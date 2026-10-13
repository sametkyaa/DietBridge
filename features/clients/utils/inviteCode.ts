export type ClientInviteMode = 'legacy_email' | 'invite_code';
export const resolveClientInviteMode = (value: unknown): ClientInviteMode => value === 'invite_code' ? 'invite_code' : 'legacy_email';
export const normalizeInviteCode = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z0-9\s-]+$/i.test(value)) return null;
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  return /^(?:[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}|DB[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{16})$/.test(code) ? code : null;
};
export const formatInviteCode = (value: string): string => {
  const code = normalizeInviteCode(value);
  if (!code) throw new Error('Geçersiz davet kodu.');
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : `DB-${code.slice(2).match(/.{4}/g)!.join('-')}`;
};
export const inviteUrl = (code: string): string => {
  const normalized = normalizeInviteCode(code);
  if (!normalized) throw new Error('Geçersiz davet kodu.');
  return `https://app.dietbridge.com.tr/davet/${normalized}`;
};
export const inviteWhatsAppUrl = (code: string): string => `https://wa.me/?text=${encodeURIComponent(`DietBridge’de bana bağlanmak için davet kodum: ${code}\n${inviteUrl(code)}`)}`;
