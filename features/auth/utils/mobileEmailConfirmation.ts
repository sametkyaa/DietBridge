export const MOBILE_EMAIL_CONFIRMATION_PATH = '/mobil/eposta-dogrulama';

export const isMobileEmailConfirmationPath = (pathname: string): boolean =>
  pathname.replace(/\/$/, '') === MOBILE_EMAIL_CONFIRMATION_PATH;

export type MobileEmailCallback =
  | { status: 'ready'; accessToken: string }
  | { status: 'expired' | 'invalid' };

// A URL marker such as ?confirmed=true is never evidence of confirmation.
export const parseMobileEmailCallback = (search: string, hash: string): MobileEmailCallback => {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const error = fragment.get('error_code') || query.get('error_code')
    || fragment.get('error') || query.get('error');
  if (error) return { status: error === 'otp_expired' ? 'expired' : 'invalid' };
  const type = fragment.get('type') || query.get('type');
  const token = fragment.get('access_token') || query.get('access_token');
  if (type !== 'signup' || !token?.trim()
      || fragment.getAll('access_token').length + query.getAll('access_token').length !== 1) {
    return { status: 'invalid' };
  }
  return { status: 'ready', accessToken: token };
};
