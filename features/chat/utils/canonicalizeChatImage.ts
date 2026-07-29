import {
  CHAT_IMAGE_JPEG_QUALITY_STEPS,
  CHAT_IMAGE_OUTPUT_MIME_TYPE,
  ChatImageDimensions,
  isAcceptableCanonicalJpegSize,
  planCanonicalJpeg,
} from './canonicalJpegPlan';
import {
  CanonicalChatImage,
  ChatImageError,
  createChatImageError,
} from '../types/chatImageUpload';

/**
 * Browser adapter that turns a picked JPEG/PNG/WebP into the canonical JPEG
 * required by the dormant backend contract.
 *
 * Metadata stripping is a consequence of the pipeline: the file is decoded to
 * pixels (with EXIF orientation already applied by the decoder) and re-encoded
 * from a canvas, so no EXIF/ICC/XMP segment survives.
 *
 * Every browser dependency is injected so the whole adapter can be exercised
 * from Node with fakes; no DOM is required by the module itself.
 */

export interface DecodedChatImage extends ChatImageDimensions {
  /** Drawable handle passed straight to the canvas adapter. */
  readonly source: unknown;
  readonly close: () => void;
}

export interface CanonicalizerCanvas {
  drawImage: (image: DecodedChatImage, target: ChatImageDimensions) => void;
  encodeJpeg: (quality: number) => Promise<Blob | null>;
  dispose?: () => void;
}

export interface CanonicalizeChatImageDeps {
  /** Decodes the file applying EXIF orientation. */
  decodeImage: (blob: Blob) => Promise<DecodedChatImage>;
  /** Optional high-quality downscale before rasterizing. */
  resizeImage?: (image: DecodedChatImage, target: ChatImageDimensions) => Promise<DecodedChatImage>;
  createCanvas: (target: ChatImageDimensions) => CanonicalizerCanvas;
}

export interface CanonicalizeChatImageOptions {
  readonly signal?: AbortSignal;
  readonly deps: CanonicalizeChatImageDeps;
}

interface ChatImageFileLike {
  readonly type: string;
  readonly size: number;
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw createChatImageError('aborted');
};

const closeQuietly = (image: DecodedChatImage | null): void => {
  if (!image) return;
  try {
    image.close();
  } catch {
    // Cleanup must never mask the original outcome.
  }
};

const disposeQuietly = (canvas: CanonicalizerCanvas | null): void => {
  if (!canvas?.dispose) return;
  try {
    canvas.dispose();
  } catch {
    // Cleanup must never mask the original outcome.
  }
};

const toChatImageError = (error: unknown): ChatImageError => (
  error instanceof ChatImageError
    ? error
    : createChatImageError('decode_failed', { cause: error })
);

/**
 * Produces the canonical JPEG for `file`, or throws a `ChatImageError`.
 *
 * The quality ladder is finite and ordered; the first encode at or below the
 * byte budget wins. When every step is still too large the caller gets
 * `output_too_large` instead of an unbounded search.
 */
export const canonicalizeChatImage = async (
  file: Blob & ChatImageFileLike,
  options: CanonicalizeChatImageOptions,
): Promise<CanonicalChatImage> => {
  const { signal, deps } = options;
  throwIfAborted(signal);

  if (!file || typeof file.size !== 'number' || file.size <= 0) {
    throw createChatImageError('decode_failed');
  }

  let decoded: DecodedChatImage | null = null;
  let resized: DecodedChatImage | null = null;
  let canvas: CanonicalizerCanvas | null = null;

  try {
    decoded = await deps.decodeImage(file);
    throwIfAborted(signal);

    const planned = planCanonicalJpeg({
      sourceMimeType: file.type,
      width: decoded.width,
      height: decoded.height,
    });
    const plan = planned.plan;
    if (!planned.ok || !plan) {
      throw createChatImageError(planned.reason ?? 'invalid_dimensions');
    }

    let drawable = decoded;
    if (plan.resizeRequired && deps.resizeImage) {
      resized = await deps.resizeImage(decoded, plan.target);
      throwIfAborted(signal);
      drawable = resized;
    }

    canvas = deps.createCanvas(plan.target);
    canvas.drawImage(drawable, plan.target);

    for (const quality of CHAT_IMAGE_JPEG_QUALITY_STEPS) {
      throwIfAborted(signal);
      const encoded = await canvas.encodeJpeg(quality);
      throwIfAborted(signal);

      if (!encoded) throw createChatImageError('decode_failed');
      if (encoded.type !== CHAT_IMAGE_OUTPUT_MIME_TYPE) {
        throw createChatImageError('decode_failed');
      }
      if (!isAcceptableCanonicalJpegSize(encoded.size)) continue;

      return {
        blob: encoded,
        byteSize: encoded.size,
        quality,
        width: plan.target.width,
        height: plan.target.height,
        mimeType: CHAT_IMAGE_OUTPUT_MIME_TYPE,
      };
    }

    throw createChatImageError('output_too_large');
  } catch (error) {
    throw toChatImageError(error);
  } finally {
    // Runs on success, failure and abort alike.
    closeQuietly(resized);
    closeQuietly(decoded);
    disposeQuietly(canvas);
  }
};

