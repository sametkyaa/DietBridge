import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { env } from '../../../lib/env';
import {
  abortChatImageUploadQuietly,
  createChatImageUploadIntent,
  finalizeChatImageMessage,
  uploadCanonicalChatImage,
} from '../services/chatImageService';
import { fetchChatMessageById } from '../services/chatService';
import {
  CanonicalChatImage,
  ChatImageUploadStage,
  ChatImageUploadState,
  ChatImageUploadIntent,
  createChatImageError,
  toChatImageUploadFailure,
} from '../types/chatImageUpload';
import {
  canonicalizeChatImage,
  createBrowserCanonicalizerDeps,
  CanonicalizeChatImageDeps,
} from '../utils/canonicalizeChatImage';
import {
  chatImageUploadReducer,
  evaluateChatImageUploadStart,
  initialChatImageUploadState,
  resolveRetryStage,
} from '../utils/chatImageUploadReducer';

/**
 * Single-slot upload lifecycle for canonical JPEG chat images.
 *
 * The hook is intentionally not wired into any component yet: the composer
 * picker and the image renderer land in a later slice. It exists so the
 * lifecycle, abort and cleanup contract can be reviewed and tested on its own.
 */

interface UseChatImageUploadOptions {
  conversationId?: string | null;
  currentUserId?: string;
  /** Injected in tests; defaults to the real browser pipeline. */
  createCanonicalizerDeps?: () => CanonicalizeChatImageDeps;
  featureEnabled?: boolean;
  onMessage?: (messageId: string) => void;
}

interface SelectChatImageInput {
  file: File;
  caption?: string | null;
}

interface ChatImageUploadController {
  state: ChatImageUploadState;
  selectImage: (input: SelectChatImageInput) => Promise<void>;
  retry: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
  isEnabled: boolean;
}

interface OperationContext {
  operationId: number;
  conversationId: string;
  clientMessageId: string;
  caption: string | null;
  file: File;
  controller: AbortController;
  previewUrl: string | null;
  finalized: boolean;
}

