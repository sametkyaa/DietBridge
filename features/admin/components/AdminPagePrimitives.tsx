import React, { ReactNode } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, RefreshCw, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AdminVerificationStatus, AdminCompletenessState } from '../types';

export const AdminLoadingState = ({ message = 'Yönetim verileri yükleniyor...' }: { message?: string }) => (
  <div className="flex min-h-[18rem] items-center justify-center p-6">
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="text-sm font-medium text-slate-500">{message}</p>
    </div>
  </div>
);

export const AdminErrorState = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <div className="mx-auto flex min-h-[18rem] max-w-xl flex-col items-center justify-center p-6 text-center">
    <AlertCircle className="mb-4 h-10 w-10 text-red-500" aria-hidden="true" />
    <h2 className="text-lg font-bold text-slate-800">Yönetim verileri yüklenemedi</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
    <button
      type="button"
      onClick={onRetry}
      className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      Tekrar Dene
    </button>
  </div>
);

export const AdminPageHeader = ({
  title,
  description,
  backTo,
  backLabel = 'Yönetim paneline dön',
  actions,
}: {
  title: string;
  description?: string;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
}) => (
  <header className="mb-8 flex flex-col gap-5 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
    <div>
      {backTo && (
        <Link
          to={backTo}
          className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-slate-500 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>
      )}
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">DietBridge Yönetim</p>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
      {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
  </header>
);

const statusConfig: Record<AdminVerificationStatus, { label: string; className: string; icon: typeof Clock3 }> = {
  pending: { label: 'Bekliyor', className: 'bg-amber-100 text-amber-800', icon: Clock3 },
  approved: { label: 'Onaylandı', className: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  rejected: { label: 'Reddedildi', className: 'bg-red-100 text-red-800', icon: XCircle },
};

export const AdminStatusBadge = ({ status }: { status: AdminVerificationStatus }) => {
  const config = statusConfig[status];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${config.className}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {config.label}
    </span>
  );
};

export const AdminCompletenessBadge = ({ state }: { state: AdminCompletenessState }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${
    state === 'complete' ? 'bg-sky-100 text-sky-800' : 'bg-orange-100 text-orange-800'
  }`}>
    {state === 'complete' ? 'Tam Başvuru' : 'Eksik Başvuru'}
  </span>
);
