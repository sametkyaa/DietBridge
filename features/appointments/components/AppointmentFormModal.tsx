import { useRef, type FormEvent } from 'react';
import type { Appointment, Client } from '../../../shared/types';
import { Button, Callout, Input, Modal, RadioCards, Select } from '../../../shared/ui';
import { APPOINTMENT_SLOT_CONFLICT_ERROR } from '../services/appointmentService';
import {
  APPOINTMENT_DURATIONS,
  APPOINTMENT_TITLE_MAX_LENGTH,
  APPOINTMENT_TYPES,
  type AppointmentDraft,
} from '../utils/appointmentContract';
import { APPOINTMENT_TYPE_META } from './appointmentPresentation';

export interface AppointmentFormModalProps {
  open: boolean;
  isEditing: boolean;
  draft: AppointmentDraft;
  onDraftChange: (draft: AppointmentDraft) => void;
  clients: readonly Client[];
  clientsStatus: 'loading' | 'success' | 'error';
  mutationError: string | null;
  bookingCheckError: string | null;
  slotConflict: boolean;
  /** Same client already has this many upcoming appointments in that week. */
  sameWeekCount: number | null;
  checking: boolean;
  saving: boolean;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}

/** Create / edit appointment; the same-week notice turns the action into an explicit confirmation. */
export const AppointmentFormModal = ({
  open,
  isEditing,
  draft,
  onDraftChange,
  clients,
  clientsStatus,
  mutationError,
  bookingCheckError,
  slotConflict,
  sameWeekCount,
  checking,
  saving,
  onSubmit,
  onClose,
}: AppointmentFormModalProps) => {
  const clientRef = useRef<HTMLSelectElement>(null);
  const busy = checking || saving;
  const formId = 'appointment-form';
  const noClients = clientsStatus === 'success' && clients.length === 0;
  const confirmSameWeek = sameWeekCount !== null && sameWeekCount > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      initialFocusRef={clientRef}
      title={isEditing ? 'Randevuyu düzenle' : 'Yeni randevu'}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={busy}
            disabled={busy || clientsStatus !== 'success' || noClients}
          >
            {checking ? 'Kontrol ediliyor' : confirmSameWeek ? 'Yine de kaydet' : isEditing ? 'Randevuyu güncelle' : 'Randevu oluştur'}
          </Button>
        </>
      )}
    >
      <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
        {mutationError && <Callout tone="bad" role="alert">{mutationError}</Callout>}
        {slotConflict && <Callout tone="warn" role="alert">{APPOINTMENT_SLOT_CONFLICT_ERROR}</Callout>}
        {bookingCheckError && <Callout tone="bad" role="alert">{bookingCheckError}</Callout>}
        <Select
          ref={clientRef}
          id="appointment-client"
          label="Danışan"
          required
          value={draft.clientId}
          onChange={(event) => onDraftChange({ ...draft, clientId: event.target.value })}
          disabled={clientsStatus !== 'success'}
          placeholder="Danışan seçin"
          options={clients.map((client) => ({ value: client.id, label: client.name }))}
          hint={clientsStatus === 'loading' ? 'Aktif danışanlar yükleniyor…' : undefined}
          error={clientsStatus === 'error'
            ? 'Danışanlar yüklenemedi.'
            : noClients ? 'Randevu oluşturulabilecek aktif danışan yok.' : undefined}
        />
        <RadioCards<Appointment['type']>
          legend="Görüşme türü"
          name="appointment-type"
          value={draft.type}
          onChange={(type) => onDraftChange({ ...draft, type })}
          options={APPOINTMENT_TYPES.map((type) => ({
            value: type,
            label: APPOINTMENT_TYPE_META[type].label,
            icon: APPOINTMENT_TYPE_META[type].icon,
          }))}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.3fr_1fr_1fr]">
          <Input
            id="appointment-date"
            label="Tarih"
            type="date"
            required
            value={draft.date}
            onChange={(event) => onDraftChange({ ...draft, date: event.target.value })}
          />
          <Input
            id="appointment-time"
            label="Saat"
            type="time"
            required
            value={draft.time}
            onChange={(event) => onDraftChange({ ...draft, time: event.target.value })}
          />
          <Select
            id="appointment-duration"
            label="Süre"
            value={String(draft.duration)}
            onChange={(event) => onDraftChange({ ...draft, duration: Number(event.target.value) })}
            options={APPOINTMENT_DURATIONS.map((duration) => ({
              value: String(duration),
              label: duration === 60 ? '1 saat' : `${duration} dk`,
            }))}
          />
        </div>
        <Input
          id="appointment-title"
          label="Başlık"
          required
          maxLength={APPOINTMENT_TITLE_MAX_LENGTH}
          placeholder="Örn: Kontrol görüşmesi"
          value={draft.title}
          onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
        />
        {confirmSameWeek && (
          <Callout tone="info" role="status">
            Bu danışanın bu hafta {sameWeekCount} randevusu daha var. Kaydetmek için tekrar onaylayın.
          </Callout>
        )}
      </form>
    </Modal>
  );
};
