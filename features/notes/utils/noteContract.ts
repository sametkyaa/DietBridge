import type { DietitianNoteDraft } from '../types/note';

export const NOTE_TITLE_MAX_LENGTH = 160;
export const NOTE_CONTENT_MAX_LENGTH = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isNoteUuid = (value: unknown): value is string => (
  typeof value === 'string' && UUID_PATTERN.test(value)
);

export const isNoteTimestamp = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
);

export type NoteValidationResult =
  | { success: true; value: DietitianNoteDraft }
  | { success: false; message: string };

export const validateNoteDraft = (draft: DietitianNoteDraft): NoteValidationResult => {
  if (draft.clientId !== null && !isNoteUuid(draft.clientId)) {
    return { success: false, message: 'Geçerli ve aktif bir danışan seçin.' };
  }

  const title = draft.title.trim();
  const content = draft.content.trim();
  if (!title) return { success: false, message: 'Not başlığı zorunludur.' };
  if (title.length > NOTE_TITLE_MAX_LENGTH) {
    return { success: false, message: `Not başlığı en fazla ${NOTE_TITLE_MAX_LENGTH} karakter olabilir.` };
  }
  if (!content) return { success: false, message: 'Not içeriği zorunludur.' };
  if (content.length > NOTE_CONTENT_MAX_LENGTH) {
    return { success: false, message: `Not içeriği en fazla ${NOTE_CONTENT_MAX_LENGTH} karakter olabilir.` };
  }

  return { success: true, value: { clientId: draft.clientId, title, content } };
};

export const formatNoteDate = (timestamp: string): string => new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(timestamp));