const revokePreview = (url: string | null): void => {
  if (!url) return;
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
    currentUserId,
    createCanonicalizerDeps,
    featureEnabled = env.enableChatImages,
    onMessage,
  } = options;

  const [state, dispatch] = useReducer(chatImageUploadReducer, initialChatImageUploadState);
  const mountedRef = useRef(false);
  const operationIdRef = useRef(0);
  const activeOperationRef = useRef<OperationContext | null>(null);
  const onMessageRef = useRef(onMessage);
  const intentIdRef = useRef<string | null>(null);
  const canonicalRef = useRef<CanonicalChatImage | null>(null);
  const intentRef = useRef<ChatImageUploadIntent | null>(null);
  const stateRef = useRef(state);

  onMessageRef.current = onMessage;
  stateRef.current = state;

  const disposeOperation = useCallback((operation: OperationContext | null): void => {
    if (!operation) return;
    operation.controller.abort();
    revokePreview(operation.previewUrl);
  }, []);

  /**
   * Best-effort abort for an intent that was created but never finalized. A
   * finalized intent is never aborted; when the abort itself fails the
   * expiry-driven cleanup queue remains the safety net.
   */
  const releaseIntent = useCallback((operation: OperationContext | null): void => {
    const intentId = intentIdRef.current;
    if (!intentId || operation?.finalized) return;
    intentIdRef.current = null;
    void abortChatImageUploadQuietly(intentId);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const operation = activeOperationRef.current;
      activeOperationRef.current = null;
      releaseIntent(operation);
      disposeOperation(operation);
      canonicalRef.current = null;
    };
  }, [disposeOperation, releaseIntent]);

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
        canonicalRef.current = canonical;
        dispatch({ type: 'canonicalized', operationId, canonical });
        stage = 'creating-intent';
      }

      const canonical = canonicalRef.current;
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
        intentIdRef.current = intent.id;
        intentRef.current = intent;
        dispatch({ type: 'intent-created', operationId, intent });
        stage = 'uploading';
      }

      const intentId = intentIdRef.current;
      if (!intentId) throw createChatImageError('invalid_request');

      if (stage === 'uploading') {
        const intent = intentRef.current;
        if (!intent) throw createChatImageError('invalid_request');
        await uploadCanonicalChatImage(intent, canonical);
        if (!isCurrent(operationId)) return;
        dispatch({ type: 'uploaded', operationId });
        stage = 'finalizing';
      }

      if (stage === 'finalizing') {
        const result = await finalizeChatImageMessage(intentId, operation.caption);
        operation.finalized = true;
        intentIdRef.current = null;
        intentRef.current = null;
        if (!isCurrent(operationId)) return;

        const message = await fetchChatMessageById(
          result.messageId,
          result.conversationId,
          currentUserId ?? result.senderId,
        );
        if (!isCurrent(operationId)) return;
        if (!message) throw createChatImageError('invalid_response');

        dispatch({ type: 'finalized', operationId, message });
        onMessageRef.current?.(message.id);
      }
    } catch (error) {
      const failure = toChatImageUploadFailure(error);
      if (failure.code === 'aborted' || !isCurrent(operationId)) {
        releaseIntent(operation);
        return;
      }
      releaseIntent(operation);
      dispatch({
        type: 'failed',
        operationId,
        error: failure,
        retryStage: resolveRetryStage(stateRef.current, stage, failure.retryable),
      });
    }
  }, [createCanonicalizerDeps, currentUserId, isCurrent, releaseIntent]);

  const selectImage = useCallback(async (input: SelectChatImageInput): Promise<void> => {
    const decision = evaluateChatImageUploadStart({
      featureEnabled,
      conversationId,
      sourceMimeType: input.file?.type,
    });

    // A new selection always supersedes the previous operation.
    const previous = activeOperationRef.current;
    activeOperationRef.current = null;
    releaseIntent(previous);
    disposeOperation(previous);
    canonicalRef.current = null;
    intentRef.current = null;

    const operationId = ++operationIdRef.current;
    if (!decision.allowed || !decision.conversationId) {
      dispatch({
        type: 'rejected',
        operationId,
        error: toChatImageUploadFailure(createChatImageError(decision.reason ?? 'invalid_request')),
      });
      return;
    }

    const clientMessageId = crypto.randomUUID();
    const previewUrl = createPreviewUrl(input.file);
    const resolvedConversationId = decision.conversationId;
    const operation: OperationContext = {
      operationId,
      conversationId: resolvedConversationId,
      clientMessageId,
      caption: typeof input.caption === 'string' ? input.caption : null,
      file: input.file,
      controller: new AbortController(),
      previewUrl,
      finalized: false,
    };
    activeOperationRef.current = operation;

    dispatch({
      type: 'select',
      operationId,
      conversationId: resolvedConversationId,
      clientMessageId,
      source: {
        name: input.file.name,
        mimeType: input.file.type,
        byteSize: input.file.size,
      },
      previewUrl,
    });

    await runStages(operation, 'canonicalizing');
  }, [conversationId, disposeOperation, featureEnabled, releaseIntent, runStages]);

  const retry = useCallback(async (): Promise<void> => {
    const operation = activeOperationRef.current;
    const stage = stateRef.current.retryStage;
    if (!operation || !stage || stateRef.current.status !== 'failed') return;
    if (operation.controller.signal.aborted) return;

    // Retry keeps the same clientMessageId and intent, preserving the server
    // idempotency contract.
    dispatch({ type: 'retry', operationId: operation.operationId, stage });
    await runStages(operation, stage);
  }, [runStages]);

  const cancel = useCallback((): void => {
    const operation = activeOperationRef.current;
    if (!operation) return;
    activeOperationRef.current = null;
    releaseIntent(operation);
    disposeOperation(operation);
    canonicalRef.current = null;
    intentRef.current = null;
    dispatch({ type: 'cancelled', operationId: operation.operationId });
  }, [disposeOperation, releaseIntent]);

  const reset = useCallback((): void => {
    const operation = activeOperationRef.current;
    activeOperationRef.current = null;
    releaseIntent(operation);
    disposeOperation(operation);
    canonicalRef.current = null;
    intentRef.current = null;
    dispatch({ type: 'reset' });
  }, [disposeOperation, releaseIntent]);

  return useMemo(() => ({
    state,
    selectImage,
    retry,
    cancel,
    reset,
    isEnabled: featureEnabled,
  }), [cancel, featureEnabled, reset, retry, selectImage, state]);
};