interface BrowserCanonicalizerGlobals {
  readonly createImageBitmap?: (
    source: Blob | ImageBitmap,
    options?: ImageBitmapOptions,
  ) => Promise<ImageBitmap>;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly createImageElement: () => HTMLImageElement;
  readonly createCanvasElement: () => HTMLCanvasElement;
}

const resolveBrowserGlobals = (): BrowserCanonicalizerGlobals => {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw createChatImageError('feature_unavailable');
  }

  return {
    createImageBitmap: typeof createImageBitmap === 'function' ? createImageBitmap : undefined,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createImageElement: () => document.createElement('img'),
    createCanvasElement: () => document.createElement('canvas'),
  };
};

const decodeWithImageElement = async (
  blob: Blob,
  globals: BrowserCanonicalizerGlobals,
): Promise<DecodedChatImage> => {
  const objectUrl = globals.createObjectURL(blob);
  const image = globals.createImageElement();

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(createChatImageError('decode_failed'));
      image.src = objectUrl;
    });
  } catch (error) {
    globals.revokeObjectURL(objectUrl);
    throw toChatImageError(error);
  }

  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    source: image,
    // The object URL stays alive while the element is drawable and is revoked
    // by the shared cleanup path.
    close: () => {
      image.src = '';
      globals.revokeObjectURL(objectUrl);
    },
  };
};

/**
 * Real browser dependencies: `createImageBitmap` when available (with EXIF
 * orientation applied and high-quality resizing), otherwise an object-URL +
 * `HTMLImageElement` fallback.
 */
export const createBrowserCanonicalizerDeps = (): CanonicalizeChatImageDeps => {
  const globals = resolveBrowserGlobals();

  return {
    decodeImage: async (blob) => {
      if (!globals.createImageBitmap) return decodeWithImageElement(blob, globals);

      const bitmap = await globals.createImageBitmap(blob, { imageOrientation: 'from-image' });
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close: () => bitmap.close(),
      };
    },
    resizeImage: globals.createImageBitmap
      ? async (image, target) => {
        const createBitmap = globals.createImageBitmap;
        if (!createBitmap || !(image.source instanceof ImageBitmap)) return image;

        const bitmap = await createBitmap(image.source, {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high',
        });
        return {
          width: bitmap.width,
          height: bitmap.height,
          source: bitmap,
          close: () => bitmap.close(),
        };
      }
      : undefined,
    createCanvas: (target) => {
      const canvas = globals.createCanvasElement();
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext('2d');
      if (!context) throw createChatImageError('feature_unavailable');

      return {
        drawImage: (image, size) => {
          context.drawImage(image.source as CanvasImageSource, 0, 0, size.width, size.height);
        },
        encodeJpeg: (quality) => new Promise<Blob | null>((resolve) => {
          canvas.toBlob((blob) => resolve(blob), CHAT_IMAGE_OUTPUT_MIME_TYPE, quality);
        }),
        dispose: () => {
          canvas.width = 0;
          canvas.height = 0;
        },
      };
    },
  };
};
