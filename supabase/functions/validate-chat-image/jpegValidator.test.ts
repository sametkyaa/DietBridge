import jpeg from "jpeg-js";
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_TOTAL_PIXELS,
} from "./contracts.ts";
import {
  JPEG_DECODE_MAX_MEMORY_MB,
  JPEG_DECODE_MAX_RESOLUTION_MP,
  type JpegValidation,
  validateJpeg,
} from "./jpegValidator.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(
  actual: unknown,
  expected: unknown,
  message?: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(expected)}, received ${
          JSON.stringify(actual)
        }`,
    );
  }
}

function errorCode(result: JpegValidation): string {
  assert(!result.ok, "Expected JPEG validation to fail");
  return result.code;
}

function makeJpeg(width = 2, height = 3): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  return new Uint8Array(jpeg.encode({ data, width, height }, 80).data);
}

function withSofDimensions(
  source: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const result = source.slice();
  for (let index = 2; index + 8 < result.length; index += 1) {
    if (result[index] !== 0xff) continue;
    let markerOffset = index + 1;
    while (result[markerOffset] === 0xff) markerOffset += 1;
    const marker = result[markerOffset];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const segmentOffset = markerOffset + 1;
      result[segmentOffset + 3] = height >>> 8;
      result[segmentOffset + 4] = height & 0xff;
      result[segmentOffset + 5] = width >>> 8;
      result[segmentOffset + 6] = width & 0xff;
      return result;
    }
  }
  throw new Error("Fixture did not contain a supported SOF marker");
}

Deno.test("actual jpeg-js decode returns canonical metadata", () => {
  const result = validateJpeg(makeJpeg(2, 3));
  assert(result.ok);
  assertEquals(result.width, 2);
  assertEquals(result.height, 3);
  assert(result.byteSize > 0);
});

Deno.test("rejects non-JPEG and a truncated SOI stream", () => {
  assertEquals(
    errorCode(validateJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))),
    "invalid_image",
  );
  assertEquals(
    errorCode(validateJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))),
    "invalid_image",
  );
});

Deno.test("rejects empty and over-byte-budget content before decode", () => {
  assertEquals(errorCode(validateJpeg(new Uint8Array())), "invalid_image");
  assertEquals(
    errorCode(validateJpeg(new Uint8Array(CHAT_IMAGE_MAX_BYTES + 1))),
    "image_too_large",
  );
});

Deno.test("rejects width, height, and pixel-count header limits before decode", () => {
  const base = makeJpeg();
  assertEquals(
    errorCode(validateJpeg(withSofDimensions(base, 2049, 1))),
    "image_dimensions_exceeded",
  );
  assertEquals(
    errorCode(validateJpeg(withSofDimensions(base, 1, 2049))),
    "image_dimensions_exceeded",
  );
  assertEquals(
    errorCode(validateJpeg(withSofDimensions(base, 2048, 2049))),
    "image_dimensions_exceeded",
  );
  assertEquals(
    errorCode(validateJpeg(withSofDimensions(base, 65535, 65535))),
    "image_dimensions_exceeded",
  );
});

Deno.test("accepts exact dimension and pixel boundaries with bounded decoder options", () => {
  const source = withSofDimensions(makeJpeg(), 2048, 2048);
  let options: unknown;
  const result = validateJpeg(source, (_bytes, passedOptions) => {
    options = passedOptions;
    return { width: 2048, height: 2048 };
  });
  assert(result.ok);
  assertEquals(result.width * result.height, CHAT_IMAGE_MAX_TOTAL_PIXELS);
  assertEquals(options, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: JPEG_DECODE_MAX_RESOLUTION_MP,
    maxMemoryUsageInMB: JPEG_DECODE_MAX_MEMORY_MB,
  });
});

Deno.test("rejects decoder exceptions and header/decode mismatches without exposing the exception", () => {
  const source = makeJpeg(2, 3);
  assertEquals(
    errorCode(validateJpeg(source, () => {
      throw new Error("decoder private detail");
    })),
    "invalid_image",
  );
  assertEquals(
    errorCode(validateJpeg(source, () => ({ width: 3, height: 2 }))),
    "invalid_image",
  );
});
