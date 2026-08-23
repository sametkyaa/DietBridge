import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/context/AuthContext';
import { createNote, deleteNote, fetchNotes, NOTE_DELETE_ERROR, NOTE_LOAD_ERROR, NOTE_SAVE_ERROR, NoteServiceError, updateNote } from '../services/noteService';
import type { DietitianNoteDraft, NoteMutationResult, NoteViewState } from '../types/note';

export const useNotes = () => {
  const { accessState, user } = useAuth();
  const [viewState, setViewState] = useState<NoteViewState>({ status: 'loading' });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const pendingRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const allowed = accessState.status === 'allowed' && Boolean(user?.id);

  const refreshNotes = useCallback(async () => {
    if (!allowed) { setViewState({ status: 'loading' }); return false; }
    const requestId = ++requestVersion.current;
    setViewState({ status: 'loading' });
    try {
      const notes = await fetchNotes();
      if (!mounted.current || requestId !== requestVersion.current) return false;
      setViewState({ status: 'success', notes }); return true;
    } catch (error) {
      if (!mounted.current || requestId !== requestVersion.current) return false;
      setViewState({ status: 'error', message: error instanceof NoteServiceError ? error.userMessage : NOTE_LOAD_ERROR });
      return false;
    }
  }, [allowed]);

  useEffect(() => { mounted.current = true; void refreshNotes(); return () => { mounted.current = false; requestVersion.current += 1; }; }, [refreshNotes, user?.id]);

  const mutate = useCallback(async (key: string, action: () => Promise<{ id?: string } | void>, fallback: string): Promise<NoteMutationResult> => {
    if (!allowed || pendingRef.current) return { success: false };
    pendingRef.current = key; setPendingAction(key); setMutationError(null);
    try {
      const result = await action();
      const refreshSucceeded = await refreshNotes();
      return { success: true, refreshSucceeded, noteId: result && 'id' in result ? result.id : undefined };
    } catch (error) {
      setMutationError(error instanceof NoteServiceError ? error.userMessage : fallback);
      return { success: false };
    } finally { pendingRef.current = null; if (mounted.current) setPendingAction(null); }
  }, [allowed, refreshNotes]);

  return {
    viewState, notes: viewState.status === 'success' ? viewState.notes : [], mutationError, pendingAction, refreshNotes,
    createNote: (draft: DietitianNoteDraft) => mutate('create', () => createNote(draft), NOTE_SAVE_ERROR),
    updateNote: (id: string, draft: DietitianNoteDraft) => mutate(`update:${id}`, () => updateNote(id, draft), NOTE_SAVE_ERROR),
    deleteNote: (id: string) => mutate(`delete:${id}`, () => deleteNote(id), NOTE_DELETE_ERROR),
    clearMutationError: () => setMutationError(null),
  };
};
