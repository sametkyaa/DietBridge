import { supabase } from '../../../lib/supabaseClient';
import type { DietitianNote, DietitianNoteDraft, NoteClientOption } from '../types/note';
import { isNoteTimestamp, isNoteUuid, validateNoteDraft } from '../utils/noteContract';

export const NOTE_LOAD_ERROR = 'Notlar yüklenemedi. Lütfen tekrar deneyin.';
export const NOTE_SAVE_ERROR = 'Not kaydedilemedi. Lütfen tekrar deneyin.';
export const NOTE_DELETE_ERROR = 'Not silinemedi. Lütfen tekrar deneyin.';

interface NoteRow {
  id: string;
  dietitian_id: string;
  client_id: string | null;
  title: string | null;
  content: string | null;
  created_at: string;
  updated_at: string;
  client: { full_name: string | null } | Array<{ full_name: string | null }> | null;
}

interface NoteClientRelationshipRow {
  client: { id: string; full_name: string | null } | Array<{ id: string; full_name: string | null }> | null;
}

export class NoteServiceError extends Error {
  constructor(public readonly userMessage: string, public readonly cause?: unknown) {
    super(userMessage);
    this.name = 'NoteServiceError';
  }
}

const NOTE_SELECT = `id, dietitian_id, client_id, title, content, created_at, updated_at,
  client:client_id (full_name)`;

const requireDietitianId = async (message: string): Promise<string> => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !isNoteUuid(user?.id)) throw new NoteServiceError(message, error);
  return user.id;
};

const mapNote = (row: NoteRow, dietitianId: string): DietitianNote => {
  if (
    !isNoteUuid(row.id) || row.dietitian_id !== dietitianId
    || (row.client_id !== null && !isNoteUuid(row.client_id))
    || typeof row.title !== 'string' || !row.title.trim()
    || typeof row.content !== 'string' || !row.content.trim()
    || !isNoteTimestamp(row.created_at) || !isNoteTimestamp(row.updated_at)
  ) throw new NoteServiceError(NOTE_LOAD_ERROR);
  const client = Array.isArray(row.client) ? row.client[0] : row.client;
  return {
    id: row.id,
    dietitianId: row.dietitian_id,
    clientId: row.client_id,
    clientName: row.client_id === null ? null : client?.full_name?.trim() || null,
    title: row.title.trim(),
    content: row.content.trim(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const assertRelationship = async (dietitianId: string, clientId: string | null): Promise<void> => {
  if (clientId === null) return;
  const { data, error } = await supabase.from('dietitian_clients').select('id')
    .eq('dietitian_id', dietitianId).eq('client_id', clientId).eq('status', 'active').maybeSingle();
  if (error || !data) throw new NoteServiceError(NOTE_SAVE_ERROR, error);
};

const assertPersisted = (note: DietitianNote, draft: DietitianNoteDraft): void => {
  if (note.clientId !== draft.clientId || note.title !== draft.title || note.content !== draft.content) {
    throw new NoteServiceError(NOTE_SAVE_ERROR);
  }
};

export const fetchNotes = async (): Promise<DietitianNote[]> => {
  const dietitianId = await requireDietitianId(NOTE_LOAD_ERROR);
  const { data, error } = await supabase.from('dietitian_notes').select(NOTE_SELECT)
    .eq('dietitian_id', dietitianId).order('updated_at', { ascending: false }).order('id');
  if (error) throw new NoteServiceError(NOTE_LOAD_ERROR, error);
  try { return ((data ?? []) as unknown as NoteRow[]).map((row) => mapNote(row, dietitianId)); }
  catch (cause) { throw cause instanceof NoteServiceError ? cause : new NoteServiceError(NOTE_LOAD_ERROR, cause); }
};

export const fetchNoteClientOptions = async (): Promise<NoteClientOption[]> => {
  const dietitianId = await requireDietitianId(NOTE_LOAD_ERROR);
  const { data, error } = await supabase.from('dietitian_clients')
    .select('client:client_id (id, full_name)')
    .eq('dietitian_id', dietitianId).eq('status', 'active');
  if (error) throw new NoteServiceError(NOTE_LOAD_ERROR, error);
  const options: NoteClientOption[] = [];
  for (const row of (data ?? []) as unknown as NoteClientRelationshipRow[]) {
    const client = Array.isArray(row.client) ? row.client[0] : row.client;
    if (!client || !isNoteUuid(client.id)) throw new NoteServiceError(NOTE_LOAD_ERROR);
    options.push({ id: client.id, name: client.full_name?.trim() || 'İsimsiz Danışan' });
  }
  return options.sort((left, right) => left.name.localeCompare(right.name, 'tr-TR'));
};

export const createNote = async (draft: DietitianNoteDraft): Promise<DietitianNote> => {
  const validation = validateNoteDraft(draft);
  if (validation.success === false) throw new NoteServiceError(validation.message);
  const dietitianId = await requireDietitianId(NOTE_SAVE_ERROR);
  await assertRelationship(dietitianId, validation.value.clientId);
  const { data, error } = await supabase.from('dietitian_notes').insert({
    dietitian_id: dietitianId, client_id: validation.value.clientId,
    title: validation.value.title, content: validation.value.content,
  }).select(NOTE_SELECT).maybeSingle();
  if (error || !data) throw new NoteServiceError(NOTE_SAVE_ERROR, error);
  const note = mapNote(data as unknown as NoteRow, dietitianId);
  assertPersisted(note, validation.value);
  return note;
};

export const updateNote = async (id: string, draft: DietitianNoteDraft): Promise<DietitianNote> => {
  if (!isNoteUuid(id)) throw new NoteServiceError(NOTE_SAVE_ERROR);
  const validation = validateNoteDraft(draft);
  if (validation.success === false) throw new NoteServiceError(validation.message);
  const dietitianId = await requireDietitianId(NOTE_SAVE_ERROR);
  await assertRelationship(dietitianId, validation.value.clientId);
  const { data, error } = await supabase.from('dietitian_notes').update({
    client_id: validation.value.clientId, title: validation.value.title, content: validation.value.content,
  }).eq('id', id).eq('dietitian_id', dietitianId).select(NOTE_SELECT).maybeSingle();
  if (error || !data) throw new NoteServiceError(NOTE_SAVE_ERROR, error);
  const note = mapNote(data as unknown as NoteRow, dietitianId);
  if (note.id !== id) throw new NoteServiceError(NOTE_SAVE_ERROR);
  assertPersisted(note, validation.value);
  return note;
};

export const deleteNote = async (id: string): Promise<void> => {
  if (!isNoteUuid(id)) throw new NoteServiceError(NOTE_DELETE_ERROR);
  const dietitianId = await requireDietitianId(NOTE_DELETE_ERROR);
  const { data, error } = await supabase.from('dietitian_notes').delete().eq('id', id)
    .eq('dietitian_id', dietitianId).select('id, dietitian_id').maybeSingle();
  const deleted = data as { id: string; dietitian_id: string } | null;
  if (error || deleted?.id !== id || deleted.dietitian_id !== dietitianId) {
    throw new NoteServiceError(NOTE_DELETE_ERROR, error);
  }
};
