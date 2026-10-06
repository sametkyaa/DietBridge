import { useRef, type FormEvent } from 'react';
import { Button, Callout, Input, Modal, Select, Textarea } from '../../../shared/ui';
import type { Client } from '../../../shared/types';
import type { DailyTaskDraft } from '../types/dailyTask';
import { DAILY_TASK_DESCRIPTION_MAX_LENGTH, DAILY_TASK_TITLE_MAX_LENGTH } from '../utils/dailyTaskContract';

export interface DailyTaskFormModalProps {
  open: boolean;
  isEditing: boolean;
  draft: DailyTaskDraft;
  onDraftChange: (draft: DailyTaskDraft) => void;
  activeClients: readonly Client[];
  clientsLoading: boolean;
  clientsError: boolean;
  mutationError: string | null;
  saving: boolean;
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Düşük' },
  { value: 'medium', label: 'Orta' },
  { value: 'high', label: 'Yüksek' },
] as const;

/** Create / edit form for a persistent daily_tasks row. */
export const DailyTaskFormModal = ({
  open,
  isEditing,
  draft,
  onDraftChange,
  activeClients,
  clientsLoading,
  clientsError,
  mutationError,
  saving,
  busy,
  onSubmit,
  onClose,
}: DailyTaskFormModalProps) => {
  const titleRef = useRef<HTMLInputElement>(null);
  const formId = 'daily-task-form';
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      initialFocusRef={titleRef}
      title={isEditing ? 'Görevi düzenle' : 'Yeni görev'}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={busy}>
            {isEditing ? 'Güncelle' : 'Görevi ekle'}
          </Button>
        </>
      )}
    >
      <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
        {mutationError && <Callout tone="bad" role="alert">{mutationError}</Callout>}
        <Input
          ref={titleRef}
          id="daily-task-title"
          label="Görev başlığı"
          required
          maxLength={DAILY_TASK_TITLE_MAX_LENGTH}
          placeholder="Örn: Haftalık raporu hazırla"
          value={draft.title}
          onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
        />
        <Select
          id="daily-task-client"
          label="Danışan (isteğe bağlı)"
          value={draft.clientId ?? ''}
          onChange={(event) => onDraftChange({ ...draft, clientId: event.target.value || null })}
          disabled={clientsLoading || clientsError}
          options={[
            { value: '', label: 'Genel görev' },
            ...activeClients.map((client) => ({ value: client.id, label: client.name })),
          ]}
          hint={clientsLoading ? 'Aktif danışanlar yükleniyor…' : undefined}
          error={clientsError ? 'Danışanlar yüklenemedi; yalnız genel görev kaydedilebilir.' : undefined}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            id="daily-task-date"
            label="Tarih"
            type="date"
            required
            value={draft.dueDate}
            onChange={(event) => onDraftChange({ ...draft, dueDate: event.target.value })}
          />
          <Input
            id="daily-task-time"
            label="Saat (isteğe bağlı)"
            type="time"
            value={draft.dueTime ?? ''}
            onChange={(event) => onDraftChange({ ...draft, dueTime: event.target.value || null })}
          />
          <Select
            id="daily-task-priority"
            label="Öncelik"
            value={draft.priority}
            onChange={(event) => onDraftChange({ ...draft, priority: event.target.value as DailyTaskDraft['priority'] })}
            options={PRIORITY_OPTIONS}
          />
        </div>
        <Textarea
          id="daily-task-description"
          label="Açıklama (isteğe bağlı)"
          rows={3}
          maxLength={DAILY_TASK_DESCRIPTION_MAX_LENGTH}
          value={draft.description ?? ''}
          onChange={(event) => onDraftChange({ ...draft, description: event.target.value || null })}
        />
      </form>
    </Modal>
  );
};
