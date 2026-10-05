import { createClient } from 'npm:@supabase/supabase-js@2.87.0';
import { handleRecipeImport } from './handler.ts';
import type { ImportLimits } from '../_shared/recipeFiles.ts';
import type { WorkbookReader } from '../_shared/recipeSpreadsheet.ts';
import { OpenAIRecipeExtractionProvider } from '../_shared/openAIRecipeExtraction.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(request=>handleRecipeImport(request,{
  authenticate:async authorization=>{
    const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.getUser();if(error||!data.user)throw new Error('auth_required');return data.user.id;
  },
  limits:async()=>{const {data,error}=await admin.rpc('recipe_import_limits');if(error||!data)throw new Error('limits_failed');return data as ImportLimits;},
  claim:async(jobId,actor)=>{const {data,error}=await admin.rpc('claim_recipe_import',{p_job_id:jobId,p_actor:actor});if(error)throw new Error('claim_failed');return data;},
  download:async path=>{const {data,error}=await admin.storage.from('recipe-imports').download(path);if(error||!data)throw new Error('download_failed');return new Uint8Array(await data.arrayBuffer());},
  workbook:async()=>await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs') as unknown as WorkbookReader,
  extract:async(bytes,job,limits)=>new OpenAIRecipeExtractionProvider({apiKey:Deno.env.get('OPENAI_API_KEY'),model:Deno.env.get('OPENAI_RECIPE_MODEL')}).extract({bytes,mime:job.source_mime_type,extension:job.source_file_name.split('.').at(-1)!.toLowerCase(),jobId:job.id,limits}),
  finish:async(jobId,actor,items,error,metrics)=>{
    const {data,error:failure}=await admin.rpc('finish_recipe_import',{p_job_id:jobId,p_actor:actor,p_items:items,p_error:error,p_metrics:metrics});if(failure)throw new Error('finish_failed');return data===true;
  },
  cleanup:async job=>{
    const {error}=await admin.storage.from('recipe-imports').remove([job.source_storage_path]);if(error)throw new Error('cleanup_failed');
    const {error:ackError}=await admin.rpc('ack_recipe_import_cleanup',{p_job_id:job.id});if(ackError)throw new Error('cleanup_ack_failed');
  },
}));
