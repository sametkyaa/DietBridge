
import { supabase } from '../../lib/supabaseClient';
import { isValidUuid } from './uuid';

export const AVATAR_BUCKET = 'avatars';
export const AVATAR_SIGNED_URL_TTL_SECONDS = 5 * 60;
export const AVATAR_MAX_FILE_BYTES = 5 * 1024 * 1024;

const UUID_PATTERN_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export const AVATAR_OBJECT_PATH_PATTERN = new RegExp(
  `^(${UUID_PATTERN_SOURCE})\\/avatar\\.(?:jpe?g|png|webp)$`,
  'i',
);

/**
 * Matches any safe image filename inside a user folder, e.g.
 * `<uuid>/avatar.jpg` or `<uuid>/avatar_1719000000000.png`.
 * Used for read-only resolution; Storage RLS remains the enforcement layer.
 */
const AVATAR_FOLDER_OBJECT_PATH_PATTERN = new RegExp(
  `^(${UUID_PATTERN_SOURCE})\\/[A-Za-z0-9][A-Za-z0-9._-]*\\.(?:jpe?g|png|webp)$`,
  'i',
);

const matchesAvatarObjectPath = (objectPath: string): boolean =>
  AVATAR_OBJECT_PATH_PATTERN.test(objectPath)
  || AVATAR_FOLDER_OBJECT_PATH_PATTERN.test(objectPath);

export type ProfilePhotoAccess = {
  subjectUserId: string;
  allowPrivatePath: boolean;
};

const SUPABASE_STORAGE_OBJECT_URL_PATTERN =
  /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i;

/**
 * Extracts the canonical `avatars` bucket object path from every stored
 * representation the apps are known to write:
 * - `<owner-uuid>/avatar.<ext>` (bucket-relative object path)
 * - `<owner-uuid>/<safe-filename>.<ext>` (timestamped or custom filenames)
 * - `avatars/<owner-uuid>/avatar.<ext>` (bucket-prefixed path)
 * - full Supabase Storage URL (public, sign or authenticated variant,
 *   including expired signed URLs carrying `token` query params)
 *
 * Returns null for external URLs and non-avatar values.
 */
export const extractAvatarObjectPath = (storedValue: string): string | null => {
  const normalizedValue = storedValue.trim();
  if (!normalizedValue) return null;

  if (!/^[a-z][a-z\d+.-]*:/i.test(normalizedValue)) {
    const withoutBucketPrefix = normalizedValue.toLowerCase().startsWith(`${AVATAR_BUCKET}/`)
      ? normalizedValue.slice(AVATAR_BUCKET.length + 1)
      : normalizedValue;
    return matchesAvatarObjectPath(withoutBucketPrefix) ? withoutBucketPrefix : null;
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    const pathMatch = SUPABASE_STORAGE_OBJECT_URL_PATTERN.exec(decodeURIComponent(parsedUrl.pathname));
    if (!pathMatch) return null;
    if (pathMatch[1].toLowerCase() !== AVATAR_BUCKET) return null;
    const objectPath = pathMatch[2];
    return matchesAvatarObjectPath(objectPath) ? objectPath : null;
  } catch {
    return null;
  }
};

/**
 * Returns the owned canonical object path for a stored avatar value, or null
 * when the value does not reference an object owned by `ownerUserId`.
 */
export const getOwnedAvatarObjectPath = (
  storedValue: string | null | undefined,
  ownerUserId: string,
): string | null => {
  const normalizedValue = String(storedValue ?? '').trim();
  if (!normalizedValue || !isValidUuid(ownerUserId)) return null;

  const objectPath = extractAvatarObjectPath(normalizedValue);
  if (!objectPath) return null;

  const pathMatch = AVATAR_FOLDER_OBJECT_PATH_PATTERN.exec(objectPath)
    ?? AVATAR_OBJECT_PATH_PATTERN.exec(objectPath);
  if (!pathMatch || pathMatch[1].toLowerCase() !== ownerUserId.toLowerCase()) return null;
  return objectPath;
};

const resolveTrustedPublicAvatarUrl = (storedValue: string): string | null => {
  try {
    const parsedUrl = new URL(storedValue);
    if ((parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') || parsedUrl.username || parsedUrl.password) return null;

    const storageObjectPath = parsedUrl.pathname.toLowerCase();
    if (
      storageObjectPath.includes('/storage/v1/object/')
      && !storageObjectPath.includes('/storage/v1/object/public/')
    ) {
      return null;
    }

    if (
      parsedUrl.searchParams.has('token')
      || parsedUrl.searchParams.has('expires')
      || parsedUrl.searchParams.has('signature')
    ) {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
};

/**
 * Resolves a stored avatar value (`profiles.avatar_url`) into a displayable
 * URL. Canonical private object paths and Supabase Storage URLs pointing at
 * the private `avatars` bucket are resolved through short-lived signed URLs.
 * Trusted external HTTP(S) URLs (e.g. legacy hosted avatars) are passed through.
 *
 * Read-side authorization is deliberately left to Storage RLS/policies: the
 * stored value already comes from the subject's own profile row, so the
 * client must not reject paths merely because the folder does not match the
 * expected user id. Ownership checks apply only to delete/cleanup helpers.
 */
export async function resolveProfilePhotoUrl(
  storedValue: string | null | undefined,
  access: ProfilePhotoAccess,
): Promise<string | null> {
  const normalizedValue = String(storedValue ?? '').trim();
  if (!normalizedValue || !isValidUuid(access.subjectUserId)) return null;

  const objectPath = extractAvatarObjectPath(normalizedValue);
  if (objectPath) {
    if (!access.allowPrivatePath) return null;

    const { data, error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(objectPath, AVATAR_SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(normalizedValue)) {
    return resolveTrustedPublicAvatarUrl(normalizedValue);
  }

  return null;
}
