export interface CleanupDeps {
  authorized(request:Request):boolean|Promise<boolean>;
  candidates():Promise<Array<{id:string|null;source_storage_path:string}>>;
  remove(path:string):Promise<void>;
  acknowledge(id:string):Promise<void>;
}
export async function handleImportCleanup(request:Request,deps:CleanupDeps):Promise<Response> {
  const headers={'Cache-Control':'no-store','Content-Type':'application/json'};
  if(request.method!=='POST')return new Response(null,{status:405,headers});
  if(!await deps.authorized(request))return new Response(null,{status:401,headers});
  try{
    const candidates=await deps.candidates();let removed=0,failed=0;
    for(const item of candidates){try{await deps.remove(item.source_storage_path);if(item.id)await deps.acknowledge(item.id);removed++;}catch{failed++;}}
    return new Response(JSON.stringify({removed,failed}),{status:failed?503:200,headers});
  }catch{return new Response(JSON.stringify({error:'cleanup_failed'}),{status:503,headers});}
}
