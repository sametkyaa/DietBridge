export type AuthLifecycleAction =
  | 'ignore_initial_session'
  | 'update_session_only'
  | 'resolve_access'
  | 'clear_access';

export const getAuthLifecycleAction = (
  event: string,
  nextUserId: string | null,
  currentUserId: string | null,
  accessResolved: boolean,
): AuthLifecycleAction => {
  if (event === 'INITIAL_SESSION') return 'ignore_initial_session';
  if (event === 'SIGNED_OUT' || !nextUserId) return 'clear_access';

  if (currentUserId && currentUserId === nextUserId && accessResolved) {
    return 'update_session_only';
  }

  return 'resolve_access';
};
