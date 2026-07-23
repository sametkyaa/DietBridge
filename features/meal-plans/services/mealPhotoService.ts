import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';

export const MEAL_PHOTO_BUCKET = 'meal-photos';
export const MEAL_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const MEAL_PHOTO_SIGNED_URL_SECONDS = 5 * 60;

const SIGNED_URL_REFRESH_WINDOW_MS = 4 * 60 * 1000;
const CANONICAL_MEAL_PHOTO_PATH = /^meal-plans\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/;

const MIME_TO_EXTENSION: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type MealPhotoValidationCode =
  | 'INVALID_MEAL_PHOTO_PATH'
  | 'INVALID_MEAL_PHOTO_FILE'
  | 'MEAL_PHOTO_TOO_LARGE'
  | 'MEAL_PHOTO_UPLOAD_FAILED';

export class MealPhotoValidationError extends Error {
  constructor(public readonly code: MealPhotoValidationCode) {
    super(code);
    this.name = 'MealPhotoValidationError';
  }
}

interface SignedPhotoCacheEntry {
  url: string;
  refreshAfter: number;
}

const signedPhotoCache = new Map<string, SignedPhotoCacheEntry>();

export const isCanonicalMealPhotoPath = (value: unknown): value is string => (
  typeof value === 'string' && CANONICAL_MEAL_PHOTO_PATH.test(value)
);

export function assertCanonicalMealPhotoPath(value: unknown): asserts value is string {
  if (!isCanonicalMealPhotoPath(value)) {
    throw new MealPhotoValidationError('INVALID_MEAL_PHOTO_PATH');
  }
}

const LEGACY_MEAL_PHOTO_HOST = 'images.unsplash.com';

/**
 * Read-only compatibility validator for legacy production rows whose photo_url
 * holds a full HTTPS URL instead of a canonical Storage object path.
 *
 * Write paths must never accept this shape; uploads and new records still
 * require isCanonicalMealPhotoPath. Only the exact images.unsplash.com host
 * over https is accepted (no credentials, no port or subdomain variations).
 */
export const isLegacyMealPhotoUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return parsed.protocol === 'https:'
    && parsed.host === LEGACY_MEAL_PHOTO_HOST
    && parsed.username === ''
    && parsed.password === '';
};

/**
 * Accepts every photo reference that is safe to read from existing rows:
 * a canonical Supabase Storage object path or an allowlisted legacy URL.
 */
export const isReadableMealPhotoReference = (value: unknown): value is string => (
  isCanonicalMealPhotoPath(value) || isLegacyMealPhotoUrl(value)
);

export const validateMealPhotoFile = (file: File): void => {
  if (!(file instanceof File) || !MIME_TO_EXTENSION[file.type]) {
    throw new MealPhotoValidationError('INVALID_MEAL_PHOTO_FILE');
  }
  if (file.size <= 0 || file.size > MEAL_PHOTO_MAX_BYTES) {
    throw new MealPhotoValidationError('MEAL_PHOTO_TOO_LARGE');
  }
};

export const createMealPhotoLocalPreview = (file: File): string => {
  validateMealPhotoFile(file);
  return URL.createObjectURL(file);
};

const assertUploadInput = (file: File, clientId: string, dietitianId: string): void => {
  if (!isValidUuid(clientId) || !isValidUuid(dietitianId)) {
    throw new MealPhotoValidationError('INVALID_MEAL_PHOTO_PATH');
  }
  validateMealPhotoFile(file);
};

const createCanonicalPath = (clientId: string, dietitianId: string, file: File): string => (
  `meal-plans/${clientId}/${dietitianId}/${crypto.randomUUID()}.${MIME_TO_EXTENSION[file.type]}`
);

export const uploadMealPhoto = async ({
  file,
  clientId,
  dietitianId,
}: {
  file: File;
  clientId: string;
  dietitianId: string;
}): Promise<string> => {
  assertUploadInput(file, clientId, dietitianId);
  const objectPath = createCanonicalPath(clientId, dietitianId, file);

  const { error } = await supabase.storage
    .from(MEAL_PHOTO_BUCKET)
    .upload(objectPath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new MealPhotoValidationError('MEAL_PHOTO_UPLOAD_FAILED');
  }

  return objectPath;
};

