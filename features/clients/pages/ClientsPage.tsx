import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Client } from '../../../shared/types';
import { fetchDietitianClientList, addClientByEmail, resolveClientIdByRelationId } from '../services/clientService';
import { exportClientsToXlsx } from '../services/clientExportService';
import { fetchClientListInsights } from '../services/clientListInsightsService';
import NotificationBell from '../../notifications/components/NotificationBell';
import InviteCodePanel from '../components/InviteCodePanel';
import { ClientActionsMenu } from '../components/ClientActionsMenu';
import { resolveClientInviteMode } from '../utils/inviteCode';
import {
  CLIENT_ATTENTION_LABELS,
  formatMeasurementAge,
  formatNextAppointment,
  getClientAttentionReasons,
  paginate,
  type ClientAttentionReason,
  type ClientListInsight,
} from '../utils/clientListContract';
import { getDateKeyInTimeZone } from '../../../shared/utils/dateContract';
import { formatPercentageDisplay } from '../../../shared/utils/percentageDisplay';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageContainer,
  PageHeader,
  Pagination,
  PersonCell,
  ProgressBar,
  SearchInput,
  SegmentedControl,
  TBody,
  THead,
  Table,
  TableCard,
  TableFooter,
  Td,
  Th,
  Tr,
} from '../../../shared/ui';

type ClientListViewState =
  | { status: 'loading' }
  | { status: 'success'; clients: Client[] }
  | { status: 'error'; message: string };

type InsightState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; insights: Map<string, ClientListInsight> }
  | { status: 'error' };

type ClientStatusFilter = 'all' | 'active' | 'attention' | 'pending';

const inviteMode = resolveClientInviteMode(import.meta.env.VITE_CLIENT_INVITE_MODE);

const normalizeClientSearchValue = (value: string | null | undefined) =>
  (value ?? '').trim().toLocaleLowerCase('tr-TR');

const compareClients = (left: Client, right: Client) => {
  const nameComparison = (left.name ?? '').localeCompare(right.name ?? '', 'tr-TR');
  if (nameComparison !== 0) return nameComparison;

  const emailComparison = (left.email ?? '').localeCompare(right.email ?? '', 'tr-TR');
  if (emailComparison !== 0) return emailComparison;

  return left.id.localeCompare(right.id);
};

const ClientCompliance: React.FC<{ client: Client }> = ({ client }) => {
  const value = client.compliance;
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-13 text-ink-3">Veri yok</span>;
  }
  return (
    <span className="flex min-w-[120px] items-center gap-2.5" aria-label={`Son 7 gün uyumu: ${formatPercentageDisplay(value)}`}>
      <ProgressBar value={value} tone={value < 50 ? 'bad' : value < 70 ? 'warn' : 'brand'} label="Son 7 gün uyumu" valueText={formatPercentageDisplay(value)} />
      <span className="w-11 text-right text-13 font-semibold tabular-nums">{formatPercentageDisplay(value)}</span>
    </span>
  );
};

const ClientStatusBadge: React.FC<{ client: Client; reasons: ClientAttentionReason[] }> = ({ client, reasons }) => {
  if (client.status === 'Onay Bekliyor') return <Badge tone="warn" dot>Onay bekliyor</Badge>;
  if (reasons.length > 0) {
    return (
      <span title={reasons.map((reason) => CLIENT_ATTENTION_LABELS[reason]).join(' · ')}>
        <Badge tone="bad" dot>Dikkat</Badge>
        <span className="sr-only">: {reasons.map((reason) => CLIENT_ATTENTION_LABELS[reason]).join(', ')}</span>
      </span>
    );
  }
  return <Badge tone="ok" dot>Aktif</Badge>;
};

