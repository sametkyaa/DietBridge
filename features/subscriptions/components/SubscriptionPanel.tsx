import { useSubscriptionOverview } from '../hooks/useSubscriptionOverview';
import { useSubscriptionDetails } from '../hooks/useSubscriptionDetails';
import type { SubscriptionOverview, SubscriptionPeriod, SubscriptionPlan } from '../types/subscription';
import { Badge, Callout, ErrorState, LoadingState, ProgressBar, cx, type Tone } from '../../../shared/ui';

const STATUS_LABELS: Record<string, string> = {
  active: 'Aktif',
  trialing: 'Deneme',
  past_due: 'Ödeme bekliyor',
  canceled: 'İptal edildi',
  inactive: 'Pasif',
  no_subscription: 'Abonelik yok',
};

const STATUS_TONES: Record<string, Tone> = {
  active: 'ok',
  trialing: 'info',
  past_due: 'warn',
  canceled: 'bad',
  inactive: 'neutral',
  no_subscription: 'neutral',
};

const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status;

const formatPeriodEnd = (value: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' }).format(date);
};

const UsageBar = ({ overview }: { overview: SubscriptionOverview }) => {
  const { used, effectiveLimit, limitReached } = overview;
  const percent = effectiveLimit > 0 ? Math.min((used / effectiveLimit) * 100, 100) : 100;
  const tone = limitReached ? 'bad' : percent >= 80 ? 'warn' : 'brand';

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-3 text-13.5">
        <span className="font-semibold text-ink-2">Danışan kullanımı</span>
        <span className="font-bold tabular-nums" aria-live="polite">{used} / {effectiveLimit} danışan</span>
      </div>
      <ProgressBar value={percent} tone={tone} label="Danışan kullanımı" valueText={`${used} / ${effectiveLimit} danışan`} />
      <p className={cx('m-0 mt-2 text-12.5', limitReached ? 'font-semibold text-bad' : 'text-ink-3')}>
        {limitReached
          ? 'Danışan limitinize ulaştınız. Yeni danışan eklemek için planınızı yükseltin.'
          : `${overview.remaining} danışan hakkınız kaldı.`}
      </p>
    </div>
  );
};

const PeriodLine = ({ period }: { period: SubscriptionPeriod | null }) => {
  const periodEnd = formatPeriodEnd(period?.currentPeriodEnd ?? null);
  if (!period) return <span>Hesabınıza tanımlı bir abonelik kaydı yok.</span>;
  if (!periodEnd) return <span>Dönem bitiş tarihi tanımlı değil.</span>;
  return <span>{period.status === 'canceled' ? 'Erişim bitişi' : 'Dönem sonu'}: <b className="font-semibold text-ink">{periodEnd}</b></span>;
};

const PlanCatalog = ({ plans, currentPlanId }: { plans: SubscriptionPlan[]; currentPlanId: string }) => (
  <section aria-labelledby="subscription-plans-title" className="mt-6">
    <h3 id="subscription-plans-title" className="m-0 text-15 font-bold">Planlar</h3>
    {plans.length === 0 ? (
      <p className="m-0 mt-2 text-13.5 text-ink-3">Aktif plan bulunamadı.</p>
    ) : (
      <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          return (
            <li
              key={plan.id}
              aria-current={isCurrent ? 'true' : undefined}
              className={cx('rounded-db border p-4', isCurrent ? 'border-brand bg-brand/5' : 'border-line bg-surface')}
            >
              <div className="flex items-center justify-between gap-2">
                <b className="text-15 font-bold">{plan.name}</b>
                {isCurrent && <Badge tone="brand" size="sm">Mevcut plan</Badge>}
              </div>
              <p className="m-0 mt-2 text-24 font-bold tabular-nums">{plan.clientLimit}</p>
              <p className="m-0 text-12.5 text-ink-3">danışana kadar</p>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);

const SubscriptionPanel = () => {
  const { state, reload } = useSubscriptionOverview();
  const { state: details, reload: reloadDetails } = useSubscriptionDetails();

  if (state.status === 'loading') {
    return <LoadingState label="Abonelik bilgileri yükleniyor..." />;
  }

  if (state.status === 'error') {
    return (
      <ErrorState
        title="Abonelik bilgileri yüklenemedi"
        description={state.userMessage}
        onRetry={() => { void reload(); void reloadDetails(); }}
        retryLabel="Tekrar dene"
      />
    );
  }

  const { overview } = state;
  const status = String(overview.status);

  return (
    <div>
      <div className="rounded-card border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="m-0 text-12 font-semibold uppercase tracking-[0.08em] text-ink-3">Mevcut Plan</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-26 font-bold tracking-[-0.3px]">{overview.planName}</h3>
              <Badge tone={STATUS_TONES[status] ?? 'neutral'} dot>{statusLabel(status)}</Badge>
            </div>
            <p className="m-0 mt-2 text-13.5 text-ink-2">
              {details.status === 'success' && <PeriodLine period={details.period} />}
              {details.status === 'loading' && <span className="text-ink-3">Dönem bilgisi yükleniyor...</span>}
              {details.status === 'error' && <span className="text-ink-3">Dönem bilgisi alınamadı.</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="m-0 text-30 font-bold tabular-nums">{overview.effectiveLimit}</p>
            <p className="m-0 text-12.5 text-ink-3">danışan limiti</p>
          </div>
        </div>
        <UsageBar overview={overview} />
      </div>

      {details.status === 'success' && <PlanCatalog plans={details.plans} currentPlanId={overview.planId} />}
      {details.status === 'error' && (
        <ErrorState compact className="mt-6" title="Planlar yüklenemedi" description={details.userMessage} onRetry={() => void reloadDetails()} retryLabel="Tekrar dene" />
      )}

      <Callout tone="mute" className="mt-6">
        Plan yükseltme ve ödeme akışı yakında eklenecektir. Danışan limiti sunucu tarafında
        uygulanır; limit dolduğunda yeni danışan bağlantısı reddedilir.
      </Callout>
    </div>
  );
};

export default SubscriptionPanel;
