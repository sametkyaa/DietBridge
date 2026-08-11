export const DAILY_TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export const DAILY_TASK_STATUSES = ['pending', 'completed'] as const;

export type DailyTaskPriority = (typeof DAILY_TASK_PRIORITIES)[number];
export type DailyTaskStatus = (typeof DAILY_TASK_STATUSES)[number];

export interface DailyTask {
  id: string;
  dietitianId: string;
  clientId: string | null;
  clientName: string | null;
  clientAvatar: string | null;
  title: string;
  description: string | null;
  dueDate: string;
  dueTime: string | null;
  priority: DailyTaskPriority;
  status: DailyTaskStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyTaskDraft {
  clientId: string | null;
  title: string;
  description: string | null;
  dueDate: string;
  dueTime: string | null;
  priority: DailyTaskPriority;
}

export type ValidatedDailyTaskDraft = DailyTaskDraft;

export interface DailyTaskGroups {
  overdue: DailyTask[];
  today: DailyTask[];
  upcoming: DailyTask[];
  completed: DailyTask[];
}

export type DailyTaskViewState =
  | { status: 'loading' }
  | { status: 'success'; tasks: DailyTask[] }
  | { status: 'error'; message: string };

export type DailyTaskMutationResult =
  | { success: false }
  | { success: true; refreshSucceeded: boolean };
