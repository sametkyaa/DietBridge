import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAppointments } from '../../appointments/context/AppointmentContext';
import {
  appointmentRangeCovers,
  getAppointmentRangeForDate,
  getMondayFirstWeekRange,
  getTimeZoneDateTimeKey,
  getTodayDateKey,
  sortAppointmentsChronologically,
} from '../../appointments/utils/appointmentContract';
import { useAuth } from '../../auth/context/AuthContext';
import { fetchChatConversations } from '../../chat/services/chatService';
import { useUnreadCounts } from '../../chat/context/UnreadCountsContext';
import { fetchDietitianClients } from '../../clients/services/clientService';
import { MealChangeRequestReviewDialog } from '../../meal-change-requests/components/MealChangeRequestReviewDialog';
import { fetchPendingMealChangeRequests } from '../../meal-change-requests/services/mealChangeRequestService';
import type { MealChangeRequest } from '../../meal-change-requests/types/mealChangeRequest';
import NotificationBell from '../../notifications/components/NotificationBell';
import type { Appointment, Client } from '../../../shared/types';
import {
  Callout,
  ConfirmDialog,
  KpiGrid,
  KpiTile,
  LinkButton,
  PageContainer,
  PageHeader,
} from '../../../shared/ui';
import { formatPercentageDisplay } from '../../../shared/utils/percentageDisplay';
import { DailyTaskDetailModal } from '../components/DailyTaskDetailModal';
import { DailyTaskFormModal } from '../components/DailyTaskFormModal';
import { DashboardClientSearch } from '../components/DashboardClientSearch';
import DashboardAccountMenu from '../components/DashboardAccountMenu';
import { DashboardTaskPanel, type TaskTab } from '../components/DashboardTaskPanel';
import { NextAppointmentBanner } from '../components/NextAppointmentBanner';
import { RecentMessagesCard, type RecentMessagesState } from '../components/RecentMessagesCard';
import { TodayScheduleCard } from '../components/TodayScheduleCard';
import { useAutomaticTasks } from '../hooks/useAutomaticTasks';
import { AUTOMATIC_TASK_SUFFIX, type AutomaticTask } from '../utils/automaticTaskContract';
import { useDailyTasks } from '../hooks/useDailyTasks';
import type { DailyTask, DailyTaskDraft } from '../types/dailyTask';
import { getIstanbulDateKey, getPendingDailyTaskGroup } from '../utils/dailyTaskContract';
import { getDashboardFocusMessage, summarizeDashboard } from '../utils/dashboardContract';

const emptyTaskDraft = (): DailyTaskDraft => ({
  clientId: null,
  title: '',
  description: null,
  dueDate: getIstanbulDateKey(),
  dueTime: null,
  priority: 'medium',
});

/** Istanbul has used a fixed UTC+03:00 offset since 2016. */
const appointmentStartMs = (appointment: Pick<Appointment, 'date' | 'time'>) => (
  Date.parse(`${appointment.date}T${appointment.time}:00+03:00`)
);

const greetingFor = (hour: number): string => {
  if (hour < 5) return 'İyi geceler';
  if (hour < 12) return 'Günaydın';
  if (hour < 18) return 'İyi günler';
  return 'İyi akşamlar';
};

const formatLongDate = (now: Date) => {
  const weekday = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' }).format(now);
  const date = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' }).format(now);
  return `${weekday}, ${date}`;
};

