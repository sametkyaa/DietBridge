import { supabase } from '../../../lib/supabaseClient';
import type {
  DailyTask,
  DailyTaskDraft,
  DailyTaskPriority,
  DailyTaskStatus,
  ValidatedDailyTaskDraft,
} from '../types/dailyTask';
import {
  isDailyTaskDate,
  isDailyTaskPriority,
  isDailyTaskStatus,
  isDailyTaskUuid,
  normalizeDailyTaskTime,
  validateDailyTaskDraft,
} from '../utils/dailyTaskContract';

export const DAILY_TASK_LOAD_ERROR = 'Görevler yüklenemedi. Lütfen tekrar deneyin.';
export const DAILY_TASK_SAVE_ERROR = 'Görev kaydedilemedi. Lütfen tekrar deneyin.';
export const DAILY_TASK_STATUS_ERROR = 'Görev durumu güncellenemedi. Lütfen tekrar deneyin.';
export const DAILY_TASK_DELETE_ERROR = 'Görev silinemedi. Lütfen tekrar deneyin.';

interface DailyTaskClientRow {
  full_name: string | null;
  avatar_url: string | null;
}

interface DailyTaskRow {
  id: string;
  dietitian_id: string;
  client_id: string | null;
  title: string | null;
  description: string | null;
  due_date: string;
  due_time: string | null;
  priority: string | null;
  status: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  client: DailyTaskClientRow | DailyTaskClientRow[] | null;
}

interface DeletedDailyTaskRow {
  id: string;
  dietitian_id: string;
}

export class DailyTaskServiceError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly cause?: unknown,
  ) {
    super(userMessage);
    this.name = 'DailyTaskServiceError';
  }
}

const DAILY_TASK_SELECT = `
  id,
  dietitian_id,
  client_id,
  title,
  description,
  due_date,
  due_time,
  priority,
  status,
  completed_at,
  created_at,
  updated_at,
  client:client_id (full_name, avatar_url)
`;

const firstClient = (value: DailyTaskRow['client']): DailyTaskClientRow | null => (
  Array.isArray(value) ? value[0] ?? null : value
);

const isTimestamp = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
);

const mapDailyTask = (row: DailyTaskRow, expectedDietitianId: string): DailyTask => {
  const dueTime = normalizeDailyTaskTime(row.due_time);
  const hasValidDescription = row.description === null
    || (typeof row.description === 'string' && row.description.trim().length > 0);
  const completionStateIsValid = (
    row.status === 'pending' && row.completed_at === null
  ) || (
    row.status === 'completed' && isTimestamp(row.completed_at)
  );

  if (
    !isDailyTaskUuid(row.id)
    || row.dietitian_id !== expectedDietitianId
    || (row.client_id !== null && !isDailyTaskUuid(row.client_id))
    || !row.title?.trim()
    || !hasValidDescription
    || !isDailyTaskDate(row.due_date)
    || (row.due_time !== null && dueTime === null)
    || !isDailyTaskPriority(row.priority)
    || !isDailyTaskStatus(row.status)
    || !completionStateIsValid
    || !isTimestamp(row.created_at)
    || !isTimestamp(row.updated_at)
  ) {
    throw new DailyTaskServiceError(DAILY_TASK_LOAD_ERROR);
  }

  const client = firstClient(row.client);
  return {
    id: row.id,
    dietitianId: row.dietitian_id,
    clientId: row.client_id,
    clientName: row.client_id === null ? null : client?.full_name?.trim() || null,
    clientAvatar: row.client_id === null ? null : client?.avatar_url || null,
    title: row.title.trim(),
    description: row.description?.trim() || null,
    dueDate: row.due_date,
    dueTime,
    priority: row.priority as DailyTaskPriority,
    status: row.status as DailyTaskStatus,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const requireCurrentDietitianId = async (userMessage: string): Promise<string> => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id || !isDailyTaskUuid(user.id)) {
    throw new DailyTaskServiceError(userMessage, error);
  }
  return user.id;
};

const assertActiveRelationship = async (
  dietitianId: string,
  clientId: string | null,
  userMessage: string,
): Promise<void> => {
  if (clientId === null) return;

  const { data, error } = await supabase
    .from('dietitian_clients')
    .select('id')
    .eq('dietitian_id', dietitianId)
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle();
  if (error || !data) throw new DailyTaskServiceError(userMessage, error);
};

const parseReturnedTask = (
  data: unknown,
  dietitianId: string,
  userMessage: string,
): DailyTask => {
  if (!data || typeof data !== 'object') {
    throw new DailyTaskServiceError(userMessage);
  }

  try {
    return mapDailyTask(data as DailyTaskRow, dietitianId);
  } catch (cause) {
    if (cause instanceof DailyTaskServiceError) {
      throw new DailyTaskServiceError(userMessage, cause);
    }
    throw new DailyTaskServiceError(userMessage, cause);
  }
};

const assertDraftPersisted = (
  task: DailyTask,
  draft: ValidatedDailyTaskDraft,
  userMessage: string,
): void => {
  if (
    task.clientId !== draft.clientId
    || task.title !== draft.title
    || task.description !== draft.description
    || task.dueDate !== draft.dueDate
    || task.dueTime !== draft.dueTime
    || task.priority !== draft.priority
  ) {
    throw new DailyTaskServiceError(userMessage);
  }
};

