export type ClientInviteMode = 'legacy_email' | 'invite_code';
export const resolveClientInviteMode = (value: unknown): ClientInviteMode => value === 'invite_code' ? 'invite_code' : 'legacy_email';
export const normalizeInviteCode = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z0-9\s-]+$/i.test(value)) return null;
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  return /^DB[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{16}$/.test(code) ? code : null;
};
export const inviteUrl = (code: string): string => {
  const normalized = normalizeInviteCode(code);
  if (!normalized) throw new Error('Geçersiz davet kodu.');
  return `https://app.dietbridge.com.tr/davet/${normalized}`;
};
export const inviteWhatsAppUrl = (code: string): string => `https://wa.me/?text=${encodeURIComponent(`DietBridge’de bana bağlanmak için davet kodum: ${code}\n${inviteUrl(code)}`)}`;
