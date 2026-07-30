import { supabase } from '../../../lib/supabaseClient';
import { isValidUuid } from '../../../shared/utils/uuid';
import { CHAT_IMAGE_BUCKET_ID, CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_MAX_EDGE_PIXELS, CHAT_IMAGE_MAX_TOTAL_PIXELS, CHAT_IMAGE_MIME_TYPE, CHAT_IMAGE_OBJECT_PATH_PATTERN, type ChatImageAttachment } from '../types/chatImage';
import type { ChatMessage } from '../types/chat';

export const CHAT_IMAGE_SIGNED_URL_TTL_SECONDS = 300;
export const CHAT_IMAGE_SIGNED_URL_REFRESH_MS = 240_000;
export const CHAT_IMAGE_SIGNED_URL_CACHE_LIMIT = 100;

interface CachedUrl { url: string; refreshedAt: number; }
type UrlMap = ReadonlyMap<string, string>;

const cache = new Map<string, CachedUrl>();
const inFlight = new Map<string, Promise<string | null>>();

const isFresh = (entry: CachedUrl, now: number): boolean => now - entry.refreshedAt < CHAT_IMAGE_SIGNED_URL_REFRESH_MS;

const touch = (path: string, entry: CachedUrl): void => {
  cache.delete(path);
  cache.set(path, entry);
  while (cache.size > CHAT_IMAGE_SIGNED_URL_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
};

export const isReadableChatImageAttachment = (attachment: unknown): attachment is ChatImageAttachment => {
  if (!attachment || typeof attachment !== 'object') return false;
  const item = attachment as ChatImageAttachment;
  return isValidUuid(item.id)
    && isValidUuid(item.messageId)
    && item.bucketId === CHAT_IMAGE_BUCKET_ID
    && typeof item.objectPath === 'string'
    && CHAT_IMAGE_OBJECT_PATH_PATTERN.test(item.objectPath)
    && item.mimeType === CHAT_IMAGE_MIME_TYPE
    && Number.isSafeInteger(item.byteSize) && item.byteSize > 0 && item.byteSize <= CHAT_IMAGE_MAX_BYTES
    && Number.isSafeInteger(item.width) && item.width > 0 && item.width <= CHAT_IMAGE_MAX_EDGE_PIXELS
    && Number.isSafeInteger(item.height) && item.height > 0 && item.height <= CHAT_IMAGE_MAX_EDGE_PIXELS
    && item.width * item.height <= CHAT_IMAGE_MAX_TOTAL_PIXELS
    && item.deletedAt === null;
};

export const getReadableChatImagePath = (message: Pick<ChatMessage, 'id' | 'messageKind' | 'deletedAt' | 'attachment'>): string | null => (
  message.messageKind === 'image'
  && message.deletedAt === null
  && isReadableChatImageAttachment(message.attachment)
  && message.attachment.messageId === message.id
    ? message.attachment.objectPath
    : null
);

export const purgeChatImageSignedUrl = (path: string | null | undefined): void => {
  if (typeof path !== 'string') return;
  cache.delete(path);
};

export const clearChatImageSignedUrlCache = (): void => {
  cache.clear();
  inFlight.clear();
};

const cacheUrl = (path: string, url: string): string => {
  touch(path, { url, refreshedAt: Date.now() });
  return url;
};

const requestSignedUrls = async (paths: readonly string[]): Promise<UrlMap> => {
  if (paths.length === 0) return new Map();
  const { data, error } = await supabase.storage
    .from(CHAT_IMAGE_BUCKET_ID)
    .createSignedUrls([...paths], CHAT_IMAGE_SIGNED_URL_TTL_SECONDS);
  if (error || !Array.isArray(data)) return new Map();
  const urls = new Map<string, string>();
  for (const entry of data) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.signedUrl !== 'string') continue;
    if (paths.includes(entry.path) && entry.signedUrl) urls.set(entry.path, cacheUrl(entry.path, entry.signedUrl));
  }
  return urls;
};

/**
 * Resolves a normalized attachment set with one bulk Storage call. A stale URL
 * is never returned after a tombstone because callers purge it before asking.
 */
export const resolveChatImageSignedUrls = async (
  messages: readonly Pick<ChatMessage, 'id' | 'messageKind' | 'deletedAt' | 'attachment'>[],
  options: { forceRefresh?: boolean } = {},
): Promise<UrlMap> => {
  const paths = [...new Set(messages.map(getReadableChatImagePath).filter((path): path is string => path !== null))];
  const now = Date.now();
  const resolved = new Map<string, string>();
  const missing: string[] = [];
  for (const path of paths) {
    const entry = cache.get(path);
    if (!options.forceRefresh && entry && isFresh(entry, now)) {
      touch(path, entry);
      resolved.set(path, entry.url);
    } else if (!inFlight.has(path)) {
      missing.push(path);
    }
  }
  if (missing.length > 0) {
    const batch = requestSignedUrls(missing);
    for (const path of missing) inFlight.set(path, batch.then((urls) => urls.get(path) ?? null));
    try {
      const urls = await batch;
      for (const [path, url] of urls) resolved.set(path, url);
    } finally {
      for (const path of missing) inFlight.delete(path);
    }
  }
  for (const path of paths) {
    if (resolved.has(path)) continue;
    const pending = inFlight.get(path);
    if (!pending) continue;
    const url = await pending;
    if (url) resolved.set(path, url);
  }
  return resolved;
};

export const getCachedChatImageSignedUrl = (path: string): string | null => {
  const entry = cache.get(path);
  if (!entry || !isFresh(entry, Date.now())) return null;
  touch(path, entry);
  return entry.url;
};
