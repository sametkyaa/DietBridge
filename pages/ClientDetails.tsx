import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown } from 'lucide-react';
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
import { formatPercentageDisplay } from '../shared/utils/percentageDisplay';
import { getDateKeyInTimeZone } from '../shared/utils/dateContract';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  LinkButton,
  LoadingState,
  PageContainer,
  PageHeader,
  TabPanel,
  Tabs,
} from '../shared/ui';
import { clientMessagesPath, clientPlanNavigation } from '../features/clients/utils/clientRoutes';
import { dietWeekNumber } from '../features/clients/utils/clientProfileContract';
import { ClientGoalCard } from '../features/clients/components/profile/ClientGoalCard';
import { ClientTodayMealsCard } from '../features/clients/components/profile/ClientTodayMealsCard';
import { ClientChangeRequestsCard } from '../features/clients/components/profile/ClientChangeRequestsCard';
import { ClientHealthCard } from '../features/clients/components/profile/ClientHealthCard';
import { ClientNutritionTargetCard } from '../features/clients/components/profile/ClientNutritionTargetCard';
import { ClientAppointmentsCard } from '../features/clients/components/profile/ClientAppointmentsCard';
import { ClientNotesCard } from '../features/clients/components/profile/ClientNotesCard';


type ProfileTab = 'overview' | 'measurements';

