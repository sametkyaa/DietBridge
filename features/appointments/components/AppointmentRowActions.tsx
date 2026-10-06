import type { Appointment } from '../../../shared/types';
import { IconButton } from '../../../shared/ui';

export interface AppointmentRowActionsProps {
  appointment: Appointment;
  disabled: boolean;
  onEdit: (appointment: Appointment) => void;
  onComplete: (appointment: Appointment) => void;
  onCancel: (appointment: Appointment) => void;
  onDelete: (appointment: Appointment) => void;
}

/** Status actions only for upcoming appointments; delete stays available. */
export const AppointmentRowActions = ({ appointment, disabled, onEdit, onComplete, onCancel, onDelete }: AppointmentRowActionsProps) => {
  const label = `${appointment.time} ${appointment.clientName}`;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {appointment.status === 'upcoming' && (
        <>
          <IconButton icon="check-circle" variant="bare" size="sm" label={`${label} randevusunu tamamlandı olarak işaretle`} disabled={disabled} onClick={() => onComplete(appointment)} />
          <IconButton icon="calendar-x" variant="bare" size="sm" label={`${label} randevusunu iptal et`} disabled={disabled} onClick={() => onCancel(appointment)} />
          <IconButton icon="pencil-simple" variant="bare" size="sm" label={`${label} randevusunu düzenle`} disabled={disabled} onClick={() => onEdit(appointment)} />
        </>
      )}
      <IconButton icon="x" variant="bare" size="sm" label={`${label} randevusunu sil`} disabled={disabled} onClick={() => onDelete(appointment)} />
    </div>
  );
};
