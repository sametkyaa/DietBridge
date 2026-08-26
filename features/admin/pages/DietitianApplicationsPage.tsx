import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AdminCompletenessBadge,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminStatusBadge,
} from '../components/AdminPagePrimitives';
import { fetchDietitianApplications, getAdminUserMessage, ADMIN_PAGE_SIZE } from '../services/adminService';
import { AdminStatusFilter, DietitianApplication } from '../types';
import { formatAdminDate } from '../utils/adminPresentation';

type ListViewState =
  | { status: 'loading' }
  | { status: 'success'; applications: DietitianApplication[] }
  | { status: 'error'; message: string };

const statusOptions: Array<{ value: AdminStatusFilter; label: string }> = [
  { value: 'all', label: 'Tüm durumlar' },
  { value: 'pending', label: 'Bekleyenler' },
  { value: 'approved', label: 'Onaylananlar' },
  { value: 'rejected', label: 'Reddedilenler' },
];

const isAdminStatusFilter = (value: string | null): value is AdminStatusFilter => (
  value === 'all' || value === 'pending' || value === 'approved' || value === 'rejected'
);

const applicationName = (application: DietitianApplication): string => (
  application.fullName?.trim() || application.email || 'İsimsiz başvuru'
);

const ApplicationTableRow: React.FC<{ application: DietitianApplication }> = ({ application }) => (
  <tr className="border-t border-slate-100 transition-colors hover:bg-slate-50">
    <td className="px-5 py-4">
      <div>
        <p className="font-semibold text-slate-900">{applicationName(application)}</p>
        <p className="mt-1 text-xs text-slate-500">{application.email || 'E-posta belirtilmemiş'}</p>
      </div>
    </td>
    <td className="px-5 py-4 text-sm text-slate-600">{application.university || 'Belirtilmemiş'}</td>
    <td className="px-5 py-4 text-sm text-slate-600">{application.specialization || 'Belirtilmemiş'}</td>
    <td className="px-5 py-4"><AdminStatusBadge status={application.verificationStatus} /></td>
    <td className="px-5 py-4"><AdminCompletenessBadge state={application.completenessState} /></td>
    <td className="px-5 py-4 text-sm text-slate-500">{formatAdminDate(application.createdAt)}</td>
    <td className="px-5 py-4 text-right">
      <Link
        to={`/admin/dietitians/${application.userId}`}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 py-2 text-sm font-bold text-primary transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        İncele
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </td>
  </tr>
);

const ApplicationCard: React.FC<{ application: DietitianApplication }> = ({ application }) => (
  <Link
    to={`/admin/dietitians/${application.userId}`}
    className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-bold text-slate-900">{applicationName(application)}</p>
        <p className="mt-1 text-xs text-slate-500">{application.email || 'E-posta belirtilmemiş'}</p>
      </div>
      <AdminStatusBadge status={application.verificationStatus} />
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-xl bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Üniversite</p>
        <p className="mt-1 font-semibold text-slate-700">{application.university || 'Belirtilmemiş'}</p>
      </div>
      <div className="rounded-xl bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Uzmanlık</p>
        <p className="mt-1 font-semibold text-slate-700">{application.specialization || 'Belirtilmemiş'}</p>
      </div>
    </div>
    <div className="mt-4 flex items-center justify-between gap-3">
      <AdminCompletenessBadge state={application.completenessState} />
      <span className="inline-flex items-center gap-1 text-sm font-bold text-primary">İncele <ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
    </div>
  </Link>
);

const DietitianApplicationsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = isAdminStatusFilter(searchParams.get('status')) ? searchParams.get('status') as AdminStatusFilter : 'all';
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  const [appliedSearch, setAppliedSearch] = useState(searchParams.get('search') || '');
  const [page, setPage] = useState(0);
  const [viewState, setViewState] = useState<ListViewState>({ status: 'loading' });
  const requestVersion = useRef(0);

  const loadApplications = useCallback(async () => {
    const requestId = ++requestVersion.current;
    setViewState({ status: 'loading' });
    try {
      const applications = await fetchDietitianApplications({
        status,
        search: appliedSearch,
        limit: ADMIN_PAGE_SIZE,
        offset: page * ADMIN_PAGE_SIZE,
      });
      if (requestId === requestVersion.current) setViewState({ status: 'success', applications });
    } catch (error: unknown) {
      if (requestId === requestVersion.current) setViewState({ status: 'error', message: getAdminUserMessage(error) });
    }
  }, [appliedSearch, page, status]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  const handleStatusChange = (nextStatus: AdminStatusFilter) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextStatus === 'all') nextParams.delete('status');
    else nextParams.set('status', nextStatus);
    setSearchParams(nextParams);
    setPage(0);
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextSearch = searchInput.trim();
    const nextParams = new URLSearchParams(searchParams);
    if (nextSearch) nextParams.set('search', nextSearch);
    else nextParams.delete('search');
    setSearchParams(nextParams);
    setAppliedSearch(nextSearch);
    setPage(0);
  };

  const applications = viewState.status === 'success' ? viewState.applications : [];
  const hasNextPage = applications.length === ADMIN_PAGE_SIZE;

  return (
    <main className="min-h-screen bg-background-light px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <AdminPageHeader
          title="Diyetisyen başvuruları"
          description="Başvuruları durum, kimlik bilgileri ve tamamlanma durumuna göre inceleyin."
          backTo="/admin"
          actions={(
            <Link
              to="/"
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Ürün paneline dön
            </Link>
          )}
        />

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Başvuru filtreleri">
          <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="flex-1">
              <label htmlFor="admin-application-search" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Ara</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  id="admin-application-search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Ad, e-posta, üniversite veya uzmanlık"
                  maxLength={120}
                  className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-800 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="w-full lg:w-56">
              <label htmlFor="admin-application-status" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Durum</label>
              <select
                id="admin-application-status"
                value={status}
                onChange={(event) => handleStatusChange(event.target.value as AdminStatusFilter)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <button
              type="submit"
              className="min-h-11 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Ara
            </button>
          </form>
        </section>

        {viewState.status === 'loading' && <AdminLoadingState message="Başvurular yükleniyor..." />}
        {viewState.status === 'error' && <AdminErrorState message={viewState.message} onRetry={() => { void loadApplications(); }} />}
        {viewState.status === 'success' && applications.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <h2 className="text-lg font-bold text-slate-800">Başvuru bulunamadı</h2>
            <p className="mt-2 text-sm text-slate-500">Filtreleri değiştirerek tekrar deneyin.</p>
          </div>
        )}
        {viewState.status === 'success' && applications.length > 0 && (
          <>
            <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Başvuru sahibi</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Üniversite</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Uzmanlık</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Durum</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Tamamlanma</th>
                      <th className="px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Başvuru tarihi</th>
                      <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>{applications.map((application) => <ApplicationTableRow key={application.userId} application={application} />)}</tbody>
                </table>
              </div>
            </div>
            <div className="space-y-3 md:hidden">
              {applications.map((application) => <ApplicationCard key={application.userId} application={application} />)}
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">Sayfa {page + 1}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  disabled={page === 0 || viewState.status === 'loading'}
                  className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Önceki
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={!hasNextPage || viewState.status === 'loading'}
                  className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:border-primary/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Sonraki
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
};

export default DietitianApplicationsPage;