const istanbulNowTime = (): string => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

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
  const [removeTarget, setRemoveTarget] = useState<{ relationId: string; mode: 'remove' | 'cancel' } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [refreshToken, setRefreshToken] = useState(0);
  const [nowTime, setNowTime] = useState(istanbulNowTime);
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
      if (!mounted) return;
      void loadData(false);
      setNowTime(istanbulNowTime());
      setRefreshToken((current) => current + 1);
    };
    const refreshSections = () => {
      if (!mounted) return;
      setNowTime(istanbulNowTime());
      setRefreshToken((current) => current + 1);
    };
    const sectionTimer = window.setInterval(refreshSections, 5 * 60_000);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_change_requests', filter: `client_id=eq.${routeClientId}` }, () => {
        refreshSections();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_plans', filter: `client_id=eq.${routeClientId}` }, () => {
        refreshSections();
      })
      .subscribe();

    return () => {
      mounted = false;
      window.clearInterval(sectionTimer);
      window.removeEventListener('focus', refreshActiveClient);
      void supabase.removeChannel(profilesSub);
    };
  }, [activeClientId, loadData, routeClientId]);

  const todayKey = getDateKeyInTimeZone();

  if (
    viewState.status === 'loading' ||
    ((viewState.status === 'active' || viewState.status === 'pending') &&
      viewState.client.id !== routeClientId)
  ) {
    return (
      <PageContainer>
        <Card><LoadingState label="Yükleniyor..." variant="skeleton" rows={4} /></Card>
      </PageContainer>
    );
  }

  const backToList = <Button variant="ghost" leftIcon="arrow-left" onClick={() => navigate('/clients')}>Listeye Dön</Button>;

  if (!routeClientId || viewState.status === 'invalid_id') {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon="warning-circle"
            title="Geçersiz Danışan Bağlantısı"
            description="Danışanı görüntülemek için lütfen danışan listesinden tekrar seçim yapın."
            action={backToList}
          />
        </Card>
      </PageContainer>
    );
  }

  if (viewState.status === 'unavailable') {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon="lock"
            title="Danışana Erişilemiyor"
            description="Bu danışana erişilemiyor veya danışan bulunamadı."
            action={backToList}
          />
        </Card>
      </PageContainer>
    );
  }

  if (viewState.status === 'error') {
    return (
      <PageContainer>
        <Card>
          <ErrorState
            title="Danışan Bilgileri Yüklenemedi"
            description={viewState.userMessage}
            onRetry={() => void loadData(true)}
            retryLabel="Tekrar Dene"
          />
          <div className="flex justify-center pb-4">{backToList}</div>
        </Card>
      </PageContainer>
    );
  }

  const requestRemoveClient = (relationId: string, mode: 'remove' | 'cancel') => {
    setRemoveError(null);
    setRemoveTarget({ relationId, mode });
  };

  const confirmRemoveClient = async () => {
    if (!removeTarget || isRemoving) return;
    setIsRemoving(true);
    setRemoveError(null);
    const result = await removeClient(removeTarget.relationId);
    if (!isMounted.current) return;
    setIsRemoving(false);
    if (result.status === 'removed') {
      setRemoveTarget(null);
      navigate('/clients', { replace: true });
    } else {
      setRemoveError('Bağlantı kaldırılamadı. İlişki artık mevcut olmayabilir veya bu işlem için yetkiniz bulunmuyor.');
    }
  };

  const removeDialog = (
    <ConfirmDialog
      open={removeTarget !== null}
      title={removeTarget?.mode === 'cancel' ? 'Bağlantı isteği iptal edilsin mi?' : 'Danışan bağlantısı kaldırılsın mı?'}
      description={removeTarget?.mode === 'cancel'
        ? 'Danışan isteği henüz kabul etmedi. İptal ettiğinizde istek geri çekilir.'
        : 'Danışan listenizden çıkar; plan, mesaj ve takip erişiminiz sona erer. Danışanın kendi kayıtları silinmez.'}
      confirmLabel={removeTarget?.mode === 'cancel' ? 'İsteği iptal et' : 'Bağlantıyı kaldır'}
      tone="danger"
      busy={isRemoving}
      onConfirm={() => void confirmRemoveClient()}
      onCancel={() => { if (!isRemoving) { setRemoveTarget(null); setRemoveError(null); } }}
    >
      {removeError && <Callout tone="bad" role="alert">{removeError}</Callout>}
    </ConfirmDialog>
  );

  if (viewState.status === 'pending') {
    const client = viewState.client;
    return (
      <PageContainer>
        <PageHeader
          back={{ to: '/clients', label: 'Danışanlara dön' }}
          leading={<Avatar name={client.name} src={client.profilePhotoUrl} size="lg" className="opacity-70 grayscale" />}
          title={<span className="break-words [overflow-wrap:anywhere]">{client.name}</span>}
          titleAddon={<Badge tone="warn" dot>Onay bekliyor</Badge>}
          description={<span className="break-words [overflow-wrap:anywhere]">{client.email}</span>}
          actions={<Button variant="danger" leftIcon="x" onClick={() => requestRemoveClient(client.relationId, 'cancel')} disabled={isRemoving}>İsteği İptal Et</Button>}
        />
        <Callout tone="warn">
          <b className="block">Bağlantı İsteği Bekleniyor</b>
          Bu danışan henüz bağlantı isteğinizi onaylamadı. Danışanınız mobil uygulama üzerinden isteği onayladığında yemek planı oluşturma, ölçüm takibi ve mesajlaşma gibi özellikler aktif olacaktır.
        </Callout>
        {removeDialog}
      </PageContainer>
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


  const planNavigation = clientPlanNavigation(client.id);
  const dietWeek = dietWeekNumber(client.dietStartDate ?? null, todayKey);
  const subtitleParts = [
    client.goal,
    client.heightCm ? `${client.heightCm} cm` : null,
    client.startDate && client.startDate !== '-' ? `${client.startDate} tarihinden beri${dietWeek ? `, ${dietWeek}. hafta` : ''}` : null,
  ].filter(Boolean);
  const contactLine = [client.email, client.phone].filter(Boolean).join(' · ');

  return (
    <PageContainer>
      <PageHeader
        back={{ to: '/clients', label: 'Danışanlara dön' }}
        leading={<Avatar name={client.name} src={client.profilePhotoUrl} size="lg" className="!h-[60px] !w-[60px] !text-20" />}
        title={<span className="break-words [overflow-wrap:anywhere]">{client.name}</span>}
        titleAddon={<Badge tone="ok" dot>Aktif</Badge>}
        description={(
          <>
            {subtitleParts.length > 0 && <span className="block">{subtitleParts.join(' · ')}</span>}
            {contactLine && <span className="block text-12.5 text-ink-3 break-words [overflow-wrap:anywhere]">{contactLine}</span>}
          </>
        )}
        actions={(
          <>
            <LinkButton to={clientMessagesPath(client.id)} variant="primary" leftIcon="chat-circle">Mesaj Gönder</LinkButton>
            <LinkButton to="/appointments" variant="secondary" leftIcon="calendar-plus">Randevu</LinkButton>
            <LinkButton to={planNavigation.to} state={planNavigation.state} variant="secondary" leftIcon="pencil-simple">Planı Düzenle</LinkButton>
            <IconButton icon="x" label="Danışan bağlantısını kaldır" onClick={() => requestRemoveClient(client.relationId, 'remove')} disabled={isRemoving} />
          </>
        )}
      />

      <Tabs<ProfileTab>
        idBase="client-profile"
        ariaLabel="Danışan bölümleri"
        value={activeTab}
        onChange={setActiveTab}
        className="mb-5"
        items={[
          { value: 'overview', label: 'Genel bakış' },
          { value: 'measurements', label: 'Ölçümler', count: measurementStatus === 'ready' ? measurements.length : undefined },
        ]}
        trailing={(
          <div className="hidden items-center gap-1 sm:flex">
            <LinkButton to={`/clients/${client.id}/meal-tracking`} variant="ghost" size="sm" leftIcon="fork-knife">Öğün Takibi</LinkButton>
            <LinkButton to="/analytics" variant="ghost" size="sm" leftIcon="chart-line-up">Analizler</LinkButton>
          </div>
        )}
      />

      <TabPanel idBase="client-profile" value="overview" activeValue={activeTab}>
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <ClientGoalCard client={client} measurements={measurements} measurementsReady={measurementStatus === 'ready'} todayKey={todayKey} />
            <p className="sr-only">
              Program uyumu: {formatPercentageDisplay(client.compliance)}. Son 7 gündeki planlanan öğünlerin tamamlanma oranı.
              {client.compliance === null ? ' Son 7 gün içinde planlanmış öğün bulunmuyor.' : ''}
            </p>
            <ClientTodayMealsCard clientId={client.id} todayKey={todayKey} nowTime={nowTime} refreshToken={refreshToken} planNavigationState={planNavigation.state} />
            <ClientChangeRequestsCard clientId={client.id} refreshToken={refreshToken} />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <ClientHealthCard client={client} />
            <ClientNutritionTargetCard clientId={client.id} />
            <Card as="section" aria-labelledby="client-water-title">
              <CardHeader
                id="client-water-title"
                title="Su tüketimi"
                actions={waterTarget !== null ? <span className="text-12.5 text-ink-3">Hedef: {waterTarget} Lt</span> : undefined}
              />
              {!hasDailyLogs ? (
                <p className="m-0 text-13.5 text-ink-2" role="status">Henüz günlük takip kaydı bulunmuyor.</p>
              ) : !hasWaterData ? (
                <p className="m-0 text-13.5 text-ink-2" role="status">Günlük kayıtlar mevcut ancak su tüketimi bilgisi bulunmuyor.</p>
              ) : (
                <>
                  <p className="m-0 mb-4 flex items-baseline gap-2">
                    <b className="text-24 font-semibold tabular-nums">{waterAvg}</b>
                    <span className="text-13 text-ink-3">Lt ({waterAverageLabel})</span>
                  </p>
                  <div className="flex h-28 items-stretch justify-between gap-2" aria-label="Son 7 günlük su kayıtları">
                    {waterData.map((data, i) => (
                      <div key={i} className="flex flex-1 flex-col items-center" title={data.val === null ? 'Su bilgisi yok' : `${data.val} Lt`}>
                        <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-[6px] bg-sunk">
                          <div
                            className={`w-full rounded-[6px] ${data.val !== null && waterTarget !== null && data.val >= waterTarget ? 'bg-info' : 'bg-info/45'}`}
                            style={{ height: `${data.val === null ? 0 : Math.min((data.val / (waterTarget || 3)) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="mt-1.5 text-11 font-medium text-ink-3">{data.day}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
            <ClientAppointmentsCard clientId={client.id} todayKey={todayKey} refreshToken={refreshToken} />
            <ClientNotesCard clientId={client.id} refreshToken={refreshToken} />
          </div>
        </div>
      </TabPanel>

      <TabPanel idBase="client-profile" value="measurements" activeValue={activeTab}>
        <div className="min-w-0 space-y-5">
            <section className="min-w-0 space-y-6" aria-labelledby="measurement-section-title">
                {(measurementStatus === 'idle' || measurementStatus === 'loading') && (
                  <div className="rounded-card border border-line bg-surface px-[22px] py-5 shadow-card" role="status">
                      <div className="flex items-center gap-3 text-sm text-ink-2">
                          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
                          Ölçüm kayıtları yükleniyor...
                      </div>
                  </div>
                )}

                {measurementStatus === 'error' && (
                  <div className="rounded-card border border-bad-line bg-surface px-[22px] py-5">
                      <p className="text-sm text-bad" role="alert">{measurementUserMessage}</p>
                      <button
                        type="button"
                        onClick={() => void loadMeasurements()}
                        className="mt-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-bad-line px-4 py-2 font-medium text-bad hover:bg-bad-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad focus-visible:ring-offset-2"
                      >
                        Tekrar Dene
                      </button>
                  </div>
                )}

                {measurementStatus === 'ready' && measurements.length === 0 && (
                  <div className="rounded-card border border-line bg-surface px-[22px] py-5 shadow-card" role="status">
                      <p className="text-sm text-ink-2">Henüz ölçüm kaydı yok</p>
                  </div>
                )}

                {measurementStatus === 'ready' && measurements.length > 0 && (
                  <>
                    <div className="min-w-0 rounded-card border border-line bg-surface p-4 shadow-card sm:px-[22px] sm:py-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
                            <h3 className="text-16 font-semibold text-ink">Kilo Değişimi Geçmişi</h3>
                            {lastWeightChange !== null && (
                              <div className={`flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${isWeightLoss ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad'}`}>
                                  {isWeightLoss ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                                  {Math.abs(lastWeightChange).toFixed(1)} kg
                                  <span className="ml-1 font-normal text-ink-3">son değişim</span>
                              </div>
                            )}
                        </div>

                        {weightHistory.length === 0 ? (
                          <p className="py-8 text-sm text-ink-2" role="status">
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
                                      <span className="text-xs text-16 font-semibold text-ink">{data.weight} kg</span>
                                      <div className="flex h-40 w-full min-w-0 items-end overflow-hidden rounded-t-lg bg-sunk">
                                          <div
                                            className="mx-1 w-full rounded-t-md bg-brand/55 transition-colors group-hover:bg-brand"
                                            style={{ height: `${height}%` }}
                                          />
                                      </div>
                                      <span className="max-w-full break-words text-center text-[10px] font-medium text-ink-3">{data.date}</span>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                    </div>

                    <div className="min-w-0 rounded-card border border-line bg-surface p-4 shadow-card sm:px-[22px] sm:py-5">
                        <h3 className="mb-4 text-16 font-semibold text-ink">Kilo Geçmişi</h3>
                        {measurementsWithWeight.length === 0 ? (
                          <p className="text-sm text-ink-2" role="status">Henüz kilo ölçümü yok.</p>
                        ) : (
                          <div className="space-y-3">
                              {measurementsWithWeight.map((measurement) => (
                                <article key={measurement.id} className="min-w-0 rounded-control border border-line bg-sunk p-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <h4 className="font-semibold text-ink">
                                                {new Date(`${measurement.measured_at}T00:00:00`).toLocaleDateString('tr-TR')}
                                            </h4>
                                            <span className="mt-2 inline-flex rounded-lg bg-white px-2 py-1 text-xs text-ink-2">
                                                Kilo: {measurement.weight} kg
                                            </span>
                                            {measurement.notes && (
                                              <p className="mt-3 break-words text-sm text-ink-2 [overflow-wrap:anywhere]">{measurement.notes}</p>
                                            )}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleEditWeight(measurement)}
                                          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control border border-line-strong bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                                        >
                                            Kilo Kaydını Düzenle
                                        </button>
                                    </div>
                                </article>
                              ))}
                          </div>
                        )}
                        {measurementLoadMoreMessage && (
                          <p className="mt-4 break-words text-sm text-bad [overflow-wrap:anywhere]" role="alert">
                            {measurementLoadMoreMessage}
                          </p>
                        )}
                        {measurementHasMore && (
                          <button
                            type="button"
                            onClick={() => void loadMoreMeasurements()}
                            disabled={isLoadingMoreMeasurements}
                            className="mt-4 inline-flex min-h-11 min-w-11 w-full items-center justify-center rounded-control border border-line-strong bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:w-auto"
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
                  <div className="min-w-0 rounded-card border border-line bg-surface p-4 shadow-card sm:px-[22px] sm:py-5">
                    <h3 className="mb-4 text-16 font-semibold text-ink">Vücut Ölçüleri Geçmişi</h3>
                    <div className="space-y-3">
                      {bodyMeasurementHistory.map(({ measurement, values }) => (
                        <article key={`body-${measurement.id}`} className="min-w-0 rounded-control border border-line bg-sunk p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <h4 className="font-semibold text-ink">
                                {new Date(`${measurement.measured_at}T00:00:00`).toLocaleDateString('tr-TR')}
                              </h4>
                              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {values.map((item) => (
                                  <span key={`${measurement.id}-${item.label}`} className="inline-flex min-w-0 items-center justify-between gap-3 rounded-lg bg-white px-2 py-1 text-xs text-ink-2">
                                    <span className="min-w-0 break-words">{item.label}</span>
                                    <span className="shrink-0 font-semibold">{item.value} cm</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                            {values.some((item) => item.legacy) && (
                              <span className="shrink-0 text-xs text-warn">Eski kayıt</span>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                <div className="min-w-0 rounded-card border border-line bg-surface p-4 shadow-card sm:px-[22px] sm:py-5">
                    <div className="mb-6">
                        <h2 id="measurement-section-title" className="text-16 font-semibold text-ink flex items-center gap-2">
                            Kilo Ölçümü
                        </h2>
                        <p className="mt-1 text-sm text-ink-2">
                            Aynı tarihteki kilo kaydı güncellenirken vücut ölçüleri korunur.
                        </p>
                    </div>

                    <form className="min-w-0 space-y-5" onSubmit={handleWeightSubmit} noValidate>
                        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                            <label className="min-w-0 text-sm font-medium text-ink">
                                Tarih
                                <input
                                  type="date"
                                  value={weightForm.measuredAt}
                                  max={todayIsoDate()}
                                  onChange={(event) => handleWeightDateChange(event.target.value)}
                                  aria-invalid={Boolean(weightFormErrors.measuredAt)}
                                  aria-describedby={weightFormErrors.measuredAt ? 'weight-date-error' : undefined}
                                  className="mt-1 min-h-11 w-full min-w-0 rounded-control border border-line-strong px-3 py-2 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                                />
                                {weightFormErrors.measuredAt && (
                                  <span id="weight-date-error" className="mt-1 block text-xs text-bad">
                                    {weightFormErrors.measuredAt}
                                  </span>
                                )}
                            </label>

                            <label className="min-w-0 text-sm font-medium text-ink">
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
                                  className="mt-1 min-h-11 w-full min-w-0 rounded-control border border-line-strong px-3 py-2 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                                />
                                {weightFormErrors.weight && (
                                  <span id="weight-value-error" className="mt-1 block text-xs text-bad">
                                    {weightFormErrors.weight}
                                  </span>
                                )}
                            </label>
                        </div>

                        <label className="block min-w-0 text-sm font-medium text-ink">
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
                              className="mt-1 min-h-28 w-full min-w-0 resize-y rounded-control border border-line-strong px-3 py-2 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                            />
                            <span id="weight-notes-help" className={`mt-1 block text-xs ${weightFormErrors.notes ? 'text-bad' : 'text-ink-3'}`}>
                              {weightFormErrors.notes || `${weightForm.notes.length}/1000 karakter`}
                            </span>
                        </label>

                        {weightFormErrors.form && (
                          <p className="text-sm text-bad" role="alert">{weightFormErrors.form}</p>
                        )}
                        {weightSaveFeedback && (
                          <p
                            className={`text-sm ${weightSaveFeedback.type === 'success' ? 'text-ok' : 'text-bad'}`}
                            role={weightSaveFeedback.type === 'error' ? 'alert' : 'status'}
                          >
                            {weightSaveFeedback.message}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="submit"
                              disabled={isSavingWeight}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control bg-brand px-5 py-2 font-medium text-white transition-colors hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                            >
                              {isSavingWeight
                                ? 'Kaydediliyor...'
                                : 'Kilo Kaydet'}
                            </button>
                        </div>
                    </form>
                </div>

                <div className="min-w-0 rounded-card border border-line bg-surface p-4 shadow-card sm:px-[22px] sm:py-5">
                    <div className="mb-6">
                        <h2 className="text-16 font-semibold text-ink flex items-center gap-2">
                            Vücut Ölçüleri
                        </h2>
                        <p className="mt-1 text-sm text-ink-2">
                            Aynı tarihteki çevre ölçüleri güncellenirken kilo kaydı ve diğer alanlar korunur.
                        </p>
                    </div>

                    <form className="min-w-0 space-y-5" onSubmit={handleBodyMeasurementsSubmit} noValidate>
                        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <label className="min-w-0 text-sm font-medium text-ink">
                                Tarih
                                <input
                                  type="date"
                                  value={bodyMeasurementForm.measuredAt}
                                  max={todayIsoDate()}
                                  onChange={(event) => handleBodyMeasurementDateChange(event.target.value)}
                                  aria-invalid={Boolean(bodyMeasurementFormErrors.measuredAt)}
                                  aria-describedby={bodyMeasurementFormErrors.measuredAt ? 'body-measurement-date-error' : undefined}
                                  className="mt-1 min-h-11 w-full min-w-0 rounded-control border border-line-strong px-3 py-2 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                                />
                                {bodyMeasurementFormErrors.measuredAt && (
                                  <span id="body-measurement-date-error" className="mt-1 block text-xs text-bad">
                                    {bodyMeasurementFormErrors.measuredAt}
                                  </span>
                                )}
                            </label>

                            {bodyMeasurementFieldDefinitions.map((definition) => (
                              <label key={definition.key} className="min-w-0 text-sm font-medium text-ink">
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
                                    className="mt-1 min-h-11 w-full min-w-0 rounded-control border border-line-strong px-3 py-2 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                                  />
                                  {bodyMeasurementFormErrors[definition.key] && (
                                    <span id={`body-measurement-${definition.key}-error`} className="mt-1 block text-xs text-bad">
                                      {bodyMeasurementFormErrors[definition.key]}
                                    </span>
                                  )}
                              </label>
                            ))}
                        </div>

                        <label className="block min-w-0 text-sm font-medium text-ink">
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
                              className="mt-1 min-h-28 w-full min-w-0 resize-y rounded-control border border-line-strong px-3 py-2 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                            />
                            <span id="body-measurement-notes-help" className={`mt-1 block text-xs ${bodyMeasurementFormErrors.notes ? 'text-bad' : 'text-ink-3'}`}>
                              {bodyMeasurementFormErrors.notes || `${bodyMeasurementForm.notes.length}/1000 karakter`}
                            </span>
                        </label>

                        {bodyMeasurementFormErrors.form && (
                          <p className="text-sm text-bad" role="alert">{bodyMeasurementFormErrors.form}</p>
                        )}
                        {bodyMeasurementSaveFeedback && (
                          <p
                            className={`text-sm ${bodyMeasurementSaveFeedback.type === 'success' ? 'text-ok' : 'text-bad'}`}
                            role={bodyMeasurementSaveFeedback.type === 'error' ? 'alert' : 'status'}
                          >
                            {bodyMeasurementSaveFeedback.message}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="submit"
                              disabled={isSavingBodyMeasurements}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control bg-brand px-5 py-2 font-medium text-white transition-colors hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                            >
                              {isSavingBodyMeasurements
                                ? 'Kaydediliyor...'
                                : 'Vücut Ölçülerini Kaydet'}
                            </button>
                        </div>
                    </form>
                </div>
            </section>
        </div>
      </TabPanel>
      {removeDialog}
    </PageContainer>
  );
};

export default ClientDetails;
