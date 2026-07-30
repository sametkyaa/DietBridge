import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { env } from '../../../lib/env';
import {
  abortChatImageUploadQuietly,
  createChatImageUploadIntent,
  finalizeChatImageMessage,
  normalizeChatImageCaption,
  uploadCanonicalChatImage,
  validateChatImageUpload,
} from '../services/chatImageService';
import type { ChatImageFinalizeResult } from '../services/chatImageService';
import {
  CanonicalChatImage,
  ChatImageUploadIntent,
  ChatImageUploadStage,
  ChatImageUploadState,
  createChatImageError,
  toChatImageUploadFailure,
} from '../types/chatImageUpload';
import {
  canonicalizeChatImage,
  createBrowserCanonicalizerDeps,
  type CanonicalizeChatImageDeps,
} from '../utils/canonicalizeChatImage';
import {
  clearChatImageCanonical,
  finalizeChatImageResources,
  takeChatImageIntentForAbort,
  takeChatImagePreviewUrl,
} from '../utils/chatImageUploadResources';
import {
  chatImageUploadReducer,
  evaluateChatImageUploadStart,
  initialChatImageUploadState,
  resolveRetryStage,
} from '../utils/chatImageUploadReducer';

/**
 * Single-slot lifecycle for canonical JPEG chat images.
 *
 * Selection is deliberately local-only: `selectImage` creates an object URL
 * and moves to `selected`, but does not call RPC or Storage. `startUpload` is
 * the only entry point that can start canonicalization and network work.
 */

interface UseChatImageUploadOptions {
  conversationId?: string | null;
  /** Injected in tests; defaults to the real browser pipeline. */
  createCanonicalizerDeps?: () => CanonicalizeChatImageDeps;
  featureEnabled?: boolean;
  /** The page coordinator reconciles the full attachment-joined message. */
  onFinalized?: (result: ChatImageFinalizeResult) => Promise<void> | void;
}

export interface ChatImageUploadController {
  state: ChatImageUploadState;
  /** Local-only selection. It creates no intent and starts no upload. */
  selectImage: (file: File) => void;
  /** Starts canonicalization, intent creation, upload, validation and finalization. */
  startUpload: (caption: string | null | undefined) => Promise<void>;
  retry: () => Promise<void>;
  /** Removes a local selection or cancels an in-flight network operation. */
  cancel: () => void;
  reset: () => void;
  isEnabled: boolean;
}

interface OperationContext {
  operationId: number;
  conversationId: string;
  clientMessageId: string;
  file: File;
  controller: AbortController;
  previewUrl: string | null;
  canonical: CanonicalChatImage | null;
  intent: ChatImageUploadIntent | null;
  intentReleased: boolean;
  caption: string | null;
  finalized: boolean;
}

const revokePreview = (url: string | null): void => {
  if (!url || typeof URL === 'undefined') return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Cleanup must never mask the surrounding outcome.
  }
};

const createPreviewUrl = (file: File): string | null => {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
};

