import { Fragment, useCallback } from 'react';
import { Badge, Card, CardHeader, Chip, EmptyState, ErrorState, Icon, LoadingState, LinkButton, cx } from '../../../../shared/ui';
import { MEAL_TYPE_LABELS } from '../../../meal-tracking/utils/mealTrackingContract';
import { fetchClientMealsForDate, type ProfileMeal } from '../../services/clientProfileService';
import { useProfileSection } from '../../hooks/useProfileSection';
import { formatDecimal } from '../../utils/clientProfileContract';

const formatCompletedAt = (value: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(date);
};

const mealName = (meal: ProfileMeal): string => {
  const slot = meal.slotLabel ?? MEAL_TYPE_LABELS[meal.type];
  return meal.title ? `${slot} · ${meal.title}` : slot;
};

export interface ClientTodayMealsCardProps {
  clientId: string;
  todayKey: string;
  nowTime: string;
  refreshToken: number;
  planNavigationState: { clientId: string };
}

/** Today's planned meals in plan order with real completion state. */
export const ClientTodayMealsCard = ({ clientId, todayKey, nowTime, refreshToken, planNavigationState }: ClientTodayMealsCardProps) => {
  const loader = useCallback(() => fetchClientMealsForDate(clientId, todayKey), [clientId, todayKey]);
  const { state, reload } = useProfileSection(loader, refreshToken);
  const meals = state.status === 'success' ? state.data : null;
  const completed = meals?.filter((meal) => meal.isEaten).length ?? 0;

  return (
    <Card as="section" aria-labelledby="client-today-meals-title">
      <CardHeader
        id="client-today-meals-title"
        title="Bugünün öğünleri"
        addon={meals && meals.length > 0 ? <Chip className="h-6">{meals.length} öğün</Chip> : undefined}
        actions={meals && meals.length > 0 ? <Badge tone={completed === meals.length ? 'ok' : 'brand'}>{completed} / {meals.length} tamamlandı</Badge> : undefined}
      />
      {state.status === 'loading' ? (
        <LoadingState label="Öğünler yükleniyor…" className="py-6" />
      ) : state.status === 'error' ? (
        <ErrorState compact description="Bugünün öğünleri yüklenemedi." onRetry={() => void reload()} />
      ) : meals === null ? (
        <EmptyState
          compact
          icon="bowl-food"
          title="Bugün için plan yok."
          action={<LinkButton to="/meal-plans" state={planNavigationState} variant="secondary" size="sm" leftIcon="plus">Plan oluştur</LinkButton>}
        />
      ) : meals.length === 0 ? (
        <EmptyState compact icon="bowl-food" title="Bugünün planında öğün yok." />
      ) : (
        <ul className="m-0 list-none p-0">
          {meals.map((meal) => {
            const late = !meal.isEaten && meal.time !== null && meal.time < nowTime;
            const completedAt = formatCompletedAt(meal.completedAt);
            return (
              <Fragment key={meal.id}>
                <li className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
                  <span
                    aria-hidden="true"
                    className={cx(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-full',
                      meal.isEaten ? 'bg-ok-bg text-ok' : 'border border-line-strong text-ink-3',
                    )}
                  >
                    {meal.isEaten ? <Icon name="check" size={15} /> : <Icon name="clock" size={14} />}
                  </span>
                  <span className="w-12 shrink-0 text-13 font-semibold tabular-nums text-ink-2">{meal.time ?? '—'}</span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate font-semibold">{mealName(meal)}</b>
                    <span className="block text-12.5 text-ink-3">
                      <span className="sr-only">{meal.isEaten ? 'Tamamlandı. ' : 'Bekliyor. '}</span>
                      {meal.isEaten
                        ? `${completedAt ? `${completedAt}'de ` : ''}${meal.hasCompletionPhoto ? 'fotoğrafla ' : ''}işaretlendi`
                        : late ? 'Henüz işaretlenmedi' : 'Bekliyor'}
                    </span>
                  </div>
                  {meal.hasCompletionPhoto && <Icon name="camera" size={17} className="shrink-0 text-ink-3" title="Fotoğraf var" />}
                  {late && <Badge tone="warn" size="sm">Saati geçti</Badge>}
                  <span className={cx('shrink-0 text-13 tabular-nums', meal.isEaten ? 'text-ink' : 'text-ink-3')}>
                    {meal.calories !== null ? `${formatDecimal(meal.calories)} kcal` : ''}
                  </span>
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </Card>
  );
};
