import type { Appointment } from '../../../shared/types';
import type { DailyTaskGroups } from '../types/dailyTask';

export interface DashboardSummaryInput {
  todayAppointments: readonly Appointment[];
  tasks: DailyTaskGroups;
}

export interface DashboardSummary {
  todayAppointmentCount: number;
  todayTaskCount: number;
}

export const summarizeDashboard = ({
  todayAppointments,
  tasks,
}: DashboardSummaryInput): DashboardSummary => ({
  todayAppointmentCount: todayAppointments.filter((appointment) => appointment.status !== 'cancelled').length,
  todayTaskCount: tasks.today.length,
});

export const getDashboardFocusMessage = (summary: DashboardSummary): string => {
  const hasTasks = summary.todayTaskCount > 0;
  const hasAppointments = summary.todayAppointmentCount > 0;

  if (hasTasks && hasAppointments) {
    return `Bugün ${summary.todayTaskCount} bekleyen göreviniz ve ${summary.todayAppointmentCount} randevunuz var.`;
  }
  if (hasTasks) {
    return `Bugün ${summary.todayTaskCount} bekleyen göreviniz var, randevunuz yok.`;
  }
  if (hasAppointments) {
    return `Bugün bekleyen göreviniz yok, ${summary.todayAppointmentCount} randevunuz var.`;
  }
  return 'Bugün bekleyen göreviniz veya randevunuz yok.';
};
