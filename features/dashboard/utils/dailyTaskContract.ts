import {
  DAILY_TASK_PRIORITIES,
  DAILY_TASK_STATUSES,
  type DailyTask,
  type DailyTaskDraft,
  type DailyTaskGroups,
  type DailyTaskPriority,
  type DailyTaskStatus,
  type ValidatedDailyTaskDraft,
} from '../types/dailyTask';

export const DIETBRIDGE_BUSINESS_TIME_ZONE = 'Europe/Istanbul';
export const DAILY_TASK_TITLE_MAX_LENGTH = 160;
export const DAILY_TASK_DESCRIPTION_MAX_LENGTH = 2000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

const priorityRank: Record<DailyTaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export type DailyTaskValidationResult =
  | { success: true; value: ValidatedDailyTaskDraft }
  | { success: false; message: string };

export type PendingDailyTaskGroup = 'overdue' | 'today' | 'upcoming';

export const isDailyTaskPriority = (value: unknown): value is DailyTaskPriority => (
  typeof value === 'string' && DAILY_TASK_PRIORITIES.includes(value as DailyTaskPriority)
);

export const isDailyTaskStatus = (value: unknown): value is DailyTaskStatus => (
  typeof value === 'string' && DAILY_TASK_STATUSES.includes(value as DailyTaskStatus)
);

export const isDailyTaskUuid = (value: unknown): value is string => (
  typeof value === 'string' && UUID_PATTERN.test(value)
);

export const isDailyTaskDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

export const normalizeDailyTaskTime = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;

  const match = TIME_PATTERN.exec(value);
  return match ? `${match[1]}:${match[2]}` : null;
};

export const getIstanbulDateKey = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DIETBRIDGE_BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const getIstanbulTimeKey = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DIETBRIDGE_BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
};

export const validateDailyTaskDraft = (draft: DailyTaskDraft): DailyTaskValidationResult => {
  if (draft.clientId !== null && !isDailyTaskUuid(draft.clientId)) {
    return { success: false, message: 'Geçerli ve aktif bir danışan seçin.' };
  }

  const title = draft.title.trim();
  if (!title) return { success: false, message: 'Görev başlığı zorunludur.' };
  if (title.length > DAILY_TASK_TITLE_MAX_LENGTH) {
    return {
      success: false,
      message: `Görev başlığı en fazla ${DAILY_TASK_TITLE_MAX_LENGTH} karakter olabilir.`,
    };
  }

  const description = draft.description?.trim() || null;
  if (description !== null && description.length > DAILY_TASK_DESCRIPTION_MAX_LENGTH) {
    return {
      success: false,
      message: `Görev açıklaması en fazla ${DAILY_TASK_DESCRIPTION_MAX_LENGTH} karakter olabilir.`,
    };
  }

  if (!isDailyTaskDate(draft.dueDate)) {
    return { success: false, message: 'Geçerli bir görev tarihi seçin.' };
  }

  const dueTime = normalizeDailyTaskTime(draft.dueTime);
  if (draft.dueTime !== null && draft.dueTime !== '' && dueTime === null) {
    return { success: false, message: 'Geçerli bir görev saati girin.' };
  }

  if (!isDailyTaskPriority(draft.priority)) {
    return { success: false, message: 'Geçerli bir görev önceliği seçin.' };
  }

  return {
    success: true,
    value: {
      clientId: draft.clientId,
      title,
      description,
      dueDate: draft.dueDate,
      dueTime,
      priority: draft.priority,
    },
  };
};

const comparePendingTasks = (left: DailyTask, right: DailyTask): number => {
  const dateComparison = left.dueDate.localeCompare(right.dueDate);
  if (dateComparison !== 0) return dateComparison;

  const leftTime = left.dueTime ?? '24:00';
  const rightTime = right.dueTime ?? '24:00';
  const timeComparison = leftTime.localeCompare(rightTime);
  if (timeComparison !== 0) return timeComparison;

  const priorityComparison = priorityRank[left.priority] - priorityRank[right.priority];
  return priorityComparison !== 0 ? priorityComparison : left.id.localeCompare(right.id);
};

const compareCompletedTasks = (left: DailyTask, right: DailyTask): number => {
  const completionComparison = (right.completedAt ?? '').localeCompare(left.completedAt ?? '');
  return completionComparison !== 0 ? completionComparison : left.id.localeCompare(right.id);
};

export const getPendingDailyTaskGroup = (
  dueDate: string,
  dueTime: string | null,
  referenceDate: Date = new Date(),
): PendingDailyTaskGroup => {
  const todayKey = getIstanbulDateKey(referenceDate);
  const currentTimeKey = getIstanbulTimeKey(referenceDate);
  if (dueDate < todayKey || (dueDate === todayKey && dueTime !== null && dueTime < currentTimeKey)) {
    return 'overdue';
  }
  return dueDate === todayKey ? 'today' : 'upcoming';
};

export const groupDailyTasks = (
  tasks: readonly DailyTask[],
  referenceDate: Date | string = new Date(),
): DailyTaskGroups => {
  const todayKey = typeof referenceDate === 'string'
    ? referenceDate
    : getIstanbulDateKey(referenceDate);

  if (!isDailyTaskDate(todayKey)) {
    throw new Error('Daily task grouping requires a valid civil date.');
  }

  const groups: DailyTaskGroups = { overdue: [], today: [], upcoming: [], completed: [] };
  for (const task of tasks) {
    if (task.status === 'completed') {
      groups.completed.push(task);
    } else {
      const group = typeof referenceDate === 'string'
        ? task.dueDate < todayKey ? 'overdue' : task.dueDate === todayKey ? 'today' : 'upcoming'
        : getPendingDailyTaskGroup(task.dueDate, task.dueTime, referenceDate);
      groups[group].push(task);
    }
  }

  groups.overdue.sort(comparePendingTasks);
  groups.today.sort(comparePendingTasks);
  groups.upcoming.sort(comparePendingTasks);
  groups.completed.sort(compareCompletedTasks);
  return groups;
};
