import { Fragment } from 'react';
import type { Appointment } from '../../../shared/types';
import { cx } from '../../../shared/ui';
import {
  CALENDAR_WEEKDAY_LABELS,
  formatDateKey,
  type CalendarDay,
} from '../utils/appointmentContract';
import { APPOINTMENT_TYPE_META } from './appointmentPresentation';

export interface AppointmentMonthGridProps {
  days: readonly CalendarDay[];
  appointmentsByDate: ReadonlyMap<string, Appointment[]>;
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

/** Month grid; each day shows up to two appointment chips and a "+n daha" count. */
export const AppointmentMonthGrid = ({ days, appointmentsByDate, today, selectedDate, onSelectDate }: AppointmentMonthGridProps) => (
  <div className="grid grid-cols-7" role="grid" aria-label="Aylık randevu takvimi">
    {CALENDAR_WEEKDAY_LABELS.map((weekday) => (
      <div key={weekday} role="columnheader" className="border-b border-line px-3 py-2.5 text-center text-12.5 font-semibold text-ink-3">
        {weekday}
      </div>
    ))}
    {days.map((day, index) => {
      const dayAppointments = (appointmentsByDate.get(day.date) ?? []).filter((appointment) => appointment.status !== 'cancelled');
      const isToday = day.date === today;
      const isSelected = day.date === selectedDate;
      return (
        <Fragment key={day.date}>
          <button
            type="button"
            role="gridcell"
            aria-selected={isSelected}
            aria-label={`${formatDateKey(day.date, { day: 'numeric', month: 'long', weekday: 'long' })}, ${dayAppointments.length} randevu`}
            onClick={() => onSelectDate(day.date)}
            className={cx(
              'flex min-h-[72px] flex-col gap-1 border-b border-line px-1.5 py-1.5 text-left text-13 transition-colors sm:min-h-[112px] sm:px-2.5 sm:py-2',
              (index + 1) % 7 !== 0 && 'border-r',
              isToday && 'bg-[#F2F8F4] shadow-[inset_0_0_0_2px_rgb(var(--db-brand))]',
              isSelected && !isToday && 'bg-surface-alt shadow-[inset_0_0_0_2px_rgb(var(--db-line-strong))]',
              'hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
            )}
          >
            <span className={cx('text-13 font-semibold', !day.isCurrentMonth && 'text-line-strong', isToday && 'text-brand')}>
              {day.day}
            </span>
            {dayAppointments.slice(0, 2).map((appointment) => {
              const meta = APPOINTMENT_TYPE_META[appointment.type];
              return (
                <span
                  key={appointment.id}
                  className={cx(
                    'hidden items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap rounded-tag px-[7px] py-[3px] text-12 font-semibold sm:flex',
                    meta.chip,
                    appointment.status === 'completed' && 'opacity-60',
                  )}
                >
                  <i aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  <span className="font-medium tabular-nums opacity-75">{appointment.time}</span>
                  <span className="truncate">{appointment.clientName.split(' ')[0]}</span>
                </span>
              );
            })}
            {dayAppointments.length > 2 && (
              <span className="hidden text-12 font-semibold text-brand sm:block">+{dayAppointments.length - 2} daha</span>
            )}
            {dayAppointments.length > 0 && (
              <span className="mt-auto inline-flex items-center gap-1 text-11 font-semibold text-brand sm:hidden">
                <i aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand" />
                {dayAppointments.length}
              </span>
            )}
          </button>
        </Fragment>
      );
    })}
  </div>
);
