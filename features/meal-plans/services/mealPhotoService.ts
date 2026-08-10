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

export interface MealPhotoCleanupResult {
  warning: string | null;
}

const CLEANUP_INFRASTRUCTURE_WARNING = 'Öğün görseli temizlik altyapısı kullanılamıyor; plan kaydı korundu ancak eski görseller otomatik temizlenemeyebilir.';
const CLEANUP_PENDING_WARNING = 'Bazı eski öğün görselleri arka planda temizlenmeyi bekliyor; plan kaydı başarıyla korundu.';
const FAILED_SAVE_CLEANUP_WARNING = 'Plan kaydedilemedi ve yeni görsel otomatik temizlik kuyruğuna alınamadı. Lütfen tekrar deneyin veya destek ekibine bildirin.';

const isCleanupInfrastructureUnavailable = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message : '';
  return record.code === 'PGRST202'
    || record.status === 404
    || /could not find the function|function .* does not exist/i.test(message);
};

export const processPendingMealPhotoCleanup = async (): Promise<MealPhotoCleanupResult> => {
  const { data, error } = await supabase.rpc('get_my_meal_photo_cleanup_status');
  if (error) {
    return { warning: isCleanupInfrastructureUnavailable(error)
      ? CLEANUP_INFRASTRUCTURE_WARNING
      : 'Öğün görsellerinin temizlik durumu doğrulanamadı; plan kaydı korundu ve temizlik arka planda yeniden denenecek.' };
  }

  return typeof data === 'number' && Number.isInteger(data) && data > 0
    ? { warning: CLEANUP_PENDING_WARNING }
    : typeof data === 'number' && Number.isInteger(data) && data === 0
      ? { warning: null }
      : { warning: CLEANUP_INFRASTRUCTURE_WARNING };
};

export const cleanupFailedMealPhotoUploads = async (objectPaths: string[]): Promise<MealPhotoCleanupResult> => {
  const uniquePaths = Array.from(new Set(objectPaths.filter(isCanonicalMealPhotoPath)));
  let queueFailures = 0;

  for (const objectPath of uniquePaths) {
    const { error } = await supabase.rpc('enqueue_my_unreferenced_meal_photo_cleanup', {
      p_object_path: objectPath,
    });
    if (error) queueFailures += 1;
  }

  if (queueFailures > 0) return { warning: FAILED_SAVE_CLEANUP_WARNING };

  const cleanup = await processPendingMealPhotoCleanup();
  return cleanup.warning
    ? cleanup
    : { warning: CLEANUP_PENDING_WARNING };
};
