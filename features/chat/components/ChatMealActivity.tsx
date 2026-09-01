import React from 'react';
import { Image as ImageIcon, Utensils } from 'lucide-react';
import type { MealActivity } from '../types/mealActivity';
import type { MealActivityPhotoState } from '../hooks/useMealActivityPhotoUrls';
import { getMealActivityPhotoPath } from '../utils/mealActivity';
import { formatMealTrackingCompletionTime, MEAL_TYPE_LABELS } from '../../meal-tracking/utils/mealTrackingContract';

interface ChatMealActivityProps {
  activity: MealActivity;
  photoState: MealActivityPhotoState;
  onOpenPhoto: () => void;
}

const ChatMealActivity: React.FC<ChatMealActivityProps> = ({ activity, photoState, onOpenPhoto }) => {
  const mealLabel = MEAL_TYPE_LABELS[activity.mealType];
  const completionTime = formatMealTrackingCompletionTime(activity.completedAt);
  const photoPath = getMealActivityPhotoPath(activity);

  return (
    <article
      data-chat-activity-id={activity.id}
      className="flex justify-center"
      aria-label={`${mealLabel} tamamlandı öğün aktivitesi`}
    >
      <div className="w-full max-w-md rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-emerald-950 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-white p-2 text-emerald-700" aria-hidden="true">
            <Utensils className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">🍽 {mealLabel} tamamlandı</p>
            <p className="mt-1 break-words text-sm text-emerald-800">{activity.mealTitle}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700">
              <time dateTime={activity.completedAt}>{completionTime ?? 'Tamamlandı'}</time>
              <span aria-hidden="true">·</span>
              <span>{activity.mealTime}</span>
            </div>
          </div>
        </div>
        {photoPath && photoState.url && (
          <button
            type="button"
            onClick={onOpenPhoto}
            className="mt-3 block w-full overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            aria-label={`${mealLabel} öğün fotoğrafını büyüt`}
          >
            <img src={photoState.url} alt={`${mealLabel} öğün fotoğrafı`} className="max-h-64 w-full object-cover" />
          </button>
        )}
        {photoPath && photoState.loading && (
          <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white/70 px-3 py-4 text-xs text-emerald-700" role="status">
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            Görsel yükleniyor…
          </div>
        )}
        {photoPath && photoState.error && !photoState.loading && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800" role="status">
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            Görsel kullanılamıyor.
          </div>
        )}
      </div>
    </article>
  );
};

export default ChatMealActivity;