const WeightCell: React.FC<{ client: Client }> = ({ client }) => {
  const change = client.weeklyChange;
  return (
    <span className="block">
      <b className="block font-semibold tabular-nums">{client.currentWeight === '-' ? '—' : client.currentWeight}</b>
      {change !== null && (
        <span className={`block text-12 tabular-nums ${change < 0 ? 'text-ok' : change > 0 ? 'text-warn' : 'text-ink-3'}`}>
          {change > 0 ? '+' : change < 0 ? '−' : '±'}{Math.abs(change)} kg / hafta
        </span>
      )}
    </span>
  );
};

const ClientsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const notificationRelationshipId = searchParams.get('notificationRelationshipId');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ClientStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [viewState, setViewState] = useState<ClientListViewState>({ status: 'loading' });
  const [insightState, setInsightState] = useState<InsightState>({ status: 'idle' });
  const requestSequence = useRef(0);
  const requestInFlight = useRef(false);
  const insightSequence = useRef(0);
  const addRequestInFlight = useRef(false);
  const isMounted = useRef(true);
  const inviteEmailInputRef = useRef<HTMLInputElement>(null);
  const handledNotificationRelationshipRef = useRef<string | null>(null);
  const exportInFlight = useRef(false);

  // Add Client Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newClientEmail, setNewClientEmail] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addFeedback, setAddFeedback] = useState<{ type: 'success' | 'info' | 'error', message: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const loadInsights = useCallback(async (clients: Client[]) => {
    const requestId = ++insightSequence.current;
    const activeIds = clients.filter((client) => client.status === 'Aktif').map((client) => client.id);
    setInsightState({ status: 'loading' });
    try {
      const insights = await fetchClientListInsights(activeIds);
      if (isMounted.current && requestId === insightSequence.current) setInsightState({ status: 'ready', insights });
    } catch {
      console.error('Client list insights failed.');
      if (isMounted.current && requestId === insightSequence.current) setInsightState({ status: 'error' });
    }
  }, []);

  const loadClients = useCallback(async (
    options: { showLoading?: boolean; preserveOnError?: boolean } = {}
  ): Promise<boolean> => {
    const { showLoading = true, preserveOnError = false } = options;
    if (requestInFlight.current) return false;

    requestInFlight.current = true;
    const requestId = ++requestSequence.current;
    if (showLoading) setViewState({ status: 'loading' });

    try {
      const result = await fetchDietitianClientList();
      if (!isMounted.current || requestId !== requestSequence.current) return false;

      if (result.status === 'error') {
        if (!preserveOnError) {
          setViewState({ status: 'error', message: result.userMessage });
        }
        return false;
      }

      setViewState({ status: 'success', clients: result.clients });
      void loadInsights(result.clients);
      return true;
    } finally {
      if (requestId === requestSequence.current) {
        requestInFlight.current = false;
      }
    }
  }, [loadInsights]);

  // Load clients from Supabase on mount
  useEffect(() => {
    isMounted.current = true;
    void loadClients();

    return () => {
      isMounted.current = false;
      requestSequence.current += 1;
      insightSequence.current += 1;
      requestInFlight.current = false;
    };
  }, [loadClients]);

  useEffect(() => {
    if (
      !notificationRelationshipId
      || viewState.status !== 'success'
      || handledNotificationRelationshipRef.current === notificationRelationshipId
    ) {
      return undefined;
    }

    handledNotificationRelationshipRef.current = notificationRelationshipId;
    let active = true;
    void resolveClientIdByRelationId(notificationRelationshipId)
      .then((clientId) => {
        if (!active) return;
        if (clientId) {
          navigate(`/clients/${clientId}`, { replace: true });
          return;
        }
        setSearchParams({}, { replace: true });
      })
      .catch(() => {
        if (active) setSearchParams({}, { replace: true });
      });

    return () => {
      active = false;
    };
  }, [navigate, notificationRelationshipId, setSearchParams, viewState.status]);

  const openAddModal = () => {
    setIsAddModalOpen(true);
    setAddFeedback(null);
    setNewClientEmail('');
  };

  const closeAddModal = useCallback(() => {
    if (isAdding || addRequestInFlight.current) return;

    addRequestInFlight.current = false;
    setIsAdding(false);
    setIsAddModalOpen(false);
    setNewClientEmail('');
    setAddFeedback(null);
  }, [isAdding]);

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addRequestInFlight.current) return;

    if (!newClientEmail.trim()) {
      setAddFeedback({ type: 'error', message: 'Lütfen geçerli bir e-posta adresi giriniz.' });
      return;
    }

    addRequestInFlight.current = true;
    setIsAdding(true);
    setAddFeedback(null);

    try {
      const result = await addClientByEmail(newClientEmail.trim());
      if (!isMounted.current) return;

      switch (result.status) {
        case 'requested': {
          setNewClientEmail('');
          const refreshed = await loadClients({ showLoading: false, preserveOnError: true });
          if (!isMounted.current) return;
          setAddFeedback({
            type: 'success',
            message: refreshed
              ? 'Bağlantı isteği gönderildi. Danışan isteği mobil uygulamadan kabul ettiğinde aktif danışanlarınız arasında görünecektir.'
              : 'Bağlantı isteği gönderildi. Liste şu anda yenilenemedi; mevcut arama ve filtrelerinizi koruyarak daha sonra tekrar deneyebilirsiniz.',
          });
          break;
        }
        case 'already_pending':
          setAddFeedback({ type: 'info', message: 'Bu danışana daha önce bağlantı isteği gönderilmiş. Danışanın mobil uygulamadan yanıt vermesi bekleniyor.' });
          break;
        case 'already_active':
          setAddFeedback({ type: 'info', message: 'Bu danışan zaten aktif danışanlarınız arasında.' });
          break;
        case 'limit_reached':
          setAddFeedback({ type: 'error', message: 'Danışan limitinize ulaştınız. Yeni danışan eklemek için planınızı yükseltin veya mevcut bir danışan bağlantısını kaldırın.' });
          break;
        case 'unavailable':
          setAddFeedback({ type: 'error', message: 'Bu e-posta ile bağlantı isteği gönderilemedi. Danışanın DietBridge mobil uygulamasında kayıtlı olduğundan ve bağlantı için uygun olduğundan emin olun.' });
          break;
        case 'error':
          setAddFeedback({ type: 'error', message: 'Bağlantı isteği gönderilemedi. Lütfen e-posta adresini kontrol edip tekrar deneyin.' });
          break;
      }
    } catch {
      if (isMounted.current) {
        setAddFeedback({ type: 'error', message: 'Bağlantı isteği gönderilemedi. Lütfen tekrar deneyin.' });
      }
    } finally {
      addRequestInFlight.current = false;
      if (isMounted.current) setIsAdding(false);
    }
  };

  const todayKey = getDateKeyInTimeZone();
  const insights = insightState.status === 'ready' ? insightState.insights : null;
  const clientSource = viewState.status === 'success' ? viewState.clients : null;
  const normalizedSearchTerm = normalizeClientSearchValue(searchTerm);

  const attentionByClientId = useMemo(() => {
    const map = new Map<string, ClientAttentionReason[]>();
    for (const client of clientSource ?? []) {
      map.set(client.id, getClientAttentionReasons(client, insights?.get(client.id), todayKey));
    }
    return map;
  }, [clientSource, insights, todayKey]);

  const { supportedClients, statusFilteredClients, filteredClients, counts } = useMemo(() => {
    const supported = (clientSource ?? []).filter(
      client => client.status === 'Aktif' || client.status === 'Onay Bekliyor'
    );
    const needsAttention = (client: Client) => (attentionByClientId.get(client.id)?.length ?? 0) > 0;
    const statusFiltered = supported.filter(client => {
      if (statusFilter === 'active') return client.status === 'Aktif';
      if (statusFilter === 'attention') return needsAttention(client);
      if (statusFilter === 'pending') return client.status === 'Onay Bekliyor';
      return true;
    });
    const searched = statusFiltered.filter(client => {
      if (!normalizedSearchTerm) return true;

      return (
        normalizeClientSearchValue(client.name).includes(normalizedSearchTerm) ||
        normalizeClientSearchValue(client.email).includes(normalizedSearchTerm)
      );
    });

    return {
      supportedClients: supported,
      statusFilteredClients: statusFiltered,
      filteredClients: [...searched].sort(compareClients),
      counts: {
        all: supported.length,
        active: supported.filter((client) => client.status === 'Aktif').length,
        attention: supported.filter(needsAttention).length,
        pending: supported.filter((client) => client.status === 'Onay Bekliyor').length,
      },
    };
  }, [attentionByClientId, clientSource, normalizedSearchTerm, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [normalizedSearchTerm, statusFilter]);

  const pageResult = paginate<Client>(filteredClients, page);

  const handleExport = useCallback(async () => {
    if (filteredClients.length === 0 || exportInFlight.current) return;

    exportInFlight.current = true;
    setIsExporting(true);
    setExportError(null);
    try {
      await exportClientsToXlsx(filteredClients);
    } catch {
      console.error('Client list export failed.');
      if (isMounted.current) {
        setExportError('Danışan listesi dışa aktarılamadı. Lütfen tekrar deneyin.');
      }
    } finally {
      exportInFlight.current = false;
      if (isMounted.current) setIsExporting(false);
    }
  }, [filteredClients]);

  const measurementLabel = (client: Client): string => {
    if (client.status !== 'Aktif') return '—';
    if (insightState.status !== 'ready') return insightState.status === 'error' ? '—' : '…';
    return formatMeasurementAge(insights?.get(client.id)?.lastMeasuredAt ?? null, todayKey) ?? 'Ölçüm yok';
  };

  const appointmentLabel = (client: Client): string => {
    if (client.status !== 'Aktif') return '—';
    if (insightState.status !== 'ready') return insightState.status === 'error' ? '—' : '…';
    return formatNextAppointment(insights?.get(client.id)?.nextAppointment ?? null, todayKey) ?? '—';
  };

  const filterEmptyTitle: Record<Exclude<ClientStatusFilter, 'all'>, string> = {
    active: 'Aktif danışan bulunmuyor.',
    attention: 'Dikkat gerektiren danışan yok.',
    pending: 'Bekleyen danışan bulunmuyor.',
  };

  return (
    <PageContainer>
      <PageHeader
        title="Danışanlar"
        description={viewState.status === 'success'
          ? `${counts.active} aktif · ${counts.pending} onay bekleyen`
          : 'Danışan ilerlemesini yönetin.'}
        actions={(
          <>
            <Button
              variant="secondary"
              leftIcon="download-simple"
              onClick={() => void handleExport()}
              disabled={filteredClients.length === 0 || isExporting}
              loading={isExporting}
            >
              {isExporting ? 'Dışa aktarılıyor...' : 'Dışa Aktar'}
            </Button>
            <Button variant="primary" leftIcon="user-plus" onClick={openAddModal}>Danışan Davet Et</Button>
            <NotificationBell className="hidden md:inline-grid" />
          </>
        )}
      />

      {exportError && <Callout tone="bad" role="alert" className="mb-4">{exportError}</Callout>}

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SegmentedControl<ClientStatusFilter>
          ariaLabel="Danışan durum filtresi"
          value={statusFilter}
          onChange={setStatusFilter}
          className="max-w-full self-start overflow-x-auto"
          options={[
            { value: 'all', label: 'Tümü', count: viewState.status === 'success' ? counts.all : undefined },
            { value: 'active', label: 'Aktif', count: viewState.status === 'success' ? counts.active : undefined },
            { value: 'attention', label: 'Dikkat', count: viewState.status === 'success' && insightState.status !== 'loading' ? counts.attention : undefined },
            { value: 'pending', label: 'Bekleyen', count: viewState.status === 'success' ? counts.pending : undefined },
          ]}
        />
        <SearchInput
          label="Danışan adı veya e-postasıyla ara"
          placeholder="İsim veya e-postaya göre ara..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          containerClassName="md:ml-auto md:w-[280px]"
        />
      </div>

      {insightState.status === 'error' && viewState.status === 'success' && (
        <Callout tone="warn" className="mb-4">
          Son ölçüm ve randevu bilgileri yüklenemedi; Dikkat filtresi yalnızca öğün uyumuna göre çalışıyor.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void loadInsights(viewState.clients)}>Tekrar dene</button>
        </Callout>
      )}

      {viewState.status === 'loading' ? (
        <Card><LoadingState label="Danışanlar yükleniyor..." variant="skeleton" rows={5} /></Card>
      ) : viewState.status === 'error' ? (
        <Card>
          <ErrorState title="Danışanlar yüklenemedi" description={viewState.message} onRetry={() => void loadClients()} retryLabel="Tekrar Dene" />
        </Card>
      ) : supportedClients.length === 0 ? (
        <Card>
          <EmptyState
            icon="users"
            title="Henüz danışanınız bulunmuyor."
            description={inviteMode === 'invite_code' ? 'Davet kodunuzu paylaştığınızda bağlanan danışanlar burada görünecek.' : 'İlk bağlantı isteğinizi gönderdiğinizde burada görünecek.'}
            action={<Button variant="primary" leftIcon="user-plus" onClick={openAddModal}>İlk danışanınızı davet edin</Button>}
          />
        </Card>
      ) : statusFilteredClients.length === 0 ? (
        <Card>
          <EmptyState
            icon="users"
            title={statusFilter === 'all' ? 'Danışan bulunmuyor.' : filterEmptyTitle[statusFilter]}
            action={<Button variant="ghost" onClick={() => setStatusFilter('all')}>Tümünü Göster</Button>}
          />
        </Card>
      ) : filteredClients.length === 0 ? (
        <Card>
          <EmptyState
            icon="magnifying-glass"
            title="Uygun danışan bulunamadı"
            description="Aramanızla eşleşen danışan bulunamadı."
            action={normalizedSearchTerm ? <Button variant="ghost" onClick={() => setSearchTerm('')}>Aramayı Temizle</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          {/* Desktop Table */}
          <TableCard className="hidden md:block">
            <Table caption="Danışan listesi">
              <THead>
                <Tr>
                  <Th>Danışan</Th>
                  <Th>Durum</Th>
                  <Th>Son ölçüm</Th>
                  <Th>Güncel kilo</Th>
                  <Th>Hedef</Th>
                  <Th>Uyum (7 Gün)</Th>
                  <Th>Sıradaki görüşme</Th>
                  <Th align="right"><span className="sr-only">İşlemler</span></Th>
                </Tr>
              </THead>
              <TBody>
                {pageResult.items.map((client) => (
                  <Fragment key={client.id}>
                    <Tr className="cursor-pointer" onClick={() => navigate(`/clients/${client.id}`)}>
                      <Td>
                        <Link
                          to={`/clients/${client.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="block rounded-tag focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        >
                          <PersonCell name={client.name} subtitle={client.email} avatarSrc={client.profilePhotoUrl} />
                        </Link>
                      </Td>
                      <Td><ClientStatusBadge client={client} reasons={attentionByClientId.get(client.id) ?? []} /></Td>
                      <Td className="text-ink-2">{measurementLabel(client)}</Td>
                      <Td><WeightCell client={client} /></Td>
                      <Td numeric>{client.targetWeight ?? '—'}</Td>
                      <Td><ClientCompliance client={client} /></Td>
                      <Td className="text-ink-2">{appointmentLabel(client)}</Td>
                      <Td align="right" onClick={(event) => event.stopPropagation()}>
                        <ClientActionsMenu client={client} />
                      </Td>
                    </Tr>
                  </Fragment>
                ))}
              </TBody>
            </Table>
            <TableFooter summary={`${filteredClients.length} danışandan ${pageResult.start}–${pageResult.end} gösteriliyor`}>
              <Pagination page={pageResult.page} pageCount={pageResult.pageCount} onPageChange={setPage} />
            </TableFooter>
          </TableCard>

          {/* Mobile Card View */}
          <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
            {pageResult.items.map((client) => (
              <Fragment key={client.id}>
                <li>
                  <Card padding="sm">
                    <div className="flex items-start gap-3">
                      <Link to={`/clients/${client.id}`} className="min-w-0 flex-1 rounded-tag focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                        <PersonCell name={client.name} subtitle={client.email} avatarSrc={client.profilePhotoUrl} />
                      </Link>
                      <ClientStatusBadge client={client} reasons={attentionByClientId.get(client.id) ?? []} />
                      <ClientActionsMenu client={client} />
                    </div>
                    <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-13">
                      <div><dt className="text-12 text-ink-3">Güncel kilo</dt><dd className="m-0"><WeightCell client={client} /></dd></div>
                      <div><dt className="text-12 text-ink-3">Hedef</dt><dd className="m-0 font-semibold tabular-nums">{client.targetWeight ?? '—'}</dd></div>
                      <div><dt className="text-12 text-ink-3">Son ölçüm</dt><dd className="m-0">{measurementLabel(client)}</dd></div>
                      <div><dt className="text-12 text-ink-3">Sıradaki görüşme</dt><dd className="m-0">{appointmentLabel(client)}</dd></div>
                      <div className="col-span-2"><dt className="text-12 text-ink-3" title="Son 7 gündeki planlanan öğünlerin tamamlanma oranı">Uyum (7 gün)</dt><dd className="m-0 mt-1"><ClientCompliance client={client} /></dd></div>
                    </dl>
                  </Card>
                </li>
              </Fragment>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-13 text-ink-2 md:hidden">
            <span>{filteredClients.length} danışandan {pageResult.start}–{pageResult.end}</span>
            <Pagination page={pageResult.page} pageCount={pageResult.pageCount} onPageChange={setPage} maxButtons={3} />
          </div>
        </>
      )}

      {/* Add Client Modal */}
      <Modal
        open={isAddModalOpen}
        onClose={closeAddModal}
        dismissible={!isAdding}
        title={inviteMode === 'invite_code' ? 'Danışan davet et' : 'Danışana bağlantı isteği gönder'}
        initialFocusRef={inviteMode === 'invite_code' ? undefined : inviteEmailInputRef}
        footer={inviteMode === 'invite_code' ? (
          <Button variant="secondary" onClick={closeAddModal} disabled={isAdding}>Kapat</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={closeAddModal} disabled={isAdding}>İptal</Button>
            <Button
              variant="primary"
              type="submit"
              form="client-invitation-form"
              leftIcon="paper-plane-tilt"
              loading={isAdding}
              disabled={isAdding || !newClientEmail.trim()}
            >
              {isAdding ? 'Gönderiliyor...' : 'Bağlantı İsteği Gönder'}
            </Button>
          </>
        )}
      >
        {inviteMode === 'invite_code' ? <InviteCodePanel onBusyChange={setIsAdding} /> : (
          <form id="client-invitation-form" onSubmit={handleAddClient} className="flex flex-col gap-4" noValidate>
            <Input
              ref={inviteEmailInputRef}
              id="client-invitation-email"
              type="email"
              required
              label="Danışanın kayıtlı e-posta adresi"
              hint="Yalnız DietBridge mobil uygulamasında kayıtlı danışanlara bağlantı isteği gönderebilirsiniz. Danışan isteği mobil uygulamadan kabul ettiğinde bağlantı aktif olur."
              leadingIcon="envelope"
              placeholder="ornek@email.com"
              value={newClientEmail}
              onChange={(event) => setNewClientEmail(event.target.value)}
              disabled={isAdding}
            />
            {addFeedback && (
              <Callout
                tone={addFeedback.type === 'success' ? 'ok' : addFeedback.type === 'info' ? 'info' : 'bad'}
                role={addFeedback.type === 'error' ? 'alert' : 'status'}
              >
                {addFeedback.message}
              </Callout>
            )}
          </form>
        )}
      </Modal>
    </PageContainer>
  );
};

export default ClientsPage;