export const fetchDailyTasks = async (): Promise<DailyTask[]> => {
  const dietitianId = await requireCurrentDietitianId(DAILY_TASK_LOAD_ERROR);
  const { data, error } = await supabase
    .from('daily_tasks')
    .select(DAILY_TASK_SELECT)
    .eq('dietitian_id', dietitianId)
    .order('status', { ascending: true })
    .order('due_date', { ascending: true })
    .order('due_time', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true });

  if (error) throw new DailyTaskServiceError(DAILY_TASK_LOAD_ERROR, error);
  try {
    return ((data ?? []) as unknown as DailyTaskRow[]).map((row) => (
      mapDailyTask(row, dietitianId)
    ));
  } catch (cause) {
    if (cause instanceof DailyTaskServiceError) throw cause;
    throw new DailyTaskServiceError(DAILY_TASK_LOAD_ERROR, cause);
  }
};

export const createDailyTask = async (draft: DailyTaskDraft): Promise<DailyTask> => {
  const validation = validateDailyTaskDraft(draft);
  if (validation.success === false) {
    throw new DailyTaskServiceError(validation.message);
  }

  const dietitianId = await requireCurrentDietitianId(DAILY_TASK_SAVE_ERROR);
  await assertActiveRelationship(dietitianId, validation.value.clientId, DAILY_TASK_SAVE_ERROR);
  const { data, error } = await supabase
    .from('daily_tasks')
    .insert({
      dietitian_id: dietitianId,
      client_id: validation.value.clientId,
      title: validation.value.title,
      description: validation.value.description,
      due_date: validation.value.dueDate,
      due_time: validation.value.dueTime,
      priority: validation.value.priority,
      status: 'pending',
      completed_at: null,
    })
    .select(DAILY_TASK_SELECT)
    .maybeSingle();

  if (error || !data) throw new DailyTaskServiceError(DAILY_TASK_SAVE_ERROR, error);
  const task = parseReturnedTask(data, dietitianId, DAILY_TASK_SAVE_ERROR);
  assertDraftPersisted(task, validation.value, DAILY_TASK_SAVE_ERROR);
  if (task.status !== 'pending' || task.completedAt !== null) {
    throw new DailyTaskServiceError(DAILY_TASK_SAVE_ERROR);
  }
  return task;
};

export const updateDailyTask = async (
  id: string,
  draft: DailyTaskDraft,
): Promise<DailyTask> => {
  if (!isDailyTaskUuid(id)) throw new DailyTaskServiceError(DAILY_TASK_SAVE_ERROR);
  const validation = validateDailyTaskDraft(draft);
  if (validation.success === false) {
    throw new DailyTaskServiceError(validation.message);
  }

  const dietitianId = await requireCurrentDietitianId(DAILY_TASK_SAVE_ERROR);
  const { data, error } = await supabase
    .from('daily_tasks')
    .update({
      client_id: validation.value.clientId,
      title: validation.value.title,
      description: validation.value.description,
      due_date: validation.value.dueDate,
      due_time: validation.value.dueTime,
      priority: validation.value.priority,
    })
    .eq('id', id)
    .eq('dietitian_id', dietitianId)
    .select(DAILY_TASK_SELECT)
    .maybeSingle();

  if (error || !data) throw new DailyTaskServiceError(DAILY_TASK_SAVE_ERROR, error);
  const task = parseReturnedTask(data, dietitianId, DAILY_TASK_SAVE_ERROR);
  if (task.id !== id) throw new DailyTaskServiceError(DAILY_TASK_SAVE_ERROR);
  assertDraftPersisted(task, validation.value, DAILY_TASK_SAVE_ERROR);
  return task;
};

export const setDailyTaskCompletion = async (
  id: string,
  completed: boolean,
): Promise<DailyTask> => {
  if (!isDailyTaskUuid(id)) throw new DailyTaskServiceError(DAILY_TASK_STATUS_ERROR);

  const dietitianId = await requireCurrentDietitianId(DAILY_TASK_STATUS_ERROR);
  const expectedStatus: DailyTaskStatus = completed ? 'completed' : 'pending';
  const { data, error } = await supabase
    .from('daily_tasks')
    .update({ status: expectedStatus })
    .eq('id', id)
    .eq('dietitian_id', dietitianId)
    .select(DAILY_TASK_SELECT)
    .maybeSingle();

  if (error || !data) throw new DailyTaskServiceError(DAILY_TASK_STATUS_ERROR, error);
  const task = parseReturnedTask(data, dietitianId, DAILY_TASK_STATUS_ERROR);
  if (
    task.id !== id
    || task.status !== expectedStatus
    || (completed ? task.completedAt === null : task.completedAt !== null)
  ) {
    throw new DailyTaskServiceError(DAILY_TASK_STATUS_ERROR);
  }
  return task;
};

export const deleteDailyTask = async (id: string): Promise<void> => {
  if (!isDailyTaskUuid(id)) throw new DailyTaskServiceError(DAILY_TASK_DELETE_ERROR);

  const dietitianId = await requireCurrentDietitianId(DAILY_TASK_DELETE_ERROR);
  const { data, error } = await supabase
    .from('daily_tasks')
    .delete()
    .eq('id', id)
    .eq('dietitian_id', dietitianId)
    .select('id, dietitian_id')
    .maybeSingle();

  const deleted = data as DeletedDailyTaskRow | null;
  if (error || deleted?.id !== id || deleted.dietitian_id !== dietitianId) {
    throw new DailyTaskServiceError(DAILY_TASK_DELETE_ERROR, error);
  }
};
