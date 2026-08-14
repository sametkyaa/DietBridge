import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, CheckCircle2, Clock3, Utensils } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import ChatImageViewer from '../features/chat/components/ChatImageViewer';
import { getMealImagePreviewUrls } from '../features/meal-plans/services/mealImagePreviewService';
import {
  fetchMealTracking,
  getMealTrackingUserMessage,
} from '../features/meal-tracking/services/mealTrackingService';
import {
  formatMealTrackingCompletionTime,
  formatMealTrackingDate,
  getMealTrackingRange,
  getMealTrackingStatus,
  MEAL_TYPE_LABELS,
} from '../features/meal-tracking/utils/mealTrackingContract';
import type { MealTrackingDay, MealTrackingFilter } from '../features/meal-tracking/types/mealTracking';
import { getIstanbulDateKey } from '../features/analytics/utils/analyticsContract';
import { isValidUuid } from '../shared/utils/uuid';

type PageStatus = 'loading' | 'ready' | 'error';

const MealTracking = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const clientId = isValidUuid(id) ? id : null;
  const [filter, setFilter] = useState<MealTrackingFilter>('today');
  const [selectedDate, setSelectedDate] = useState(() => getIstanbulDateKey());
  const [status, setStatus] = useState<PageStatus>('loading');
  const [days, setDays] = useState<MealTrackingDay[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [photoPreviews, setPhotoPreviews] = useState<Map<string, string>>(new Map());
  const [viewer, setViewer] = useState<{ url: string; caption: string } | null>(null);
  const requestSequence = useRef(0);

  const range = useMemo(() => {
    try {
      return getMealTrackingRange(filter, selectedDate);
    } catch {
      return null;
    }
  }, [filter, selectedDate]);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!clientId || !range) {
      setStatus('error');
      setErrorMessage('Danışan bağlantısı geçersiz.');
      setDays([]);
      setPhotoPreviews(new Map());
      return;
    }

    setStatus('loading');
    setErrorMessage(null);
    try {
      const nextDays = await fetchMealTracking(clientId, range.startDate, range.endDate);
      if (requestId !== requestSequence.current) return;
      setDays(nextDays);
      setStatus('ready');

      const references = nextDays.flatMap((day) => day.meals
        .map((meal) => meal.photoPath)
        .filter((path): path is string => path !== null));
      if (references.length === 0) {
        setPhotoPreviews(new Map());
        return;
      }
      const previews = await getMealImagePreviewUrls(references);
      if (requestId === requestSequence.current) setPhotoPreviews(previews);
    } catch (cause) {
      if (requestId !== requestSequence.current) return;
      setStatus('error');
      setDays([]);
      setPhotoPreviews(new Map());
      setErrorMessage(getMealTrackingUserMessage(cause));
    }
  }, [clientId, range]);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const today = getIstanbulDateKey();

  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-5xl p-4 sm:p-6 lg:p-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg font-medium text-slate-500 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        Danışan detayına dön
      </button>

      <header className="mb-6 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Operasyonel takip</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-800 sm:text-3xl">
              <Utensils className="h-7 w-7 text-primary" aria-hidden="true" />
              Öğün Takibi
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">
              Bu danışanın planlı öğünlerinden hangilerinin tamamlandığını gerçek kayıtlarla görüntüleyin.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Öğün takip aralığı">
            {([
              ['today', 'Bugün'],
              ['7d', 'Son 7 Gün'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`min-h-11 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${filter === value ? 'bg-primary text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
            <label className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${filter === 'date' ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-700'}`}>
              <span className="sr-only">Tarih seç</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => {
                  setSelectedDate(event.target.value);
                  setFilter('date');
                }}
                aria-label="Öğün takip tarihi seç"
                className="min-h-9 rounded-lg border-0 bg-transparent p-0 text-sm font-semibold outline-none"
              />
            </label>
          </div>
        </div>
      </header>

      {status === 'loading' && (
        <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-sm text-slate-500 shadow-sm" role="status">
          Öğün takip kayıtları yükleniyor…
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center shadow-sm" role="alert">
          <p className="font-semibold text-rose-900">Öğün takip kayıtları yüklenemedi.</p>
          <p className="mt-2 text-sm text-rose-800">{errorMessage}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 min-h-11 rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
          >
            Tekrar dene
          </button>
        </div>
      )}

      {status === 'ready' && days.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm" role="status">
          <Utensils className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
          <p className="mt-3 font-semibold text-slate-700">Bu tarih aralığında planlı öğün bulunmuyor.</p>
          <p className="mt-1 text-sm text-slate-500">Plan oluşturulduğunda tamamlanma durumu burada görünecek.</p>
        </div>
      )}

      {status === 'ready' && days.length > 0 && (
        <div className="space-y-5">
          {days.map((day) => (
            <section key={day.date} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-6" aria-labelledby={`meal-day-${day.date}`}>
              <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <h2 id={`meal-day-${day.date}`} className="font-bold text-slate-800">
                  {formatMealTrackingDate(day.date)}
                </h2>
                <p className="text-sm font-semibold text-slate-600">
                  {day.completedCount}/{day.plannedCount} tamamlandı · %{day.percentage ?? 0}
                </p>
              </div>

              <div className="mt-4 space-y-3">
                {day.meals.map((meal) => {
                  const mealStatus = getMealTrackingStatus(meal, day.date, today);
                  const completionTime = formatMealTrackingCompletionTime(meal.completedAt);
                  const photoUrl = meal.photoPath ? photoPreviews.get(meal.photoPath) ?? null : null;
                  const statusLabel = mealStatus === 'completed'
                    ? `Tamamlandı${completionTime ? ` · ${completionTime}` : ''}`
                    : mealStatus === 'unmarked' ? 'İşaretlenmedi' : 'Bekliyor';

                  return (
                    <article key={meal.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className={`mt-0.5 rounded-full p-2 ${mealStatus === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-slate-400'}`} aria-hidden="true">
                          {mealStatus === 'completed' ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-500">{meal.time} · {MEAL_TYPE_LABELS[meal.type]}</p>
                          <h3 className="mt-1 break-words font-semibold text-slate-800">{meal.title}</h3>
                          <p className={`mt-1 text-sm font-medium ${mealStatus === 'completed' ? 'text-emerald-700' : mealStatus === 'unmarked' ? 'text-slate-500' : 'text-amber-700'}`}>
                            {statusLabel}
                          </p>
                        </div>
                      </div>
                      {photoUrl && (
                        <button
                          type="button"
                          onClick={() => setViewer({ url: photoUrl, caption: `${meal.title} fotoğrafı` })}
                          className="group inline-flex min-h-16 min-w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          aria-label={`${meal.title} fotoğrafını büyüt`}
                        >
                          <img src={photoUrl} alt={`${meal.title} fotoğrafı`} className="h-16 w-16 object-cover transition-transform group-hover:scale-105" />
                        </button>
                      )}
                      {meal.photoPath && !photoUrl && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-400" role="status">
                          <Camera className="h-4 w-4" aria-hidden="true" />
                          Görsel hazır değil
                        </span>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {viewer && <ChatImageViewer url={viewer.url} caption={viewer.caption} onClose={() => setViewer(null)} />}
      <div className="sr-only" aria-live="polite">{range ? `${range.startDate} – ${range.endDate}` : ''}</div>
    </div>
  );
};

export default MealTracking;
