import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, ExternalLink, FileText, ShieldCheck, X, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import {
  AdminCompletenessBadge,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminStatusBadge,
} from '../components/AdminPagePrimitives';
import {
  ADMIN_COMPLETENESS_LABELS,
  approveDietitian,
  createAdminDiplomaSignedUrl,
  fetchDietitianApplication,
  fetchDietitianVerificationHistory,
  getAdminUserMessage,
  rejectDietitian,
} from '../services/adminService';
import { DietitianApplicationDetail, VerificationHistoryEntry } from '../types';
import { formatAdminDate } from '../utils/adminPresentation';

type DetailViewState =
  | { status: 'loading' }
  | { status: 'success'; detail: DietitianApplicationDetail; history: VerificationHistoryEntry[] }
  | { status: 'error'; message: string };

type DecisionType = 'approve' | 'reject';

const DetailField = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-slate-50 p-4">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-1.5 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-800">{value || 'Belirtilmemiş'}</p>
  </div>
);

const DecisionDialog = ({
  type,
  reason,
  busy,
  error,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  type: DecisionType;
  reason: string;
  busy: boolean;
  error: string | null;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const isReject = type === 'reject';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-decision-title"
        className="w-full max-w-lg rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Karar onayı</p>
            <h2 id="admin-decision-title" className="mt-2 text-xl font-bold text-slate-900">
              {isReject ? 'Başvuruyu reddet' : 'Başvuruyu onayla'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Diyaloğu kapat"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          {isReject
            ? 'Bu karar başvuruyu reddedilmiş duruma alır. MVP kapsamında reddedilmiş başvuru yeniden onaylanamaz.'
            : 'Bu karar başvuruyu onaylar ve diyetisyen ürün paneline erişebilir.'}
        </p>
        {isReject && (
          <div className="mt-5">
            <label htmlFor="admin-rejection-reason" className="mb-1.5 block text-sm font-bold text-slate-700">Ret nedeni</label>
            <textarea
              id="admin-rejection-reason"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="Başvurunun neden reddedildiğini yazın"
              className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <p className="mt-1 text-right text-xs text-slate-400">{reason.length}/1000</p>
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || (isReject && !reason.trim())}
            className={`min-h-11 rounded-xl px-5 py-3 text-sm font-bold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
              isReject ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-600' : 'bg-primary hover:bg-primary-dark focus-visible:ring-primary'
            }`}
          >
            {busy ? 'İşleniyor...' : isReject ? 'Reddet' : 'Onayla'}
          </button>
        </div>
      </div>
    </div>
  );
};

const historyIcon = (status: VerificationHistoryEntry['newStatus']) => {
  if (status === 'approved') return <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />;
  return <XCircle className="h-5 w-5 text-red-600" aria-hidden="true" />;
};

const DietitianApplicationDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [viewState, setViewState] = useState<DetailViewState>({ status: 'loading' });
  const [decisionType, setDecisionType] = useState<DecisionType | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [diplomaLoading, setDiplomaLoading] = useState(false);
  const [diplomaError, setDiplomaError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!id) {
      setViewState({ status: 'error', message: 'Diyetisyen kimliği doğrulanamadı.' });
      return;
    }
    setViewState({ status: 'loading' });
    try {
      const [detail, history] = await Promise.all([
        fetchDietitianApplication(id),
        fetchDietitianVerificationHistory(id),
      ]);
      setViewState({ status: 'success', detail, history });
    } catch (error: unknown) {
      setViewState({ status: 'error', message: getAdminUserMessage(error) });
    }
  }, [id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const openDecision = (type: DecisionType) => {
    setDecisionError(null);
    setRejectionReason('');
    setDecisionType(type);
  };

  const closeDecision = () => {
    if (decisionBusy) return;
    setDecisionType(null);
    setDecisionError(null);
    setRejectionReason('');
  };

  const confirmDecision = async () => {
    if (!id || !decisionType) return;
    setDecisionBusy(true);
    setDecisionError(null);
    try {
      if (decisionType === 'approve') await approveDietitian(id);
      else await rejectDietitian(id, rejectionReason);
      setDecisionType(null);
      setRejectionReason('');
      await loadDetail();
    } catch (error: unknown) {
      setDecisionError(getAdminUserMessage(error));
    } finally {
      setDecisionBusy(false);
    }
  };

  const openDiploma = async () => {
    if (viewState.status !== 'success' || !id || !viewState.detail.diplomaObjectPath) return;
    setDiplomaLoading(true);
    setDiplomaError(null);
    try {
      const signedUrl = await createAdminDiplomaSignedUrl(id, viewState.detail.diplomaObjectPath);
      const openedWindow = window.open(signedUrl, '_blank', 'noopener,noreferrer');
      if (!openedWindow) setDiplomaError('Diploma yeni sekmede açılamadı. Tarayıcı engellemesini kontrol edin.');
    } catch (error: unknown) {
      setDiplomaError(getAdminUserMessage(error));
    } finally {
      setDiplomaLoading(false);
    }
  };

  if (viewState.status === 'loading') return <AdminLoadingState message="Başvuru ayrıntıları yükleniyor..." />;
  if (viewState.status === 'error') return <AdminErrorState message={viewState.message} onRetry={() => { void loadDetail(); }} />;

  const { detail, history } = viewState;
  const canApprove = detail.verificationStatus === 'pending' && detail.completenessState === 'complete';
  const canReject = detail.verificationStatus === 'pending';

  return (
    <main className="min-h-screen bg-background-light px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <AdminPageHeader
          title={detail.fullName?.trim() || 'Diyetisyen başvurusu'}
          description={detail.email || 'Başvuru ayrıntıları ve karar geçmişi'}
          backTo="/admin/dietitians"
          backLabel="Başvuru listesine dön"
          actions={<AdminStatusBadge status={detail.verificationStatus} />}
        />

        {detail.rejectionReason && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-5 text-red-800" role="status">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">Ret nedeni</p>
              <p className="mt-1 text-sm leading-6">{detail.rejectionReason}</p>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="application-profile-heading">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="application-profile-heading" className="text-lg font-bold text-slate-900">Başvuru bilgileri</h2>
                  <p className="text-sm text-slate-500">Sunucu tarafında doğrulanan profil alanları.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label="Ad soyad" value={detail.fullName || ''} />
                <DetailField label="E-posta" value={detail.email || ''} />
                <DetailField label="Telefon" value={detail.phone || ''} />
                <DetailField label="Üniversite" value={detail.university || ''} />
                <DetailField label="Mezuniyet yılı" value={detail.graduationYear ? String(detail.graduationYear) : ''} />
                <DetailField label="Deneyim" value={detail.experienceYears === null ? '' : `${detail.experienceYears} yıl`} />
                <DetailField label="Uzmanlık alanı" value={detail.specialization || ''} />
                <DetailField label="Başvuru tarihi" value={formatAdminDate(detail.createdAt)} />
                <div className="sm:col-span-2"><DetailField label="Biyografi" value={detail.bio || ''} /></div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="application-completeness-heading">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 id="application-completeness-heading" className="text-lg font-bold text-slate-900">Başvuru tamamlanma durumu</h2>
                  <p className="mt-1 text-sm text-slate-500">Onay kararı öncesinde sunucu tarafında tekrar kontrol edilir.</p>
                </div>
                <AdminCompletenessBadge state={detail.completenessState} />
              </div>
              {detail.missingFields.length > 0 && (
                <div className="mt-5 rounded-xl border border-orange-100 bg-orange-50 p-4">
                  <p className="text-sm font-bold text-orange-900">Eksik alanlar</p>
                  <ul className="mt-2 grid gap-1 text-sm text-orange-800 sm:grid-cols-2">
                    {detail.missingFields.map((field) => <li key={field}>• {ADMIN_COMPLETENESS_LABELS[field] || field}</li>)}
                  </ul>
                </div>
              )}
              {detail.missingFields.length === 0 && (
                <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Gerekli profil alanları ve diploma nesnesi hazır.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="application-history-heading">
              <div className="mb-5 flex items-center gap-3">
                <Clock3 className="h-5 w-5 text-slate-500" aria-hidden="true" />
                <div>
                  <h2 id="application-history-heading" className="text-lg font-bold text-slate-900">Karar geçmişi</h2>
                  <p className="text-sm text-slate-500">Değiştirilemez audit kayıtları.</p>
                </div>
              </div>
              {history.length === 0 ? (
                <p className="text-sm text-slate-500">Henüz bir karar kaydı yok.</p>
              ) : (
                <ol className="space-y-4">
                  {history.map((entry) => (
                    <li key={entry.id} className="flex gap-3 rounded-xl border border-slate-100 p-4">
                      <div className="mt-0.5 shrink-0">{historyIcon(entry.newStatus)}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800">
                          {entry.newStatus === 'approved' ? 'Başvuru onaylandı' : 'Başvuru reddedildi'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{formatAdminDate(entry.decidedAt)} · Karar verici: {entry.decidedBySnapshot}</p>
                        {entry.rejectionReason && <p className="mt-2 text-sm leading-6 text-slate-600">{entry.rejectionReason}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="application-actions-heading">
              <h2 id="application-actions-heading" className="text-lg font-bold text-slate-900">İşlemler</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Kararlar tek yönlüdür ve audit kaydı oluşturur.</p>
              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => openDecision('approve')}
                  disabled={!canApprove || decisionBusy}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {detail.completenessState === 'incomplete' && detail.verificationStatus === 'pending' ? 'Eksik başvuru' : 'Başvuruyu onayla'}
                </button>
                <button
                  type="button"
                  onClick={() => openDecision('reject')}
                  disabled={!canReject || decisionBusy}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-bold text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  Başvuruyu reddet
                </button>
              </div>
              {!canApprove && detail.verificationStatus === 'pending' && detail.completenessState === 'incomplete' && (
                <p className="mt-4 text-xs leading-5 text-orange-700">Onay için eksik alanları tamamlayın; sunucu da aynı kontrolü yapar.</p>
              )}
              {detail.verificationStatus !== 'pending' && (
                <p className="mt-4 text-xs leading-5 text-slate-500">Bu durum için tersine karar işlemi desteklenmiyor.</p>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="application-diploma-heading">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-slate-500" aria-hidden="true" />
                <h2 id="application-diploma-heading" className="text-lg font-bold text-slate-900">Diploma</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-500">Özel dosya, yalnızca kısa süreli imzalı bağlantıyla açılır.</p>
              <button
                type="button"
                onClick={() => { void openDiploma(); }}
                disabled={!detail.diplomaObjectPath || diplomaLoading}
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:border-primary/30 hover:bg-emerald-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {diplomaLoading ? 'Diploma açılıyor...' : 'Diplomayı Görüntüle'}
              </button>
              {!detail.diplomaObjectPath && <p className="mt-3 text-xs leading-5 text-slate-500">Bu başvuru için doğrulanabilir diploma nesnesi bulunamadı.</p>}
              {diplomaError && <p className="mt-3 text-xs leading-5 text-red-700" role="alert">{diplomaError}</p>}
            </section>

            <Link
              to="/admin/dietitians"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:border-primary/30 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Listeye dön
            </Link>
          </aside>
        </div>
      </div>
      {decisionType && (
        <DecisionDialog
          type={decisionType}
          reason={rejectionReason}
          busy={decisionBusy}
          error={decisionError}
          onReasonChange={setRejectionReason}
          onCancel={closeDecision}
          onConfirm={() => { void confirmDecision(); }}
        />
      )}
    </main>
  );
};

export default DietitianApplicationDetailPage;
