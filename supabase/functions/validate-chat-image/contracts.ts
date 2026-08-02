export const CHAT_IMAGE_BUCKET = "chat-images";
export const CHAT_IMAGE_MIME_TYPE = "image/jpeg";
export const CHAT_IMAGE_MAX_BYTES = 4_194_304;
export const CHAT_IMAGE_MAX_EDGE_PIXELS = 2_048;
export const CHAT_IMAGE_MAX_TOTAL_PIXELS = 4_194_304;
export const VALIDATE_REQUEST_MAX_BYTES = 1_024;

const UUID_V4_OR_V5_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Server-generated only: pending/<intent-uuid>/<object-uuid>.jpg.
export const CHAT_IMAGE_OBJECT_PATH_PATTERN = new RegExp(
  "^pending/" +
    "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/" +
    "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.jpg$",
);

export interface ChatImageIntent {
  id: string;
  conversationId: string;
  createdBy: string;
  bucketId: typeof CHAT_IMAGE_BUCKET;
  objectPath: string;
  expectedMime: typeof CHAT_IMAGE_MIME_TYPE;
  maxBytes: typeof CHAT_IMAGE_MAX_BYTES;
  status: "pending" | "finalized" | "aborted";
  expiresAt: string;
  validation: ChatImageValidationMetadata | null;
}

export interface ChatImageValidationMetadata {
  mimeType: typeof CHAT_IMAGE_MIME_TYPE;
  byteSize: number;
  width: number;
  height: number;
  validatedAt: string;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const getString = (value: UnknownRecord, key: string): string | null => (
  typeof value[key] === "string" ? value[key] as string : null
);

const getNullableString = (
  value: UnknownRecord,
  key: string,
): string | null | undefined => {
  if (!(key in value)) return undefined;
  const candidate = value[key];
  return candidate === null || typeof candidate === "string"
    ? candidate
    : undefined;
};

const getNullableNumber = (
  value: UnknownRecord,
  key: string,
): number | null | undefined => {
  if (!(key in value)) return undefined;
  const candidate = value[key];
  return candidate === null ||
      (typeof candidate === "number" && Number.isSafeInteger(candidate))
    ? candidate as number | null
    : undefined;
};

const isValidTimestamp = (value: string): boolean =>
  Number.isFinite(Date.parse(value));

export const isValidUuid = (value: unknown): value is string => (
  typeof value === "string" && UUID_V4_OR_V5_PATTERN.test(value)
);

export const isCanonicalChatImagePath = (value: unknown): value is string => (
  typeof value === "string" && CHAT_IMAGE_OBJECT_PATH_PATTERN.test(value)
);

export const isCanonicalDimensions = (
  width: unknown,
  height: unknown,
): boolean => (
  typeof width === "number" &&
  Number.isSafeInteger(width) &&
  width >= 1 &&
  width <= CHAT_IMAGE_MAX_EDGE_PIXELS &&
  typeof height === "number" &&
  Number.isSafeInteger(height) &&
  height >= 1 &&
  height <= CHAT_IMAGE_MAX_EDGE_PIXELS &&
  width * height <= CHAT_IMAGE_MAX_TOTAL_PIXELS
);

const parseValidation = (
  row: UnknownRecord,
): ChatImageValidationMetadata | null | undefined => {
  const mimeType = getNullableString(row, "validated_mime");
  const byteSize = getNullableNumber(row, "validated_byte_size");
  const width = getNullableNumber(row, "validated_width");
  const height = getNullableNumber(row, "validated_height");
  const validatedAt = getNullableString(row, "validated_at");

  if (
    mimeType === undefined || byteSize === undefined || width === undefined ||
    height === undefined || validatedAt === undefined
  ) return undefined;

  if (
    mimeType === null && byteSize === null && width === null &&
    height === null && validatedAt === null
  ) {
    return null;
  }

  if (
    mimeType !== CHAT_IMAGE_MIME_TYPE ||
    typeof byteSize !== "number" ||
    !Number.isSafeInteger(byteSize) ||
    byteSize < 1 ||
    byteSize > CHAT_IMAGE_MAX_BYTES ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !isCanonicalDimensions(width, height) ||
    typeof validatedAt !== "string" ||
    !isValidTimestamp(validatedAt)
  ) return undefined;

  return { mimeType, byteSize, width, height, validatedAt };
};

/** Fails closed unless every server-owned intent field matches the migration contract. */
export const parseChatImageIntent = (
  value: unknown,
): ChatImageIntent | null => {
  if (!isRecord(value)) return null;

  const id = getString(value, "id");
  const conversationId = getString(value, "conversation_id");
  const createdBy = getString(value, "created_by");
  const bucketId = getString(value, "bucket_id");
  const objectPath = getString(value, "object_path");
  const expectedMime = getString(value, "expected_mime");
  const maxBytes = value.max_bytes;
  const status = getString(value, "status");
  const expiresAt = getString(value, "expires_at");
  const validation = parseValidation(value);

  if (
    !isValidUuid(id) ||
    !isValidUuid(conversationId) ||
    !isValidUuid(createdBy) ||
    bucketId !== CHAT_IMAGE_BUCKET ||
    !isCanonicalChatImagePath(objectPath) ||
    expectedMime !== CHAT_IMAGE_MIME_TYPE ||
    maxBytes !== CHAT_IMAGE_MAX_BYTES ||
    (status !== "pending" && status !== "finalized" && status !== "aborted") ||
    !expiresAt ||
    !isValidTimestamp(expiresAt) ||
    validation === undefined
  ) return null;

  return {
    id,
    conversationId,
    createdBy,
    bucketId,
    objectPath,
    expectedMime,
    maxBytes: CHAT_IMAGE_MAX_BYTES,
    status,
    expiresAt,
    validation,
  };
};

export const parseIntentIdRequest = (body: string): string | null => {
  if (new TextEncoder().encode(body).byteLength > VALIDATE_REQUEST_MAX_BYTES) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(body);
    if (
      !isRecord(value) || Object.keys(value).length !== 1 ||
      !("intentId" in value)
    ) return null;
    return isValidUuid(value.intentId) ? value.intentId : null;
  } catch {
    return null;
  }
};

export const parseAuthUserId = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  const id = getString(value, "id");
  return isValidUuid(id) ? id : null;
};

export const parseSingleRow = (value: unknown): UnknownRecord | null => (
  Array.isArray(value)
    ? (value.length === 1 && isRecord(value[0]) ? value[0] : null)
    : isRecord(value)
    ? value
    : null
);
