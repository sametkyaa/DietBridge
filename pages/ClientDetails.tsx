import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, MapPin, Phone, Calendar, Weight, Activity, TrendingUp, TrendingDown, Droplets, Utensils, HeartPulse, Pill, Moon, Coffee, Stethoscope, Clock, Trash2, MessageSquare } from 'lucide-react';
import {
  fetchClientDetails,
  removeClient,
  fetchClientMeasurements,
  fetchClientDailyLogs,
  saveClientWeight,
  saveClientBodyMeasurements,
  Measurement,
  DailyLog,
  PendingClientSummary,
  ActiveClientDetails,
  SaveClientBodyMeasurementsInput,
} from '../features/clients/services/clientService';
import { supabase } from '../lib/supabaseClient';
import { isValidUuid } from '../shared/utils/uuid';
import { parseMeasurementInput } from '../features/clients/utils/measurementContract';

const clientPercentageFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

const formatClientPercentage = (value: number | null): string => (
  value === null || !Number.isFinite(value) ? 'Veri yok' : `%${clientPercentageFormatter.format(value)}`
);


const ProfileAvatarFallback = ({ name, className }: { name: string, className?: string }) => {
  const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  return (
    <div className={`flex items-center justify-center bg-slate-200 text-slate-500 font-bold ${className}`}>
      {initials}
    </div>
  );
};

type ClientDetailsViewState =
  | { status: 'loading' }
  | { status: 'active'; client: ActiveClientDetails }
  | { status: 'pending'; client: PendingClientSummary }
  | { status: 'invalid_id' }
  | { status: 'unavailable' }
  | { status: 'error'; userMessage: string };

const CLIENT_DETAIL_LOAD_ERROR =
  'Danışan bilgileri şu anda yüklenemiyor. Lütfen tekrar deneyin.';

const MEASUREMENT_LOAD_ERROR =
  'Ölçüm kayıtları şu anda yüklenemiyor. Lütfen tekrar deneyin.';

const MEASUREMENT_LOAD_MORE_ERROR =
  'Daha eski ölçümler yüklenemedi. Mevcut kayıtlar korunuyor.';

type MeasurementSectionStatus = 'idle' | 'loading' | 'ready' | 'error';
type BodyMeasurementNumericField = Exclude<
  keyof SaveClientBodyMeasurementsInput,
  'clientId' | 'measuredAt' | 'notes'
>;
type WeightFormField = 'measuredAt' | 'weight' | 'notes';
type WeightFormValues = Record<WeightFormField, string>;
type WeightFormErrors = Partial<Record<WeightFormField | 'form', string>>;
type BodyMeasurementFormField = BodyMeasurementNumericField | 'measuredAt' | 'notes';
type BodyMeasurementFormValues = Record<BodyMeasurementNumericField, string> & {
  measuredAt: string;
  notes: string;
};
type BodyMeasurementFormErrors = Partial<Record<BodyMeasurementFormField | 'form', string>>;
type MeasurementSaveFeedback = {
  type: 'success' | 'error';
  message: string;
};

const bodyMeasurementFieldDefinitions: ReadonlyArray<{
  key: BodyMeasurementNumericField;
  label: string;
  min: number;
  max: number;
  step: string;
}> = [
  { key: 'waist', label: 'Bel çevresi (cm)', min: 0, max: 500, step: 'any' },
  { key: 'hip', label: 'Kalça çevresi (cm)', min: 0, max: 500, step: 'any' },
  { key: 'right_arm', label: 'Sağ kol çevresi (cm)', min: 0, max: 500, step: 'any' },
  { key: 'left_arm', label: 'Sol kol çevresi (cm)', min: 0, max: 500, step: 'any' },
  { key: 'chest', label: 'Göğüs çevresi (cm)', min: 0, max: 500, step: 'any' },
  { key: 'right_calf', label: 'Sağ baldır çevresi (cm)', min: 0, max: 500, step: 'any' },
  { key: 'left_calf', label: 'Sol baldır çevresi (cm)', min: 0, max: 500, step: 'any' },
  { key: 'neck', label: 'Boyun çevresi (cm)', min: 0, max: 500, step: 'any' },
];

const todayIsoDate = (): string => {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
};

const createEmptyWeightForm = (measuredAt = todayIsoDate()): WeightFormValues => ({
  measuredAt,
  weight: '',
  notes: '',
});

const createEmptyBodyMeasurementForm = (
  measuredAt = todayIsoDate(),
): BodyMeasurementFormValues => ({
  measuredAt,
  waist: '',
  hip: '',
  right_arm: '',
  left_arm: '',
  chest: '',
  right_calf: '',
  left_calf: '',
  neck: '',
  notes: '',
});

const measurementToWeightForm = (measurement: Measurement): WeightFormValues => ({
  measuredAt: measurement.measured_at,
  weight: measurement.weight?.toString() ?? '',
  notes: measurement.notes ?? '',
});

const measurementToBodyMeasurementForm = (
  measurement: Measurement,
): BodyMeasurementFormValues => ({
  measuredAt: measurement.measured_at,
  waist: measurement.waist?.toString() ?? '',
  hip: measurement.hip?.toString() ?? '',
  right_arm: measurement.right_arm?.toString() ?? '',
  left_arm: measurement.left_arm?.toString() ?? '',
  chest: measurement.chest?.toString() ?? '',
  right_calf: measurement.right_calf?.toString() ?? '',
  left_calf: measurement.left_calf?.toString() ?? '',
  neck: measurement.neck?.toString() ?? '',
  notes: measurement.notes ?? '',
});

type BodyMeasurementDisplayValue = {
  label: string;
  value: number;
  legacy?: boolean;
};

const getBodyMeasurementDisplayValues = (measurement: Measurement): BodyMeasurementDisplayValue[] => {
  const values: BodyMeasurementDisplayValue[] = [];
  if (measurement.waist !== null) values.push({ label: 'Bel', value: measurement.waist });
  if (measurement.hip !== null) values.push({ label: 'Kalça', value: measurement.hip });

  const hasSideSpecificArm = measurement.right_arm !== null || measurement.left_arm !== null;
  if (measurement.right_arm !== null) values.push({ label: 'Sağ kol', value: measurement.right_arm });
  if (measurement.left_arm !== null) values.push({ label: 'Sol kol', value: measurement.left_arm });
  if (!hasSideSpecificArm && measurement.arm !== null) {
    values.push({ label: 'Kol — eski kayıt', value: measurement.arm, legacy: true });
  }

  if (measurement.chest !== null) values.push({ label: 'Göğüs', value: measurement.chest });

  const hasSideSpecificCalf = measurement.right_calf !== null || measurement.left_calf !== null;
  if (measurement.right_calf !== null) values.push({ label: 'Sağ baldır', value: measurement.right_calf });
  if (measurement.left_calf !== null) values.push({ label: 'Sol baldır', value: measurement.left_calf });
  if (!hasSideSpecificCalf && measurement.calf !== null) {
    values.push({ label: 'Baldır — eski kayıt', value: measurement.calf, legacy: true });
  }

  if (measurement.neck !== null) values.push({ label: 'Boyun', value: measurement.neck });
  if (measurement.thigh !== null) values.push({ label: 'Uyluk — eski kayıt', value: measurement.thigh, legacy: true });

  return values;
};

