import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNotes } from '../hooks/useNotes';
import { fetchNoteClientOptions, NoteServiceError } from '../services/noteService';
import type { DietitianNote, DietitianNoteDraft, NoteClientOption } from '../types/note';
import { formatNoteDate, NOTE_CONTENT_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH, validateNoteDraft } from '../utils/noteContract';
import { stripNoteFormatting } from '../utils/noteFormat';
import { NoteContent } from '../components/NoteContent';
import {
  Badge,
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  PageContainer,
  PageHeader,
  SearchInput,
  SegmentedControl,
  cx,
} from '../../../shared/ui';

const EMPTY_DRAFT: DietitianNoteDraft = { clientId: null, title: '', content: '' };
type NoteScope = 'all' | 'client' | 'general';

const NotesPage = () => {
  const { viewState, notes, mutationError, pendingAction, refreshNotes, createNote, updateNote, deleteNote, clearMutationError } = useNotes();
  const [clients, setClients] = useState<NoteClientOption[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<NoteScope>('all');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DietitianNoteDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<DietitianNote | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const selected = notes.find((note) => note.id === selectedId) ?? null;
  const busy = pendingAction !== null;

  useEffect(() => { void (async () => {
    try { setClients(await fetchNoteClientOptions()); }
    catch (error) { setClientError(error instanceof NoteServiceError ? error.userMessage : 'Danışanlar yüklenemedi.'); }
  })(); }, []);
  useEffect(() => { if (selectedId && !notes.some((note) => note.id === selectedId)) setSelectedId(null); }, [notes, selectedId]);

  const counts = useMemo(() => ({
    all: notes.length,
    client: notes.filter((note) => note.clientId !== null).length,
    general: notes.filter((note) => note.clientId === null).length,
  }), [notes]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    return notes
      .filter((note) => (scope === 'all' ? true : scope === 'client' ? note.clientId !== null : note.clientId === null))
      .filter((note) => !normalized || [note.title, note.content, note.clientName ?? ''].some((value) => value.toLocaleLowerCase('tr-TR').includes(normalized)));
  }, [notes, query, scope]);

  const openCreate = () => { clearMutationError(); setSelectedId(null); setDraft(EMPTY_DRAFT); setFormError(null); setEditing(true); };
  const openEdit = (note: DietitianNote) => { clearMutationError(); setSelectedId(note.id); setDraft({ clientId: note.clientId, title: note.title, content: note.content }); setFormError(null); setEditing(true); };
  const submit = async () => {
    const validation = validateNoteDraft(draft);
    if (validation.success === false) { setFormError(validation.message); return; }
    const result = selected ? await updateNote(selected.id, validation.value) : await createNote(validation.value);
    if (result.success) { setEditing(false); setSelectedId(result.noteId ?? selected?.id ?? null); }
  };
  const remove = async (note: DietitianNote) => {
    // Deleting requires the explicit ConfirmDialog step (no window.confirm).
    const result = await deleteNote(note.id);
    if (result.success) { setSelectedId(null); setEditing(false); setNoteToDelete(null); }
  };

  /** Wraps the selection (or inserts a marker) with the supported plain-text syntax. */
  const applyFormat = (kind: 'bold' | 'bullet' | 'number') => {
    const textarea = contentRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd, value } = textarea;
    let next = value;
    let caret = selectionEnd;
    if (kind === 'bold') {
      const selectedText = value.slice(selectionStart, selectionEnd) || 'kalın metin';
      next = `${value.slice(0, selectionStart)}**${selectedText}**${value.slice(selectionEnd)}`;
      caret = selectionStart + selectedText.length + 4;
    } else {
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const marker = kind === 'bullet' ? '- ' : '1. ';
      next = `${value.slice(0, lineStart)}${marker}${value.slice(lineStart)}`;
      caret = selectionEnd + marker.length;
    }
    if (next.length > NOTE_CONTENT_MAX_LENGTH) return;
    setDraft((current) => ({ ...current, content: next }));
    window.requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(caret, caret); });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Notlar"
        description="Özel notlarınızı ve danışan bağlamınızı güvenle yönetin. Notlar yalnız size görünür."
        actions={<Button variant="primary" leftIcon="plus" onClick={openCreate} disabled={busy}>Yeni Not</Button>}
      />
      {(mutationError || clientError) && <Callout tone="bad" role="alert" className="mb-4">{mutationError || clientError}</Callout>}
      <div className="grid min-h-[640px] overflow-hidden rounded-card border border-line bg-surface shadow-card lg:grid-cols-[360px_1fr]">
        <aside className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r">
          <div className="flex flex-col gap-3 border-b border-line p-4">
            <SearchInput label="Notlarda ara" placeholder="Notlarda ara..." value={query} onChange={(e) => setQuery(e.target.value)} />
            <SegmentedControl<NoteScope>
              ariaLabel="Not türü"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'Tümü', count: counts.all },
                { value: 'client', label: 'Danışan', count: counts.client },
                { value: 'general', label: 'Genel', count: counts.general },
              ]}
            />
          </div>
          <div className="max-h-[360px] min-h-0 flex-1 overflow-y-auto p-3 lg:max-h-none">
            {viewState.status === 'loading' && <LoadingState label="Notlar yükleniyor..." className="py-8" />}
            {viewState.status === 'error' && <ErrorState compact description={viewState.message} onRetry={() => void refreshNotes()} retryLabel="Tekrar dene" />}
            {viewState.status === 'success' && filtered.length === 0 && (
              <EmptyState
                compact
                icon="note-pencil"
                title={query ? 'Aramanızla eşleşen not yok.' : scope === 'client' ? 'Danışana bağlı not yok.' : scope === 'general' ? 'Genel not yok.' : 'Henüz not yok.'}
                action={!query ? <Button variant="ghost" size="sm" onClick={openCreate}>İlk notu oluştur</Button> : undefined}
              />
            )}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {filtered.map((note) => (
                <Fragment key={note.id}>
                  <li>
                    <button
                      type="button"
                      onClick={() => { setSelectedId(note.id); setEditing(false); }}
                      aria-current={selectedId === note.id ? 'true' : undefined}
                      className={cx('w-full rounded-db border p-3.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand', selectedId === note.id ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-hover')}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-1 font-semibold text-ink">{note.title}</span>
                        <time className="shrink-0 text-12 text-ink-3" dateTime={note.updatedAt}>{formatNoteDate(note.updatedAt)}</time>
                      </div>
                      <p className="m-0 mt-1.5 line-clamp-2 text-13 text-ink-2">{stripNoteFormatting(note.content)}</p>
                      <div className="mt-2">
                        {note.clientId ? <Badge tone="brand" size="sm" icon="user">{note.clientName || 'Danışan'}</Badge> : <Badge size="sm">Genel not</Badge>}
                      </div>
                    </button>
                  </li>
                </Fragment>
              ))}
            </ul>
          </div>
        </aside>
        <main className="p-5 sm:p-8">
          {editing ? (
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mx-auto flex max-w-3xl flex-col gap-4">
              <h2 className="m-0 text-20 font-bold text-ink">{selected ? 'Notu Düzenle' : 'Yeni Not'}</h2>
              <label className="flex flex-col gap-1.5 text-13 font-semibold text-ink">Danışan (isteğe bağlı)
                <select value={draft.clientId ?? ''} onChange={(e) => setDraft((value) => ({ ...value, clientId: e.target.value || null }))} className="h-[42px] w-full rounded-control border border-line-strong bg-surface px-3 text-14 font-normal focus:border-brand focus:outline-none focus:shadow-focus">
                  <option value="">Genel not</option>
                  {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-13 font-semibold text-ink">Başlık
                <input autoFocus maxLength={NOTE_TITLE_MAX_LENGTH} value={draft.title} onChange={(e) => setDraft((value) => ({ ...value, title: e.target.value }))} className="h-[42px] w-full rounded-control border border-line-strong bg-surface px-3 text-14 font-normal focus:border-brand focus:outline-none focus:shadow-focus" />
              </label>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="note-content" className="text-13 font-semibold text-ink">İçerik</label>
                  <div className="flex gap-1" role="toolbar" aria-label="Biçimlendirme">
                    <Button type="button" variant="ghost" size="sm" onClick={() => applyFormat('bold')} aria-label="Kalın">
                      <b>K</b>
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => applyFormat('bullet')} aria-label="Madde işaretli liste">• Liste</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => applyFormat('number')} aria-label="Numaralı liste">1. Liste</Button>
                  </div>
                </div>
                <textarea id="note-content" ref={contentRef} rows={14} maxLength={NOTE_CONTENT_MAX_LENGTH} value={draft.content} onChange={(e) => setDraft((value) => ({ ...value, content: e.target.value }))} className="w-full rounded-control border border-line-strong bg-surface p-3 text-14 leading-relaxed focus:border-brand focus:outline-none focus:shadow-focus" />
                <p className="m-0 text-12 text-ink-3">**kalın**, “- ” madde ve “1. ” numaralı satırlar desteklenir. HTML yazılırsa düz metin olarak gösterilir. {draft.content.length}/{NOTE_CONTENT_MAX_LENGTH}</p>
              </div>
              {formError && <Callout tone="bad" role="alert">{formError}</Callout>}
              <div className="flex justify-end gap-2.5">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Vazgeç</Button>
                <Button type="submit" variant="primary" loading={busy}>{busy ? 'Kaydediliyor...' : 'Kaydet'}</Button>
              </div>
            </form>
          ) : selected ? (
            <article className="mx-auto max-w-3xl">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="m-0 break-words text-26 font-bold text-ink">{selected.title}</h2>
                  <p className="m-0 mt-2 flex flex-wrap items-center gap-2 text-13 text-ink-2">
                    {selected.clientId ? <Badge tone="brand" size="sm" icon="user">{selected.clientName || 'Danışan'}</Badge> : <Badge size="sm">Genel not</Badge>}
                    <span>Son düzenleme {formatNoteDate(selected.updatedAt)}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" leftIcon="pencil-simple" onClick={() => openEdit(selected)}>Düzenle</Button>
                  <Button variant="danger" leftIcon="x" onClick={() => setNoteToDelete(selected)} disabled={busy}>Sil</Button>
                </div>
              </div>
              <div className="rounded-card bg-sunk p-6">
                <NoteContent content={selected.content} />
              </div>
            </article>
          ) : (
            <div className="flex min-h-[500px] flex-col items-center justify-center text-center text-ink-2">
              <Icon name="note-pencil" size={48} className="mb-4 text-ink-3" />
              <h2 className="m-0 text-17 font-semibold text-ink">Görüntülemek için bir not seçin</h2>
              <p className="m-0 mt-1 text-13.5">Ya da yeni bir kalıcı not oluşturun.</p>
            </div>
          )}
        </main>
      </div>
      <ConfirmDialog
        open={noteToDelete !== null}
        title="Not silinsin mi?"
        description={noteToDelete ? `“${noteToDelete.title}” notu kalıcı olarak silinecek.` : undefined}
        confirmLabel="Notu sil"
        tone="danger"
        busy={busy}
        onConfirm={() => { if (noteToDelete) void remove(noteToDelete); }}
        onCancel={() => setNoteToDelete(null)}
      />
    </PageContainer>
  );
};

export default NotesPage;
