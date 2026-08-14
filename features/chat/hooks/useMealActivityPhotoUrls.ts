import { useEffect, useMemo, useState } from 'react';
import { getMealImagePreviewUrls } from '../../meal-plans/services/mealImagePreviewService';
import type { MealActivity } from '../types/mealActivity';

export interface MealActivityPhotoState {
  url: string | null;
  loading: boolean;
  error: boolean;
}

const EMPTY_PHOTO_STATE: MealActivityPhotoState = { url: null, loading: false, error: false };

export const useMealActivityPhotoUrls = (activities: readonly MealActivity[]) => {
  const photoKey = useMemo(
    () => activities.map((activity) => `${activity.id}:${activity.photoPath ?? ''}`).join('|'),
    [activities],
  );
  const [states, setStates] = useState<Record<string, MealActivityPhotoState>>({});

  useEffect(() => {
    const nextStates: Record<string, MealActivityPhotoState> = {};
    activities.forEach((activity) => {
      nextStates[activity.id] = activity.photoPath
        ? { url: null, loading: true, error: false }
        : EMPTY_PHOTO_STATE;
    });
    setStates(nextStates);

    const references = activities
      .map((activity) => activity.photoPath)
      .filter((path): path is string => path !== null);
    if (references.length === 0) return undefined;

    let active = true;
    void getMealImagePreviewUrls(references)
      .then((previews) => {
        if (!active) return;
        setStates((current) => {
          const resolved: Record<string, MealActivityPhotoState> = {};
          activities.forEach((activity) => {
            const url = activity.photoPath ? previews.get(activity.photoPath) ?? null : null;
            resolved[activity.id] = activity.photoPath
              ? { url, loading: false, error: url === null }
              : EMPTY_PHOTO_STATE;
          });
          return { ...current, ...resolved };
        });
      })
      .catch(() => {
        if (!active) return;
        setStates((current) => {
          const failed: Record<string, MealActivityPhotoState> = {};
          activities.forEach((activity) => {
            failed[activity.id] = activity.photoPath
              ? { url: null, loading: false, error: true }
              : EMPTY_PHOTO_STATE;
          });
          return { ...current, ...failed };
        });
      });

    return () => {
      active = false;
    };
  }, [activities, photoKey]);

  return {
    states,
    empty: EMPTY_PHOTO_STATE,
  };
};
