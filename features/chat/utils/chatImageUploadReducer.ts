import { isValidUuid } from '../../../shared/utils/uuid';
import { isSupportedChatImageSourceMimeType } from './canonicalJpegPlan';
import {
  CanonicalChatImage,
  ChatImageSourceSummary,
  ChatImageUploadFailure,
  ChatImageUploadIntent,
  ChatImageUploadStage,
  ChatImageUploadState,
} from '../types/chatImageUpload';

/**
 * Pure state machine for the single-slot chat image upload.
 *
 * Only one upload may be in flight. Every async result carries the
 * `operationId` it was started with, so a late result from a superseded or
 * cancelled operation is dropped instead of corrupting the current state.
 */

export const initialChatImageUploadState: ChatImageUploadState = {
  status: 'idle',
  operationId: 0,
  conversationId: null,
  clientMessageId: null,
  source: null,
  previewUrl: null,
  canonical: null,
  intent: null,
  progress: null,
  error: null,
  retryStage: null,
};

export type ChatImageUploadAction =
  | {
    type: 'select';
    operationId: number;
    conversationId: string;
    clientMessageId: string;
    source: ChatImageSourceSummary;
    previewUrl: string | null;
  }
  | { type: 'start'; operationId: number }
  | { type: 'canonicalized'; operationId: number; canonical: CanonicalChatImage }
  | { type: 'intent-created'; operationId: number; intent: ChatImageUploadIntent }
  | { type: 'uploaded'; operationId: number }
  | { type: 'progress'; operationId: number; progress: number }
  | { type: 'finalized'; operationId: number }
  | {
    type: 'failed';
    operationId: number;
    error: ChatImageUploadFailure;
    retryStage: ChatImageUploadStage | null;
  }
  | { type: 'cancelled'; operationId: number }
  | { type: 'retry'; operationId: number; stage: ChatImageUploadStage }
  | { type: 'rejected'; operationId: number; error: ChatImageUploadFailure }
  | { type: 'reset' };

const isStale = (state: ChatImageUploadState, operationId: number): boolean => (
  operationId !== state.operationId
);

const isTerminal = (status: ChatImageUploadState['status']): boolean => (
  status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'idle'
);

export const chatImageUploadReducer = (
  state: ChatImageUploadState,
  action: ChatImageUploadAction,
): ChatImageUploadState => {
  if (action.type === 'reset') return { ...initialChatImageUploadState, operationId: state.operationId };

  // A new selection always wins: it carries a strictly newer operation id and
  // invalidates any in-flight work.
  if (action.type === 'select') {
    if (action.operationId <= state.operationId) return state;
    return {
      status: 'selected',
      operationId: action.operationId,
      conversationId: action.conversationId,
      clientMessageId: action.clientMessageId,
      source: action.source,
      previewUrl: action.previewUrl,
      canonical: null,
      intent: null,
      progress: null,
      error: null,
      retryStage: null,
    };
  }

  // A start that never reached the first stage (feature disabled, no
  // conversation, unsupported type) still has to surface its error.
  if (action.type === 'rejected') {
    if (action.operationId <= state.operationId) return state;
    return {
      ...initialChatImageUploadState,
      status: 'failed',
      operationId: action.operationId,
      error: action.error,
    };
  }

  if (isStale(state, action.operationId)) return state;

  switch (action.type) {
    case 'start':
      if (state.status !== 'selected') return state;
      return { ...state, status: 'canonicalizing', error: null, retryStage: null };

    case 'canonicalized':
      if (state.status !== 'canonicalizing') return state;
      return { ...state, status: 'creating-intent', canonical: action.canonical, error: null };

    case 'intent-created':
      if (state.status !== 'creating-intent') return state;
      return { ...state, status: 'uploading', intent: action.intent, error: null };

    case 'uploaded':
      if (state.status !== 'uploading') return state;
      return { ...state, status: 'finalizing', progress: null, error: null };

    case 'progress':
      if (state.status !== 'uploading') return state;
      if (!Number.isFinite(action.progress) || action.progress < 0 || action.progress > 1) return state;
      return { ...state, progress: action.progress };

    case 'finalized':
      if (state.status !== 'finalizing') return state;
      return {
        ...state,
        status: 'succeeded',
        progress: null,
        error: null,
        retryStage: null,
        source: null,
        previewUrl: null,
        canonical: null,
        intent: null,
      };

    case 'failed':
      if (isTerminal(state.status)) return state;
      return {
        ...state,
        status: 'failed',
        progress: null,
        error: action.error,
        retryStage: action.retryStage,
      };

    case 'cancelled':
      // A finished upload is never rolled back into `cancelled`.
      if (state.status === 'succeeded' || state.status === 'idle') return state;
      // Cancellation is a terminal UI state. Network/resource ownership is
      // handled by the operation lifecycle helper; the reducer only removes
      // every state value that could point at a revoked or stale resource.
      return {
        ...state,
        status: 'cancelled',
        conversationId: null,
        clientMessageId: null,
        source: null,
        previewUrl: null,
        canonical: null,
        intent: null,
        progress: null,
        error: null,
        retryStage: null,
      };

    case 'retry':
      if (state.status !== 'failed') return state;
      if (state.retryStage !== action.stage) return state;
      return { ...state, status: action.stage, progress: null, error: null, retryStage: null };

    default:
      return state;
  }
};

/**
 * Resolves the stage a failure can resume from while preserving idempotency:
 * the same `clientMessageId` (and therefore the same server intent) is reused.
 */
export const resolveRetryStage = (
  state: ChatImageUploadState,
  stage: ChatImageUploadStage,
  retryable: boolean,
): ChatImageUploadStage | null => {
  if (!retryable) return null;
  if (stage === 'canonicalizing') return 'canonicalizing';
  if (!state.canonical) return null;
  if (stage === 'creating-intent') return 'creating-intent';
  if (!state.intent) return null;
  return stage;
};

export interface ChatImageUploadStartGuard {
  readonly featureEnabled: boolean;
  readonly conversationId: string | null | undefined;
  readonly sourceMimeType: unknown;
}

export type ChatImageUploadStartDecision =
  | { readonly allowed: true; readonly conversationId: string; readonly reason?: undefined }
  | {
    readonly allowed: false;
    readonly conversationId?: undefined;
    readonly reason: 'feature_unavailable' | 'invalid_request' | 'unsupported_type';
  };

/**
 * Fail-closed gate evaluated before any RPC or Storage call.
 *
 * The image RPCs are dormant, so the flag defaults to off; and an image can
 * never be the first message of a conversation, so a missing `conversationId`
 * stops the flow before it starts.
 */
export const evaluateChatImageUploadStart = (
  guard: ChatImageUploadStartGuard,
): ChatImageUploadStartDecision => {
  if (!guard.featureEnabled) return { allowed: false, reason: 'feature_unavailable' };
  if (!isValidUuid(guard.conversationId)) return { allowed: false, reason: 'invalid_request' };
  if (!isSupportedChatImageSourceMimeType(guard.sourceMimeType)) {
    return { allowed: false, reason: 'unsupported_type' };
  }
  return { allowed: true, conversationId: guard.conversationId };
};
