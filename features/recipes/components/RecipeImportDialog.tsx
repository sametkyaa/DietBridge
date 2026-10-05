import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { draftIssues } from '../../../supabase/functions/_shared/recipeContract';
import { type ColumnField, type ColumnMapping, type SheetTable } from '../../../supabase/functions/_shared/recipeSpreadsheet';
import { cancelImport, getImportItems, getImportJob, importErrorMessage, inspectImportFile, listImportJobs, openImportSession, processImport, saveImportItems, uploadImportFile, watchImportActor, type ImportSession, type RecipeImportItem, type RecipeImportJob } from '../services/recipeImportService';
import RecipeImportPreview from './RecipeImportPreview';
const fields:Array<[ColumnField,string]>=[['name','Tarif adı'],['description','Açıklama'],['mealType','Öğün'],['calories','Kalori'],['protein','Protein'],['carbs','Karbonhidrat'],['fat','Yağ'],['ingredients','Malzemeler'],['instructions','Hazırlanış']];
export default function RecipeImportDialog({onClose,onSaved,existingNames=[]}:{onClose:()=>void;onSaved:(count:number)=>void;existingNames?:string[]}) {
  const [session,setSession]=useState<ImportSession|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState<string|null>(null);
  const [file,setFile]=useState<File|null>(null),[tables,setTables]=useState<SheetTable[]>([]),[mappings,setMappings]=useState<Record<string,ColumnMapping>>({});
  const [job,setJob]=useState<RecipeImportJob|null>(null),[recent,setRecent]=useState<RecipeImportJob[]>([]),[items,setItems]=useState<RecipeImportItem[]>([]),[selected,setSelected]=useState<Set<string>>(new Set());
  const [confirm,setConfirm]=useState(false);const lock=useRef(false),alive=useRef(true),requestId=useRef(crypto.randomUUID()),closeButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    alive.current=true;const previous=document.activeElement;closeButton.current?.focus();
    void openImportSession().then(async value=>{const jobs=await listImportJobs(value);if(alive.current){setSession(value);setRecent(jobs);}}).catch(failure=>{if(alive.current)setError(importErrorMessage(failure));}).finally(()=>{if(alive.current)setBusy(false);});
    return()=>{alive.current=false;if(previous instanceof HTMLElement)previous.focus();};
  },[]);
  useEffect(()=>session?watchImportActor(session,()=>{alive.current=false;onClose();}):undefined,[session,onClose]);
  async function run(action:()=>Promise<void>) {
    if(lock.current)return;lock.current=true;setBusy(true);setError(null);
    try{await action();}catch(failure){if(alive.current)setError(importErrorMessage(failure));}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function loadPreview(current:RecipeImportJob) {
    if(!session)return;let latest=current;
    for(let i=0;i<60&&latest.status==='processing';i++) {await new Promise(resolve=>setTimeout(resolve,2000));if(!alive.current)return;latest=await getImportJob(session,current.id);}
    if(!alive.current)return;setJob(latest);
    if(latest.status!=='ready')throw new Error(latest.error_code??'extraction_failed');
    const found=await getImportItems(session,latest.id);if(!alive.current)return;
    setItems(found);setSelected(new Set(found.filter(item=>draftIssues(item.recipe_draft).length===0).map(item=>item.id)));
  }
  const chosen=items.filter(item=>selected.has(item.id)),invalid=chosen.some(item=>draftIssues(item.recipe_draft).length>0);
  function chooseFile(value:File) {
    if(!session||busy)return;
    void run(async()=>{const inspection=await inspectImportFile(value,session);if(alive.current){setFile(value);setTables(inspection.tables);setMappings(inspection.mappings);setJob(null);requestId.current=crypto.randomUUID();}});
  }
  const canRead=tables.every(table=>{const mapping=mappings[table.name];return mapping?.name!==undefined&&new Set(Object.values(mapping)).size===Object.values(mapping).length;});
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3" onKeyDown={event=>{
    if(event.key==='Escape'&&!busy)onClose();
    if(event.key==='Tab'){const controls=Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)'));const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  }}><section role="dialog" aria-modal="true" aria-labelledby="import-title" aria-busy={busy} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
    <header className="flex items-center justify-between"><h2 id="import-title" className="text-xl font-bold">Dosyadan içe aktar</h2><button ref={closeButton} type="button" aria-label="İçe aktarmayı kapat" disabled={busy} onClick={onClose}><X /></button></header>
    <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Danışanlara ait kişisel veya sağlık bilgilerini içeren dosyaları yüklemeyin.</p>
    <p className="my-3 text-sm text-slate-600">Dosyalar geçici olarak tutulur. Tarifleri inceleyip seçiminizi onaylamadan kayıt oluşturulmaz. Eksik besin değerleri tahmin edilmez.</p>
    {error&&<p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
    {busy&&<p role="status" className="my-3 flex gap-2"><Loader2 className="animate-spin" />{job?'Tarifler okunuyor':'İşlem sürüyor'}</p>}
    {session&&!items.length&&<>
      <label className="block text-sm font-semibold" htmlFor="recipe-file">Tarif dosyası ({Math.round(session.limits.maxBytes/1024/1024)} MB, en fazla {session.limits.maxRecipes} tarif)</label>
      <div className="my-3 rounded-xl border border-dashed border-slate-300 p-3" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const files=event.dataTransfer.files;if(files.length!==1){if(!busy)setError('Her işlemde bir tarif dosyası yükleyin.');return;}chooseFile(files[0]);}}>
        <p className="text-sm text-slate-500">Bir dosyayı buraya sürükleyin veya seçin.</p>
        <input id="recipe-file" type="file" accept=".csv,.xls,.xlsx,.pdf,.doc,.docx,.jpg,.jpeg,.png" disabled={busy} onChange={event=>{const value=event.target.files?.[0];if(value)chooseFile(value);event.target.value='';}} className="my-3 block w-full text-sm" />
      </div>
      {tables.map(table=><fieldset key={table.name} disabled={busy} className="mb-3 grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-3"><legend className="text-sm font-semibold">Kolon eşleme — {table.name}</legend>{fields.map(([field,label])=><label key={field} className="text-sm">{label}<select aria-label={`${table.name} ${label} kolonu`} className="w-full rounded-lg border p-2" value={mappings[table.name]?.[field]??''} onChange={event=>{const value=event.target.value;setMappings(current=>{const mapping={...current[table.name]};if(value==='')delete mapping[field];else mapping[field]=Number(value);return {...current,[table.name]:mapping};});}}><option value="">Eşlenmedi</option>{table.rows[0].map((name,index)=><option key={index} value={index}>{String(name??'')||`Kolon ${index+1}`}</option>)}</select></label>)}</fieldset>)}
      {file&&<button type="button" disabled={busy||!canRead} className="rounded-xl bg-primary px-4 py-2 text-white disabled:opacity-50" onClick={()=>void run(async()=>{const current=await uploadImportFile(file,session,requestId.current);if(alive.current)setJob(current);if(current.status==='uploaded')await processImport(session,current.id,mappings);await loadPreview(await getImportJob(session,current.id));})}>Tarifleri oku</button>}
      {recent.filter(value=>['ready','processing'].includes(value.status)).map(value=><button key={value.id} type="button" disabled={busy} className="ml-2 mt-3 rounded-lg border px-3 py-2 text-sm" onClick={()=>void run(()=>loadPreview(value))}>Önceki içe aktarmayı aç: {value.source_file_name}</button>)}
    </>}
    {items.length>0&&<>
      <RecipeImportPreview items={items} selected={selected} busy={busy} existingNames={existingNames} onSelect={(id,value)=>{setSelected(current=>{const next=new Set(current);if(value)next.add(id);else next.delete(id);return next;});setConfirm(false);}} onEdit={(id,draft)=>{setItems(current=>current.map(item=>item.id===id?{...item,recipe_draft:draft}:item));setConfirm(false);}} />
      {confirm?<div className="rounded-xl bg-slate-50 p-4"><p>{chosen.length} tarif kaydedilecek. Seçiminizi onaylıyor musunuz?</p><button type="button" disabled={busy||invalid||!chosen.length} className="mt-3 rounded-lg bg-primary px-4 py-2 text-white" onClick={()=>void run(async()=>{if(!session||!job)return;const ids=await saveImportItems(session,job.id,chosen);if(alive.current)onSaved(ids.length);})}>Onayla ve kaydet</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)} className="ml-3">Vazgeç</button></div>
        :<button type="button" disabled={busy||invalid||!chosen.length} onClick={()=>setConfirm(true)} className="rounded-xl bg-primary px-4 py-2 text-white disabled:opacity-50">Seçilenleri kaydet ({chosen.length})</button>}
      <button type="button" disabled={busy} className="ml-3 text-sm text-slate-600" onClick={()=>void run(async()=>{if(session&&job)await cancelImport(session,job.id);if(alive.current)onClose();})}>İçe aktarmadan vazgeç</button>
    </>}
  </section></div>;
}
