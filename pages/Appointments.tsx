import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppointmentFormModal } from '../features/appointments/components/AppointmentFormModal';
import { AppointmentMonthGrid } from '../features/appointments/components/AppointmentMonthGrid';
import { AppointmentRowActions } from '../features/appointments/components/AppointmentRowActions';
import {
  APPOINTMENT_STATUS_META,
  APPOINTMENT_TYPE_META,
  formatDurationLabel,
} from '../features/appointments/components/appointmentPresentation';
import { useAppointments } from '../features/appointments/context/AppointmentContext';
import {
  addCalendarMonths,
  appointmentRangeCovers,
  createAppointmentDraft,
  formatDateKey,
  formatMonthKey,
  getMonthCalendarDays,
  getMonthCalendarRange,
  getMonthKey,
  getMonthKeyFromDateKey,
  getTodayDateKey,
  sortAppointmentsChronologically,
  type AppointmentDraft,
} from '../features/appointments/utils/appointmentContract';
import { fetchActiveDietitianClientList } from '../features/clients/services/clientService';
import type { Appointment, Client } from '../shared/types';
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PageContainer,
  PageHeader,
  SegmentedControl,
  TableCard,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  cx,
} from '../shared/ui';

type ClientState =
  | { status: 'loading'; clients: Client[] }
  | { status: 'success'; clients: Client[] }
  | { status: 'error'; clients: Client[]; message: string };

type PendingConfirmation =
  | { kind: 'complete' | 'cancel' | 'delete'; appointment: Appointment };

