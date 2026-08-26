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
}

export const usePlatformAdminAccess = ({ enabled }: UsePlatformAdminAccessOptions): PlatformAdminAccessState & { retry: () => void } => {
  const [state, setState] = useState<PlatformAdminAccessState>({ status: 'disabled' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'disabled' });
      return undefined;
    }

    let active = true;
    setState({ status: 'loading' });

    void checkCurrentPlatformAdmin()
      .then((isAdmin) => {
        if (active) setState({ status: isAdmin ? 'authorized' : 'denied' });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: 'error',
            message: getAdminUserMessage(error),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, enabled]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { ...state, retry };
};
