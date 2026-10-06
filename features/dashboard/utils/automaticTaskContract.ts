import { addCalendarDays } from '../../../shared/utils/dateContract';

/**
 * Automatic tasks are DERIVED on every panel load from real data and are never
 * stored as tasks. They disappear by themselves once the underlying condition
 * is resolved, so they intentionally have no completion checkbox.
 */
export type AutomaticTaskKind =
  | 'no_plan'
  | 'plan_expired'
  | 'meal_inactivity'
  | 'meal_change_request'
  | 'measurement_due';

export type AutomaticTaskGroup = 'overdue' | 'today';

export interface AutomaticTask {
  /** Stable key: kind + subject; used as React key and for de-duplication. */
  key: string;
  kind: AutomaticTaskKind;
  group: AutomaticTaskGroup;
  clientId: string;
  clientName: string;
  /** Date the condition started (plan end, last completion, request date…). */
  sinceDate: string | null;
  /** Whole days the condition is overdue; only for overdue items. */
  overdueDays: number | null;
  /** Pending meal change request id when kind = meal_change_request. */
  requestId: string | null;
  /** Free-form detail line built from real values. */
  detail: string;
}

export interface AutomaticTaskDismissal {
  taskKey: string;
  taskRevision: string;
}

/** Stable across elapsed days; a new plan, measurement or request is a new occurrence. */
export const automaticTaskRevision = (task: AutomaticTask): string => (
  JSON.stringify([task.kind, task.clientId, task.sinceDate, task.requestId])
);

export const filterDismissedAutomaticTasks = (
  tasks: readonly AutomaticTask[],
  dismissals: readonly AutomaticTaskDismissal[],
): AutomaticTask[] => {
  const hidden = new Map(dismissals.map((item) => [item.taskKey, item.taskRevision]));
  return tasks.filter((task) => hidden.get(task.key) !== automaticTaskRevision(task));
};

export interface AutomaticTaskClient {
  id: string;
  name: string;
  /** Relationship acceptance date (Istanbul date key) or null. */
  connectedOn: string | null;
}

export interface AutomaticTaskPlanDay {
  clientId: string;
  planDate: string;
  mealCount: number;
  eatenCount: number;
}

export interface AutomaticTaskChangeRequest {
  id: string;
  clientId: string;
  planDate: string;
  createdAt: string;
  slotLabel: string;
}

export interface AutomaticTaskMeasurement {
  clientId: string;
  measuredAt: string;
}

export interface AutomaticTaskInput {
  today: string;
  clients: readonly AutomaticTaskClient[];
  planDays: readonly AutomaticTaskPlanDay[];
  pendingRequests: readonly AutomaticTaskChangeRequest[];
  latestMeasurements: readonly AutomaticTaskMeasurement[];
}

/** Consecutive days without any marked meal that raise an inactivity task. */
export const INACTIVITY_DAYS = 3;
/** A client without a weight measurement for this many days gets a reminder. */
export const MEASUREMENT_DUE_DAYS = 30;
/** How far back weight measurements are read. */
export const MEASUREMENT_LOOKBACK_DAYS = 365;
/** How far back plan days are read; older plans count as "no plan". */
export const PLAN_LOOKBACK_DAYS = 90;
/** Relationship age before measurement / inactivity tasks apply. */
const SETTLING_DAYS = 3;

const daysBetween = (from: string, to: string): number => {
  const start = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((end - start) / 86_400_000);
};

const formatShortDate = (dateKey: string): string => new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
}).format(new Date(`${dateKey}T00:00:00Z`));

