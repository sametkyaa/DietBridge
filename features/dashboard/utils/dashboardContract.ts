import type { Appointment, Client } from '../../../shared/types';
import type { DailyTaskGroups } from '../types/dailyTask';

export interface DashboardSummaryInput {
  clients: readonly Client[];
  todayAppointments: readonly Appointment[];
  tasks: DailyTaskGroups;
}

export interface DashboardSummary {
  activeClientCount: number;
  pendingClientCount: number;
  todayAppointmentCount: number;
  overdueTaskCount: number;
  todayTaskCount: number;
}

export const summarizeDashboard = ({
  clients,
  todayAppointments,
  tasks,
}: DashboardSummaryInput): DashboardSummary => ({
  activeClientCount: clients.filter((client) => client.status === 'Aktif').length,
  pendingClientCount: clients.filter((client) => client.status === 'Onay Bekliyor').length,
  todayAppointmentCount: todayAppointments.filter((appointment) => appointment.status !== 'cancelled').length,
  overdueTaskCount: tasks.overdue.length,
  todayTaskCount: tasks.today.length,
});

export const getDashboardFocusMessage = (summary: DashboardSummary): string => {
  if (summary.overdueTaskCount > 0) {
    return `${summary.overdueTaskCount} geciken görevi önce ele alın.`;
  }
  if (summary.todayTaskCount > 0) {
    return `Bugün için ${summary.todayTaskCount} bekleyen göreviniz var.`;
  }
  if (summary.todayAppointmentCount > 0) {
    return `Bugün ${summary.todayAppointmentCount} randevunuz var.`;
  }
  return 'Bugün için bekleyen görev veya randevu bulunmuyor.';
};
