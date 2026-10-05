import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabaseClient';
import { env } from '../../../lib/env';
import { isValidUuid } from '../../../shared/utils/uuid';
import { draftToRecipeInput, type RecipeDraft } from '../../../supabase/functions/_shared/recipeContract';
import { IMPORT_MIMES, validateArchivePayload, validateFileBytes, validateFileMetadata, type ImportLimits } from '../../../supabase/functions/_shared/recipeFiles';
import { inferMapping, parseCsv, readWorkbook, type ColumnMapping, type WorkbookReader } from '../../../supabase/functions/_shared/recipeSpreadsheet';
export interface RecipeImportItem { id:string;recipe_draft:RecipeDraft;source_reference:{sheet?:string;row?:number;page?:number|null;section?:string|null};warnings:string[] }
export interface RecipeImportJob { id:string;dietitian_id:string;status:'uploaded'|'processing'|'ready'|'failed'|'saved'|'expired';source_storage_path:string;source_file_name:string;error_code:string|null;expires_at:string }
export interface ImportSession { client:SupabaseClient;actor:string;limits:ImportLimits }
async function assertCurrentActor(session:ImportSession):Promise<void> {
  const {data,error}=await supabase.auth.getSession();
  if(error||data.session?.user.id!==session.actor)throw new Error('auth_required');
}
export function watchImportActor(session:ImportSession,invalidated:()=>void):()=>void {
  const {data}=supabase.auth.onAuthStateChange((_event,current)=>{if(current?.user.id!==session.actor)invalidated();});
  return ()=>data.subscription.unsubscribe();
}
export async function openImportSession():Promise<ImportSession> {
  const {data:{session},error}=await supabase.auth.getSession();
  const {data,error:authError}=await supabase.auth.getUser(session?.access_token);
  if(error||authError||!session||!data.user||data.user.id!==session.user.id)throw new Error('auth_required');
  const client=createClient(env.supabaseUrl,env.supabaseAnonKey,{global:{headers:{Authorization:`Bearer ${session.access_token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:limits,error:limitsError}=await client.rpc('recipe_import_limits');
  if(limitsError||!limits||!Number.isInteger(limits.maxBytes)||!Number.isInteger(limits.maxRecipes))throw new Error('import_unavailable');
  return {client,actor:data.user.id,limits};
}
export async function inspectImportFile(file:File,session:ImportSession) {
  const ext=file.name.split('.').at(-1)?.toLowerCase()??'';
  validateFileMetadata(file.name,file.type||IMPORT_MIMES[ext]||'',file.size,session.limits);
  const bytes=new Uint8Array(await file.arrayBuffer());validateFileBytes(bytes,ext,session.limits);await validateArchivePayload(bytes,ext,session.limits);
  const tables=ext==='csv'?parseCsv(bytes,session.limits):['xls','xlsx'].includes(ext)?readWorkbook(bytes,await import('xlsx') as unknown as WorkbookReader,session.limits):[];
  const mappings:Record<string,ColumnMapping>={};let ambiguous=false;
  for(const table of tables){const inferred=inferMapping(table.rows[0]);mappings[table.name]=inferred.mapping;ambiguous||=inferred.ambiguous;}
  return {ext,tables,mappings,ambiguous};
}
export async function listImportJobs(session:ImportSession):Promise<RecipeImportJob[]> {
  const {data,error}=await session.client.from('recipe_import_jobs').select('*').eq('dietitian_id',session.actor).gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(10);
  if(error||!Array.isArray(data))throw new Error('import_unavailable');return data;
}
export async function uploadImportFile(file:File,session:ImportSession,requestId:string):Promise<RecipeImportJob> {
  await assertCurrentActor(session);
  const ext=file.name.split('.').at(-1)?.toLowerCase()??'';
  const {data,error}=await session.client.rpc('begin_recipe_import',{p_request_id:requestId,p_name:file.name,p_mime:file.type||IMPORT_MIMES[ext],p_size:file.size});
  if(error||!data?.id||data.dietitian_id!==session.actor)throw new Error(error?.code==='54000'?'import_rate_limited':'upload_failed');
  const job=data as RecipeImportJob;
  if(job.status!=='uploaded')return job;
  const {error:uploadError}=await session.client.storage.from('recipe-imports').upload(job.source_storage_path,file,{contentType:file.type||IMPORT_MIMES[ext],upsert:false});
  if(uploadError){
    // An upload may have committed despite a lost HTTP acknowledgement. Compare
    // its content before treating a retry as success; never overwrite a source.
    const {data:existing,error:readError}=await session.client.storage.from('recipe-imports').download(job.source_storage_path);
    if(!readError&&existing&&existing.size===file.size){
      const [left,right]=await Promise.all([crypto.subtle.digest('SHA-256',await existing.arrayBuffer()),crypto.subtle.digest('SHA-256',await file.arrayBuffer())]);
      if(new Uint8Array(left).every((value,index)=>value===new Uint8Array(right)[index]))return job;
    }
    await cancelImport(session,job.id);throw new Error('upload_failed');
  }
  return job;
}
export async function processImport(session:ImportSession,jobId:string,mappings:Record<string,ColumnMapping>):Promise<void> {
  await assertCurrentActor(session);
  const {data,error}=await session.client.functions.invoke('process-recipe-import',{body:{jobId,mappings}});
  if(error||data?.status!=='ready'){
    const job=await getImportJob(session,jobId);
    if(job.status!=='ready'&&job.status!=='processing')throw new Error(job.error_code||'extraction_failed');
  }
}
export async function getImportJob(session:ImportSession,id:string):Promise<RecipeImportJob> {
  await assertCurrentActor(session);
  if(!isValidUuid(id))throw new Error('import_unavailable');
  const {data,error}=await session.client.from('recipe_import_jobs').select('*').eq('id',id).eq('dietitian_id',session.actor).single();
  if(error||!data)throw new Error('import_unavailable');return data;
}
export async function getImportItems(session:ImportSession,id:string):Promise<RecipeImportItem[]> {
  await assertCurrentActor(session);
  const {data,error}=await session.client.from('recipe_import_items').select('id,recipe_draft,source_reference,warnings').eq('import_job_id',id).eq('dietitian_id',session.actor).order('created_at');
  if(error||!Array.isArray(data))throw new Error('import_unavailable');return data;
}
export async function saveImportItems(session:ImportSession,jobId:string,items:RecipeImportItem[]):Promise<string[]> {
  await assertCurrentActor(session);
  if(!items.length||items.length>session.limits.maxRecipes)throw new Error('invalid_selection');
  const selected=items.map(item=>({id:item.id,input:draftToRecipeInput(item.recipe_draft)}));
  const {data,error}=await session.client.rpc('save_recipe_import',{p_job_id:jobId,p_selected:selected});
  if(error||!Array.isArray(data)||data.length!==selected.length||!data.every(isValidUuid))throw new Error('save_failed');return data;
}
export async function cancelImport(session:ImportSession,jobId:string):Promise<void> {
  await assertCurrentActor(session);
  const {error}=await session.client.rpc('cancel_recipe_import',{p_job_id:jobId});if(error)throw new Error('cancel_failed');
}
export function importErrorMessage(error:unknown):string {
  const code=error instanceof Error?error.message:'';
  const messages:Record<string,string>={invalid_file:'Dosya boş, bozuk veya izin verilen sınırların dışında. Dosyayı kontrol edin.',unsupported_file:'Desteklenmeyen dosya türü veya dosya uzantısıyla uyuşmayan içerik.',empty_output:'Dosyada tarif bulunamadı.',too_many_recipes:'Dosyada sınırdan fazla tarif var. Daha küçük dosyalar yükleyin.',provider_unavailable:'Tarif okuma hizmeti şu anda kullanılamıyor. Daha sonra tekrar deneyin.',provider_timeout:'Tariflerin okunması zamanında tamamlanamadı. Daha küçük bir dosyayla tekrar deneyin.',invalid_output:'Tarifler güvenilir biçimde okunamadı. Dosyayı kontrol edip yeniden yükleyin.',upload_failed:'Dosya yüklenemedi. Bağlantınızı kontrol edin.',save_failed:'Tarifler kaydedilemedi. Önizleme korundu; tekrar deneyebilirsiniz.',import_rate_limited:'Çok fazla dosya yüklediniz. Daha sonra tekrar deneyin.',auth_required:'Oturumunuzu kontrol edip yeniden giriş yapın.'};
  return messages[code]??'İçe aktarma tamamlanamadı. Dosyanızı ve bağlantınızı kontrol edin.';
}
