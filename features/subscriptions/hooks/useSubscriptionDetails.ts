import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSubscriptionDetails } from '../services/subscriptionService';
import type { SubscriptionPeriod, SubscriptionPlan } from '../types/subscription';

type DetailsState =
  | { status: 'loading' }
  | { status: 'error'; userMessage: string }
  | { status: 'success'; plans: SubscriptionPlan[]; period: SubscriptionPeriod | null };

/** Loads the plan catalog and own billing period; stale responses are dropped. */
export const useSubscriptionDetails = () => {
  const [state, setState] = useState<DetailsState>({ status: 'loading' });
  const requestId = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setState({ status: 'loading' });
    const result = await fetchSubscriptionDetails();
    if (!mounted.current || currentRequest !== requestId.current) return;
    setState(result.status === 'success'
      ? { status: 'success', plans: result.plans, period: result.period }
      : { status: 'error', userMessage: result.userMessage });
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
