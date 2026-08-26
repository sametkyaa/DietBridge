import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, ShieldCheck, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchAdminSummary, getAdminUserMessage } from '../services/adminService';
import { AdminSummary } from '../types';
import { AdminErrorState, AdminLoadingState, AdminPageHeader } from '../components/AdminPagePrimitives';
import { formatAdminNumber } from '../utils/adminPresentation';

type SummaryViewState =
  | { status: 'loading' }
  | { status: 'success'; summary: AdminSummary }
  | { status: 'error'; message: string };

const AdminDashboardPage = () => {
  const [viewState, setViewState] = useState<SummaryViewState>({ status: 'loading' });

  const loadSummary = useCallback(async () => {
    setViewState({ status: 'loading' });
    try {
      setViewState({ status: 'success', summary: await fetchAdminSummary() });
    } catch (error: unknown) {
      setViewState({ status: 'error', message: getAdminUserMessage(error) });
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  if (viewState.status === 'loading') return <AdminLoadingState />;
  if (viewState.status === 'error') return <AdminErrorState message={viewState.message} onRetry={() => { void loadSummary(); }} />;

  const cards = [
    {
      label: 'Bekleyen başvuru',
      value: viewState.summary.pending,
      icon: Clock3,
      className: 'bg-amber-50 text-amber-700 border-amber-100',
      link: '/admin/dietitians?status=pending',
    },
    {
      label: 'Onaylanan diyetisyen',
      value: viewState.summary.approved,
      icon: CheckCircle2,
      className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      link: '/admin/dietitians?status=approved',
    },
    {
      label: 'Reddedilen başvuru',
      value: viewState.summary.rejected,
      icon: XCircle,
      className: 'bg-red-50 text-red-700 border-red-100',
      link: '/admin/dietitians?status=rejected',
    },
  ];

  return (
    <main className="min-h-screen bg-background-light px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <AdminPageHeader
          title="Ürün yönetimi"
          description="Diyetisyen başvurularını, doğrulama durumlarını ve karar geçmişini yönetin."
          actions={(
            <Link
              to="/"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Ürün paneline dön
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        />

        <section aria-labelledby="admin-summary-heading">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="admin-summary-heading" className="text-lg font-bold text-slate-900">Doğrulama özeti</h2>
              <p className="text-sm text-slate-500">Karar gerektiren başvurular burada görünür.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.label}
                  to={card.link}
                  className={`group rounded-2xl border p-5 transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${card.className}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold opacity-80">{card.label}</p>
                      <p className="mt-3 text-4xl font-bold tracking-tight">{formatAdminNumber(card.value)}</p>
                    </div>
                    <Icon className="h-6 w-6 opacity-80" aria-hidden="true" />
                  </div>
                  <span className="mt-5 inline-flex items-center gap-1 text-xs font-bold opacity-80 transition-transform group-hover:translate-x-1">
                    Listeyi aç
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Başvuru inceleme akışı</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Başvuruyu açarak profil bilgilerini ve tamamlanma durumunu kontrol edin. Diploma yalnızca açıkça istediğinizde kısa süreli imzalı bağlantıyla görüntülenir.
          </p>
          <Link
            to="/admin/dietitians"
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Tüm başvuruları görüntüle
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      </div>
    </main>
  );
};

export default AdminDashboardPage;
