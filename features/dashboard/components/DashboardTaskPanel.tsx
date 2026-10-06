import { Fragment, useMemo } from 'react';
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  LinkButton,
  LoadingState,
  TabPanel,
  Tabs,
  Tag,
  type IconName,
} from '../../../shared/ui';
import type { DailyTask, DailyTaskGroups, DailyTaskViewState } from '../types/dailyTask';
import type { AutomaticTaskViewState } from '../hooks/useAutomaticTasks';
import {
  AUTOMATIC_TASK_SUFFIX,
  type AutomaticTask,
  type AutomaticTaskKind,
} from '../utils/automaticTaskContract';
import { getIstanbulDateKey } from '../utils/dailyTaskContract';
import { formatTaskDue } from '../utils/taskPresentation';

export type TaskTab = keyof DailyTaskGroups;

const TAB_LABELS: Record<TaskTab, string> = {
  overdue: 'Geciken',
  today: 'Bugün',
  upcoming: 'Yaklaşan',
  completed: 'Tamamlanan',
};

const EMPTY_COPY: Record<TaskTab, string> = {
  overdue: 'Geciken görev yok.',
  today: 'Bugün için görev yok.',
  upcoming: 'Yaklaşan görev yok.',
  completed: 'Tamamlanan görev yok.',
};

const AUTOMATIC_ICONS: Record<AutomaticTaskKind, IconName> = {
  no_plan: 'calendar-plus',
  plan_expired: 'calendar-dots',
  meal_inactivity: 'fork-knife',
  meal_change_request: 'swap',
  measurement_due: 'scales-duotone',
};

const PRIORITY: Record<DailyTask['priority'], { label: string; tone: 'bad' | 'warn' | 'neutral' }> = {
  high: { label: 'Yüksek', tone: 'bad' },
  medium: { label: 'Orta', tone: 'warn' },
  low: { label: 'Düşük', tone: 'neutral' },
};

const daysBetween = (from: string, to: string): number => (
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
);

const AutomaticTaskAction = ({ task, onReviewRequest }: { task: AutomaticTask; onReviewRequest: (requestId: string) => void }) => {
  const client = encodeURIComponent(task.clientId);
  switch (task.kind) {
    case 'no_plan':
    case 'plan_expired':
      return <LinkButton size="sm" to={`/meal-plans?clientId=${client}`}>Plan oluştur</LinkButton>;
    case 'meal_inactivity':
      return <LinkButton size="sm" to={`/messages?clientId=${client}`}>Mesaj yaz</LinkButton>;
    case 'meal_change_request':
      return task.requestId
        ? <Button size="sm" onClick={() => onReviewRequest(task.requestId as string)}>İncele</Button>
        : null;
    case 'measurement_due':
      return <LinkButton size="sm" to={`/clients/${client}`}>Profili aç</LinkButton>;
    default:
      return null;
  }
};

const AutomaticTaskRow = ({ task, onReviewRequest }: { task: AutomaticTask; onReviewRequest: (requestId: string) => void }) => (
  <li className="flex flex-wrap items-center gap-3.5 border-t border-line px-[22px] py-3.5 sm:flex-nowrap">
    <span
      aria-hidden="true"
      className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] bg-sunk text-ink-2"
    >
      <Icon name={AUTOMATIC_ICONS[task.kind]} size={15} />
    </span>
    <div className="min-w-0 flex-1">
      <p className="m-0 text-14">
        <b className="font-semibold">{task.clientName}</b> {AUTOMATIC_TASK_SUFFIX[task.kind]}
        <Tag>Otomatik</Tag>
      </p>
      <p className="m-0 text-12.5 text-ink-3">{task.detail}</p>
    </div>
    {task.overdueDays !== null && task.overdueDays > 0 && (
      <Badge tone="bad">{task.overdueDays} gün gecikti</Badge>
    )}
    <AutomaticTaskAction task={task} onReviewRequest={onReviewRequest} />
  </li>
);

interface ManualTaskRowProps {
  task: DailyTask;
  today: string;
  pendingAction: string | null;
  onToggle: (task: DailyTask) => void;
  onOpen: (task: DailyTask) => void;
  onEdit: (task: DailyTask) => void;
  onDelete: (task: DailyTask) => void;
}

const ManualTaskRow = ({ task, today, pendingAction, onToggle, onOpen, onEdit, onDelete }: ManualTaskRowProps) => {
  const isCompleted = task.status === 'completed';
  const overdueDays = !isCompleted && task.dueDate < today ? daysBetween(task.dueDate, today) : 0;
  const busy = pendingAction !== null;
  const priority = PRIORITY[task.priority];
  return (
    <li className="flex flex-wrap items-center gap-3.5 border-t border-line px-[22px] py-3.5 sm:flex-nowrap">
      <Checkbox
        shape="round"
        checked={isCompleted}
        disabled={busy}
        onChange={() => onToggle(task)}
        aria-label={isCompleted ? `${task.title} görevini yeniden aç` : `${task.title} görevini tamamla`}
      />
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="min-w-0 flex-1 rounded-tag text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        aria-label={`${task.title} görev ayrıntılarını aç`}
      >
        <span className={`block truncate text-14 ${isCompleted ? 'text-ink-3 line-through' : 'font-medium text-ink'}`}>
          {task.clientName ? <><b className="font-semibold">{task.clientName}</b> · </> : null}
          {task.title}
        </span>
        <span className="block text-12.5 text-ink-3">
          {task.clientId === null ? 'Genel görev · ' : ''}{formatTaskDue(task)}
        </span>
      </button>
      {overdueDays > 0 ? (
        <Badge tone="bad">{overdueDays} gün gecikti</Badge>
      ) : (
        !isCompleted && <Badge tone={priority.tone} size="sm">{priority.label}</Badge>
      )}
      <div className="flex items-center gap-0.5">
        <IconButton icon="pencil-simple" label={`${task.title} görevini düzenle`} variant="bare" size="sm" disabled={busy} onClick={() => onEdit(task)} />
        <IconButton icon="x" label={`${task.title} görevini sil`} variant="bare" size="sm" disabled={busy} onClick={() => onDelete(task)} />
      </div>
    </li>
  );
};