const compareMeasurementsNewestFirst = (left: Measurement, right: Measurement): number => {
  const dateComparison = right.measured_at.localeCompare(left.measured_at);
  return dateComparison !== 0 ? dateComparison : right.id.localeCompare(left.id);
};

const mergeMeasurements = (
  current: Measurement[],
  incoming: Measurement[],
): Measurement[] => {
  let merged = [...current];

  for (const measurement of incoming) {
    merged = merged.filter((candidate) => (
      candidate.id !== measurement.id
      && candidate.measured_at !== measurement.measured_at
    ));
    merged.push(measurement);
  }

  return merged.sort(compareMeasurementsNewestFirst);
};

const ClientDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const routeClientId = isValidUuid(id) ? id : null;
  const [viewState, setViewState] = useState<ClientDetailsViewState>({ status: 'loading' });
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [measurementStatus, setMeasurementStatus] = useState<MeasurementSectionStatus>('idle');
  const [measurementUserMessage, setMeasurementUserMessage] = useState<string | null>(null);
  const [measurementCursor, setMeasurementCursor] = useState<string | null>(null);
  const [measurementHasMore, setMeasurementHasMore] = useState(false);
  const [isLoadingMoreMeasurements, setIsLoadingMoreMeasurements] = useState(false);
  const [measurementLoadMoreMessage, setMeasurementLoadMoreMessage] = useState<string | null>(null);
  const [weightForm, setWeightForm] = useState<WeightFormValues>(createEmptyWeightForm);
  const [weightFormErrors, setWeightFormErrors] = useState<WeightFormErrors>({});
  const [weightSaveFeedback, setWeightSaveFeedback] = useState<MeasurementSaveFeedback | null>(null);
  const [isSavingWeight, setIsSavingWeight] = useState(false);
  const [bodyMeasurementForm, setBodyMeasurementForm] = useState<BodyMeasurementFormValues>(
    createEmptyBodyMeasurementForm,
  );
  const [bodyMeasurementFormErrors, setBodyMeasurementFormErrors] = useState<BodyMeasurementFormErrors>({});
  const [bodyMeasurementSaveFeedback, setBodyMeasurementSaveFeedback] = useState<MeasurementSaveFeedback | null>(null);
  const [isSavingBodyMeasurements, setIsSavingBodyMeasurements] = useState(false);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [isRemoving, setIsRemoving] = useState(false);
  const [profileImageError, setProfileImageError] = useState(false);
  const requestSequence = useRef(0);
  const measurementRequestSequence = useRef(0);
  const measurementLoadMoreLock = useRef(false);
  const measurementHistoryInitialized = useRef(false);
  const isMounted = useRef(true);

  const loadMeasurements = useCallback(async (): Promise<boolean> => {
    if (!routeClientId) return false;

    const requestId = ++measurementRequestSequence.current;
    measurementHistoryInitialized.current = true;
    setMeasurementStatus('loading');
    setMeasurementUserMessage(null);
    setMeasurementCursor(null);
    setMeasurementHasMore(false);
    measurementLoadMoreLock.current = false;
    setIsLoadingMoreMeasurements(false);
    setMeasurementLoadMoreMessage(null);

    try {
      const page = await fetchClientMeasurements(routeClientId);
      if (!isMounted.current || requestId !== measurementRequestSequence.current) return false;
      setMeasurements(mergeMeasurements([], page.measurements));
      setMeasurementCursor(page.nextCursor);
      setMeasurementHasMore(page.hasMore);
      setMeasurementStatus('ready');
      measurementHistoryInitialized.current = true;
      return true;
    } catch {
      if (!isMounted.current || requestId !== measurementRequestSequence.current) return false;
      measurementHistoryInitialized.current = false;
      setMeasurementStatus('error');
      setMeasurementUserMessage(MEASUREMENT_LOAD_ERROR);
      return false;
    }
  }, [routeClientId]);

  const loadMoreMeasurements = useCallback(async (): Promise<void> => {
    if (
      !routeClientId
      || !measurementHasMore
      || !measurementCursor
      || measurementLoadMoreLock.current
    ) return;

    measurementLoadMoreLock.current = true;
    const cursor = measurementCursor;
    const requestId = ++measurementRequestSequence.current;
    setIsLoadingMoreMeasurements(true);
    setMeasurementLoadMoreMessage(null);

    try {
      const page = await fetchClientMeasurements(routeClientId, cursor);
      if (!isMounted.current || requestId !== measurementRequestSequence.current) return;

      setMeasurements((current) => mergeMeasurements(current, page.measurements));
      setMeasurementCursor(page.nextCursor);
      setMeasurementHasMore(page.hasMore);
    } catch {
      if (!isMounted.current || requestId !== measurementRequestSequence.current) return;
      setMeasurementLoadMoreMessage(MEASUREMENT_LOAD_MORE_ERROR);
    } finally {
      measurementLoadMoreLock.current = false;
      if (isMounted.current && requestId === measurementRequestSequence.current) {
        setIsLoadingMoreMeasurements(false);
      }
    }
  }, [measurementCursor, measurementHasMore, routeClientId]);

  const loadData = useCallback(async (showLoading: boolean) => {
    const requestId = ++requestSequence.current;

    if (showLoading) {
      setViewState({ status: 'loading' });
      setMeasurements([]);
      setMeasurementStatus('idle');
      setMeasurementUserMessage(null);
      setMeasurementCursor(null);
      setMeasurementHasMore(false);
      measurementLoadMoreLock.current = false;
      measurementHistoryInitialized.current = false;
      setIsLoadingMoreMeasurements(false);
      setMeasurementLoadMoreMessage(null);
      setWeightForm(createEmptyWeightForm());
      setWeightFormErrors({});
      setWeightSaveFeedback(null);
      setBodyMeasurementForm(createEmptyBodyMeasurementForm());
      setBodyMeasurementFormErrors({});
      setBodyMeasurementSaveFeedback(null);
      setDailyLogs([]);
    }

    if (!routeClientId) {
      if (requestId === requestSequence.current) {
        measurementRequestSequence.current += 1;
        setMeasurements([]);
        setMeasurementStatus('idle');
        setMeasurementCursor(null);
        setMeasurementHasMore(false);
        setIsLoadingMoreMeasurements(false);
        setMeasurementLoadMoreMessage(null);
        setDailyLogs([]);
        setViewState({ status: 'invalid_id' });
      }
      return;
    }

    try {
      const accessResult = await fetchClientDetails(routeClientId);
      if (requestId !== requestSequence.current) return;

      switch (accessResult.status) {
        case 'invalid_id':
          measurementRequestSequence.current += 1;
          setMeasurements([]);
          setMeasurementStatus('idle');
          setMeasurementCursor(null);
          setMeasurementHasMore(false);
          setIsLoadingMoreMeasurements(false);
          setMeasurementLoadMoreMessage(null);
          setDailyLogs([]);
          setViewState({ status: 'invalid_id' });
          return;
        case 'unavailable':
          measurementRequestSequence.current += 1;
          setMeasurements([]);
          setMeasurementStatus('idle');
          setMeasurementCursor(null);
          setMeasurementHasMore(false);
          setIsLoadingMoreMeasurements(false);
          setMeasurementLoadMoreMessage(null);
          setDailyLogs([]);
          setViewState({ status: 'unavailable' });
          return;
        case 'error':
          measurementRequestSequence.current += 1;
          setMeasurements([]);
          setMeasurementStatus('idle');
          setMeasurementCursor(null);
          setMeasurementHasMore(false);
          setIsLoadingMoreMeasurements(false);
          setMeasurementLoadMoreMessage(null);
          setDailyLogs([]);
          setViewState({ status: 'error', userMessage: accessResult.userMessage });
          return;
        case 'pending':
          measurementRequestSequence.current += 1;
          setMeasurements([]);
          setMeasurementStatus('idle');
          setMeasurementCursor(null);
          setMeasurementHasMore(false);
          setIsLoadingMoreMeasurements(false);
          setMeasurementLoadMoreMessage(null);
          setDailyLogs([]);
          setViewState({ status: 'pending', client: accessResult.client });
          return;
        case 'active': {
          setViewState({ status: 'active', client: accessResult.client });
          if (!measurementHistoryInitialized.current) {
            void loadMeasurements();
          }
          try {
            const logsData = await fetchClientDailyLogs(routeClientId);
            if (requestId !== requestSequence.current) return;
            setDailyLogs(logsData);
          } catch {
            if (requestId !== requestSequence.current) return;
            setDailyLogs([]);
          }
          return;
        }
      }
    } catch {
      if (requestId !== requestSequence.current) return;
      measurementRequestSequence.current += 1;
      setMeasurements([]);
      setMeasurementStatus('idle');
      setMeasurementCursor(null);
      setMeasurementHasMore(false);
      setIsLoadingMoreMeasurements(false);
      setMeasurementLoadMoreMessage(null);
      setDailyLogs([]);
      setViewState({ status: 'error', userMessage: CLIENT_DETAIL_LOAD_ERROR });
    }
  }, [loadMeasurements, routeClientId]);

  const displayedClient =
    viewState.status === 'active' || viewState.status === 'pending'
      ? viewState.client
      : null;

  useEffect(() => {
    setProfileImageError(false);
  }, [displayedClient?.id, displayedClient?.profilePhotoUrl]);

  useEffect(() => {
    isMounted.current = true;
    void loadData(true);

    return () => {
      isMounted.current = false;
      requestSequence.current += 1;
      measurementRequestSequence.current += 1;
      measurementLoadMoreLock.current = false;
      measurementHistoryInitialized.current = false;
    };
  }, [loadData]);

  const activeClientId = viewState.status === 'active' ? viewState.client.id : null;

  useEffect(() => {
    if (!routeClientId || activeClientId !== routeClientId) return;

    let mounted = true;
    const refreshActiveClient = () => {
      if (mounted) void loadData(false);
    };

    window.addEventListener('focus', refreshActiveClient);

    const profilesSub = supabase
      .channel(`client_detail_changes_${activeClientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_profiles', filter: `user_id=eq.${routeClientId}` }, () => {
        refreshActiveClient();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${routeClientId}` }, () => {
        refreshActiveClient();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'measurements', filter: `client_id=eq.${routeClientId}` }, () => {
        refreshActiveClient();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_logs', filter: `client_id=eq.${routeClientId}` }, () => {
        refreshActiveClient();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dietitian_clients', filter: `client_id=eq.${routeClientId}` }, () => {
        refreshActiveClient();
      })
      .subscribe();

    return () => {
      mounted = false;
      window.removeEventListener('focus', refreshActiveClient);
      void supabase.removeChannel(profilesSub);
    };
  }, [activeClientId, loadData, routeClientId]);

  const loadingView = (
    <div className="p-8 flex items-center justify-center h-full min-h-screen">
      <div className="text-center text-slate-500">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          Yükleniyor...
      </div>
    </div>
  );

  if (
    viewState.status === 'loading' ||
    ((viewState.status === 'active' || viewState.status === 'pending') &&
      viewState.client.id !== routeClientId)
  ) {
    return loadingView;
  }

  if (!routeClientId || viewState.status === 'invalid_id') {
    return (
      <div className="p-8 flex items-center justify-center h-full min-h-screen">
        <div className="text-center max-w-md">
            <h2 className="text-2xl font-bold text-slate-800">Geçersiz Danışan Bağlantısı</h2>
            <p className="mt-2 text-slate-500">Danışanı görüntülemek için lütfen danışan listesinden tekrar seçim yapın.</p>
            <button onClick={() => navigate('/clients')} className="mt-4 text-primary font-medium hover:underline">Listeye Dön</button>
        </div>
      </div>
    );
  }

  if (viewState.status === 'unavailable') {
    return (
      <div className="p-8 flex items-center justify-center h-full min-h-screen">
        <div className="text-center max-w-md">
            <h2 className="text-2xl font-bold text-slate-800">Danışana Erişilemiyor</h2>
            <p className="mt-2 text-slate-500">Bu danışana erişilemiyor veya danışan bulunamadı.</p>
            <button onClick={() => navigate('/clients')} className="mt-4 text-primary font-medium hover:underline">Listeye Dön</button>
        </div>
      </div>
    );
  }

  if (viewState.status === 'error') {
    return (
      <div className="p-8 flex items-center justify-center h-full min-h-screen">
        <div className="text-center max-w-md">
            <h2 className="text-2xl font-bold text-slate-800">Danışan Bilgileri Yüklenemedi</h2>
            <p className="mt-2 text-slate-500">{viewState.userMessage}</p>
            <div className="mt-4 flex items-center justify-center gap-4">
              <button onClick={() => void loadData(true)} className="text-primary font-medium hover:underline">Tekrar Dene</button>
              <button onClick={() => navigate('/clients')} className="text-slate-500 font-medium hover:underline">Listeye Dön</button>
            </div>
        </div>
      </div>
    );
  }

  const handleRemoveClient = async (relationId: string) => {
    if (window.confirm('Bu danışanı listenizden kaldırmak istediğinize emin misiniz?')) {
      setIsRemoving(true);
      const result = await removeClient(relationId);
      if (!isMounted.current) return;

      setIsRemoving(false);
      if (result.status === 'removed') {
        alert('Danışan bağlantısı kaldırıldı.');
        navigate('/clients');
      } else {
        alert('Bağlantı kaldırılamadı. İlişki artık mevcut olmayabilir veya bu işlem için yetkiniz bulunmuyor.');
      }
    }
  };

  if (viewState.status === 'pending') {
    const client = viewState.client;
    return (
      <div className="w-full min-w-0 max-w-7xl mx-auto min-h-screen p-4 sm:p-6 lg:p-8">
        <button 
          onClick={() => navigate('/clients')}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 text-slate-500 hover:text-primary transition-colors mb-6 rounded-lg font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <ArrowLeft className="w-5 h-5" />
          Listeye Dön
        </button>
        <div className="w-full min-w-0 bg-white rounded-3xl p-4 sm:p-8 shadow-sm border border-slate-100 relative overflow-hidden">
           <div className="min-w-0 flex flex-col md:flex-row gap-8 relative z-10 items-center md:items-start">
              <div className="flex-shrink-0">
                  {client.profilePhotoUrl && !profileImageError ? (
                  <img 
                    src={client.profilePhotoUrl} 
                    alt="" 
                      className="w-32 h-32 rounded-full object-cover border-4 border-slate-100 shadow-sm opacity-60 grayscale" 
                      onError={() => setProfileImageError(true)}
                    />
                  ) : (
                    <ProfileAvatarFallback name={client.name} className="w-32 h-32 rounded-full border-4 border-slate-100 shadow-sm opacity-60 grayscale text-3xl" />
                  )}
              </div>
              <div className="min-w-0 flex-1 text-center md:text-left">
                 <h1 className="text-3xl font-bold text-slate-800 mb-2 break-words [overflow-wrap:anywhere]">{client.name}</h1>
                 <p className="text-slate-500 flex items-center justify-center md:justify-start gap-2 mb-6">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    Onay Bekleyen Danışan
                 </p>
                 <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-8 justify-center md:justify-start">
                     <div className="flex min-w-0 max-w-full items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl">
                         <Mail className="w-4 h-4 shrink-0 text-slate-400" />
                         <span className="min-w-0 break-words [overflow-wrap:anywhere]">{client.email}</span>
                     </div>
                 </div>
                 <div className="p-5 bg-amber-50 text-amber-800 rounded-2xl border border-amber-200/50 flex flex-col md:flex-row items-center md:items-start gap-4">
                    <div className="p-3 bg-amber-100 rounded-full shrink-0">
                      <Clock className="w-6 h-6 text-amber-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold mb-1">Bağlantı İsteği Bekleniyor</h4>
                      <p className="text-sm opacity-90 break-words [overflow-wrap:anywhere]">Bu danışan henüz bağlantı isteğinizi onaylamadı. Danışanınız mobil uygulama üzerinden isteği onayladığında yemek planı oluşturma, ölçüm takibi ve mesajlaşma gibi özellikler aktif olacaktır.</p>
                    </div>
                 </div>
                 <div className="mt-8 flex justify-center md:justify-start">
                    <button 
                      onClick={() => handleRemoveClient(client.relationId)}
                      disabled={isRemoving}
                      className="min-h-11 min-w-11 px-4 py-2 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                        <Trash2 className="w-4 h-4" />
                        İsteği İptal Et
                    </button>
                 </div>
              </div>
           </div>
        </div>
      </div>
    );
  }

  const client = viewState.client;
  const handleWeightDateChange = (measuredAt: string) => {
    const existingMeasurement = measurements.find(
      (measurement) => measurement.measured_at === measuredAt,
    );
    setWeightForm(
      existingMeasurement
        ? measurementToWeightForm(existingMeasurement)
        : createEmptyWeightForm(measuredAt),
    );
    setWeightFormErrors({});
    setWeightSaveFeedback(null);
  };

  const handleBodyMeasurementDateChange = (measuredAt: string) => {
    const existingMeasurement = measurements.find(
      (measurement) => measurement.measured_at === measuredAt,
    );
    setBodyMeasurementForm(
      existingMeasurement
        ? measurementToBodyMeasurementForm(existingMeasurement)
        : createEmptyBodyMeasurementForm(measuredAt),
    );
    setBodyMeasurementFormErrors({});
    setBodyMeasurementSaveFeedback(null);
  };

  const handleEditWeight = (measurement: Measurement) => {
    setWeightForm(measurementToWeightForm(measurement));
    setWeightFormErrors({});
    setWeightSaveFeedback(null);
  };

  const handleWeightSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingWeight) return;

    const errors: WeightFormErrors = {};
    let weight: number | null = null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(weightForm.measuredAt)) {
      errors.measuredAt = 'Geçerli bir tarih seçin.';
    } else if (weightForm.measuredAt > todayIsoDate()) {
      errors.measuredAt = 'Gelecek tarihli ölçüm kaydedilemez.';
    }

    const rawWeight = weightForm.weight.trim();
    if (!rawWeight) {
      errors.weight = 'Kilo değeri zorunludur.';
    } else {
      const parsedWeight = Number(rawWeight);
      if (!Number.isFinite(parsedWeight)) {
        errors.weight = 'Geçerli bir sayı girin.';
      } else if (parsedWeight < 20 || parsedWeight > 500) {
        errors.weight = 'Kilo 20–500 kg arasında olmalıdır.';
      } else {
        weight = parsedWeight;
      }
    }
    if (weightForm.notes.trim().length > 1000) {
      errors.notes = 'Not en fazla 1000 karakter olabilir.';
    }

    if (Object.keys(errors).length > 0) {
      setWeightFormErrors(errors);
      setWeightSaveFeedback(null);
      return;
    }

    setIsSavingWeight(true);
    setWeightFormErrors({});
    setWeightSaveFeedback(null);

    try {
      const savedMeasurement = await saveClientWeight({
        clientId: client.id,
        measuredAt: weightForm.measuredAt,
        weight: weight as number,
        notes: weightForm.notes.trim() || null,
      });
      if (!isMounted.current) return;

      measurementHistoryInitialized.current = true;
      setMeasurements((current) => mergeMeasurements(current, [savedMeasurement]));
      setMeasurementStatus('ready');
      setMeasurementUserMessage(null);
      setWeightSaveFeedback({
        type: 'success',
        message: 'Kilo kaydı kaydedildi.',
      });
    } catch {
      if (!isMounted.current) return;
      setWeightSaveFeedback({
        type: 'error',
        message: 'Kilo kaydedilemedi. Bilgileri kontrol edip tekrar deneyin.',
      });
    } finally {
      if (isMounted.current) setIsSavingWeight(false);
    }
  };

  const handleBodyMeasurementsSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingBodyMeasurements) return;

    const errors: BodyMeasurementFormErrors = {};
    const numericValues = Object.fromEntries(
      bodyMeasurementFieldDefinitions.map(({ key }) => [key, null]),
    ) as Record<BodyMeasurementNumericField, number | null>;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(bodyMeasurementForm.measuredAt)) {
      errors.measuredAt = 'Geçerli bir tarih seçin.';
    } else if (bodyMeasurementForm.measuredAt > todayIsoDate()) {
      errors.measuredAt = 'Gelecek tarihli ölçüm kaydedilemez.';
    }

    for (const definition of bodyMeasurementFieldDefinitions) {
      const rawValue = bodyMeasurementForm[definition.key].trim();
      const parsedValue = parseMeasurementInput(rawValue);
      if (parsedValue.error === 'invalid') {
        errors[definition.key] = 'Geçerli bir sayı girin.';
      } else if (parsedValue.error === 'out_of_range') {
        errors[definition.key] = 'Değer 0’dan büyük ve en fazla 500 cm olmalıdır.';
      } else {
        numericValues[definition.key] = parsedValue.value;
      }
    }

    if (!Object.values(numericValues).some((value) => value !== null)) {
      errors.form = 'En az bir vücut ölçüsü girin.';
    }
    if (bodyMeasurementForm.notes.trim().length > 1000) {
      errors.notes = 'Not en fazla 1000 karakter olabilir.';
    }

    if (Object.keys(errors).length > 0) {
      setBodyMeasurementFormErrors(errors);
      setBodyMeasurementSaveFeedback(null);
      return;
    }

    setIsSavingBodyMeasurements(true);
    setBodyMeasurementFormErrors({});
    setBodyMeasurementSaveFeedback(null);

    try {
      const savedMeasurement = await saveClientBodyMeasurements({
        clientId: client.id,
        measuredAt: bodyMeasurementForm.measuredAt,
        ...numericValues,
        notes: bodyMeasurementForm.notes.trim() || null,
      });
      if (!isMounted.current) return;

      measurementHistoryInitialized.current = true;
      setMeasurements((current) => mergeMeasurements(current, [savedMeasurement]));
      setMeasurementStatus('ready');
      setMeasurementUserMessage(null);
      setBodyMeasurementSaveFeedback({
        type: 'success',
        message: 'Vücut ölçüleri kaydedildi.',
      });
    } catch {
      if (!isMounted.current) return;
      setBodyMeasurementSaveFeedback({
        type: 'error',
        message: 'Vücut ölçüleri kaydedilemedi. Bilgileri kontrol edip tekrar deneyin.',
      });
    } finally {
      if (isMounted.current) setIsSavingBodyMeasurements(false);
    }
  };

  const smokingStatusLabel = client.smokingStatus === null
    ? 'Yok'
    : client.smokingStatus
      ? 'Kullanıyor'
      : 'Kullanmıyor';
  const alcoholStatusLabel = client.alcoholStatus
    || (client.alcoholUse === null
      ? 'Yok'
      : client.alcoholUse
        ? 'Tüketiyor'
        : 'Tüketmiyor');

  const handleEditPlan = () => {
    navigate('/meal-plans', { state: { clientId: client.id } });
  };

  // Calculate Data
  const parsedCurrentWeight = Number.parseFloat(client.currentWeight);
  const currentWeightNum = Number.isFinite(parsedCurrentWeight) ? parsedCurrentWeight : null;
  const parsedStartWeight = client.startWeight ? Number.parseFloat(client.startWeight) : Number.NaN;
  const startWeight = Number.isFinite(parsedStartWeight) ? parsedStartWeight : null;
  const heightM = client.heightCm ? client.heightCm / 100 : 0;
  const bmi = heightM > 0 && currentWeightNum !== null
    ? (currentWeightNum / (heightM * heightM)).toFixed(1)
    : '-';

  // Format Weight History
  const measurementsWithWeight = measurements.filter(
    (measurement): measurement is Measurement & { weight: number } => measurement.weight !== null
  );
  const bodyMeasurementHistory = measurements
    .map((measurement) => ({ measurement, values: getBodyMeasurementDisplayValues(measurement) }))
    .filter(({ values }) => values.length > 0);
  const weightHistory = measurementsWithWeight.slice(0, 8).reverse().map((measurement) => {
    const date = new Date(`${measurement.measured_at}T00:00:00`);
    return {
      id: measurement.id,
      date: `${date.getDate()} ${date.toLocaleString('tr-TR', { month: 'short' })}`,
      weight: measurement.weight,
    };
  });
  const weightValues = weightHistory.map(({ weight }) => weight);
  const chartMinWeight = weightValues.length > 0 ? Math.min(...weightValues) : null;
  const chartMaxWeight = weightValues.length > 0 ? Math.max(...weightValues) : null;
  const lastWeightChange = weightHistory.length > 1
    ? weightHistory[weightHistory.length - 1].weight - weightHistory[weightHistory.length - 2].weight
    : null;
  const isWeightLoss = lastWeightChange !== null && lastWeightChange <= 0;

  // Format Water Data
  const recentLogs = dailyLogs.slice(-7);
  const waterTarget = client.waterGoalLiters ?? null;
  const recordedWaterValues = recentLogs
    .map(log => log.water_intake)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const hasDailyLogs = recentLogs.length > 0;
  const hasWaterData = recordedWaterValues.length > 0;
  const waterAvg = hasWaterData
    ? (recordedWaterValues.reduce((sum, value) => sum + value, 0) / recordedWaterValues.length).toFixed(1)
    : null;
  const waterAverageLabel = recordedWaterValues.length === 1
    ? 'Son Kayıt'
    : `Son ${recordedWaterValues.length} Kayıt Ort.`;
  
  const dayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const waterData = recentLogs.map(log => {
      const d = new Date(log.date);
      return {
        val: typeof log.water_intake === 'number'
            ? parseFloat(log.water_intake.toFixed(1))
            : null,
          day: dayNames[d.getDay()] || '-'
      };
  });
  
  // Pad if we don't have 7 days
  while (waterData.length < 7) {
      waterData.unshift({ val: null, day: '-' });
  }

  return (
    <div className="w-full min-w-0 max-w-7xl mx-auto min-h-screen p-4 sm:p-6 lg:p-8">
      <button 
        onClick={() => navigate('/clients')}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 text-slate-500 hover:text-primary transition-colors mb-6 rounded-lg font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <ArrowLeft className="w-5 h-5" />
        Listeye Dön
      </button>

      {/* Header Profile Card */}
      <div className="w-full min-w-0 bg-white rounded-3xl p-4 sm:p-8 shadow-sm border border-slate-100 mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-bl-full -mr-16 -mt-16 opacity-50"></div>
        
        <div className="min-w-0 flex flex-col md:flex-row gap-8 relative z-10">
            <div className="flex-shrink-0">
                {client.profilePhotoUrl && !profileImageError ? (
                  <img 
                    src={client.profilePhotoUrl} 
                    alt="" 
                    className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-md" 
                    onError={() => setProfileImageError(true)}
                  />
                ) : (
                  <ProfileAvatarFallback name={client.name} className="w-32 h-32 rounded-full border-4 border-white shadow-md text-3xl" />
                )}
            </div>
            
            <div className="min-w-0 flex-1">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                    <div className="min-w-0">
                        <h1 className="text-3xl font-bold text-slate-800 break-words [overflow-wrap:anywhere]">{client.name}</h1>
                        <p className="text-slate-500 flex items-center gap-2 mt-1">
                            <span className={`inline-block w-2.5 h-2.5 rounded-full ${client.status === 'Aktif' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                            {client.status} Danışan
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => navigate(`/messages?clientId=${encodeURIComponent(client.id)}`)}
                          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-medium text-white shadow-sm shadow-primary/30 transition-all hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                            <MessageSquare className="h-4 w-4" aria-hidden="true" />
                            Mesaj Gönder
                        </button>
                        <button 
                          onClick={handleEditPlan}
                          className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                            Planı Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/clients/${client.id}/meal-tracking`)}
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                            <Utensils className="h-4 w-4 text-primary" aria-hidden="true" />
                            Öğün Takibi
                        </button>
                        <button 
                          onClick={() => handleRemoveClient(client.relationId)}
                          disabled={isRemoving}
                          className="px-3 py-2.5 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-all disabled:opacity-50 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          title="Danışanı Kaldır"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="min-w-0 flex flex-wrap gap-6 text-sm text-slate-600">
                    <div className="flex min-w-0 max-w-full items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Mail className="w-4 h-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{client.email}</span>
                    </div>
                    {client.phone && (<div className="flex min-w-0 max-w-full items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Phone className="w-4 h-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{client.phone}</span>
                    </div>)}
                    <div className="flex min-w-0 max-w-full items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Calendar className="w-4 h-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">Başlangıç: {client.startDate}</span>
                    </div>
                    <div className="flex min-w-0 max-w-full items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Activity className="w-4 h-4 shrink-0 text-primary" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">Hedef: {client.goal || 'Yok'}</span>
                    </div>
                </div>
            </div>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Left Column - Stats */}
        <div className="min-w-0 space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <Weight className="w-5 h-5 text-primary" />
                    Vücut Kompozisyonu
                </h3>
                
                <div className="space-y-6">
                    <div className="flex justify-between items-end border-b border-slate-50 pb-4">
                        <div className="text-sm text-slate-500">Güncel Kilo</div>
                        <div className="text-2xl font-bold text-slate-800">{client.currentWeight}</div>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-50 pb-4">
                        <div className="text-sm text-slate-500">Başlangıç Kilosu</div>
                        <div className="text-2xl font-bold text-slate-400">{startWeight !== null ? `${startWeight} kg` : '-'}</div>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-50 pb-4">
                        <div className="text-sm text-slate-500">Hedef Kilo</div>
                        <div className="text-2xl font-bold text-slate-400">{client.targetWeight || '-'}</div>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-50 pb-4">
                        <div className="text-sm text-slate-500">Boy</div>
                        <div className="text-2xl font-bold text-slate-800">{client.heightCm ? `${client.heightCm} cm` : '-'}</div>
                    </div>
                    <div className="flex justify-between items-end">
                        <div className="text-sm text-slate-500">Vücut Kitle İndeksi (BMI)</div>
                        <div className="text-2xl font-bold text-slate-800">{bmi}</div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <Stethoscope className="w-5 h-5 text-red-500" />
                    Tıbbi Profil
                </h3>
                
                <div className="space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Kan Grubu</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{client.bloodType || 'Yok'}</div>
                    </div>
                    <div className="border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500 mb-2">Kronik Rahatsızlıklar</div>
                        <div className="flex flex-wrap gap-2">
                            {client.chronicConditions && client.chronicConditions.length > 0 ? (
                                client.chronicConditions.map((condition, idx) => (
                                    <span key={idx} className="max-w-full break-words px-2 py-1 bg-red-50 text-red-600 rounded-md text-xs font-medium [overflow-wrap:anywhere]">
                                        {condition}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-400">Yok</span>
                            )}
                        </div>
                    </div>
                    <div className="border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500 mb-2">Kullanılan İlaçlar</div>
                        <div className="flex flex-wrap gap-2">
                            {client.medications && client.medications.length > 0 ? (
                                client.medications.map((med, idx) => (
                                    <span key={idx} className="max-w-full break-words px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-xs font-medium [overflow-wrap:anywhere]">
                                        {med}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-400">Yok</span>
                            )}
                        </div>
                    </div>
                    <div className="border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500 mb-2">Besin İntoleransları</div>
                        <div className="flex flex-wrap gap-2">
                            {client.foodIntolerances && client.foodIntolerances.length > 0 ? (
                                client.foodIntolerances.map((intol, idx) => (
                                    <span key={idx} className="max-w-full break-words px-2 py-1 bg-yellow-50 text-yellow-700 rounded-md text-xs font-medium [overflow-wrap:anywhere]">
                                        {intol}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-400">Yok</span>
                            )}
                        </div>
                    </div>
                    <div className="border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500 mb-2">Sevilmeyen Besinler</div>
                        <div className="flex flex-wrap gap-2">
                            {client.dislikedFoods.length > 0 ? (
                                client.dislikedFoods.map((food) => (
                                    <span key={food} className="max-w-full break-words px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-medium [overflow-wrap:anywhere]">
                                        {food}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-400">Yok</span>
                            )}
                        </div>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="text-sm text-slate-500">Son Tahlil Tarihi</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{client.lastLabDate || 'Yok'}</div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-orange-500" />
                    Yaşam Tarzı
                </h3>
                
                <div className="space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Aktivite Seviyesi</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{client.activityLevel || 'Yok'}</div>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Uyku Düzeni</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{client.sleepHoursLabel || 'Yok'}</div>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Sigara Kullanımı</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{smokingStatusLabel}</div>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Alkol Kullanımı</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{alcoholStatusLabel}</div>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="text-sm text-slate-500">Beslenme Tipi</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{client.nutritionType || 'Yok'}</div>
                    </div>
                </div>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-dark p-6 text-white shadow-lg shadow-primary/20">
                <div className="mb-8 flex items-start justify-between">
                   <div>
                       <p className="mb-1 font-medium text-emerald-100">Program Uyumu</p>
                       <h3 className="text-3xl font-bold">{formatClientPercentage(client.compliance)}</h3>
                   </div>
                   <div className="rounded-lg bg-white/20 p-2">
                       <TrendingUp className="h-6 w-6 text-white" aria-hidden="true" />
                   </div>
                </div>
                <p className="mb-6 text-sm leading-relaxed text-emerald-100">
                    Son 7 gündeki planlanan öğünlerin tamamlanma oranı.
                </p>
                {client.compliance === null ? (
                  <p className="rounded-xl bg-black/10 px-3 py-2 text-sm text-emerald-50" role="status">
                    Son 7 gün içinde planlanmış öğün bulunmuyor.
                  </p>
                ) : (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-black/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, client.compliance))} aria-label="Son 7 gün program uyumu">
                    <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, Math.max(0, client.compliance))}%` }} />
                  </div>
                )}
            </div>
        </div>

        {/* Middle Column - Activity/Charts */}
        <div className="min-w-0 md:col-span-2 space-y-6">
            <section className="min-w-0 space-y-6" aria-labelledby="measurement-section-title">
                {(measurementStatus === 'idle' || measurementStatus === 'loading') && (
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100" role="status">
                      <div className="flex items-center gap-3 text-sm text-slate-500">
                          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
                          Ölçüm kayıtları yükleniyor...
                      </div>
                  </div>
                )}

                {measurementStatus === 'error' && (
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100">
                      <p className="text-sm text-red-700" role="alert">{measurementUserMessage}</p>
                      <button
                        type="button"
                        onClick={() => void loadMeasurements()}
                        className="mt-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-red-200 px-4 py-2 font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                      >
                        Tekrar Dene
                      </button>
                  </div>
                )}

                {measurementStatus === 'ready' && measurements.length === 0 && (
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100" role="status">
                      <p className="text-sm text-slate-500">Henüz ölçüm kaydı yok</p>
                  </div>
                )}

                {measurementStatus === 'ready' && measurements.length > 0 && (
                  <>
                    <div className="min-w-0 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-100">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                            <h3 className="font-bold text-slate-800">Kilo Değişimi Geçmişi</h3>
                            {lastWeightChange !== null && (
                              <div className={`flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${isWeightLoss ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                                  {isWeightLoss ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                                  {Math.abs(lastWeightChange).toFixed(1)} kg
                                  <span className="ml-1 font-normal text-slate-400">son değişim</span>
                              </div>
                            )}
                        </div>

                        {weightHistory.length === 0 ? (
                          <p className="py-8 text-sm text-slate-500" role="status">
                            Kilo içeren ölçüm kaydı yok.
                          </p>
                        ) : (
                          <div className="grid min-w-0 grid-cols-4 gap-2 sm:grid-cols-8" aria-label="Son kilo ölçümleri">
                              {weightHistory.map((data) => {
                                const range = chartMinWeight !== null && chartMaxWeight !== null
                                  ? chartMaxWeight - chartMinWeight
                                  : 0;
                                const height = range === 0 || chartMinWeight === null
                                  ? 60
                                  : 20 + ((data.weight - chartMinWeight) / range) * 80;
                                return (
                                  <div key={data.id} className="group flex min-w-0 flex-col items-center gap-2">
                                      <span className="text-xs font-bold text-slate-700">{data.weight} kg</span>
                                      <div className="flex h-40 w-full min-w-0 items-end overflow-hidden rounded-t-lg bg-slate-50">
                                          <div
                                            className="mx-1 w-full rounded-t-md bg-emerald-200/70 transition-colors group-hover:bg-primary"
                                            style={{ height: `${height}%` }}
                                          />
                                      </div>
                                      <span className="max-w-full break-words text-center text-[10px] font-medium text-slate-400">{data.date}</span>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                    </div>

                    <div className="min-w-0 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-100">
                        <h3 className="mb-4 font-bold text-slate-800">Kilo Geçmişi</h3>
                        {measurementsWithWeight.length === 0 ? (
                          <p className="text-sm text-slate-500" role="status">Henüz kilo ölçümü yok.</p>
                        ) : (
                          <div className="space-y-3">
                              {measurementsWithWeight.map((measurement) => (
                                <article key={measurement.id} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <h4 className="font-semibold text-slate-800">
                                                {new Date(`${measurement.measured_at}T00:00:00`).toLocaleDateString('tr-TR')}
                                            </h4>
                                            <span className="mt-2 inline-flex rounded-lg bg-white px-2 py-1 text-xs text-slate-600">
                                                Kilo: {measurement.weight} kg
                                            </span>
                                            {measurement.notes && (
                                              <p className="mt-3 break-words text-sm text-slate-600 [overflow-wrap:anywhere]">{measurement.notes}</p>
                                            )}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleEditWeight(measurement)}
                                          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                                        >
                                            Kilo Kaydını Düzenle
                                        </button>
                                    </div>
                                </article>
                              ))}
                          </div>
                        )}
                        {measurementLoadMoreMessage && (
                          <p className="mt-4 break-words text-sm text-red-700 [overflow-wrap:anywhere]" role="alert">
                            {measurementLoadMoreMessage}
                          </p>
                        )}
                        {measurementHasMore && (
                          <button
                            type="button"
                            onClick={() => void loadMoreMeasurements()}
                            disabled={isLoadingMoreMeasurements}
                            className="mt-4 inline-flex min-h-11 min-w-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:w-auto"
                          >
                            {isLoadingMoreMeasurements
                              ? 'Yükleniyor...'
                              : measurementLoadMoreMessage
                                ? 'Tekrar Dene'
                                : '8 ölçüm daha göster'}
                          </button>
                        )}
                    </div>
                  </>
                )}

                {measurementStatus === 'ready' && bodyMeasurementHistory.length > 0 && (
                  <div className="min-w-0 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h3 className="mb-4 font-bold text-slate-800">Vücut Ölçüleri Geçmişi</h3>
                    <div className="space-y-3">
                      {bodyMeasurementHistory.map(({ measurement, values }) => (
                        <article key={`body-${measurement.id}`} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <h4 className="font-semibold text-slate-800">
                                {new Date(`${measurement.measured_at}T00:00:00`).toLocaleDateString('tr-TR')}
                              </h4>
                              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {values.map((item) => (
                                  <span key={`${measurement.id}-${item.label}`} className="inline-flex min-w-0 items-center justify-between gap-3 rounded-lg bg-white px-2 py-1 text-xs text-slate-600">
                                    <span className="min-w-0 break-words">{item.label}</span>
                                    <span className="shrink-0 font-semibold">{item.value} cm</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                            {values.some((item) => item.legacy) && (
                              <span className="shrink-0 text-xs text-amber-700">Eski kayıt</span>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                <div className="min-w-0 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-100">
                    <div className="mb-6">
                        <h2 id="measurement-section-title" className="font-bold text-slate-800 flex items-center gap-2">
                            <Weight className="w-5 h-5 text-primary" /> Kilo Ölçümü
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                            Aynı tarihteki kilo kaydı güncellenirken vücut ölçüleri korunur.
                        </p>
                    </div>

                    <form className="min-w-0 space-y-5" onSubmit={handleWeightSubmit} noValidate>
                        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                            <label className="min-w-0 text-sm font-medium text-slate-700">
                                Tarih
                                <input
                                  type="date"
                                  value={weightForm.measuredAt}
                                  max={todayIsoDate()}
                                  onChange={(event) => handleWeightDateChange(event.target.value)}
                                  aria-invalid={Boolean(weightFormErrors.measuredAt)}
                                  aria-describedby={weightFormErrors.measuredAt ? 'weight-date-error' : undefined}
                                  className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                />
                                {weightFormErrors.measuredAt && (
                                  <span id="weight-date-error" className="mt-1 block text-xs text-red-600">
                                    {weightFormErrors.measuredAt}
                                  </span>
                                )}
                            </label>

                            <label className="min-w-0 text-sm font-medium text-slate-700">
                                Kilo (kg)
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min={20}
                                  max={500}
                                  step="any"
                                  value={weightForm.weight}
                                  onChange={(event) => {
                                    setWeightForm((current) => ({ ...current, weight: event.target.value }));
                                    setWeightFormErrors((current) => ({ ...current, weight: undefined, form: undefined }));
                                    setWeightSaveFeedback(null);
                                  }}
                                  aria-invalid={Boolean(weightFormErrors.weight)}
                                  aria-describedby={weightFormErrors.weight ? 'weight-value-error' : undefined}
                                  className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                />
                                {weightFormErrors.weight && (
                                  <span id="weight-value-error" className="mt-1 block text-xs text-red-600">
                                    {weightFormErrors.weight}
                                  </span>
                                )}
                            </label>
                        </div>

                        <label className="block min-w-0 text-sm font-medium text-slate-700">
                            Not
                            <textarea
                              value={weightForm.notes}
                              maxLength={1000}
                              onChange={(event) => {
                                setWeightForm((current) => ({ ...current, notes: event.target.value }));
                                setWeightFormErrors((current) => ({ ...current, notes: undefined }));
                                setWeightSaveFeedback(null);
                              }}
                              aria-invalid={Boolean(weightFormErrors.notes)}
                              aria-describedby="weight-notes-help"
                              className="mt-1 min-h-28 w-full min-w-0 resize-y rounded-xl border border-slate-200 px-3 py-2 text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <span id="weight-notes-help" className={`mt-1 block text-xs ${weightFormErrors.notes ? 'text-red-600' : 'text-slate-400'}`}>
                              {weightFormErrors.notes || `${weightForm.notes.length}/1000 karakter`}
                            </span>
                        </label>

                        {weightFormErrors.form && (
                          <p className="text-sm text-red-600" role="alert">{weightFormErrors.form}</p>
                        )}
                        {weightSaveFeedback && (
                          <p
                            className={`text-sm ${weightSaveFeedback.type === 'success' ? 'text-emerald-700' : 'text-red-600'}`}
                            role={weightSaveFeedback.type === 'error' ? 'alert' : 'status'}
                          >
                            {weightSaveFeedback.message}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="submit"
                              disabled={isSavingWeight}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-primary px-5 py-2 font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            >
                              {isSavingWeight
                                ? 'Kaydediliyor...'
                                : 'Kilo Kaydet'}
                            </button>
                        </div>
                    </form>
                </div>

                <div className="min-w-0 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-slate-100">
                    <div className="mb-6">
                        <h2 className="font-bold text-slate-800 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-primary" /> Vücut Ölçüleri
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                            Aynı tarihteki çevre ölçüleri güncellenirken kilo kaydı ve diğer alanlar korunur.
                        </p>
                    </div>

                    <form className="min-w-0 space-y-5" onSubmit={handleBodyMeasurementsSubmit} noValidate>
                        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <label className="min-w-0 text-sm font-medium text-slate-700">
                                Tarih
                                <input
                                  type="date"
                                  value={bodyMeasurementForm.measuredAt}
                                  max={todayIsoDate()}
                                  onChange={(event) => handleBodyMeasurementDateChange(event.target.value)}
                                  aria-invalid={Boolean(bodyMeasurementFormErrors.measuredAt)}
                                  aria-describedby={bodyMeasurementFormErrors.measuredAt ? 'body-measurement-date-error' : undefined}
                                  className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                />
                                {bodyMeasurementFormErrors.measuredAt && (
                                  <span id="body-measurement-date-error" className="mt-1 block text-xs text-red-600">
                                    {bodyMeasurementFormErrors.measuredAt}
                                  </span>
                                )}
                            </label>

                            {bodyMeasurementFieldDefinitions.map((definition) => (
                              <label key={definition.key} className="min-w-0 text-sm font-medium text-slate-700">
                                  {definition.label}
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min={definition.min}
                                    max={definition.max}
                                    step={definition.step}
                                    value={bodyMeasurementForm[definition.key]}
                                    onChange={(event) => {
                                      setBodyMeasurementForm((current) => ({
                                        ...current,
                                        [definition.key]: event.target.value,
                                      }));
                                      setBodyMeasurementFormErrors((current) => ({
                                        ...current,
                                        [definition.key]: undefined,
                                        form: undefined,
                                      }));
                                      setBodyMeasurementSaveFeedback(null);
                                    }}
                                    aria-invalid={Boolean(bodyMeasurementFormErrors[definition.key])}
                                    aria-describedby={bodyMeasurementFormErrors[definition.key] ? `body-measurement-${definition.key}-error` : undefined}
                                    className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                                  />
                                  {bodyMeasurementFormErrors[definition.key] && (
                                    <span id={`body-measurement-${definition.key}-error`} className="mt-1 block text-xs text-red-600">
                                      {bodyMeasurementFormErrors[definition.key]}
                                    </span>
                                  )}
                              </label>
                            ))}
                        </div>

                        <label className="block min-w-0 text-sm font-medium text-slate-700">
                            Not
                            <textarea
                              value={bodyMeasurementForm.notes}
                              maxLength={1000}
                              onChange={(event) => {
                                setBodyMeasurementForm((current) => ({ ...current, notes: event.target.value }));
                                setBodyMeasurementFormErrors((current) => ({ ...current, notes: undefined }));
                                setBodyMeasurementSaveFeedback(null);
                              }}
                              aria-invalid={Boolean(bodyMeasurementFormErrors.notes)}
                              aria-describedby="body-measurement-notes-help"
                              className="mt-1 min-h-28 w-full min-w-0 resize-y rounded-xl border border-slate-200 px-3 py-2 text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <span id="body-measurement-notes-help" className={`mt-1 block text-xs ${bodyMeasurementFormErrors.notes ? 'text-red-600' : 'text-slate-400'}`}>
                              {bodyMeasurementFormErrors.notes || `${bodyMeasurementForm.notes.length}/1000 karakter`}
                            </span>
                        </label>

                        {bodyMeasurementFormErrors.form && (
                          <p className="text-sm text-red-600" role="alert">{bodyMeasurementFormErrors.form}</p>
                        )}
                        {bodyMeasurementSaveFeedback && (
                          <p
                            className={`text-sm ${bodyMeasurementSaveFeedback.type === 'success' ? 'text-emerald-700' : 'text-red-600'}`}
                            role={bodyMeasurementSaveFeedback.type === 'error' ? 'alert' : 'status'}
                          >
                            {bodyMeasurementSaveFeedback.message}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="submit"
                              disabled={isSavingBodyMeasurements}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-primary px-5 py-2 font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            >
                              {isSavingBodyMeasurements
                                ? 'Kaydediliyor...'
                                : 'Vücut Ölçülerini Kaydet'}
                            </button>
                        </div>
                    </form>
                </div>
            </section>

            {/* Daily Charts Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Water Chart */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Droplets className="w-5 h-5 text-blue-500" /> Su Tüketimi
                    </h3>
                    {!hasDailyLogs ? (
                      <p className="text-sm text-slate-500 py-8" role="status">
                        Henüz günlük takip kaydı bulunmuyor.
                      </p>
                    ) : !hasWaterData ? (
                      <p className="text-sm text-slate-500 py-8" role="status">
                        Günlük kayıtlar mevcut ancak su tüketimi bilgisi bulunmuyor.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2 mb-6">
                            <span className="text-3xl font-bold text-slate-800">{waterAvg} <span className="text-sm font-normal text-slate-400">Lt ({waterAverageLabel})</span></span>
                            {waterTarget !== null && <span className="text-xs font-medium text-slate-400">Hedef: {waterTarget} Lt</span>}
                        </div>

                        <div className="h-48 flex items-stretch justify-between gap-3">
                            {waterData.map((data, i) => (
                                 <div key={i} className="flex flex-col items-center flex-1 group relative">
                                    <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full mb-2 text-xs font-bold bg-slate-800 text-white px-2 py-1 rounded shadow-lg z-10">
                                        {data.val === null ? 'Su bilgisi yok' : `${data.val} Lt`}
                                    </span>
                                    <div className="w-full bg-blue-50/50 rounded-2xl relative flex-1 flex items-end overflow-hidden">
                                        <div
                                            className={`w-full rounded-2xl transition-all duration-500 ${data.val !== null && waterTarget !== null && data.val >= waterTarget ? 'bg-blue-500' : 'bg-blue-300'}`}
                                            style={{ height: `${data.val === null ? 0 : Math.min((data.val / (waterTarget || 3)) * 100, 100)}%` }}
                                        ></div>
                                    </div>
                                    <span className="text-xs text-slate-400 mt-3 font-medium">{data.day}</span>
                                 </div>
                            ))}
                        </div>
                      </>
                    )}
                </div>

                {/* Calorie Chart - Kept as mock since no direct calorie logs are found */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Utensils className="w-5 h-5 text-orange-500" /> Kalori Alımı
                    </h3>
                    <div className="flex items-baseline gap-2 mb-6">
                        <span className="text-3xl font-bold text-slate-800">- <span className="text-sm font-normal text-slate-400">kcal (Ort.)</span></span>
                        <span className="text-xs font-medium text-slate-400">Hedef: Belirlenmedi</span>
                    </div>

                    <div className="h-48 flex items-stretch justify-center items-center gap-3">
                        <div className="text-slate-400 text-sm text-center">
                            Henüz kalori/öğün tüketim kaydı bulunmuyor.
                        </div>
                    </div>
                </div>
            </div>

        </div>

      </div>
    </div>
  );
};

export default ClientDetails;
