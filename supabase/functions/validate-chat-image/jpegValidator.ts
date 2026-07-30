import jpeg from "jpeg-js";
import { CHAT_IMAGE_MAX_BYTES, isCanonicalDimensions } from "./contracts.ts";

// 4,194,304 RGBA pixels require 16 MiB. 24 MB leaves bounded decoder overhead
// above the maximum 4 MiB compressed input without accepting an open-ended buffer.
export const JPEG_DECODE_MAX_MEMORY_MB = 24;
export const JPEG_DECODE_MAX_RESOLUTION_MP = 4.194304;

export type JpegValidationErrorCode =
  | "invalid_image"
  | "image_too_large"
  | "image_dimensions_exceeded";

export interface DecodedJpeg {
  width: number;
  height: number;
}

export type JpegDecoder = (
  bytes: Uint8Array,
  options: {
    useTArray: true;
    formatAsRGBA: true;
    maxResolutionInMP: number;
    maxMemoryUsageInMB: number;
  },
) => DecodedJpeg;

export interface JpegValidationResult {
  ok: true;
  byteSize: number;
  width: number;
  height: number;
}

export interface JpegValidationFailure {
  ok: false;
  code: JpegValidationErrorCode;
}

export type JpegValidation = JpegValidationResult | JpegValidationFailure;

const defaultDecoder: JpegDecoder = (bytes, options) =>
  jpeg.decode(bytes, options);

const isSofMarker = (marker: number): boolean => (
  marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
  marker === 0xc5 || marker === 0xc6 || marker === 0xc7 ||
  marker === 0xc9 || marker === 0xca || marker === 0xcb ||
  marker === 0xcd || marker === 0xce || marker === 0xcf
);

interface JpegHeaderDimensions {
  width: number;
  height: number;
}

/**
 * Parses only enough of the JPEG marker stream to bound a later full decode.
 * It is never accepted as validation by itself: `validateJpeg` always decodes.
 */
export const parseJpegHeaderDimensions = (
  bytes: Uint8Array,
): JpegHeaderDimensions | null => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;

    if (isSofMarker(marker)) {
      if (segmentLength < 8) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width >= 1 && height >= 1 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
};

export const validateJpeg = (
  bytes: Uint8Array,
  decoder: JpegDecoder = defaultDecoder,
): JpegValidation => {
  if (bytes.byteLength < 1 || bytes.byteLength > CHAT_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      code: bytes.byteLength > CHAT_IMAGE_MAX_BYTES
        ? "image_too_large"
        : "invalid_image",
    };
  }

  const header = parseJpegHeaderDimensions(bytes);
  if (!header) return { ok: false, code: "invalid_image" };
  if (!isCanonicalDimensions(header.width, header.height)) {
    return { ok: false, code: "image_dimensions_exceeded" };
  }

  let decoded: DecodedJpeg;
  try {
    decoded = decoder(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: JPEG_DECODE_MAX_RESOLUTION_MP,
      maxMemoryUsageInMB: JPEG_DECODE_MAX_MEMORY_MB,
    });
  } catch {
    return { ok: false, code: "invalid_image" };
  }

  if (!isCanonicalDimensions(decoded.width, decoded.height)) {
    return { ok: false, code: "image_dimensions_exceeded" };
  }
  if (decoded.width !== header.width || decoded.height !== header.height) {
    return { ok: false, code: "invalid_image" };
  }

  return {
    ok: true,
    byteSize: bytes.byteLength,
    width: decoded.width,
    height: decoded.height,
  };
};
