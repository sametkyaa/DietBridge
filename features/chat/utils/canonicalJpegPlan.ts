import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_EDGE_PIXELS,
  CHAT_IMAGE_MAX_TOTAL_PIXELS,
  CHAT_IMAGE_MIME_TYPE,
} from '../types/chatImage';

/**
 * Pure planning rules for the canonical JPEG-only chat image contract.
 *
 * The backend (`20260729090000_chat_image_schema.sql`,
 * `20260729090200_chat_image_rpc.sql`) only ever accepts `image/jpeg` at most
 * 2048 px on the longest edge, at most 4194304 total pixels and at most
 * 4194304 bytes. Clients are therefore required to decode the picked file and
 * re-encode it as a canonical JPEG *before* an upload intent is created.
 *
 * This module holds no browser API: every decision is a pure function so the
 * contract can be tested without a DOM.
 */

/** Source formats a picker may hand over. The output is always JPEG. */
export const CHAT_IMAGE_SOURCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ChatImageSourceMimeType = (typeof CHAT_IMAGE_SOURCE_MIME_TYPES)[number];

/**
 * Bounded quality ladder. The first step is the quality target; the remaining
 * steps are only attempted when the previous encode exceeded the byte budget.
 * The list is intentionally finite: there is no open-ended search loop.
 */
export const CHAT_IMAGE_JPEG_QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58] as const;

export const CHAT_IMAGE_INITIAL_JPEG_QUALITY = CHAT_IMAGE_JPEG_QUALITY_STEPS[0];

export const CHAT_IMAGE_OUTPUT_MIME_TYPE = CHAT_IMAGE_MIME_TYPE;

export const CHAT_IMAGE_OUTPUT_EXTENSION = 'jpg';

export interface ChatImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface CanonicalJpegPlan {
  readonly sourceMimeType: ChatImageSourceMimeType;
  readonly source: ChatImageDimensions;
  readonly target: ChatImageDimensions;
  readonly resizeRequired: boolean;
  readonly qualitySteps: readonly number[];
  readonly outputMimeType: typeof CHAT_IMAGE_OUTPUT_MIME_TYPE;
  readonly outputExtension: typeof CHAT_IMAGE_OUTPUT_EXTENSION;
  readonly maxBytes: number;
}

export type CanonicalJpegPlanFailure = 'unsupported_type' | 'invalid_dimensions';

/**
 * Both variants declare both keys (one of them as `undefined`) so the result
 * can be inspected without relying on discriminated-union narrowing, which the
 * repository's non-strict TypeScript configuration does not apply here.
 */
export type CanonicalJpegPlanResult =
  | { readonly ok: true; readonly plan: CanonicalJpegPlan; readonly reason?: undefined }
  | { readonly ok: false; readonly plan?: undefined; readonly reason: CanonicalJpegPlanFailure };

export const isSupportedChatImageSourceMimeType = (
  value: unknown,
): value is ChatImageSourceMimeType => (
  typeof value === 'string'
  && (CHAT_IMAGE_SOURCE_MIME_TYPES as readonly string[]).includes(value)
);

/**
 * Dimensions must be finite, positive, safe integers. Zero, negative, NaN,
 * Infinity and fractional values are rejected fail-closed.
 */
export const isValidSourceDimension = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value >= 1
);

export const isAcceptableCanonicalJpegSize = (byteSize: unknown): byteSize is number => (
  typeof byteSize === 'number'
  && Number.isSafeInteger(byteSize)
  && byteSize >= 1
  && byteSize <= CHAT_IMAGE_MAX_BYTES
);

/**
 * Returns the next lower quality step, or `null` when the ladder is exhausted.
 * Callers use this to guarantee a terminating encode loop.
 */
export const resolveNextJpegQuality = (quality: number): number | null => {
  const index = CHAT_IMAGE_JPEG_QUALITY_STEPS.indexOf(quality as (typeof CHAT_IMAGE_JPEG_QUALITY_STEPS)[number]);
  if (index < 0 || index === CHAT_IMAGE_JPEG_QUALITY_STEPS.length - 1) return null;
  return CHAT_IMAGE_JPEG_QUALITY_STEPS[index + 1];
};

const scaleDimensions = (
  dimensions: ChatImageDimensions,
  scale: number,
): ChatImageDimensions => ({
  width: Math.max(1, Math.floor(dimensions.width * scale)),
  height: Math.max(1, Math.floor(dimensions.height * scale)),
});

/**
 * Applies the longest-edge limit and the total-pixel limit together while
 * preserving the aspect ratio. Both constraints are applied in sequence so a
 * wide-but-short image cannot bypass the pixel budget.
 */
export const resolveCanonicalJpegDimensions = (
  source: ChatImageDimensions,
): ChatImageDimensions | null => {
  if (!isValidSourceDimension(source.width) || !isValidSourceDimension(source.height)) {
    return null;
  }

  const longestEdge = Math.max(source.width, source.height);
  const edgeScale = longestEdge > CHAT_IMAGE_MAX_EDGE_PIXELS
    ? CHAT_IMAGE_MAX_EDGE_PIXELS / longestEdge
    : 1;
  const edgeConstrained = edgeScale === 1 ? source : scaleDimensions(source, edgeScale);

  const totalPixels = edgeConstrained.width * edgeConstrained.height;
  const pixelConstrained = totalPixels > CHAT_IMAGE_MAX_TOTAL_PIXELS
    ? scaleDimensions(edgeConstrained, Math.sqrt(CHAT_IMAGE_MAX_TOTAL_PIXELS / totalPixels))
    : edgeConstrained;

  // Flooring can only shrink, but the `max(1, ...)` clamp above means a
  // degenerate aspect ratio could still breach a limit. Reject instead of
  // shipping an out-of-contract image.
  if (
    pixelConstrained.width > CHAT_IMAGE_MAX_EDGE_PIXELS
    || pixelConstrained.height > CHAT_IMAGE_MAX_EDGE_PIXELS
    || pixelConstrained.width * pixelConstrained.height > CHAT_IMAGE_MAX_TOTAL_PIXELS
  ) {
    return null;
  }

  return pixelConstrained;
};

export interface CanonicalJpegPlanInput {
  readonly sourceMimeType: unknown;
  readonly width: unknown;
  readonly height: unknown;
}

export const planCanonicalJpeg = (input: CanonicalJpegPlanInput): CanonicalJpegPlanResult => {
  if (!isSupportedChatImageSourceMimeType(input.sourceMimeType)) {
    return { ok: false, reason: 'unsupported_type' };
  }
  if (!isValidSourceDimension(input.width) || !isValidSourceDimension(input.height)) {
    return { ok: false, reason: 'invalid_dimensions' };
  }

  const source: ChatImageDimensions = { width: input.width, height: input.height };
  const target = resolveCanonicalJpegDimensions(source);
  if (!target) return { ok: false, reason: 'invalid_dimensions' };

  return {
    ok: true,
    plan: {
      sourceMimeType: input.sourceMimeType,
      source,
      target,
      resizeRequired: target.width !== source.width || target.height !== source.height,
      qualitySteps: CHAT_IMAGE_JPEG_QUALITY_STEPS,
      outputMimeType: CHAT_IMAGE_OUTPUT_MIME_TYPE,
      outputExtension: CHAT_IMAGE_OUTPUT_EXTENSION,
      maxBytes: CHAT_IMAGE_MAX_BYTES,
    },
  };
};
