import { supabase } from '../../../lib/supabaseClient';
import { isDailyTaskUuid } from '../utils/dailyTaskContract';
import {
  automaticTaskRevision,
  type AutomaticTask,
  type AutomaticTaskDismissal,
} from '../utils/automaticTaskContract';

export const AUTOMATIC_TASK_DELETE_ERROR = 'Otomatik görev silinemedi. Lütfen tekrar deneyin.';
export const AUTOMATIC_TASK_PREFERENCES_ERROR = 'Otomatik görev tercihleri yüklenemedi. Lütfen tekrar deneyin.';

const requireOwner = async (expectedOwner: string, message: string): Promise<string> => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !isDailyTaskUuid(expectedOwner) || user?.id !== expectedOwner) throw new Error(message);
  return expectedOwner;
};

const parseDismissal = (data: unknown, owner: string): AutomaticTaskDismissal => {
  if (!data || typeof data !== 'object') throw new Error(AUTOMATIC_TASK_PREFERENCES_ERROR);
  const row = data as Record<string, unknown>;
  if (row.dietitian_id !== owner || typeof row.task_key !== 'string' || typeof row.task_revision !== 'string') {
    throw new Error(AUTOMATIC_TASK_PREFERENCES_ERROR);
  }
  return { taskKey: row.task_key, taskRevision: row.task_revision };
};

export const fetchAutomaticTaskDismissals = async (expectedOwner: string): Promise<AutomaticTaskDismissal[]> => {
  const owner = await requireOwner(expectedOwner, AUTOMATIC_TASK_PREFERENCES_ERROR);
  const result: AutomaticTaskDismissal[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('automatic_task_dismissals')
      .select('dietitian_id, task_key, task_revision').eq('dietitian_id', owner)
      .order('task_key').range(offset, offset + pageSize - 1);
    if (error || !Array.isArray(data)) throw new Error(AUTOMATIC_TASK_PREFERENCES_ERROR);
    result.push(...data.map((row) => parseDismissal(row, owner)));
    if (data.length < pageSize) return result;
  }
};

export const dismissAutomaticTask = async (task: AutomaticTask, expectedOwner: string): Promise<void> => {
  const owner = await requireOwner(expectedOwner, AUTOMATIC_TASK_DELETE_ERROR);
  const subject = task.kind === 'meal_change_request' ? task.requestId : task.clientId;
  if (!isDailyTaskUuid(task.clientId) || !subject || !isDailyTaskUuid(subject)
    || task.key !== `${task.kind}:${subject}`) throw new Error(AUTOMATIC_TASK_DELETE_ERROR);
  const revision = automaticTaskRevision(task);
  const { data, error } = await supabase.from('automatic_task_dismissals')
    .upsert({ dietitian_id: owner, client_id: task.clientId, task_key: task.key, task_revision: revision },
      { onConflict: 'dietitian_id,task_key' })
    .select('dietitian_id, task_key, task_revision').maybeSingle();
  if (error || !data) throw new Error(AUTOMATIC_TASK_DELETE_ERROR);
  const saved = parseDismissal(data, owner);
  if (saved.taskKey !== task.key || saved.taskRevision !== revision) throw new Error(AUTOMATIC_TASK_DELETE_ERROR);
};