const isDateKey = (value: string | null): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const Appointments = () => {
  const {
    appointments,
    appointmentsAfterRange,
    loadedRange,
    requestAppointmentRange,
    loading: appointmentsRequestLoading,
    error,
    mutationError,
    pendingAction,
    refreshAppointments,
    addAppointment,
    updateAppointment,
    deleteAppointment,
    changeAppointmentStatus,
    checkAppointmentBooking,
    clearMutationError,
  } = useAppointments();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getTodayDateKey();
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const requested = searchParams.get('date');
    return isDateKey(requested) ? requested : today;
  });
  const [visibleMonth, setVisibleMonth] = useState<string>(() => getMonthKeyFromDateKey(selectedDate) ?? getMonthKey());
  const visibleRange = useMemo(() => getMonthCalendarRange(visibleMonth), [visibleMonth]);
  const loading = appointmentsRequestLoading || (
    !error && visibleRange !== null && !appointmentRangeCovers(loadedRange, visibleRange)
  );

  // ---- clients ---------------------------------------------------------------
  const [clientState, setClientState] = useState<ClientState>({ status: 'loading', clients: [] });
  const loadClients = useCallback(async () => {
    setClientState((current) => ({ status: 'loading', clients: current.clients }));
    const result = await fetchActiveDietitianClientList();
    if (result.status === 'error') {
      setClientState({ status: 'error', clients: [], message: result.userMessage });
      return;
    }
    setClientState({ status: 'success', clients: result.clients });
  }, []);
  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (visibleRange) requestAppointmentRange(visibleRange);
  }, [requestAppointmentRange, visibleRange]);

  // ---- form ----------------------------------------------------------------
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [formData, setFormData] = useState<AppointmentDraft>(() => createAppointmentDraft());
  const [bookingCheckError, setBookingCheckError] = useState<string | null>(null);
  const [slotConflict, setSlotConflict] = useState(false);
  const [sameWeekCount, setSameWeekCount] = useState<number | null>(null);
  const [isCheckingBooking, setIsCheckingBooking] = useState(false);
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  const submissionRef = useRef(false);

  const resetFormFeedback = () => {
    clearMutationError();
    setBookingCheckError(null);
    setSlotConflict(false);
    setSameWeekCount(null);
  };

  const openCreateModal = useCallback((date?: string) => {
    const nextDate = date ?? selectedDate;
    clearMutationError();
    setBookingCheckError(null);
    setSlotConflict(false);
    setSameWeekCount(null);
    setEditingAppointment(null);
    setFormData(createAppointmentDraft(nextDate < today ? today : nextDate));
    setIsModalOpen(true);
  }, [clearMutationError, selectedDate, today]);

  // "Yeni randevu" from Panelim opens the form once.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    openCreateModal();
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [openCreateModal, searchParams, setSearchParams]);

  const openEditModal = (appointment: Appointment) => {
    resetFormFeedback();
    setEditingAppointment(appointment);
    setFormData({
      clientId: appointment.clientId,
      title: appointment.title,
      date: appointment.date,
      time: appointment.time,
      duration: appointment.duration,
      type: appointment.type,
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isCheckingBooking || isSubmittingForm || pendingAction !== null) return;
    setIsModalOpen(false);
    setEditingAppointment(null);
    setSameWeekCount(null);
  };

  const updateDraft = (draft: AppointmentDraft) => {
    // A changed client or date needs a fresh same-week check.
    if (draft.clientId !== formData.clientId || draft.date !== formData.date) setSameWeekCount(null);
    setSlotConflict(false);
    setFormData(draft);
  };

  const persistForm = async (draft: AppointmentDraft, appointmentId?: string) => {
    setIsSubmittingForm(true);
    try {
      const result = appointmentId
        ? await updateAppointment(appointmentId, draft)
        : await addAppointment(draft);
      if (!result.success) return;
      setSelectedDate(draft.date);
      setVisibleMonth(getMonthKeyFromDateKey(draft.date) ?? visibleMonth);
      setIsModalOpen(false);
      setEditingAppointment(null);
      setSameWeekCount(null);
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pendingAction !== null || submissionRef.current) return;
    submissionRef.current = true;
    const draft = { ...formData };
    const appointmentId = editingAppointment?.id;
    try {
      if (sameWeekCount !== null && sameWeekCount > 0) {
        await persistForm(draft, appointmentId);
        return;
      }
      setIsCheckingBooking(true);
      setBookingCheckError(null);
      setSlotConflict(false);
      clearMutationError();
      const check = await checkAppointmentBooking(draft, appointmentId);
      setIsCheckingBooking(false);
      if (!check.success) {
        setBookingCheckError(check.message);
        return;
      }
      if (check.value.slotConflict) {
        setSlotConflict(true);
        return;
      }
      if (check.value.sameWeekCount > 0) {
        setSameWeekCount(check.value.sameWeekCount);
        return;
      }
      await persistForm(draft, appointmentId);
    } finally {
      setIsCheckingBooking(false);
      submissionRef.current = false;
    }
  };

  // ---- status / delete -------------------------------------------------------
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const confirmAction = async () => {
    if (!confirmation) return;
    const { kind, appointment } = confirmation;
    const result = kind === 'delete'
      ? await deleteAppointment(appointment.id)
      : await changeAppointmentStatus(appointment.id, kind === 'complete' ? 'completed' : 'cancelled');
    if (result.success) setConfirmation(null);
  };
  const confirmationBusy = confirmation !== null && (
    pendingAction === `delete:${confirmation.appointment.id}` || pendingAction === `status:${confirmation.appointment.id}`
  );

  // ---- derived views ---------------------------------------------------------
  const calendarDays = useMemo(() => getMonthCalendarDays(visibleMonth), [visibleMonth]);
  const appointmentsByDate = useMemo(() => {
    const grouped = new Map<string, Appointment[]>();
    for (const appointment of appointments) {
      const list = grouped.get(appointment.date) ?? [];
      list.push(appointment);
      grouped.set(appointment.date, list);
    }
    for (const [date, list] of grouped) grouped.set(date, sortAppointmentsChronologically<Appointment>(list));
    return grouped;
  }, [appointments]);
  const selectedDayAppointments = appointmentsByDate.get(selectedDate) ?? [];
  const monthAppointments = useMemo(() => sortAppointmentsChronologically<Appointment>(
    appointments.filter((appointment) => appointment.date.startsWith(visibleMonth)),
  ), [appointments, visibleMonth]);
  const laterAppointments = useMemo(() => sortAppointmentsChronologically<Appointment>(
    appointmentsAfterRange.filter((appointment) => appointment.status === 'upcoming'),
  ), [appointmentsAfterRange]);

  const changeMonth = (months: number) => {
    const nextMonth = addCalendarMonths(visibleMonth, months);
    if (!nextMonth) return;
    setVisibleMonth(nextMonth);
    setSelectedDate(nextMonth === getMonthKey() ? today : `${nextMonth}-01`);
  };
  const goToday = () => {
    setVisibleMonth(getMonthKey());
    setSelectedDate(today);
  };
  const actionsDisabled = pendingAction !== null;

  const rowActions = (appointment: Appointment) => (
    <AppointmentRowActions
      appointment={appointment}
      disabled={actionsDisabled}
      onEdit={openEditModal}
      onComplete={(item) => setConfirmation({ kind: 'complete', appointment: item })}
      onCancel={(item) => setConfirmation({ kind: 'cancel', appointment: item })}
      onDelete={(item) => setConfirmation({ kind: 'delete', appointment: item })}
    />
  );

  const monthToolbar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
      <h2 className="m-0 flex-1 text-[18px] font-semibold capitalize">{formatMonthKey(visibleMonth)}</h2>
      <div className="hidden gap-4 text-12.5 text-ink-2 lg:flex" aria-hidden="true">
        {(['Yüzyüze', 'Görüntülü Görüşme', 'Telefon Görüşmesi'] as const).map((type) => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <i className={cx('h-2 w-2 rounded-full', APPOINTMENT_TYPE_META[type].dot)} />
            {APPOINTMENT_TYPE_META[type].label}
          </span>
        ))}
      </div>
      <Button size="sm" onClick={goToday}>Bugün</Button>
      <IconButton icon="caret-left" label="Önceki ay" size="sm" onClick={() => changeMonth(-1)} />
      <IconButton icon="caret-right" label="Sonraki ay" size="sm" onClick={() => changeMonth(1)} />
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Randevular"
        actions={(
          <>
            <SegmentedControl
              ariaLabel="Randevu görünümü"
              value={viewMode}
              onChange={setViewMode}
              options={[{ value: 'list', label: 'Liste' }, { value: 'calendar', label: 'Takvim' }]}
            />
            <Button
              variant="primary"
              leftIcon="plus"
              onClick={() => openCreateModal()}
              disabled={clientState.status !== 'success'}
            >
              Yeni randevu
            </Button>
          </>
        )}
      />

      {(mutationError && !isModalOpen && !confirmation) && <Callout tone="bad" role="alert" className="mb-4">{mutationError}</Callout>}
      {clientState.status === 'error' && (
        <Callout tone="bad" role="alert" className="mb-4">
          <span className="flex flex-wrap items-center gap-2">
            {clientState.message}
            <button type="button" className="font-semibold underline" onClick={() => void loadClients()}>Danışanları tekrar dene</button>
          </span>
        </Callout>
      )}

      {viewMode === 'calendar' ? (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <TableCard aria-label="Aylık takvim">
            {monthToolbar}
            {loading ? (
              <LoadingState label="Randevular yükleniyor…" className="min-h-[24rem]" />
            ) : error ? (
              <ErrorState description="Randevular gösterilemiyor." onRetry={() => void refreshAppointments()} className="min-h-[24rem]" />
            ) : (
              <AppointmentMonthGrid
                days={calendarDays}
                appointmentsByDate={appointmentsByDate}
                today={today}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
            )}
          </TableCard>

          <Card as="section" aria-labelledby="appointment-day-title">
            <h2 id="appointment-day-title" className="m-0 text-16 font-semibold capitalize">
              {formatDateKey(selectedDate, { day: 'numeric', month: 'long', weekday: 'long' })}
            </h2>
            <p className="m-0 mb-3.5 text-13 text-ink-3">
              {loading ? 'Yükleniyor…' : `${selectedDayAppointments.length} randevu`}
            </p>
            {!loading && !error && selectedDayAppointments.length === 0 && (
              <EmptyState compact icon="calendar-blank" title="Bu tarihte randevu yok." />
            )}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {!loading && !error && selectedDayAppointments.map((appointment) => {
                const status = APPOINTMENT_STATUS_META[appointment.status];
                const inactive = appointment.status !== 'upcoming';
                return (
                  <Fragment key={appointment.id}>
                    <li className={cx('rounded-[11px] border border-line px-3.5 pb-1.5 pt-3', inactive && 'bg-surface-alt')}>
                      <div className="flex items-start gap-3">
                        <span className={cx('w-[46px] shrink-0 font-bold tabular-nums', inactive && 'text-ink-3')}>{appointment.time}</span>
                        <div className="min-w-0 flex-1">
                          <b className={cx('block truncate font-semibold', inactive && 'text-ink-3')}>{appointment.clientName}</b>
                          <span className="block text-12 text-ink-2">
                            {appointment.title} · {APPOINTMENT_TYPE_META[appointment.type].short} · {formatDurationLabel(appointment.duration)}
                          </span>
                        </div>
                        {inactive && <Badge tone={status.tone} size="sm">{status.label}</Badge>}
                      </div>
                      <div className="ml-[58px] mt-1 flex justify-end">{rowActions(appointment)}</div>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
            <Button
              fullWidth
              leftIcon="plus"
              className="mt-3.5 border-dashed"
              onClick={() => openCreateModal(selectedDate)}
              disabled={clientState.status !== 'success'}
            >
              Bu güne randevu ekle
            </Button>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <TableCard aria-label="Aylık randevu listesi">
            {monthToolbar}
            {loading ? (
              <LoadingState label="Randevular yükleniyor…" variant="skeleton" rows={5} />
            ) : error ? (
              <ErrorState description="Randevular gösterilemiyor." onRetry={() => void refreshAppointments()} />
            ) : monthAppointments.length === 0 ? (
              <EmptyState icon="calendar-blank" title="Bu ay randevu yok." />
            ) : (
              <Table caption={`${formatMonthKey(visibleMonth)} randevuları`} density="compact">
                <THead>
                  <tr>
                    <Th>Tarih</Th>
                    <Th>Saat</Th>
                    <Th>Danışan</Th>
                    <Th>Görüşme</Th>
                    <Th>Durum</Th>
                    <Th align="right"><span className="sr-only">İşlemler</span></Th>
                  </tr>
                </THead>
                <TBody>
                  {monthAppointments.map((appointment) => (
                    <Fragment key={appointment.id}>
                      <Tr>
                        <Td>{formatDateKey(appointment.date, { day: 'numeric', month: 'short', weekday: 'short' })}</Td>
                        <Td numeric className="font-semibold">{appointment.time}</Td>
                        <Td>
                          <b className="font-semibold">{appointment.clientName}</b>
                          <span className="block text-12 text-ink-3">{appointment.title}</span>
                        </Td>
                        <Td>{APPOINTMENT_TYPE_META[appointment.type].label} · {formatDurationLabel(appointment.duration)}</Td>
                        <Td>
                          <Badge tone={APPOINTMENT_STATUS_META[appointment.status].tone} size="sm">
                            {APPOINTMENT_STATUS_META[appointment.status].label}
                          </Badge>
                        </Td>
                        <Td align="right">{rowActions(appointment)}</Td>
                      </Tr>
                    </Fragment>
                  ))}
                </TBody>
              </Table>
            )}
          </TableCard>
          {laterAppointments.length > 0 && (
            <Card as="section" aria-labelledby="later-appointments-title">
              <h2 id="later-appointments-title" className="m-0 mb-3 text-16 font-semibold">Sonraki aylarda</h2>
              <ul className="m-0 list-none p-0">
                {laterAppointments.map((appointment) => (
                  <Fragment key={appointment.id}>
                    <li className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                      <span className="w-28 text-13 text-ink-2">{formatDateKey(appointment.date, { day: 'numeric', month: 'short' })} · {appointment.time}</span>
                      <b className="min-w-0 flex-1 truncate font-semibold">{appointment.clientName}</b>
                      <span className="text-12 text-ink-3">{appointment.title}</span>
                    </li>
                  </Fragment>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <AppointmentFormModal
        open={isModalOpen}
        isEditing={editingAppointment !== null}
        draft={formData}
        onDraftChange={updateDraft}
        clients={clientState.clients}
        clientsStatus={clientState.status}
        mutationError={mutationError}
        bookingCheckError={bookingCheckError}
        slotConflict={slotConflict}
        sameWeekCount={sameWeekCount}
        checking={isCheckingBooking}
        saving={isSubmittingForm || pendingAction === 'create' || Boolean(pendingAction?.startsWith('update:'))}
        onSubmit={(event) => void handleSubmit(event)}
        onClose={closeModal}
      />

      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation?.kind === 'delete'
          ? 'Randevu silinsin mi?'
          : confirmation?.kind === 'cancel' ? 'Randevu iptal edilsin mi?' : 'Randevu tamamlandı olarak işaretlensin mi?'}
        description={confirmation
          ? `${formatDateKey(confirmation.appointment.date, { day: 'numeric', month: 'long' })} ${confirmation.appointment.time} · ${confirmation.appointment.clientName}`
          : undefined}
        confirmLabel={confirmation?.kind === 'delete' ? 'Sil' : confirmation?.kind === 'cancel' ? 'İptal et' : 'Tamamlandı'}
        cancelLabel="Vazgeç"
        tone={confirmation?.kind === 'complete' ? 'default' : 'danger'}
        busy={confirmationBusy}
        onConfirm={() => void confirmAction()}
        onCancel={() => setConfirmation(null)}
      >
        {confirmation?.kind === 'cancel' && (
          <p className="m-0 text-13.5 text-ink-2">Danışana randevunun iptal edildiği bildirilir.</p>
        )}
        {confirmation && mutationError && <Callout tone="bad" role="alert">{mutationError}</Callout>}
      </ConfirmDialog>
    </PageContainer>
  );
};

export default Appointments;
