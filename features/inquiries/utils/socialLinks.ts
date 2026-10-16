// Mirrors public.dietitian_social_links_valid. The database constraint is the
// real gate; this copy only gives the form field-level messages.
export const SOCIAL_LINK_KEYS = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'website'] as const;
export type SocialLinkKey = (typeof SOCIAL_LINK_KEYS)[number];
export type SocialLinks = Partial<Record<SocialLinkKey, string>>;

export const SOCIAL_LINK_LABELS: Record<SocialLinkKey, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
  website: 'Web sitesi',
};

export const SOCIAL_LINK_PLACEHOLDERS: Record<SocialLinkKey, string> = {
  instagram: 'https://instagram.com/kullaniciadi',
  tiktok: 'https://tiktok.com/@kullaniciadi',
  youtube: 'https://youtube.com/@kanal',
  linkedin: 'https://linkedin.com/in/kullaniciadi',
  x: 'https://x.com/kullaniciadi',
  website: 'https://ornek.com',
};

const MAX_LENGTH = 200;
const BASE = /^https:\/\/[^\s/?#@]+(\/\S*)?$/;
const HOSTS: Partial<Record<SocialLinkKey, RegExp>> = {
  instagram: /^https:\/\/(www\.)?instagram\.com\//i,
  tiktok: /^https:\/\/(www\.)?tiktok\.com\//i,
  youtube: /^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\//i,
  linkedin: /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i,
  x: /^https:\/\/(www\.)?(x\.com|twitter\.com)\//i,
};

export const validateSocialLink = (key: SocialLinkKey, value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_LENGTH) return `Bağlantı en fazla ${MAX_LENGTH} karakter olabilir.`;
  if (!BASE.test(trimmed)) return 'Bağlantı https:// ile başlamalı ve boşluk içermemelidir.';
  const host = HOSTS[key];
  if (host && !host.test(trimmed)) return `Geçerli bir ${SOCIAL_LINK_LABELS[key]} bağlantısı girin.`;
  return null;
};

export const normalizeSocialLinks = (input: unknown): SocialLinks => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: SocialLinks = {};
  for (const key of SOCIAL_LINK_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) result[key] = value.trim();
  }
  return result;
};

export const validateSocialLinks = (links: SocialLinks): Partial<Record<SocialLinkKey, string>> => {
  const errors: Partial<Record<SocialLinkKey, string>> = {};
  for (const key of SOCIAL_LINK_KEYS) {
    const message = validateSocialLink(key, links[key] ?? '');
    if (message) errors[key] = message;
  }
  return errors;
};
