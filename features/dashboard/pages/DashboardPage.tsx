import React, { useCallback, useState, useRef, useEffect } from 'react';
import { 
  CheckCircle2, 
  MoreHorizontal, 
  Search, 
  ChevronRight, 
  Calendar, 
  ClipboardList,
  MessageCircle,
  X,
  Plus,
  User,
  AlertCircle,
  Edit2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DietitianAvatar from '../../../shared/components/DietitianAvatar';
import { useAppointments } from '../../appointments/context/AppointmentContext';
import { getLocalDateKey } from '../../appointments/utils/appointmentContract';
import { fetchDietitianClients } from '../../clients/services/clientService';
import { Client } from '../../../shared/types';
import { useDailyTasks } from '../hooks/useDailyTasks';
import type { DailyTask, DailyTaskDraft, DailyTaskGroups } from '../types/dailyTask';
import { getIstanbulDateKey, getPendingDailyTaskGroup } from '../utils/dailyTaskContract';
import { getDashboardFocusMessage, summarizeDashboard } from '../utils/dashboardContract';

type TaskFilter = keyof DailyTaskGroups;

const emptyTaskDraft = (): DailyTaskDraft => ({
  clientId: null,
  title: '',
  description: null,
  dueDate: getIstanbulDateKey(),
  dueTime: null,
  priority: 'medium',
});

const TASK_FILTERS: Array<{ key: TaskFilter; label: string }> = [
  { key: 'overdue', label: 'Geciken' },
  { key: 'today', label: 'Bugün' },
  { key: 'upcoming', label: 'Yaklaşan' },
  { key: 'completed', label: 'Tamamlanan' },
];

const DashboardPage = () => {
  const navigate = useNavigate();
  // Clients State
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [clientLoadError, setClientLoadError] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Task Management State
  const [isTaskMenuOpen, setIsTaskMenuOpen] = useState(false);
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('today');
  const [taskDraft, setTaskDraft] = useState<DailyTaskDraft>(emptyTaskDraft);
  const taskDialogRef = useRef<HTMLDivElement>(null);
  const taskTitleInputRef = useRef<HTMLInputElement>(null);
  const taskMenuButtonRef = useRef<HTMLButtonElement>(null);
  const taskDialogOpenerRef = useRef<HTMLElement | null>(null);
  const pendingTaskActionRef = useRef<string | null>(null);

  const {
    viewState: taskViewState,
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
  pendingTaskActionRef.current = pendingTaskAction;
  
  // Fetch appointments from context
  const {
    error: appointmentsError,
    getAppointmentsByDate,
    loading: appointmentsLoading,
    refreshAppointments,
  } = useAppointments();
  
  // Get today's appointments dynamically
  const today = getLocalDateKey();
  const todaysAppointments = getAppointmentsByDate(today)
    .filter((appointment) => appointment.status !== 'cancelled');

  // Fetch Clients
  const loadClients = useCallback(async () => {
    setLoadingClients(true);
    setClientLoadError(false);
    try {
      const data = await fetchDietitianClients();
      setClients(data);
    } catch (error) {
      console.error('Failed to fetch clients:', error);
      setClients([]);
      setClientLoadError(true);
    } finally {
      setLoadingClients(false);
    }
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const openCreateTaskModal = () => {
    taskDialogOpenerRef.current = taskMenuButtonRef.current;
    clearMutationError();
    setEditingTask(null);
    setTaskDraft(emptyTaskDraft());
    setIsAddTaskModalOpen(true);
  };

  const openEditTaskModal = (task: DailyTask) => {
    taskDialogOpenerRef.current = document.activeElement as HTMLElement | null;
    clearMutationError();
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

  const handleTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const handleDeleteTask = async (task: DailyTask) => {
    if (!window.confirm(`“${task.title}” görevi silinsin mi?`)) return;
    await deleteTask(task.id);
  };

  // Filter clients for main search
  const filteredClients = searchQuery.length > 0 
    ? clients.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  const activeTaskClients = clients.filter((client) => client.status === 'Aktif');
  const visibleTasks = taskGroups[taskFilter];
  const dashboardSummary = summarizeDashboard({
    clients,
    todayAppointments: todaysAppointments,
    tasks: taskGroups,
  });
  const clientSummaryReady = !loadingClients && !clientLoadError;
  const appointmentsSummaryReady = !appointmentsLoading && !appointmentsError;
  const tasksSummaryReady = taskViewState.status === 'success';
  const dashboardFocusMessage = clientLoadError || appointmentsError || taskViewState.status === 'error'
    ? 'Bugünün özeti şu anda tamamlanamadı. Verileri tekrar deneyin.'
    : !clientSummaryReady || !appointmentsSummaryReady || !tasksSummaryReady
      ? 'Bugünün özeti yükleniyor...'
      : getDashboardFocusMessage(dashboardSummary);

  const focusTasks = (filter: 'overdue' | 'today') => {
    setTaskFilter(filter);
    document.getElementById('daily-tasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Close search dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Main Search
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isAddTaskModalOpen) return;
    taskTitleInputRef.current?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pendingTaskActionRef.current === null) setIsAddTaskModalOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !taskDialogRef.current) return;
      const focusable: HTMLElement[] = Array.from(taskDialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      taskDialogOpenerRef.current?.focus();
    };
  }, [isAddTaskModalOpen]);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Kontrol Paneli</h1>
          <p className="text-slate-500 mt-1">Tekrar hoş geldiniz, Diyetisyen!</p>
        </div>
        <div className="flex items-center gap-6">
          
          {/* Search Bar with Dropdown */}
          <div className="relative" ref={searchRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 pointer-events-none" />
            <input
              type="text"
              placeholder="Danışan ara..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              className="pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-64 text-sm transition-all shadow-sm"
            />
            {searchQuery && (
              <button 
                onClick={() => {
                  setSearchQuery('');
                  setIsSearchOpen(false);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Dropdown Results */}
            {isSearchOpen && searchQuery && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {filteredClients.length > 0 ? (
                  <div className="py-1">
                    <p className="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">Sonuçlar</p>
                    {filteredClients.map(client => (
                      <button
                        key={client.id}
                        onClick={() => {
                          navigate(`/clients/${client.id}`);
                          setSearchQuery('');
                          setIsSearchOpen(false);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3 transition-colors group border-b border-slate-50 last:border-0"
                      >
                        <img src={client.avatar} alt={client.name} className="w-8 h-8 rounded-full object-cover ring-2 ring-slate-100 group-hover:ring-primary/20" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-700 group-hover:text-primary transition-colors truncate">{client.name}</p>
                          <p className="text-xs text-slate-400 truncate">{client.goal}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-primary" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-slate-500 text-sm">
                    Sonuç bulunamadı.
                  </div>
                )}
              </div>
            )}
          </div>

          <button onClick={() => navigate('/profile')} className="focus:outline-none hover:opacity-80 transition-opacity p-0 border-0 bg-transparent cursor-pointer rounded-full" aria-label="Profil sayfasına git" role="button">
            <DietitianAvatar
              alt="Profil"
              className="w-12 h-12 rounded-full border-2 border-white shadow-sm object-cover"
            />
          </button>
        </div>
      </header>

      {/* Operational summary */}
      <section aria-labelledby="dashboard-summary-title" className="mb-8 space-y-4">
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-primary">Bugünün odağı</p>
            <h2 id="dashboard-summary-title" className="mt-1 text-lg font-bold text-slate-800">{dashboardFocusMessage}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {dashboardSummary.overdueTaskCount > 0 && (
              <button type="button" onClick={() => focusTasks('overdue')} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-rose-600 shadow-sm ring-1 ring-rose-100 hover:bg-rose-50">
                Geciken görevleri aç
              </button>
            )}
            {dashboardSummary.todayTaskCount > 0 && (
              <button type="button" onClick={() => focusTasks('today')} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-primary shadow-sm ring-1 ring-primary/15 hover:bg-primary/5">
                Bugünkü görevleri aç
              </button>
            )}
            {dashboardSummary.overdueTaskCount === 0 && dashboardSummary.todayTaskCount === 0 && (
              <button type="button" onClick={openCreateTaskModal} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-dark">
                Görev ekle
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button type="button" onClick={() => navigate('/clients')} className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Aktif danışan</p>
            <p className="mt-2 text-2xl font-bold text-slate-800">{clientSummaryReady ? dashboardSummary.activeClientCount : '—'}</p>
            <p className="mt-1 text-xs text-slate-500">{clientLoadError ? 'Veri yüklenemedi' : clientSummaryReady ? `${dashboardSummary.pendingClientCount} onay bekliyor` : 'Yükleniyor...'}</p>
          </button>
          <button type="button" onClick={() => navigate('/appointments')} className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Bugünkü randevu</p>
            <p className="mt-2 text-2xl font-bold text-slate-800">{appointmentsSummaryReady ? dashboardSummary.todayAppointmentCount : '—'}</p>
            <p className="mt-1 text-xs text-slate-500">{appointmentsError ? 'Veri yüklenemedi' : appointmentsSummaryReady ? 'Randevu takvimini aç' : 'Yükleniyor...'}</p>
          </button>
          <button type="button" onClick={() => focusTasks('overdue')} className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-rose-200 hover:bg-rose-50">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Geciken görev</p>
            <p className="mt-2 text-2xl font-bold text-slate-800">{tasksSummaryReady ? dashboardSummary.overdueTaskCount : '—'}</p>
            <p className="mt-1 text-xs text-slate-500">{taskViewState.status === 'error' ? 'Veri yüklenemedi' : tasksSummaryReady ? 'Öncelikli iş listesi' : 'Yükleniyor...'}</p>
          </button>
          <button type="button" onClick={() => focusTasks('today')} className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Bugünün görevi</p>
            <p className="mt-2 text-2xl font-bold text-slate-800">{tasksSummaryReady ? dashboardSummary.todayTaskCount : '—'}</p>
            <p className="mt-1 text-xs text-slate-500">{taskViewState.status === 'error' ? 'Veri yüklenemedi' : tasksSummaryReady ? 'Bugünkü iş listesi' : 'Yükleniyor...'}</p>
          </button>
        </div>
      </section>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-8">
        {/* Left Column */}
        <div className="col-span-12 lg:col-span-8 space-y-8">
          
          {/* Persistent Daily Tasks */}
          <section id="daily-tasks" className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-bold text-slate-800">Günlük Görevler</h3>
                <p className="mt-1 text-xs text-slate-500">Kalıcı iş listenizi yönetin.</p>
              </div>
              <div className="relative">
                <button 
                  ref={taskMenuButtonRef}
                  onClick={() => setIsTaskMenuOpen(!isTaskMenuOpen)}
                  aria-label="Görev menüsünü aç"
                  className="text-slate-400 hover:text-primary transition-colors p-1 rounded-full hover:bg-slate-50"
                >
                  <MoreHorizontal className="w-6 h-6" />
                </button>
                
                {/* Task Menu Dropdown */}
                {isTaskMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10 cursor-default" onClick={() => setIsTaskMenuOpen(false)}></div>
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-100 z-20 py-1 animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                      <button
                        onClick={() => {
                          openCreateTaskModal();
                          setIsTaskMenuOpen(false);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 text-slate-600 font-medium flex items-center gap-2 transition-colors"
                      >
                        <Plus className="w-4 h-4 text-primary" /> Yeni Görev Ekle
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Görev görünümü">
              {TASK_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={taskFilter === key}
                  onClick={() => setTaskFilter(key)}
                  className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${
                    taskFilter === key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {label} ({taskGroups[key].length})
                </button>
              ))}
            </div>

            {taskMutationError && (
              <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {taskMutationError}
              </div>
            )}

            <div className="space-y-3">
              {taskViewState.status === 'loading' ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" /> Görevler yükleniyor...
                </div>
              ) : taskViewState.status === 'error' ? (
                <div role="alert" className="py-8 text-center">
                  <p className="text-sm font-medium text-rose-600">{taskViewState.message}</p>
                  <button type="button" onClick={() => void refreshDailyTasks()} className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary">
                    <RefreshCw className="h-4 w-4" /> Tekrar dene
                  </button>
                </div>
              ) : visibleTasks.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">
                  Bu görünümde görev bulunmuyor.
                </div>
              ) : visibleTasks.map((task) => (
                <div key={task.id} className="flex flex-col gap-3 rounded-xl border border-slate-100 p-3 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    {task.clientAvatar ? (
                      <img src={task.clientAvatar} alt="" className="h-11 w-11 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                        <User className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className={`truncate font-semibold ${task.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{task.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {task.clientName || 'Genel görev'} · {new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('tr-TR')}
                        {task.dueTime ? ` ${task.dueTime}` : ''}
                      </p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        task.priority === 'high' ? 'bg-rose-50 text-rose-600' : task.priority === 'low' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {task.priority === 'high' ? 'Yüksek' : task.priority === 'low' ? 'Düşük' : 'Orta'} öncelik
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => void (task.status === 'completed' ? reopenTask(task.id) : completeTask(task.id))}
                      disabled={pendingTaskAction !== null}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      {pendingTaskAction === `complete:${task.id}` || pendingTaskAction === `reopen:${task.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : task.status === 'completed' ? <RotateCcw className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                      {task.status === 'completed' ? 'Tekrar aç' : 'Tamamla'}
                    </button>
                    <button type="button" onClick={() => openEditTaskModal(task)} disabled={pendingTaskAction !== null} aria-label={`${task.title} görevini düzenle`} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-primary disabled:opacity-50">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => void handleDeleteTask(task)} disabled={pendingTaskAction !== null} aria-label={`${task.title} görevini sil`} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">
                      {pendingTaskAction === `delete:${task.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Quick actions */}
          <section aria-labelledby="quick-actions-title" className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="mb-5">
              <h3 id="quick-actions-title" className="text-xl font-bold text-slate-800">Hızlı işlemler</h3>
              <p className="mt-1 text-xs text-slate-500">Bugünkü iş akışınıza doğrudan geçin.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <button type="button" onClick={() => navigate('/appointments')} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5">
                <Calendar className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="flex-1 text-sm font-bold text-slate-700">Randevu ekle / düzenle</span>
                <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => navigate('/clients')} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5">
                <User className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="flex-1 text-sm font-bold text-slate-700">Danışanları yönet</span>
                <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => navigate('/meal-plans')} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5">
                <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="flex-1 text-sm font-bold text-slate-700">Beslenme planlarını aç</span>
                <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => navigate('/messages')} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5">
                <MessageCircle className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="flex-1 text-sm font-bold text-slate-700">Mesajlara git</span>
                <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="col-span-12 lg:col-span-4 space-y-8">
          
          {/* Appointments */}
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-800">Bugünkü Randevular</h3>
            </div>
            
            {appointmentsLoading ? (
              <div className="py-6 text-center text-sm text-slate-400">Randevular yükleniyor...</div>
            ) : appointmentsError ? (
              <div role="alert" className="py-6 text-center">
                <p className="text-sm text-rose-600">Bugünkü randevular yüklenemedi.</p>
                <button
                  type="button"
                  onClick={() => void refreshAppointments()}
                  className="mt-2 text-sm font-bold text-primary hover:underline"
                >
                  Tekrar dene
                </button>
              </div>
            ) : todaysAppointments.length > 0 ? (
              <div className="space-y-6 relative">
                {/* Timeline Line */}
                <div className="absolute left-[3.25rem] top-2 bottom-2 w-0.5 bg-slate-100"></div>

                {todaysAppointments.map((apt) => (
                  <div key={apt.id} className="flex gap-4 relative">
                    <div className="flex flex-col items-end w-10 flex-shrink-0 pt-0.5">
                      <span className="font-bold text-slate-800 leading-none">{apt.time}</span>
                      <span className="text-xs text-slate-400 mt-1">{apt.duration}</span>
                    </div>
                    <div className={`relative pl-4 border-l-4 ${
                      apt.type === 'Görüntülü Görüşme' ? 'border-primary' : apt.type === 'Yüzyüze' ? 'border-orange-400' : 'border-blue-400'
                    }`}>
                      <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 bg-white rounded-full border-2 border-inherit"></div>
                      <p className="font-semibold text-slate-800 leading-tight mb-1">{apt.title}</p>
                      <p className="text-sm text-slate-500">{apt.clientName} · {apt.type}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400">
                <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Bugün için randevu bulunmuyor.</p>
              </div>
            )}
            
            <button 
              onClick={() => navigate('/appointments')}
              className="w-full mt-6 py-3 rounded-xl border border-dashed border-slate-300 text-slate-500 font-medium hover:bg-slate-50 hover:border-primary hover:text-primary transition-all flex items-center justify-center gap-2"
            >
               Tüm Randevuları Gör
            </button>
          </section>

          {/* My Clients */}
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h3 className="text-xl font-bold text-slate-800 mb-6">Danışanlarım</h3>
            <div className="space-y-5">
              {loadingClients ? (
                <div className="text-center py-4 text-slate-400">Yükleniyor...</div>
              ) : clients.length > 0 ? (
                clients.slice(0, 5).map((client) => (
                  <div 
                    key={client.id} 
                    onClick={() => navigate(`/clients/${client.id}`)}
                    className="flex items-center justify-between group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <img src={client.avatar} alt={client.name} className="w-10 h-10 rounded-full object-cover ring-2 ring-white group-hover:ring-primary/20 transition-all" />
                      <div>
                        <p className="font-semibold text-slate-800 text-sm group-hover:text-primary transition-colors">{client.name}</p>
                        <p className="text-xs text-slate-500">{client.goal}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${client.compliance > 80 ? 'bg-primary' : client.compliance > 70 ? 'bg-yellow-400' : 'bg-red-500'}`} 
                          style={{ width: `${client.compliance}%` }}
                        ></div>
                      </div>
                      <span className={`text-sm font-bold ${client.compliance > 80 ? 'text-primary' : client.compliance > 70 ? 'text-yellow-500' : 'text-red-500'}`}>
                        %{client.compliance}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-slate-400">
                  <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Search className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 mb-1">Henüz danışanınız yok</p>
                  <p className="text-xs">İlk danışanınızı eklediğinizde burada görünecek.</p>
                </div>
              )}
            </div>
            <button 
              onClick={() => navigate('/clients')}
              className="w-full mt-6 py-3 rounded-xl border border-dashed border-slate-300 text-slate-500 font-medium hover:bg-slate-50 hover:border-primary hover:text-primary transition-all flex items-center justify-center gap-2"
            >
               Tüm Danışanları Gör
            </button>
          </section>
        </div>
      </div>

      {/* Add Task Modal */}
      {isAddTaskModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div ref={taskDialogRef} role="dialog" aria-modal="true" aria-labelledby="daily-task-dialog-title" className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
               <h2 id="daily-task-dialog-title" className="text-xl font-bold text-slate-800">{editingTask ? 'Görevi Düzenle' : 'Yeni Görev Ekle'}</h2>
               <button type="button" aria-label="Görev penceresini kapat" onClick={() => setIsAddTaskModalOpen(false)} disabled={pendingTaskAction !== null} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 disabled:opacity-50">
                  <X className="w-5 h-5" />
               </button>
            </div>
            
            <form onSubmit={handleTaskSubmit} className="p-6 space-y-5">
               {taskMutationError && (
                 <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                   <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {taskMutationError}
                 </div>
               )}
               <div className="space-y-1.5">
                  <label htmlFor="daily-task-title" className="text-sm font-bold text-slate-700">Görev Başlığı</label>
                  <input 
                    id="daily-task-title"
                    ref={taskTitleInputRef}
                    type="text"
                    required
                    maxLength={160}
                    placeholder="Örn: Haftalık raporu hazırla..."
                    value={taskDraft.title}
                    onChange={(e) => setTaskDraft({ ...taskDraft, title: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
                  />
               </div>

               <div className="space-y-1.5">
                  <label htmlFor="daily-task-description" className="text-sm font-bold text-slate-700">Açıklama (Opsiyonel)</label>
                  <textarea
                    id="daily-task-description"
                    rows={3}
                    maxLength={2000}
                    value={taskDraft.description || ''}
                    onChange={(e) => setTaskDraft({ ...taskDraft, description: e.target.value || null })}
                    className="w-full resize-none px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
                  />
               </div>

               <div className="space-y-1.5">
                  <label htmlFor="daily-task-client" className="text-sm font-bold text-slate-700">İlgili Danışan (Opsiyonel)</label>
                  <select
                    id="daily-task-client"
                    value={taskDraft.clientId || ''}
                    onChange={(e) => setTaskDraft({ ...taskDraft, clientId: e.target.value || null })}
                    disabled={loadingClients || clientLoadError}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm disabled:opacity-60"
                  >
                    <option value="">Genel görev</option>
                    {activeTaskClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                  </select>
                  {loadingClients && <p className="text-xs text-slate-500">Aktif danışanlar yükleniyor...</p>}
                  {clientLoadError && <p role="alert" className="text-xs text-rose-600">Danışanlar yüklenemedi; yalnız genel görev kaydedilebilir.</p>}
               </div>

               <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                 <div className="space-y-1.5">
                   <label htmlFor="daily-task-date" className="text-sm font-bold text-slate-700">Bitiş Tarihi</label>
                   <input id="daily-task-date" type="date" required value={taskDraft.dueDate} onChange={(e) => setTaskDraft({ ...taskDraft, dueDate: e.target.value })} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm" />
                 </div>
                 <div className="space-y-1.5">
                   <label htmlFor="daily-task-time" className="text-sm font-bold text-slate-700">Saat (Opsiyonel)</label>
                   <input id="daily-task-time" type="time" value={taskDraft.dueTime || ''} onChange={(e) => setTaskDraft({ ...taskDraft, dueTime: e.target.value || null })} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm" />
                 </div>
               </div>

               <div className="space-y-1.5">
                  <label htmlFor="daily-task-priority" className="text-sm font-bold text-slate-700">Öncelik</label>
                  <select id="daily-task-priority" value={taskDraft.priority} onChange={(e) => setTaskDraft({ ...taskDraft, priority: e.target.value as DailyTaskDraft['priority'] })} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm">
                    <option value="low">Düşük</option>
                    <option value="medium">Orta</option>
                    <option value="high">Yüksek</option>
                  </select>
               </div>

               <div className="pt-2 flex gap-3">
                  <button 
                    type="button" 
                    onClick={() => setIsAddTaskModalOpen(false)}
                    disabled={pendingTaskAction !== null}
                    className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl border border-slate-200 transition-colors text-sm disabled:opacity-50"
                  >
                     İptal
                  </button>
                  <button 
                    type="submit"
                    disabled={pendingTaskAction !== null}
                    className="flex-1 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/30 hover:bg-primary-dark transition-colors text-sm disabled:opacity-60"
                  >
                     {pendingTaskAction === 'create' || pendingTaskAction?.startsWith('update:') ? (
                       <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Kaydediliyor</span>
                     ) : editingTask ? 'Güncelle' : 'Ekle'}
                  </button>
               </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