export const useChatImageUpload = (
  options: UseChatImageUploadOptions = {},
): ChatImageUploadController => {
  const {
    conversationId = null,
    createCanonicalizerDeps,
    featureEnabled = env.enableChatImages,
    onFinalized,
  } = options;

  const [state, dispatch] = useReducer(chatImageUploadReducer, initialChatImageUploadState);
  const mountedRef = useRef(false);
  const operationIdRef = useRef(0);
  const activeOperationRef = useRef<OperationContext | null>(null);
  const stateRef = useRef(state);
  const onFinalizedRef = useRef(onFinalized);
  const previousConversationIdRef = useRef<string | null>(conversationId);

  stateRef.current = state;
  onFinalizedRef.current = onFinalized;

  const disposeOperation = useCallback((operation: OperationContext | null): void => {
    if (!operation) return;
    operation.controller.abort();
    revokePreview(takeChatImagePreviewUrl(operation));
    clearChatImageCanonical(operation);
  }, []);

  /** A best-effort abort is limited to this operation's own server-issued intent. */
  const releaseIntent = useCallback((operation: OperationContext | null): void => {
    if (!operation) return;
    const intentId = takeChatImageIntentForAbort(operation);
    if (intentId) void abortChatImageUploadQuietly(intentId);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const operation = activeOperationRef.current;
      activeOperationRef.current = null;
      releaseIntent(operation);
      disposeOperation(operation);
    };
  }, [disposeOperation, releaseIntent]);

  // A selection belongs to the conversation that created it. Switching the
  // active conversation clears it (and aborts only if network work had begun).
  useEffect(() => {
    if (previousConversationIdRef.current === conversationId) return;
    previousConversationIdRef.current = conversationId;
    const operation = activeOperationRef.current;
    activeOperationRef.current = null;
    releaseIntent(operation);
    disposeOperation(operation);
    dispatch({ type: 'reset' });
  }, [conversationId, disposeOperation, releaseIntent]);

  const isCurrent = useCallback((operationId: number): boolean => (
    mountedRef.current
    && activeOperationRef.current !== null
    && activeOperationRef.current.operationId === operationId
    && !activeOperationRef.current.controller.signal.aborted
  ), []);

  const runStages = useCallback(async (
    operation: OperationContext,
    startStage: ChatImageUploadStage,
  ): Promise<void> => {
    const { operationId } = operation;
    let stage: ChatImageUploadStage = startStage;

    try {
      if (stage === 'canonicalizing') {
        const deps = (createCanonicalizerDeps ?? createBrowserCanonicalizerDeps)();
        const canonical = await canonicalizeChatImage(operation.file, {
          signal: operation.controller.signal,
          deps,
        });
        if (!isCurrent(operationId)) return;
        operation.canonical = canonical;
        dispatch({ type: 'canonicalized', operationId, canonical });
        stage = 'creating-intent';
      }

      const canonical = operation.canonical;
      if (!canonical) throw createChatImageError('invalid_request');

      if (stage === 'creating-intent') {
        const intent = await createChatImageUploadIntent({
          conversationId: operation.conversationId,
          clientMessageId: operation.clientMessageId,
        });
        if (!isCurrent(operationId)) {
          void abortChatImageUploadQuietly(intent.id);
          return;
        }
        operation.intent = intent;
        dispatch({ type: 'intent-created', operationId, intent });
        stage = 'uploading';
      }

      if (stage === 'uploading') {
        const intent = operation.intent;
        if (!intent) throw createChatImageError('invalid_request');
        await uploadCanonicalChatImage(intent, canonical);
        if (!isCurrent(operationId)) return;
        dispatch({ type: 'uploaded', operationId });
        stage = 'validating';
      }

      if (stage === 'validating') {
        const intentId = operation.intent?.id;
        if (!intentId) throw createChatImageError('invalid_request');
        await validateChatImageUpload(intentId);
        if (!isCurrent(operationId)) return;
        dispatch({ type: 'validated', operationId });
        stage = 'finalizing';
      }

      if (stage === 'finalizing') {
        const intentId = operation.intent?.id;
        if (!intentId) throw createChatImageError('invalid_request');
        const result = await finalizeChatImageMessage(intentId, operation.caption);
        operation.finalized = true;
        finalizeChatImageResources(operation);
        if (!isCurrent(operationId)) return;

        // A finalized upload never aborts. The page owns the follow-up read;
        // it must not fabricate an incomplete image message if that read fails.
        revokePreview(takeChatImagePreviewUrl(operation));
        dispatch({ type: 'finalized', operationId });
        void Promise.resolve(onFinalizedRef.current?.(result)).catch(() => undefined);
      }
    } catch (error) {
      const failure = toChatImageUploadFailure(error);
      if (failure.code === 'aborted' || !isCurrent(operationId)) {
        releaseIntent(operation);
        return;
      }

      const retryStage = resolveRetryStage(stateRef.current, stage, failure.retryable);
      // Keep the existing pending intent for a retryable upload/finalize
      // failure. All terminal failures release it to the expiry cleanup net.
      if (!retryStage) releaseIntent(operation);
      dispatch({ type: 'failed', operationId, error: failure, retryStage });
    }
  }, [createCanonicalizerDeps, isCurrent, releaseIntent]);

  const selectImage = useCallback((file: File): void => {
    const decision = evaluateChatImageUploadStart({
      featureEnabled,
      conversationId,
      sourceMimeType: file?.type,
    });

    const previous = activeOperationRef.current;
    activeOperationRef.current = null;
    releaseIntent(previous);
    disposeOperation(previous);

    const operationId = ++operationIdRef.current;
    if (!decision.allowed || !decision.conversationId) {
      dispatch({
        type: 'rejected',
        operationId,
        error: toChatImageUploadFailure(createChatImageError(decision.reason ?? 'invalid_request')),
      });
      return;
    }
    if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
      dispatch({
        type: 'rejected',
        operationId,
        error: toChatImageUploadFailure(createChatImageError('invalid_request')),
      });
      return;
    }

    const clientMessageId = crypto.randomUUID();
    const previewUrl = createPreviewUrl(file);
    const operation: OperationContext = {
      operationId,
      conversationId: decision.conversationId,
      clientMessageId,
      file,
      controller: new AbortController(),
      previewUrl,
      canonical: null,
      intent: null,
      intentReleased: false,
      caption: null,
      finalized: false,
    };
    activeOperationRef.current = operation;

    dispatch({
      type: 'select',
      operationId,
      conversationId: decision.conversationId,
      clientMessageId,
      source: { name: file.name, mimeType: file.type, byteSize: file.size },
      previewUrl,
    });
  }, [conversationId, disposeOperation, featureEnabled, releaseIntent]);

  const startUpload = useCallback(async (caption: string | null | undefined): Promise<void> => {
    const operation = activeOperationRef.current;
    if (!operation || stateRef.current.status !== 'selected') return;

    try {
      operation.caption = normalizeChatImageCaption(caption);
    } catch (error) {
      dispatch({
        type: 'failed',
        operationId: operation.operationId,
        error: toChatImageUploadFailure(error),
        retryStage: null,
      });
      return;
    }

    dispatch({ type: 'start', operationId: operation.operationId });
    await runStages(operation, 'canonicalizing');
  }, [runStages]);

  const retry = useCallback(async (): Promise<void> => {
    const operation = activeOperationRef.current;
    const stage = stateRef.current.retryStage;
    if (!operation || !stage || stateRef.current.status !== 'failed') return;
    if (operation.controller.signal.aborted) return;

    dispatch({ type: 'retry', operationId: operation.operationId, stage });
    await runStages(operation, stage);
  }, [runStages]);

  const cancel = useCallback((): void => {
    const operation = activeOperationRef.current;
    if (!operation) return;
    activeOperationRef.current = null;
    releaseIntent(operation);
    disposeOperation(operation);
    dispatch({ type: 'cancelled', operationId: operation.operationId });
  }, [disposeOperation, releaseIntent]);

  const reset = useCallback((): void => {
    const operation = activeOperationRef.current;
    activeOperationRef.current = null;
    releaseIntent(operation);
    disposeOperation(operation);
    dispatch({ type: 'reset' });
  }, [disposeOperation, releaseIntent]);

  return useMemo(() => ({
    state,
    selectImage,
    startUpload,
    retry,
    cancel,
    reset,
    isEnabled: featureEnabled,
  }), [cancel, featureEnabled, reset, retry, selectImage, startUpload, state]);
};
