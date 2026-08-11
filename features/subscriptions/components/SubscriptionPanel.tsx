import React from 'react';
import { AlertTriangle, Loader2, RefreshCw, Users } from 'lucide-react';
import { useSubscriptionOverview } from '../hooks/useSubscriptionOverview';
import { SubscriptionOverview } from '../types/subscription';

const STATUS_LABELS: Record<string, string> = {
  active: 'Aktif',
  trialing: 'Deneme',
  past_due: 'Ödeme bekliyor',
  canceled: 'İptal edildi',
  inactive: 'Pasif',
};

const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status;

const UsageBar = ({ overview }: { overview: SubscriptionOverview }) => {
  const { used, effectiveLimit, limitReached } = overview;
  const ratio = effectiveLimit > 0 ? Math.min(used / effectiveLimit, 1) : 1;
  const barColor = limitReached
    ? 'bg-red-500'
    : ratio >= 0.8
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-300 flex items-center gap-2">
          <Users className="w-4 h-4" /> Danışan kullanımı
        </span>
        <span className="text-sm font-bold text-white" aria-live="polite">
          {used} / {effectiveLimit} danışan
        </span>
      </div>
      <div
        className="w-full h-2.5 rounded-full bg-slate-700 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={effectiveLimit}
        aria-valuenow={used}
        aria-label="Danışan kullanımı"
      >
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <p className="text-xs text-slate-400 mt-2">
        {limitReached
          ? 'Danışan limitinize ulaştınız. Yeni danışan eklemek için planınızı yükseltin.'
          : `${overview.remaining} danışan hakkınız kaldı.`}
      </p>
    </div>
  );
};

const SubscriptionPanel = () => {
  const { state, reload } = useSubscriptionOverview();

  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-3 p-8 text-slate-500" aria-live="polite">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm font-medium">Abonelik bilgileri yükleniyor...</span>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="p-8 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <h3 className="text-lg font-bold text-slate-800 mb-1">Abonelik bilgileri yüklenemedi</h3>
        <p className="text-sm text-slate-500 mb-4">{state.userMessage}</p>
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Tekrar dene
        </button>
      </div>
    );
  }

  const { overview } = state;

  return (
    <div>
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-8 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500 rounded-full blur-[80px] opacity-20 -mr-16 -mt-16 pointer-events-none"></div>

        <div className="flex justify-between items-start relative z-10">
          <div>
            <p className="text-slate-400 font-medium text-sm mb-1 uppercase tracking-wider">Mevcut Plan</p>
            <h3 className="text-3xl font-bold">{overview.planName}</h3>
            <p className="text-emerald-400 text-sm mt-2 font-medium">{statusLabel(String(overview.status))}</p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-bold">{overview.effectiveLimit}</p>
            <p className="text-sm text-slate-400 font-normal">danışan limiti</p>
          </div>
        </div>

        <UsageBar overview={overview} />
      </div>

      <p className="text-xs text-slate-400 mt-4">
        Plan yükseltme ve ödeme akışı yakında eklenecektir. Danışan limiti sunucu tarafında
        uygulanır; limit dolduğunda yeni danışan bağlantısı reddedilir.
      </p>
    </div>
  );
};

export default SubscriptionPanel;