export const deriveAutomaticTasks = (input: AutomaticTaskInput): AutomaticTask[] => {
  const { today } = input;
  const tasks: AutomaticTask[] = [];
  const plannedDaysByClient = new Map<string, AutomaticTaskPlanDay[]>();
  for (const day of input.planDays) {
    if (day.mealCount <= 0) continue;
    const list = plannedDaysByClient.get(day.clientId) ?? [];
    list.push(day);
    plannedDaysByClient.set(day.clientId, list);
  }
  const measurementByClient = new Map(input.latestMeasurements.map((item) => [item.clientId, item.measuredAt]));
  const requestsByClient = new Map<string, AutomaticTaskChangeRequest[]>();
  for (const request of input.pendingRequests) {
    const list = requestsByClient.get(request.clientId) ?? [];
    list.push(request);
    requestsByClient.set(request.clientId, list);
  }

  for (const client of input.clients) {
    const days = (plannedDaysByClient.get(client.id) ?? []).sort((a, b) => a.planDate.localeCompare(b.planDate));
    const lastPlanDate = days.at(-1)?.planDate ?? null;
    const settled = client.connectedOn === null || daysBetween(client.connectedOn, today) >= SETTLING_DAYS;

    if (lastPlanDate === null) {
      tasks.push({
        key: `no_plan:${client.id}`,
        kind: 'no_plan',
        group: 'today',
        clientId: client.id,
        clientName: client.name,
        sinceDate: client.connectedOn,
        overdueDays: null,
        requestId: null,
        detail: client.connectedOn && daysBetween(client.connectedOn, today) < PLAN_LOOKBACK_DAYS
          ? `${formatShortDate(client.connectedOn)} tarihinde bağlandı`
          : `Son ${PLAN_LOOKBACK_DAYS} günde planlanmış öğün yok`,
      });
    } else if (lastPlanDate < today) {
      const overdueDays = daysBetween(lastPlanDate, today);
      tasks.push({
        key: `plan_expired:${client.id}`,
        kind: 'plan_expired',
        group: 'overdue',
        clientId: client.id,
        clientName: client.name,
        sinceDate: lastPlanDate,
        overdueDays,
        requestId: null,
        detail: `Planın son günü ${formatShortDate(lastPlanDate)}`,
      });
    }

    if (settled && lastPlanDate !== null) {
      const windowStart = addCalendarDays(today, -INACTIVITY_DAYS);
      const windowDays = days.filter((day) => day.planDate >= windowStart && day.planDate < today);
      const recentlyEaten = days.some((day) => day.planDate >= windowStart && day.planDate <= today && day.eatenCount > 0);
      if (windowDays.length === INACTIVITY_DAYS && !recentlyEaten) {
        const lastEaten = [...days].reverse().find((day) => day.eatenCount > 0)?.planDate ?? null;
        tasks.push({
          key: `meal_inactivity:${client.id}`,
          kind: 'meal_inactivity',
          group: 'today',
          clientId: client.id,
          clientName: client.name,
          sinceDate: lastEaten,
          overdueDays: null,
          requestId: null,
          detail: lastEaten ? `Son işaretleme ${formatShortDate(lastEaten)}` : 'Bu dönemde hiç öğün işaretlenmedi',
        });
      }
    }

    for (const request of requestsByClient.get(client.id) ?? []) {
      tasks.push({
        key: `meal_change_request:${request.id}`,
        kind: 'meal_change_request',
        group: 'today',
        clientId: client.id,
        clientName: client.name,
        sinceDate: request.createdAt.slice(0, 10),
        overdueDays: null,
        requestId: request.id,
        detail: `${formatShortDate(request.planDate)} · ${request.slotLabel}`,
      });
    }

    const lastMeasurement = measurementByClient.get(client.id) ?? null;
    if (settled && (lastMeasurement === null || daysBetween(lastMeasurement, today) >= MEASUREMENT_DUE_DAYS)) {
      tasks.push({
        key: `measurement_due:${client.id}`,
        kind: 'measurement_due',
        group: 'today',
        clientId: client.id,
        clientName: client.name,
        sinceDate: lastMeasurement,
        overdueDays: null,
        requestId: null,
        detail: lastMeasurement ? `Son ölçüm ${formatShortDate(lastMeasurement)}` : 'Son bir yılda kilo ölçümü yok',
      });
    }
  }

  const kindOrder: Record<AutomaticTaskKind, number> = {
    plan_expired: 0,
    meal_change_request: 1,
    meal_inactivity: 2,
    no_plan: 3,
    measurement_due: 4,
  };
  return tasks.sort((a, b) => (
    kindOrder[a.kind] - kindOrder[b.kind]
    || (b.overdueDays ?? 0) - (a.overdueDays ?? 0)
    || a.clientName.localeCompare(b.clientName, 'tr')
  ));
};

/** Sentence after the bold client name, e.g. "<b>Ayşe</b> için haftalık planı güncelle". */
export const AUTOMATIC_TASK_SUFFIX: Record<AutomaticTaskKind, string> = {
  no_plan: 'için beslenme planı yok',
  plan_expired: 'için haftalık planı güncelle',
  meal_inactivity: `${INACTIVITY_DAYS} gündür öğün işaretlemiyor`,
  meal_change_request: 'öğün değişikliği istedi',
  measurement_due: 'için yeni ölçüm al',
};
