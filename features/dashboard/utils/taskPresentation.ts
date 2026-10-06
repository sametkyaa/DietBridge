import type { DailyTask } from '../types/dailyTask';

/** "4 Ekim · 14:30" style due label of a persistent task (Istanbul civil date). */
export const formatTaskDue = (task: Pick<DailyTask, 'dueDate' | 'dueTime'>): string => {
  const date = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${task.dueDate}T00:00:00Z`));
  return task.dueTime ? `${date} · ${task.dueTime}` : date;
};