export const getMealPhotoPreviewUrl = async (objectPath: string): Promise<string> => {
  assertCanonicalMealPhotoPath(objectPath);
  const cached = signedPhotoCache.get(objectPath);
  if (cached && cached.refreshAfter > Date.now()) {
    return cached.url;
  }

  const { data, error } = await supabase.storage
    .from(MEAL_PHOTO_BUCKET)
    .createSignedUrl(objectPath, MEAL_PHOTO_SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new MealPhotoValidationError('INVALID_MEAL_PHOTO_PATH');
  }

  signedPhotoCache.set(objectPath, {
    url: data.signedUrl,
    refreshAfter: Date.now() + SIGNED_URL_REFRESH_WINDOW_MS,
  });
  return data.signedUrl;
};

export const getMealPhotoPreviewUrls = async (objectPaths: string[]): Promise<Map<string, string>> => {
  const uniquePaths = Array.from(new Set(objectPaths));
  const previews = await Promise.allSettled(uniquePaths.map(async (path) => {
    assertCanonicalMealPhotoPath(path);
    return [path, await getMealPhotoPreviewUrl(path)] as const;
  }));

  return new Map(previews.flatMap((result) => (
    result.status === 'fulfilled' ? [result.value] : []
  )));
};

type CleanupRow = {
  cleanup_id: unknown;
  object_path: unknown;
  attempt_count: unknown;
};

export interface MealPhotoCleanupResult {
  warning: string | null;
}

const isCleanupInfrastructureUnavailable = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : '';
  return record.code === 'PGRST202'
    || record.status === 404
    || /could not find the function|function .* does not exist/i.test(message);
};

const getPendingCleanupRows = async (): Promise<Array<{ cleanupId: string; objectPath: string }>> => {
  const { data, error } = await supabase.rpc('list_my_pending_meal_photo_cleanup');
  if (error) {
    if (isCleanupInfrastructureUnavailable(error)) return [];
    throw new MealPhotoValidationError('MEAL_PHOTO_UPLOAD_FAILED');
  }
  if (!Array.isArray(data)) throw new MealPhotoValidationError('MEAL_PHOTO_UPLOAD_FAILED');

  return (data as CleanupRow[]).flatMap((row) => {
    if (!isValidUuid(row.cleanup_id) || !isCanonicalMealPhotoPath(row.object_path)) {
      return [];
    }
    return [{ cleanupId: row.cleanup_id, objectPath: row.object_path }];
  });
};

export const processPendingMealPhotoCleanup = async (): Promise<MealPhotoCleanupResult> => {
  let pending: Array<{ cleanupId: string; objectPath: string }>;
  try {
    pending = await getPendingCleanupRows();
  } catch (error) {
    if (isCleanupInfrastructureUnavailable(error)) return { warning: null };
    return {
      warning: 'Eski öğün görsellerinin temizlik durumu doğrulanamadı; plan kaydı korundu ve temizlik yeniden denenecek.',
    };
  }
  let failures = 0;

  for (const item of pending) {
    const { error: attemptError } = await supabase.rpc('record_my_meal_photo_cleanup_attempt', {
      p_cleanup_id: item.cleanupId,
    });
    if (attemptError) {
      failures += 1;
      continue;
    }

    const { error: removeError } = await supabase.storage
      .from(MEAL_PHOTO_BUCKET)
      .remove([item.objectPath]);

    if (removeError) {
      failures += 1;
      continue;
    }

    const { error: completeError } = await supabase.rpc('complete_my_meal_photo_cleanup', {
      p_cleanup_id: item.cleanupId,
    });
    if (completeError) failures += 1;
  }

  return {
    warning: failures > 0
      ? 'Bazı eski öğün görselleri henüz temizlenemedi; plan kaydı korundu ve temizlik yeniden denenecek.'
      : null,
  };
};

export const cleanupFailedMealPhotoUploads = async (objectPaths: string[]): Promise<MealPhotoCleanupResult> => {
  const uniquePaths = Array.from(new Set(objectPaths.filter(isCanonicalMealPhotoPath)));
  let queueFailures = 0;

  for (const objectPath of uniquePaths) {
    const { error } = await supabase.rpc('enqueue_my_unreferenced_meal_photo_cleanup', {
      p_object_path: objectPath,
    });
    if (error && !isCleanupInfrastructureUnavailable(error)) queueFailures += 1;
  }

  const cleanup = await processPendingMealPhotoCleanup();
  if (queueFailures > 0 || cleanup.warning) {
    return {
      warning: 'Plan kaydedilemedi. Yeni görsel için temizlik tamamlanamadı; güvenli yeniden deneme kaydı tutuldu.',
    };
  }

  return cleanup;
};
