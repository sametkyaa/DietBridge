import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSubscriptionOverview } from '../services/subscriptionService';
import { SubscriptionOverview } from '../types/subscription';

type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; userMessage: string }
  | { status: 'success'; overview: SubscriptionOverview };

/**
 * Loads the authoritative subscription overview once per mount and exposes a
 * safe retry. Stale responses from a superseded request are discarded.
 */
export const useSubscriptionOverview = () => {
  const [state, setState] = useState<OverviewState>({ status: 'loading' });
  const requestId = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setState({ status: 'loading' });
    const result = await fetchSubscriptionOverview();
    if (!mounted.current || currentRequest !== requestId.current) return;
    if (result.status === 'success') {
      setState({ status: 'success', overview: result.overview });
    } else {
      setState({ status: 'error', userMessage: result.userMessage });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, [load]);

  return { state, reload: load };
};
