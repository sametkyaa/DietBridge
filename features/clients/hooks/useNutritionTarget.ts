import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidUuid } from '../../../shared/utils/uuid';
import {
  fetchNutritionTarget,
  NUTRITION_TARGET_LOAD_ERROR,
  NutritionTargetServiceError,
  type NutritionTarget,
} from '../services/nutritionTargetService';

export type NutritionTargetState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; target: NutritionTarget | null }
  | { status: 'error'; message: string };

/** Reads the dietitian-owned kcal target of one client (plan editor, analytics, profile). */
export const useNutritionTarget = (clientId: string | null) => {
  const [state, setState] = useState<NutritionTargetState>({ status: 'idle' });
  const versionRef = useRef(0);

  const reload = useCallback(async () => {
    const version = ++versionRef.current;
    if (!clientId || !isValidUuid(clientId)) {
      setState({ status: 'idle' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const target = await fetchNutritionTarget(clientId);
      if (version === versionRef.current) setState({ status: 'success', target });
    } catch (error) {
      if (version !== versionRef.current) return;
      setState({
        status: 'error',
        message: error instanceof NutritionTargetServiceError ? error.userMessage : NUTRITION_TARGET_LOAD_ERROR,
      });
    }
  }, [clientId]);

  useEffect(() => {
    void reload();
    return () => {
      versionRef.current += 1;
    };
  }, [reload]);

  const setTarget = useCallback((target: NutritionTarget | null) => {
    setState({ status: 'success', target });
  }, []);

  return { state, reload, setTarget };
};
