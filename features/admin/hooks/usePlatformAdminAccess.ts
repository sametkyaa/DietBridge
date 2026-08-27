import { useCallback, useEffect, useState } from 'react';
import { checkCurrentPlatformAdmin, getAdminUserMessage } from '../services/adminService';

export type PlatformAdminAccessState =
  | { status: 'disabled' }
  | { status: 'loading' }
  | { status: 'authorized' }
  | { status: 'denied' }
  | { status: 'error'; message: string };

interface UsePlatformAdminAccessOptions {
  enabled: boolean;
  userId: string | null;
}

export const usePlatformAdminAccess = ({ enabled, userId }: UsePlatformAdminAccessOptions): PlatformAdminAccessState & { retry: () => void } => {
  const [state, setState] = useState<PlatformAdminAccessState>({ status: 'disabled' });
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !userId) {
      setState({ status: 'disabled' });
      setResolvedUserId(null);
      return undefined;
    }

    let active = true;
    setState({ status: 'loading' });
    setResolvedUserId(null);

    void checkCurrentPlatformAdmin()
      .then((isAdmin) => {
        if (active) {
          setResolvedUserId(userId);
          setState({ status: isAdmin ? 'authorized' : 'denied' });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setResolvedUserId(userId);
          setState({
            status: 'error',
            message: getAdminUserMessage(error),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, enabled, userId]);

  const retry = useCallback(() => {
    setResolvedUserId(null);
    setAttempt((current) => current + 1);
  }, []);

  const visibleState: PlatformAdminAccessState = !enabled || !userId
    ? { status: 'disabled' }
    : resolvedUserId === userId
      ? state
      : { status: 'loading' };

  return { ...visibleState, retry };
};