export interface DashboardTaskPanelProps {
  activeTab: TaskTab;
  onTabChange: (tab: TaskTab) => void;
  taskViewState: DailyTaskViewState;
  groups: DailyTaskGroups;
  automaticState: AutomaticTaskViewState;
  mutationError: string | null;
  pendingAction: string | null;
  onCreate: () => void;
  onRetryTasks: () => void;
  onRetryAutomatic: () => void;
  onToggle: (task: DailyTask) => void;
  onOpen: (task: DailyTask) => void;
  onEdit: (task: DailyTask) => void;
  onDelete: (task: DailyTask) => void;
  onReviewRequest: (requestId: string) => void;
}

/**
 * Persistent daily_tasks (manual, completable) and derived automatic tasks
 * (no checkbox; they disappear when their data condition is resolved).
 */
export const DashboardTaskPanel = ({
  activeTab,
  onTabChange,
  taskViewState,
  groups,
  automaticState,
  mutationError,
  pendingAction,
  onCreate,
  onRetryTasks,
  onRetryAutomatic,
  onToggle,
  onOpen,
  onEdit,
  onDelete,
  onReviewRequest,
}: DashboardTaskPanelProps) => {
  const today = getIstanbulDateKey();
  const automaticTasks = useMemo(
    () => (automaticState.status === 'success' ? automaticState.tasks : []),
    [automaticState],
  );
  const automaticByTab = useMemo(() => ({
    overdue: automaticTasks.filter((task) => task.group === 'overdue'),
    today: automaticTasks.filter((task) => task.group === 'today'),
    upcoming: [] as AutomaticTask[],
    completed: [] as AutomaticTask[],
  }), [automaticTasks]);
  const tasksReady = taskViewState.status === 'success';
  const count = (tab: TaskTab) => (tasksReady ? groups[tab].length : 0) + automaticByTab[tab].length;
  const tabs = (Object.keys(TAB_LABELS) as TaskTab[]).map((tab) => ({
    value: tab,
    label: TAB_LABELS[tab],
    count: tab === 'completed' ? undefined : count(tab),
    countTone: tab === 'overdue' && count(tab) > 0 ? 'bad' as const : 'neutral' as const,
  }));
  const manual = tasksReady ? groups[activeTab] : [];
  const automatic = automaticByTab[activeTab];

  return (
    <Card padding="none" as="section" aria-labelledby="dashboard-tasks-title">
      <div className="flex items-center gap-2.5 px-[22px] pt-5">
        <h2 id="dashboard-tasks-title" className="m-0 text-16 font-semibold tracking-[-0.1px]">Görevler</h2>
        <Button size="sm" leftIcon="plus" className="ml-auto" onClick={onCreate}>Görev ekle</Button>
      </div>
      <Tabs
        items={tabs}
        value={activeTab}
        onChange={onTabChange}
        ariaLabel="Görev görünümü"
        idBase="dashboard-tasks"
        className="mt-2.5 px-[22px]"
      />
      <TabPanel idBase="dashboard-tasks" value={activeTab} activeValue={activeTab}>
        {mutationError && <Callout tone="bad" role="alert" className="mx-[22px] mt-3">{mutationError}</Callout>}
        {automaticState.status === 'error' && (activeTab === 'overdue' || activeTab === 'today') && (
          <Callout tone="warn" className="mx-[22px] mt-3">
            <span className="flex flex-wrap items-center gap-2">
              Otomatik görevler hesaplanamadı.
              <button type="button" className="font-semibold underline" onClick={onRetryAutomatic}>Tekrar dene</button>
            </span>
          </Callout>
        )}
        {taskViewState.status === 'loading' ? (
          <LoadingState label="Görevler yükleniyor…" variant="skeleton" rows={3} className="px-[22px] py-4" />
        ) : taskViewState.status === 'error' ? (
          <ErrorState description={taskViewState.message} onRetry={onRetryTasks} compact className="py-8" />
        ) : manual.length === 0 && automatic.length === 0 ? (
          <EmptyState
            compact
            icon="check-circle"
            title={EMPTY_COPY[activeTab]}
            className="py-8"
          />
        ) : (
          <ul className="m-0 list-none p-0 pb-1 [&>li:first-child]:border-t-0 [&>li:first-child]:mt-1">
            {automatic.map((task) => (
              <Fragment key={task.key}>
                <AutomaticTaskRow task={task} onReviewRequest={onReviewRequest} />
              </Fragment>
            ))}
            {manual.map((task) => (
              <Fragment key={task.id}>
                <ManualTaskRow
                  task={task}
                  today={today}
                  pendingAction={pendingAction}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              </Fragment>
            ))}
          </ul>
        )}
      </TabPanel>
    </Card>
  );
};
