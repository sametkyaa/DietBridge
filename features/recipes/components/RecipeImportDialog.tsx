import { Fragment, useEffect, useRef, useState } from 'react';
import { draftIssues } from '../../../supabase/functions/_shared/recipeContract';
import { type ColumnField, type ColumnMapping, type SheetTable } from '../../../supabase/functions/_shared/recipeSpreadsheet';
import { cancelImport, getImportItems, getImportJob, importErrorMessage, inspectImportFile, listImportJobs, openImportSession, processImport, saveImportItems, uploadImportFile, watchImportActor, type ImportSession, type RecipeImportItem, type RecipeImportJob } from '../services/recipeImportService';
import RecipeImportPreview from './RecipeImportPreview';
import { Badge, Button, Callout, Icon, Modal, Spinner, cx } from '../../../shared/ui';

const fields: Array<[ColumnField, string]> = [['name', 'Tarif adı'], ['description', 'Açıklama'], ['mealType', 'Öğün'], ['calories', 'Kalori'], ['protein', 'Protein'], ['carbs', 'Karbonhidrat'], ['fat', 'Yağ'], ['ingredients', 'Malzemeler'], ['instructions', 'Hazırlanış']];
const ACCEPT = '.csv,.xls,.xlsx,.pdf,.doc,.docx,.jpg,.jpeg,.png';
const FORMAT_LABELS = ['CSV', 'XLS', 'XLSX', 'PDF', 'DOC', 'DOCX', 'JPG', 'PNG'];

type Step = 'upload' | 'map' | 'preview';
const STEPS: Array<[Step, string]> = [['upload', 'Dosya'], ['map', 'Kolon eşleme'], ['preview', 'Önizleme ve seçim']];

const formatBytes = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
const JOB_STATUS_LABEL: Partial<Record<RecipeImportJob['status'], string>> = { ready: 'Hazır', processing: 'Okunuyor' };

/**
 * Upload → column mapping (spreadsheets) → extraction → preview/edit →
 * explicit selection and confirmed save. Nothing is written as a recipe until
 * "Onayla ve kaydet"; missing nutrition values are never estimated.
 */