const DashboardPage = () => {
  const { dietitianProfile, user } = useAuth();
  const userId = user?.id ?? null;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // ---- clients (real list; also feeds search + task form) -----------------
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [clientLoadError, setClientLoadError] = useState(false);
  const loadClients = useCallback(async () => {
    setLoadingClients(true);
    setClientLoadError(false);
    try {
      setClients(await fetchDietitianClients());
    } catch (error) {
      console.error('Dashboard client load failed:', error instanceof Error ? error.message : 'unknown');
      setClients([]);
      setClientLoadError(true);
    } finally {
      setLoadingClients(false);
    }
  }, []);
  useEffect(() => {
    void loadClients();
  }, [loadClients]);
  const activeClients = useMemo(() => clients.filter((client) => client.status === 'Aktif'), [clients]);
  const pendingClientCount = clients.length - activeClients.length;
  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);

  // ---- tasks ---------------------------------------------------------------
  const {
    viewState: taskViewState,
    tasks: dailyTasks,
    groups: taskGroups,
    mutationError: taskMutationError,
    pendingAction: pendingTaskAction,
    refreshDailyTasks,
    createTask,
    updateTask,
    completeTask,
    reopenTask,
    deleteTask,
    clearMutationError,
  } = useDailyTasks();
  const { state: automaticState, refresh: refreshAutomatic, deleteTask: deleteAutomaticTask,
    pendingAction: pendingAutomaticAction, mutationError: automaticMutationError,
    clearMutationError: clearAutomaticMutationError } = useAutomaticTasks();
  const [automaticTaskToDelete, setAutomaticTaskToDelete] = useState<AutomaticTask | null>(null);
  const [taskFilter, setTaskFilter] = useState<TaskTab>('today');
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null);
  const [taskDraft, setTaskDraft] = useState<DailyTaskDraft>(emptyTaskDraft);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<DailyTask | null>(null);

  const openCreateTaskModal = () => {
    clearMutationError();
    setEditingTask(null);
    setTaskDraft(emptyTaskDraft());
    setIsAddTaskModalOpen(true);
  };
  const openEditTaskModal = (task: DailyTask) => {
    clearMutationError();
    setSelectedTaskId(null);
    setEditingTask(task);
    setTaskDraft({
      clientId: task.clientId,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      priority: task.priority,
    });
    setIsAddTaskModalOpen(true);
  };
  const closeTaskModal = () => {
    if (pendingTaskAction !== null) return;
    setIsAddTaskModalOpen(false);
    setEditingTask(null);
  };
  const handleTaskSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const result = editingTask
      ? await updateTask(editingTask.id, taskDraft)
      : await createTask(taskDraft);
    if (!result.success) return;
    const nextFilter = editingTask?.status === 'completed'
      ? 'completed'
      : getPendingDailyTaskGroup(taskDraft.dueDate, taskDraft.dueTime);
    setIsAddTaskModalOpen(false);
    setEditingTask(null);
    setTaskFilter(nextFilter);
  };
  const toggleTask = (task: DailyTask) => {
    void (task.status === 'completed' ? reopenTask(task.id) : completeTask(task.id));
  };
  const confirmDeleteTask = async () => {
    if (!taskToDelete) return;
    const result = await deleteTask(taskToDelete.id);
    if (result.success) setTaskToDelete(null);
  };
  const confirmDeleteAutomaticTask = async () => {
    if (automaticTaskToDelete && await deleteAutomaticTask(automaticTaskToDelete)) setAutomaticTaskToDelete(null);
  };
  const selectedTask = selectedTaskId ? dailyTasks.find((task) => task.id === selectedTaskId) ?? null : null;
  useEffect(() => {
    if (selectedTaskId && !dailyTasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(null);
  }, [dailyTasks, selectedTaskId]);

  // ---- pending meal change request review ---------------------------------
  const [reviewRequest, setReviewRequest] = useState<MealChangeRequest | null>(null);
  const [reviewLoadError, setReviewLoadError] = useState<string | null>(null);
  const openReview = async (requestId: string) => {
    setReviewLoadError(null);
    try {
      const pending = await fetchPendingMealChangeRequests({ limit: 100 });
      const request = pending.find((item) => item.id === requestId) ?? null;
      if (!request) {
        setReviewLoadError('Bu talep artık beklemede değil.');
        void refreshAutomatic();
        return;
      }
      setReviewRequest(request);
    } catch {
      setReviewLoadError('Talep yüklenemedi. Lütfen tekrar deneyin.');
    }
  };

  // ---- appointments --------------------------------------------------------
  const {
    appointments,
    appointmentsAfterRange,
    error: appointmentsError,
    getAppointmentsByDate,
    loadedRange,
    loading: appointmentsRequestLoading,
    refreshAppointments,
    requestAppointmentRange,
  } = useAppointments();
  const today = getTodayDateKey(now);
  useEffect(() => {
    const todayRange = getAppointmentRangeForDate(today);
    if (todayRange) requestAppointmentRange(todayRange);
  }, [requestAppointmentRange, today]);
  const appointmentsLoading = appointmentsRequestLoading || (
    !appointmentsError
    && !appointmentRangeCovers(loadedRange, { startDate: today, endDate: today })
  );
  const todaysAppointments = sortAppointmentsChronologically<Appointment>(
    getAppointmentsByDate(today).filter((appointment) => appointment.status !== 'cancelled'),
  );
  const nowTime = getTimeZoneDateTimeKey(now).slice(11);
  const nextAppointment = useMemo(() => {
    const nowMs = now.getTime();
    return sortAppointmentsChronologically<Appointment>([...appointments, ...appointmentsAfterRange]
      .filter((appointment) => appointment.status === 'upcoming' && appointmentStartMs(appointment) >= nowMs))[0] ?? null;
  }, [appointments, appointmentsAfterRange, now]);
  const week = getMondayFirstWeekRange(today);
  const weekAppointments = week
    ? appointments.filter((appointment) => (
      appointment.status !== 'cancelled' && appointment.date >= week.startDate && appointment.date <= week.endDate
    ))
    : [];
  const weekRemaining = weekAppointments.filter((appointment) => (
    appointment.status === 'upcoming' && appointmentStartMs(appointment) >= now.getTime()
  )).length;
  const weekCovered = week !== null && appointmentRangeCovers(loadedRange, week);

  // ---- messages --------------------------------------------------------------
  const { state: unreadState, countForConversation } = useUnreadCounts();
  const [recentMessages, setRecentMessages] = useState<RecentMessagesState>({ status: 'loading' });
  const loadRecentMessages = useCallback(async () => {
    if (!userId) return;
    setRecentMessages({ status: 'loading' });
    try {
      setRecentMessages({ status: 'success', conversations: await fetchChatConversations(userId) });
    } catch {
      setRecentMessages({ status: 'error' });
    }
  }, [userId]);
  useEffect(() => {
    void loadRecentMessages();
  }, [loadRecentMessages]);

  // ---- KPIs (all from real data) -------------------------------------------
  const adherenceValues = activeClients
    .map((client) => client.compliance)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const averageAdherence = adherenceValues.length > 0
    ? adherenceValues.reduce((total, value) => total + value, 0) / adherenceValues.length
    : null;

  const dashboardSummary = summarizeDashboard({
    todayAppointments: todaysAppointments,
    tasks: taskGroups,
    automaticTasks: automaticState.status === 'success' ? automaticState.tasks : [],
  });
  const focusMessage = appointmentsError || taskViewState.status === 'error' || automaticState.status === 'error'
    ? 'Bugünün özeti şu anda tamamlanamadı. Verileri tekrar deneyin.'
    : appointmentsLoading || taskViewState.status !== 'success' || automaticState.status !== 'success'
      ? 'Bugünün özeti yükleniyor…'
      : getDashboardFocusMessage(dashboardSummary);

  const firstName = dietitianProfile?.first_name?.trim();
  const istanbulHour = Number(nowTime.slice(0, 2));

  return (
    <PageContainer>
      <PageHeader
        className="relative"
        eyebrow={<span className="capitalize">{formatLongDate(now)}</span>}
        title={<span className="block pr-14 md:pr-0">{firstName ? `${greetingFor(istanbulHour)}, ${firstName}` : greetingFor(istanbulHour)}</span>}
        titleAddon={<DashboardAccountMenu />}
        description={focusMessage}
        actions={(
          <>
            <DashboardClientSearch clients={clients} />
            <NotificationBell />
            <LinkButton variant="primary" leftIcon="plus" to="/appointments?new=1">Yeni randevu</LinkButton>
          </>
        )}
      />

      {nextAppointment && (
        <NextAppointmentBanner
          appointment={nextAppointment}
          isToday={nextAppointment.date === today}
          minutesUntil={Math.max(0, Math.round((appointmentStartMs(nextAppointment) - now.getTime()) / 60_000))}
        />
      )}

      <KpiGrid className="grid-cols-2">
        <KpiTile
          icon="users-three-duotone"
          label="Aktif danışan"
          loading={loadingClients}
          value={clientLoadError ? '—' : activeClients.length}
          hint={clientLoadError ? 'Danışanlar yüklenemedi' : pendingClientCount > 0 ? `${pendingClientCount} onay bekliyor` : 'Onay bekleyen yok'}
        />
        <KpiTile
          icon="calendar-check-duotone"
          label="Bu hafta randevu"
          loading={!weekCovered && !appointmentsError}
          value={appointmentsError ? '—' : weekAppointments.length}
          hint={appointmentsError ? 'Randevular yüklenemedi' : `Bugün ${todaysAppointments.length} · kalan ${weekRemaining}`}
        />
        <KpiTile
          icon="check-circle-duotone"
          label="Ortalama öğün uyumu"
          loading={loadingClients}
          value={averageAdherence === null ? '—' : formatPercentageDisplay(averageAdherence)}
          hint={averageAdherence === null ? 'Son 7 günde planlı öğün yok' : `Son 7 gün · ${adherenceValues.length} danışan`}
        />
        <KpiTile
          icon="chat-circle-dots-duotone"
          label="Okunmamış mesaj"
          loading={unreadState.status === 'loading'}
          value={unreadState.status === 'success' ? unreadState.total : '—'}
          hint={unreadState.status === 'success'
            ? unreadState.conversationsWithUnread > 0 ? `${unreadState.conversationsWithUnread} danışandan` : 'Tüm mesajlar okundu'
            : 'Sayı alınamadı'}
        />
      </KpiGrid>

      {reviewLoadError && <Callout tone="warn" className="mb-4">{reviewLoadError}</Callout>}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <DashboardTaskPanel
          activeTab={taskFilter}
          onTabChange={setTaskFilter}
          taskViewState={taskViewState}
          groups={taskGroups}
          automaticState={automaticState}
          mutationError={automaticMutationError || (isAddTaskModalOpen ? null : taskMutationError)}
          pendingAction={pendingTaskAction}
          pendingAutomaticAction={pendingAutomaticAction}
          onDeleteAutomatic={(task) => { clearAutomaticMutationError(); setAutomaticTaskToDelete(task); }}
          onCreate={openCreateTaskModal}
          onRetryTasks={() => void refreshDailyTasks()}
          onRetryAutomatic={() => void refreshAutomatic()}
          onToggle={toggleTask}
          onOpen={(task) => setSelectedTaskId(task.id)}
          onEdit={openEditTaskModal}
          onDelete={(task) => setTaskToDelete(task)}
          onReviewRequest={(requestId) => void openReview(requestId)}
        />
        <div className="flex flex-col gap-5">
          <TodayScheduleCard
            appointments={todaysAppointments}
            loading={appointmentsLoading}
            error={Boolean(appointmentsError)}
            nowTime={nowTime}
            nextAppointmentId={nextAppointment?.date === today ? nextAppointment.id : null}
            onRetry={() => void refreshAppointments()}
          />
          <RecentMessagesCard
            state={recentMessages}
            currentUserId={userId}
            unreadCountFor={countForConversation}
            onRetry={() => void loadRecentMessages()}
          />
        </div>
      </div>

      <DailyTaskFormModal
        open={isAddTaskModalOpen}
        isEditing={editingTask !== null}
        draft={taskDraft}
        onDraftChange={setTaskDraft}
        activeClients={activeClients}
        clientsLoading={loadingClients}
        clientsError={clientLoadError}
        mutationError={taskMutationError}
        saving={pendingTaskAction === 'create' || Boolean(pendingTaskAction?.startsWith('update:'))}
        busy={pendingTaskAction !== null}
        onSubmit={(event) => void handleTaskSubmit(event)}
        onClose={closeTaskModal}
      />

      <DailyTaskDetailModal
        task={selectedTask}
        clientName={selectedTask?.clientId ? clientById.get(selectedTask.clientId)?.name ?? null : null}
        clientPhotoUrl={selectedTask?.clientId ? clientById.get(selectedTask.clientId)?.profilePhotoUrl ?? null : null}
        onClose={() => setSelectedTaskId(null)}
        onEdit={openEditTaskModal}
      />

      <ConfirmDialog
        open={taskToDelete !== null}
        title="Görev silinsin mi?"
        description={taskToDelete ? `“${taskToDelete.title}” kalıcı olarak silinecek.` : undefined}
        confirmLabel="Sil"
        tone="danger"
        busy={taskToDelete !== null && pendingTaskAction === `delete:${taskToDelete.id}`}
        onConfirm={() => void confirmDeleteTask()}
        onCancel={() => setTaskToDelete(null)}
      />

      <ConfirmDialog
        open={automaticTaskToDelete !== null}
        title="Otomatik görev silinsin mi?"
        description={automaticTaskToDelete
          ? `“${automaticTaskToDelete.clientName} ${AUTOMATIC_TASK_SUFFIX[automaticTaskToDelete.kind]}” görevi tüm cihazlarda panelinizden silinecek. Danışan kayıtları değişmez; yeni bir görev koşulu oluşursa tekrar görünür.`
          : undefined}
        confirmLabel="Sil"
        tone="danger"
        busy={pendingAutomaticAction !== null}
        onConfirm={() => void confirmDeleteAutomaticTask()}
        onCancel={() => { if (pendingAutomaticAction === null) setAutomaticTaskToDelete(null); }}
      >
        {automaticMutationError && <Callout tone="bad" role="alert">{automaticMutationError}</Callout>}
      </ConfirmDialog>

      <MealChangeRequestReviewDialog
        request={reviewRequest}
        onClose={() => setReviewRequest(null)}
        onReviewed={() => {
          setReviewRequest(null);
          void refreshAutomatic();
        }}
      />
    </PageContainer>
  );
};

export default DashboardPage;
