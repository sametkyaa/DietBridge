import { Fragment, useCallback, useState } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Icon, LoadingState } from '../../../../shared/ui';
import { fetchPendingMealChangeRequests } from '../../../meal-change-requests/services/mealChangeRequestService';
import { MealChangeRequestReviewDialog } from '../../../meal-change-requests/components/MealChangeRequestReviewDialog';
import { formatMealChangeSlots } from '../../../meal-change-requests/utils/mealChangeRequestContract';
import type { MealChangeRequest } from '../../../meal-change-requests/types/mealChangeRequest';
import { useProfileSection } from '../../hooks/useProfileSection';

const formatPlanDay = (dateKey: string): string => new Intl.DateTimeFormat('tr-TR', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
}).format(new Date(`${dateKey}T00:00:00Z`));

const formatCreatedAt = (value: string): string => new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
}).format(new Date(value));

/** Pending meal change requests of this client; decisions go through the review RPC dialog. */
export const ClientChangeRequestsCard = ({ clientId, refreshToken }: { clientId: string; refreshToken: number }) => {
  const loader = useCallback(() => fetchPendingMealChangeRequests({ clientId, limit: 20 }), [clientId]);
  const { state, reload } = useProfileSection(loader, refreshToken);
  const [selected, setSelected] = useState<MealChangeRequest | null>(null);
  const requests = state.status === 'success' ? state.data : null;

  return (
    <Card as="section" aria-labelledby="client-change-requests-title">
      <CardHeader
        id="client-change-requests-title"
        title="Öğün değişiklik talepleri"
        addon={requests && requests.length > 0 ? <Badge tone="warn" size="sm">{requests.length} bekliyor</Badge> : undefined}
      />
      {state.status === 'loading' ? (
        <LoadingState label="Talepler yükleniyor…" className="py-4" />
      ) : state.status === 'error' ? (
        <ErrorState compact description="Öğün değişiklik talepleri yüklenemedi." onRetry={() => void reload()} />
      ) : requests && requests.length === 0 ? (
        <EmptyState compact icon="swap" title="Bekleyen talep yok." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {(requests ?? []).map((request) => (
            <Fragment key={request.id}>
              <li className="flex flex-wrap items-start gap-3 rounded-db border border-line px-3.5 py-3">
                <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-db bg-warn-bg text-warn">
                  <Icon name="swap" size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block font-semibold"><span className="capitalize">{formatPlanDay(request.planDate)}</span> · {formatMealChangeSlots(request.requestedSlots)}</b>
                  {request.notes && <p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-13 text-ink-2">“{request.notes}”</p>}
                  <span className="mt-1 block text-12 text-ink-3">{formatCreatedAt(request.createdAt)}</span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setSelected(request)}>İncele</Button>
              </li>
            </Fragment>
          ))}
        </ul>
      )}
      <MealChangeRequestReviewDialog
        request={selected}
        onClose={() => setSelected(null)}
        onReviewed={() => { setSelected(null); void reload(); }}
      />
    </Card>
  );
};
