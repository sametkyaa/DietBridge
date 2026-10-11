// Consent state is private and is not a client Realtime feed. Revalidate
// visible health projections; hiding the page invalidates pending responses.
export const HEALTH_DATA_REFRESH_MS = 60_000;

export const subscribeToHealthDataRefresh = (
  refresh: () => void | Promise<unknown>,
  invalidate: () => void,
): (() => void) => {
  const onFocus = () => { if (document.visibilityState !== 'hidden') void refresh(); };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') invalidate();
    else onFocus();
  };
  const timer = window.setInterval(onFocus, HEALTH_DATA_REFRESH_MS);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibility);
    invalidate();
  };
};
