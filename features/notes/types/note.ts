export interface DietitianNote {
  id: string;
  dietitianId: string;
  clientId: string | null;
  clientName: string | null;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface DietitianNoteDraft {
  clientId: string | null;
  title: string;
  content: string;
}

export interface NoteClientOption {
  id: string;
  name: string;
}

export type NoteViewState =
  | { status: 'loading' }
  | { status: 'success'; notes: DietitianNote[] }
  | { status: 'error'; message: string };

export type NoteMutationResult =
  | { success: false }
  | { success: true; refreshSucceeded: boolean; noteId?: string };
