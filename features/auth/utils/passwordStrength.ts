export const PASSWORD_MIN_LENGTH = 8;

export type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  level: PasswordStrengthLevel;
  label: string;
  /** Unmet suggestions, in Turkish, shown under the field. */
  hints: string[];
}

const LABELS: Record<PasswordStrengthLevel, string> = {
  0: 'Çok zayıf',
  1: 'Zayıf',
  2: 'Orta',
  3: 'İyi',
  4: 'Güçlü',
};

/**
 * Local guidance only (the server keeps its own password policy). Scores
 * length, mixed case, digits and symbols; a short password is always "Çok
 * zayıf" and never reaches level 2.
 */
export const evaluatePasswordStrength = (password: string): PasswordStrength => {
  const hints: string[] = [];
  const longEnough = password.length >= PASSWORD_MIN_LENGTH;
  const mixedCase = /[a-zçğıöşü]/u.test(password) && /[A-ZÇĞİÖŞÜ]/u.test(password);
  const digit = /\d/.test(password);
  const symbol = /[^A-Za-z0-9ÇĞİÖŞÜçğıöşü\s]/u.test(password);
  if (!longEnough) hints.push(`En az ${PASSWORD_MIN_LENGTH} karakter`);
  if (!mixedCase) hints.push('Büyük ve küçük harf');
  if (!digit) hints.push('Rakam');
  if (!symbol) hints.push('Simge (ör. ! ? #)');
  if (!password) return { level: 0, label: LABELS[0], hints };
  if (!longEnough) return { level: password.length >= 4 ? 1 : 0, label: LABELS[password.length >= 4 ? 1 : 0], hints };
  let score = 1 + [mixedCase, digit, symbol].filter(Boolean).length;
  if (password.length >= 12 && score < 4) score += 1;
  const level = Math.min(4, score) as PasswordStrengthLevel;
  return { level, label: LABELS[level], hints };
};
