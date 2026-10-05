import { ImportError, validateArchivePayload, validateFileBytes, validateFileMetadata, type ImportLimits } from '../_shared/recipeFiles.ts';
import { mapTables, parseCsv, readWorkbook, type ColumnMapping, type ImportItem, type WorkbookReader } from '../_shared/recipeSpreadsheet.ts';
export interface ImportJob { id:string;dietitian_id:string;status:string;source_file_name:string;source_mime_type:string;file_size:number;source_storage_path:string }
export interface ExtractionMetrics { model?:string;inputTokens?:number;outputTokens?:number;attemptCount?:number;durationMs?:number }
export interface ImportDependencies {
  authenticate(authorization:string):Promise<string>;
  limits():Promise<ImportLimits>;
  claim(jobId:string,actor:string):Promise<ImportJob|null>;
  download(path:string):Promise<Uint8Array>;
  workbook():Promise<WorkbookReader>;
  extract?(bytes:Uint8Array,job:ImportJob,limits:ImportLimits):Promise<{items:ImportItem[];metrics:ExtractionMetrics}>;
  finish(jobId:string,actor:string,items:ImportItem[]|null,error:string|null,metrics:ExtractionMetrics):Promise<boolean>;
  cleanup(job:ImportJob):Promise<void>;
}
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
const response=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeErrors=new Set(['invalid_file','unsupported_file','extraction_failed','provider_unavailable','provider_timeout','invalid_output','empty_output','too_many_recipes']);
async function smallJson(request:Request):Promise<unknown> {
  if(!request.body)throw new ImportError('invalid_file');const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new ImportError('invalid_file');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function handleRecipeImport(request:Request,deps:ImportDependencies):Promise<Response> {
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return response(405,{error:'method_not_allowed'});
  const authorization=request.headers.get('Authorization')??'';
  if(!/^Bearer \S+$/i.test(authorization))return response(401,{error:'auth_required'});
  let actor:string;try{actor=await deps.authenticate(authorization);}catch{return response(401,{error:'auth_required'});}
  let body:{jobId?:string;mappings?:Record<string,ColumnMapping>};
  try{body=await smallJson(request) as typeof body;if(!body||typeof body.jobId!=='string'||!uuid.test(body.jobId))throw new Error();}catch{return response(400,{error:'invalid_file'});}
  let job:ImportJob|null;let limits:ImportLimits;
  try{limits=await deps.limits();job=await deps.claim(body.jobId!,actor);}catch{return response(403,{error:'import_unavailable'});}
  if(!job?.id)return response(409,{error:'import_unavailable'});
  // Service claims only the verified actor's unexpired uploaded job. Never trust caller paths.
  let items:ImportItem[]|null=null,error:string|null=null,metrics:ExtractionMetrics={};
  try {
    if(job.dietitian_id!==actor)throw new ImportError('extraction_failed');
    const ext=validateFileMetadata(job.source_file_name,job.source_mime_type,job.file_size,limits);
    const bytes=await deps.download(job.source_storage_path);
    if(bytes.length!==job.file_size)throw new ImportError('invalid_file');
    validateFileBytes(bytes,ext,limits);
    await validateArchivePayload(bytes,ext,limits);
    if(['csv','xls','xlsx'].includes(ext)) {
      const tables=ext==='csv'?parseCsv(bytes,limits):readWorkbook(bytes,await deps.workbook(),limits);
      items=mapTables(tables,body.mappings??{},limits);
    }else if(deps.extract){({items,metrics}=await deps.extract(bytes,job,limits));}
    else throw new ImportError('unsupported_file');
  }catch(failure){
    error=failure instanceof ImportError&&safeErrors.has(failure.message)?failure.message:'extraction_failed';
    if(failure instanceof ImportError&&'metrics' in failure&&typeof failure.metrics==='object')metrics=failure.metrics as ExtractionMetrics;
  }
  let finished=false;
  try{finished=await deps.finish(job.id,actor,items,error,metrics);}catch{return response(503,{error:'import_unavailable'});}
  if(!finished)return response(409,{error:'import_unavailable'});
  // Payload removal failure keeps cleanup_pending=true for the scheduled reconciler.
  try{await deps.cleanup(job);}catch{/* Explicit durable compensation queue, no success claim for cleanup. */}
  return error?response(422,{error}):response(200,{status:'ready',jobId:job.id});
}