export default function RecipeImportDialog({ onClose, onSaved, existingNames = [] }: { onClose: () => void; onSaved: (count: number) => void; existingNames?: string[] }) {
  const [session, setSession] = useState<ImportSession | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [tables, setTables] = useState<SheetTable[]>([]);
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>({});
  const [job, setJob] = useState<RecipeImportJob | null>(null);
  const [recent, setRecent] = useState<RecipeImportJob[]>([]);
  const [items, setItems] = useState<RecipeImportItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const requestId = useRef(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    void openImportSession()
      .then(async (value) => { const jobs = await listImportJobs(value); if (alive.current) { setSession(value); setRecent(jobs); } })
      .catch((failure) => { if (alive.current) setError(importErrorMessage(failure)); })
      .finally(() => { if (alive.current) setBusy(false); });
    return () => { alive.current = false; };
  }, []);
  useEffect(() => (session ? watchImportActor(session, () => { alive.current = false; onClose(); }) : undefined), [session, onClose]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await action(); } catch (failure) { if (alive.current) setError(importErrorMessage(failure)); } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function loadPreview(current: RecipeImportJob) {
    if (!session) return;
    let latest = current;
    for (let i = 0; i < 60 && latest.status === 'processing'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (!alive.current) return;
      latest = await getImportJob(session, current.id);
    }
    if (!alive.current) return;
    setJob(latest);
    if (latest.status !== 'ready') throw new Error(latest.error_code ?? 'extraction_failed');
    const found = await getImportItems(session, latest.id);
    if (!alive.current) return;
    setItems(found);
    setSelected(new Set(found.filter((item) => draftIssues(item.recipe_draft).length === 0).map((item) => item.id)));
  }
  const chosen = items.filter((item) => selected.has(item.id));
  const invalid = chosen.some((item) => draftIssues(item.recipe_draft).length > 0);
  function chooseFile(value: File) {
    if (!session || busy) return;
    void run(async () => {
      const inspection = await inspectImportFile(value, session);
      if (alive.current) { setFile(value); setTables(inspection.tables); setMappings(inspection.mappings); setJob(null); requestId.current = crypto.randomUUID(); }
    });
  }
  const canRead = tables.every((table) => { const mapping = mappings[table.name]; return mapping?.name !== undefined && new Set(Object.values(mapping)).size === Object.values(mapping).length; });
  const step: Step = items.length > 0 ? 'preview' : file ? 'map' : 'upload';
  const readRecipes = () => void run(async () => {
    if (!session || !file) return;
    const current = await uploadImportFile(file, session, requestId.current);
    if (alive.current) setJob(current);
    if (current.status === 'uploaded') await processImport(session, current.id, mappings);
    await loadPreview(await getImportJob(session, current.id));
  });
  const reopenable = recent.filter((value) => ['ready', 'processing'].includes(value.status));

  const footer = step === 'preview' ? (
    confirm ? (
      <div className="flex w-full flex-wrap items-center gap-2.5">
        <span className="mr-auto flex items-center gap-2 text-13.5 font-medium"><Icon name="info" size={17} className="text-info" />{chosen.length} tarif kaydedilecek. Seçiminizi onaylıyor musunuz?</span>
        <Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>Vazgeç</Button>
        <Button variant="primary" leftIcon="check" disabled={busy || invalid || !chosen.length} loading={busy} onClick={() => void run(async () => { if (!session || !job) return; const ids = await saveImportItems(session, job.id, chosen); if (alive.current) onSaved(ids.length); })}>Onayla ve kaydet</Button>
      </div>
    ) : (
      <>
        <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { if (session && job) await cancelImport(session, job.id); if (alive.current) onClose(); })}>İçe aktarmadan vazgeç</Button>
        <Button variant="primary" disabled={busy || invalid || !chosen.length} onClick={() => setConfirm(true)}>Seçilenleri kaydet ({chosen.length})</Button>
      </>
    )
  ) : step === 'map' ? (
    <>
      <Button variant="ghost" disabled={busy} onClick={onClose}>Vazgeç</Button>
      <Button variant="primary" leftIcon="file-text" disabled={busy || !canRead} loading={busy && job !== null} onClick={readRecipes}>Tarifleri oku</Button>
    </>
  ) : (
    <Button variant="secondary" disabled={busy} onClick={onClose}>Kapat</Button>
  );

  return (
    <Modal open onClose={onClose} dismissible={!busy} title="Dosyadan içe aktar" size="lg" footer={footer}>
      <div aria-busy={busy} className="flex flex-col gap-4">
        <ol className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="İçe aktarma adımları">
          {STEPS.map(([value, label], index) => {
            const activeIndex = STEPS.findIndex(([key]) => key === step);
            return (
              <Fragment key={value}>
                <li aria-current={value === step ? 'step' : undefined} className={cx('inline-flex items-center gap-1.5 text-12.5 font-semibold', index <= activeIndex ? 'text-brand' : 'text-ink-3')}>
                  <span className={cx('grid h-5 w-5 place-items-center rounded-full text-11', index < activeIndex ? 'bg-brand text-white' : index === activeIndex ? 'border border-brand' : 'border border-line-strong')}>
                    {index < activeIndex ? <Icon name="check" size={12} /> : index + 1}
                  </span>
                  {label}
                </li>
              </Fragment>
            );
          })}
        </ol>

        <Callout tone="warn">Danışanlara ait kişisel veya sağlık bilgilerini içeren dosyaları yüklemeyin.</Callout>
        {step === 'upload' && <p className="m-0 text-13.5 text-ink-2">Dosyalar geçici olarak tutulur. Tarifleri inceleyip seçiminizi onaylamadan kayıt oluşturulmaz. Eksik besin değerleri tahmin edilmez.</p>}
        {error && <Callout tone="bad" role="alert">{error}</Callout>}
        {busy && (
          <p role="status" className="m-0 flex items-center gap-2 text-13.5 text-ink-2">
            <Spinner size={16} />{job ? 'Tarifler okunuyor' : 'İşlem sürüyor'}
          </p>
        )}

        {session && step !== 'preview' && (
          <>
            {!file ? (
              <div className="flex flex-col gap-2">
                <label className="text-13 font-semibold" htmlFor="recipe-file">
                  Tarif dosyası ({Math.round(session.limits.maxBytes / 1024 / 1024)} MB, en fazla {session.limits.maxRecipes} tarif)
                </label>
                <div
                  className={cx('flex flex-col items-center gap-2 rounded-card border-2 border-dashed px-4 py-7 text-center transition-colors', dragOver ? 'border-brand bg-brand-tint' : 'border-line-strong bg-sunk')}
                  onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault(); setDragOver(false);
                    const files = event.dataTransfer.files;
                    if (files.length !== 1) { if (!busy) setError('Her işlemde bir tarif dosyası yükleyin.'); return; }
                    chooseFile(files[0]);
                  }}
                >
                  <Icon name="download-simple" size={26} className="rotate-180 text-ink-3" />
                  <p className="m-0 text-13.5 text-ink-2">Bir dosyayı buraya sürükleyin veya seçin.</p>
                  <input
                    ref={fileInput}
                    id="recipe-file"
                    type="file"
                    accept={ACCEPT}
                    disabled={busy}
                    onChange={(event) => { const value = event.target.files?.[0]; if (value) chooseFile(value); event.target.value = ''; }}
                    className="sr-only"
                  />
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>Dosya seç</Button>
                  <span className="text-11.5 text-ink-3">{FORMAT_LABELS.join(' · ')}</span>
                </div>
                {reopenable.length > 0 && (
                  <div className="mt-2">
                    <p className="m-0 mb-1.5 text-13 font-semibold">Önceki içe aktarmayı aç</p>
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                      {reopenable.map((value) => (
                        <li key={value.id} className="flex items-center gap-3 rounded-db border border-line px-3 py-2">
                          <Icon name="file-text" size={17} className="text-ink-3" />
                          <span className="min-w-0 flex-1 truncate text-13.5">{value.source_file_name}</span>
                          <Badge tone={value.status === 'ready' ? 'ok' : 'info'} size="sm">{JOB_STATUS_LABEL[value.status] ?? value.status}</Badge>
                          <Button variant="ghost" size="sm" disabled={busy} aria-label={`Önceki içe aktarmayı aç: ${value.source_file_name}`} onClick={() => void run(() => loadPreview(value))}>Aç</Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 rounded-db border border-line px-3 py-2.5">
                  <Icon name="file-text" size={18} className="text-ink-3" />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-13.5 font-semibold">{file.name}</b>
                    <span className="block text-12 text-ink-3">{formatBytes(file.size)}{tables.length > 0 ? ` · ${tables.length} tablo` : ''}</span>
                  </div>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setFile(null); setTables([]); setMappings({}); setJob(null); }}>Değiştir</Button>
                </div>
                {tables.length === 0 && <p className="m-0 text-13 text-ink-2">Bu dosya türünde kolon eşleme gerekmez; tarifler içerikten okunur.</p>}
                {tables.map((table) => (
                  <fieldset key={table.name} disabled={busy} className="m-0 grid grid-cols-1 gap-3 rounded-card border border-line p-3.5 sm:grid-cols-3">
                    <legend className="px-1 text-13 font-semibold">Kolon eşleme — {table.name}</legend>
                    {fields.map(([field, label]) => (
                      <label key={field} className="flex flex-col gap-1 text-12.5 font-medium text-ink-2">
                        <span>{label}{field === 'name' && <span aria-hidden="true" className="ml-0.5 text-bad">*</span>}</span>
                        <select
                          aria-label={`${table.name} ${label} kolonu`}
                          className="h-9 w-full rounded-control border border-line-strong bg-surface px-2 text-13.5 text-ink focus:border-brand focus:outline-none focus:shadow-focus"
                          value={mappings[table.name]?.[field] ?? ''}
                          onChange={(event) => {
                            const value = event.target.value;
                            setMappings((current) => { const mapping = { ...current[table.name] }; if (value === '') delete mapping[field]; else mapping[field] = Number(value); return { ...current, [table.name]: mapping }; });
                          }}
                        >
                          <option value="">Eşlenmedi</option>
                          {table.rows[0].map((name, index) => <option key={index} value={index}>{String(name ?? '') || `Kolon ${index + 1}`}</option>)}
                        </select>
                      </label>
                    ))}
                  </fieldset>
                ))}
                {!canRead && tables.length > 0 && <p className="m-0 text-12.5 text-warn">Her tabloda “Tarif adı” eşlenmeli ve bir kolon yalnız bir alana eşlenmeli.</p>}
              </>
            )}
          </>
        )}

        {step === 'preview' && (
          <RecipeImportPreview
            items={items}
            selected={selected}
            busy={busy}
            existingNames={existingNames}
            fileName={job?.source_file_name ?? file?.name ?? null}
            onSelect={(id, value) => { setSelected((current) => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next; }); setConfirm(false); }}
            onEdit={(id, draft) => { setItems((current) => current.map((item) => (item.id === id ? { ...item, recipe_draft: draft } : item))); setConfirm(false); }}
          />
        )}
      </div>
    </Modal>
  );
}
