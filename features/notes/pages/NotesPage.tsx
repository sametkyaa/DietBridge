import { useEffect, useMemo, useState } from 'react';
import { FileText, Pencil, Plus, RefreshCw, Search, Trash2, User } from 'lucide-react';
import { useNotes } from '../hooks/useNotes';
import { fetchNoteClientOptions, NoteServiceError } from '../services/noteService';
import type { DietitianNote, DietitianNoteDraft, NoteClientOption } from '../types/note';
import { formatNoteDate, NOTE_CONTENT_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH, validateNoteDraft } from '../utils/noteContract';

const EMPTY_DRAFT: DietitianNoteDraft = { clientId: null, title: '', content: '' };

const NotesPage = () => {
  const { viewState, notes, mutationError, pendingAction, refreshNotes, createNote, updateNote, deleteNote, clearMutationError } = useNotes();
  const [clients, setClients] = useState<NoteClientOption[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DietitianNoteDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const selected = notes.find((note) => note.id === selectedId) ?? null;
  const busy = pendingAction !== null;

  useEffect(() => { void (async () => {
    try { setClients(await fetchNoteClientOptions()); }
    catch (error) { setClientError(error instanceof NoteServiceError ? error.userMessage : 'Danışanlar yüklenemedi.'); }
  })(); }, []);
  useEffect(() => { if (selectedId && !notes.some((note) => note.id === selectedId)) setSelectedId(null); }, [notes, selectedId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    if (!normalized) return notes;
    return notes.filter((note) => [note.title, note.content, note.clientName ?? ''].some((value) => value.toLocaleLowerCase('tr-TR').includes(normalized)));
  }, [notes, query]);

  const openCreate = () => { clearMutationError(); setSelectedId(null); setDraft(EMPTY_DRAFT); setFormError(null); setEditing(true); };
  const openEdit = (note: DietitianNote) => { clearMutationError(); setSelectedId(note.id); setDraft({ clientId: note.clientId, title: note.title, content: note.content }); setFormError(null); setEditing(true); };
  const submit = async () => {
    const validation = validateNoteDraft(draft);
    if (validation.success === false) { setFormError(validation.message); return; }
    const result = selected ? await updateNote(selected.id, validation.value) : await createNote(validation.value);
    if (result.success) { setEditing(false); setSelectedId(result.noteId ?? selected?.id ?? null); }
  };
  const remove = async (note: DietitianNote) => {
    if (!window.confirm(`“${note.title}” notunu silmek istediğinize emin misiniz?`)) return;
    const result = await deleteNote(note.id);
    if (result.success) { setSelectedId(null); setEditing(false); }
  };

  return <div className="min-h-full bg-slate-50 p-4 pb-24 sm:p-6 lg:p-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">Notlar</h1><p className="mt-1 text-sm text-slate-500">Özel notlarınızı ve danışan bağlamınızı güvenle yönetin.</p></div>
        <button onClick={openCreate} disabled={busy} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50"><Plus className="h-5 w-5" />Yeni Not</button>
      </header>
      {(mutationError || clientError) && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{mutationError || clientError}</div>}
      <div className="grid min-h-[640px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[360px_1fr]">
        <aside className="border-b border-slate-200 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-100 p-4"><label className="relative block"><Search className="absolute left-3 top-3 h-5 w-5 text-slate-400"/><span className="sr-only">Notlarda ara</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Notlarda ara..." className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 outline-none focus:border-primary"/></label></div>
          <div className="max-h-[360px] overflow-y-auto p-3 lg:max-h-[570px]">
            {viewState.status === 'loading' && <div className="p-8 text-center text-sm text-slate-500">Notlar yükleniyor...</div>}
            {viewState.status === 'error' && <div className="p-6 text-center"><p className="text-sm text-red-600">{viewState.message}</p><button onClick={() => void refreshNotes()} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-primary"><RefreshCw className="h-4 w-4"/>Tekrar dene</button></div>}
            {viewState.status === 'success' && filtered.length === 0 && <div className="p-8 text-center text-slate-500"><FileText className="mx-auto mb-3 h-10 w-10 text-slate-300"/><p className="font-medium">{query ? 'Aramanızla eşleşen not yok.' : 'Henüz not yok.'}</p>{!query && <button onClick={openCreate} className="mt-2 text-sm font-semibold text-primary">İlk notu oluştur</button>}</div>}
            {filtered.map((note) => <button key={note.id} onClick={() => { setSelectedId(note.id); setEditing(false); }} className={`mb-2 w-full rounded-xl border p-4 text-left ${selectedId === note.id ? 'border-primary bg-emerald-50' : 'border-slate-100 hover:border-emerald-200'}`}>
              <div className="flex items-start justify-between gap-2"><span className="line-clamp-1 font-semibold text-slate-800">{note.title}</span>{note.clientId && <User className="h-4 w-4 shrink-0 text-primary"/>}</div>
              <p className="mt-2 line-clamp-2 text-sm text-slate-500">{note.content}</p><div className="mt-3 flex justify-between gap-2 text-xs text-slate-400"><span className="truncate">{note.clientName || 'Genel not'}</span><time dateTime={note.updatedAt}>{formatNoteDate(note.updatedAt)}</time></div>
            </button>)}
          </div>
        </aside>
        <main className="p-5 sm:p-8">
          {editing ? <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mx-auto max-w-3xl space-y-5">
            <h2 className="text-xl font-bold text-slate-900">{selected ? 'Notu Düzenle' : 'Yeni Not'}</h2>
            <label className="block text-sm font-semibold text-slate-700">Danışan (isteğe bağlı)<select value={draft.clientId ?? ''} onChange={(e) => setDraft((value) => ({ ...value, clientId: e.target.value || null }))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3"><option value="">Genel not</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label className="block text-sm font-semibold text-slate-700">Başlık<input autoFocus maxLength={NOTE_TITLE_MAX_LENGTH} value={draft.title} onChange={(e) => setDraft((value) => ({ ...value, title: e.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3"/></label>
            <label className="block text-sm font-semibold text-slate-700">İçerik<textarea rows={14} maxLength={NOTE_CONTENT_MAX_LENGTH} value={draft.content} onChange={(e) => setDraft((value) => ({ ...value, content: e.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 p-3 leading-relaxed"/></label>
            {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setEditing(false)} className="min-h-11 rounded-xl border border-slate-200 px-4 font-semibold text-slate-600">Vazgeç</button><button disabled={busy} className="min-h-11 rounded-xl bg-primary px-5 font-semibold text-white disabled:opacity-50">{busy ? 'Kaydediliyor...' : 'Kaydet'}</button></div>
          </form> : selected ? <article className="mx-auto max-w-3xl"><div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-3xl font-bold text-slate-900">{selected.title}</h2><p className="mt-2 text-sm text-slate-500">{selected.clientName || 'Genel not'} · Son düzenleme {formatNoteDate(selected.updatedAt)}</p></div><div className="flex gap-2"><button onClick={() => openEdit(selected)} className="flex min-h-11 items-center gap-2 rounded-xl border px-4 font-semibold text-slate-600"><Pencil className="h-4 w-4"/>Düzenle</button><button onClick={() => void remove(selected)} disabled={busy} className="flex min-h-11 items-center gap-2 rounded-xl border border-red-200 px-4 font-semibold text-red-600"><Trash2 className="h-4 w-4"/>Sil</button></div></div><div className="whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-6 leading-7 text-slate-700">{selected.content}</div></article>
          : <div className="flex min-h-[500px] flex-col items-center justify-center text-center text-slate-500"><FileText className="mb-4 h-14 w-14 text-slate-300"/><h2 className="text-lg font-semibold text-slate-700">Görüntülemek için bir not seçin</h2><p className="mt-1 text-sm">Ya da yeni bir kalıcı not oluşturun.</p></div>}
        </main>
      </div>
    </div>
  </div>;
};

export default NotesPage;
