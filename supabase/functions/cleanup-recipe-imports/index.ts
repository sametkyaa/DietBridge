import { createClient } from 'npm:@supabase/supabase-js@2.87.0';
import { handleImportCleanup } from './handler.ts';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(request=>handleImportCleanup(request,{
  authorized:request=>{
    const expected=Deno.env.get('RECIPE_IMPORT_CLEANUP_TOKEN');
    const actual=request.headers.get('Authorization')?.replace(/^Bearer /i,'');
    if(!expected||!actual||expected.length!==actual.length)return false;
    let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^actual.charCodeAt(i);return difference===0;
  },
  candidates:async()=>{const {data,error}=await admin.rpc('recipe_import_cleanup_candidates');if(error||!Array.isArray(data))throw new Error('cleanup_failed');return data;},
  remove:async path=>{const {error}=await admin.storage.from('recipe-imports').remove([path]);if(error)throw new Error('cleanup_failed');},
  acknowledge:async id=>{const {error}=await admin.rpc('ack_recipe_import_cleanup',{p_job_id:id});if(error)throw new Error('cleanup_ack_failed');},
}));
