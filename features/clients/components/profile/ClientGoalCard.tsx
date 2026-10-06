import { Fragment, type ReactNode } from 'react';
import { Badge, Card, CardHeader, cx } from '../../../../shared/ui';
import { calculateGoalProgress } from '../../../analytics/utils/goalProgressContract';
import { formatPercentageDisplay } from '../../../../shared/utils/percentageDisplay';
import type { ActiveClientDetails, Measurement } from '../../services/clientService';
import {
  calculateBmi,
  formatDecimal,
  formatSignedDecimal,
  latestMeasurementDelta,
  parseWeightLabel,
} from '../../utils/clientProfileContract';
import { formatMeasurementAge } from '../../utils/clientListContract';

const formatShortDate = (dateKey: string): string => new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric', month: 'long', timeZone: 'UTC',
}).format(new Date(`${dateKey}T00:00:00Z`));

const Stat = ({ label, value, sub, subTone }: { label: string; value: ReactNode; sub?: ReactNode; subTone?: 'ok' | 'bad' | 'mute' }) => (
  <div className="min-w-0">
    <span className="block text-12 text-ink-3">{label}</span>
    <b className="mt-0.5 block text-20 font-semibold tabular-nums">{value}</b>
    {sub && <span className={cx('block text-12', subTone === 'ok' ? 'font-semibold text-ok' : subTone === 'bad' ? 'font-semibold text-bad' : 'text-ink-3')}>{sub}</span>}
  </div>
);

/** A change is "good" when it moves toward the goal direction (loss for weight-loss goals). */
const toneFor = (diff: number | null, lowerIsBetter: boolean | null): 'ok' | 'bad' | 'mute' => {
  if (diff === null || diff === 0 || lowerIsBetter === null) return 'mute';
  return (diff < 0) === lowerIsBetter ? 'ok' : 'bad';
};

export interface ClientGoalCardProps {
  client: ActiveClientDetails;
  measurements: readonly Measurement[];
  measurementsReady: boolean;
  todayKey: string;
}

/** Goal strip (start → current → target), BMI and real measurement differences. */
export const ClientGoalCard = ({ client, measurements, measurementsReady, todayKey }: ClientGoalCardProps) => {
  const start = parseWeightLabel(client.startWeight);
  const current = parseWeightLabel(client.currentWeight);
  const target = parseWeightLabel(client.targetWeight);
  const progress = calculateGoalProgress({ startWeight: start, currentWeight: current, targetWeight: target });
  const lowerIsBetter = start !== null && target !== null && start !== target ? target < start : null;
  const changeFromStart = start !== null && current !== null ? Math.round((current - start) * 10) / 10 : null;
  const bmi = calculateBmi(current, client.heightCm);
  const startBmi = calculateBmi(start, client.heightCm);
  const waist = latestMeasurementDelta(measurements, 'waist');
  const hip = latestMeasurementDelta(measurements, 'hip');
  const latestMeasuredAt = measurements[0]?.measured_at ?? null;
  const pinPercent = progress.progressPercentage ?? 0;

  return (
    <Card as="section" aria-labelledby="client-goal-title">
      <CardHeader
        id="client-goal-title"
        title="Hedef"
        addon={client.goal ? <Badge tone="brand" size="sm">{client.goal}</Badge> : undefined}
        actions={measurementsReady ? (
          <span className="text-12.5 text-ink-3">
            {latestMeasuredAt ? `Son ölçüm ${formatShortDate(latestMeasuredAt)} · ${formatMeasurementAge(latestMeasuredAt, todayKey)}` : 'Henüz ölçüm yok'}
          </span>
        ) : undefined}
      />
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Başlangıç" value={start !== null ? `${formatDecimal(start)} kg` : '—'} />
        <Stat
          label="Güncel"
          value={current !== null ? `${formatDecimal(current)} kg` : '—'}
          sub={changeFromStart !== null
            ? `${formatSignedDecimal(changeFromStart)} kg${progress.progressPercentage !== null ? ` · %${Math.round(progress.progressPercentage)} yol alındı` : ''}`
            : undefined}
          subTone={toneFor(changeFromStart, lowerIsBetter)}
        />
        <Stat
          label="Hedef"
          value={target !== null ? `${formatDecimal(target)} kg` : '—'}
          sub={progress.remainingKg !== null ? (progress.isComplete ? 'Hedefe ulaşıldı' : `${formatDecimal(progress.remainingKg)} kg kaldı`) : undefined}
        />
      </div>
      {progress.hasData ? (
        <div
          role="progressbar"
          aria-label="Hedefe ilerleme"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pinPercent)}
          className="relative my-4 h-2 rounded-full bg-sunk"
        >
          <span className="block h-full rounded-full bg-brand" style={{ width: `${pinPercent}%` }} />
          <span aria-hidden="true" className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-surface bg-brand shadow-card" style={{ left: `${pinPercent}%` }} />
        </div>
      ) : (
        <p className="my-3 text-13 text-ink-3">Hedef ilerlemesi için başlangıç, güncel ve hedef kilo gerekli.</p>
      )}
      <div className="grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
        {[
          { key: 'bmi', label: 'VKİ', value: bmi !== null ? formatDecimal(bmi) : '—', sub: startBmi !== null && start !== current ? `Başlangıç ${formatDecimal(startBmi)}` : client.heightCm ? undefined : 'Boy bilgisi yok', tone: 'mute' as const },
          { key: 'waist', label: 'Bel', value: waist ? `${formatDecimal(waist.value)} cm` : '—', sub: waist?.diff != null ? `${formatSignedDecimal(waist.diff)} cm` : undefined, tone: toneFor(waist?.diff ?? null, true) },
          { key: 'hip', label: 'Kalça', value: hip ? `${formatDecimal(hip.value)} cm` : '—', sub: hip?.diff != null ? `${formatSignedDecimal(hip.diff)} cm` : undefined, tone: toneFor(hip?.diff ?? null, true) },
          { key: 'adherence', label: '7 günlük öğün uyumu', value: client.compliance === null ? '—' : formatPercentageDisplay(client.compliance), sub: client.compliance === null ? 'Planlı öğün yok' : undefined, tone: 'mute' as const },
        ].map((item) => (
          <Fragment key={item.key}>
            <div className="min-w-0">
              <span className="block truncate text-12 text-ink-3">{item.label}</span>
              <b className="block text-16 font-semibold tabular-nums">{item.value}</b>
              {item.sub && <span className={cx('block text-12', item.tone === 'ok' ? 'font-semibold text-ok' : item.tone === 'bad' ? 'font-semibold text-bad' : 'text-ink-3')}>{item.sub}</span>}
            </div>
          </Fragment>
        ))}
      </div>
      {(waist?.diff != null || hip?.diff != null) && (
        <p className="m-0 mt-2 text-12 text-ink-3">Bel ve kalça farkları bir önceki ölçüme göredir.</p>
      )}
    </Card>
  );
};
