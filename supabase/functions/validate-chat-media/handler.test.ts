import { handleValidateChatMediaRequest, type MediaDependencies } from './handler.ts';
const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PEER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ID='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const bytes=new TextEncoder().encode('Test document\n');
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const assert=(condition:unknown)=>{if(!condition)throw new Error('assertion failed');};
const harness=(change:Record<string,unknown>={})=>{
 const calls:{url:string;init?:RequestInit}[]=[];
 const intent={id:ID,conversation_id:PEER,created_by:USER,bucket_id:'chat-media',object_path:`pending/${PEER}/${ID}.txt`,expected_mime:'text/plain',max_bytes:10485760,declared_byte_size:bytes.length,status:'pending',expires_at:'2030-01-01',validated_at:null,...change};
 const deps:MediaDependencies={getEnv:name=>({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_ANON_KEY:'test-anon',SUPABASE_SERVICE_ROLE_KEY:'test-server-secret'}[name]),now:()=>Date.parse('2026-10-12'),fetch:(async(input,init)=>{
  const url=String(input);calls.push({url,init});
  if(url.includes('/auth/'))return json({id:USER});
  if(url.includes('get_chat_media_capabilities'))return json({enabled:change.enabled??true});
  if(url.includes('can_process_my_chat_image'))return json(change.consent??true);
  if(url.includes('/chat_upload_intents?'))return json([intent]);
  if(url.includes('/chat_conversations?'))return json([{id:PEER,client_id:USER,dietitian_id:PEER,dietitian_clients:{status:change.relationship??'active'}}]);
  if(url.includes('/storage/')&&init?.method==='POST')return json({},Number(change.uploadStatus??200));
  if(url.includes('/storage/'))return new Response(new Uint8Array(change.object as Uint8Array??bytes).buffer,{headers:{'content-type':String(change.type??'text/plain')}});
  if(url.includes('record_chat_media_validation'))return json(change.recorded??true);
  throw new Error('unexpected fetch');
 }) as typeof fetch};
 return {calls,deps};
};
const request=(authorization='Bearer caller-token',body:unknown={intentId:ID})=>new Request('http://local.test/validate-chat-media',{method:'POST',headers:{authorization},body:JSON.stringify(body)});
for(const [name,change,status] of [
 ['valid text',{},200],['wrong owner',{created_by:PEER},404],['consent revoked',{consent:false},404],['server disabled',{enabled:false},404],
 ['ended relationship',{relationship:'ended'},404],['wrong bucket',{bucket_id:'avatars'},404],
 ['path traversal',{object_path:`pending/${PEER}/../test.txt`},404],['declared oversize',{declared_byte_size:10485761},404],
 ['expired',{expires_at:'2020-01-01'},409],['wrong MIME header',{type:'text/html'},422],
 ['oversize stream',{object:new Uint8Array(bytes.length+1)},422],['short stream',{object:bytes.slice(1)},422],
 ['binary in text',{object:new Uint8Array(bytes.length)},422],['validation recording rejected',{recorded:false},422],
 ['idempotent validation',{validated_at:'2026-10-11'},200],
] as const) Deno.test(name,async()=>{
 const {calls,deps}=harness(change);const result=await handleValidateChatMediaRequest(request(),deps);assert(result.status===status);
 if(status===404||status===409)assert(!calls.some(call=>call.url.includes('/storage/')));
 if(status===422&&name!=='validation recording rejected')assert(!calls.some(call=>call.url.includes('record_chat_media_validation')));
 for(const call of calls.filter(call=>call.url.includes('/rest/')&&!call.url.includes('record_chat_media_validation')))assert((call.init?.headers as Record<string,string>).authorization==='Bearer caller-token');
 if(name==='idempotent validation')assert(!calls.some(call=>call.url.includes('/storage/')));
});
Deno.test('missing JWT denied before IO',async()=>{const {calls,deps}=harness();assert((await handleValidateChatMediaRequest(request(''),deps)).status===401);assert(calls.length===0);});
Deno.test('extra caller-controlled payload fields rejected',async()=>{const {deps}=harness();assert((await handleValidateChatMediaRequest(request(undefined,{intentId:ID,bucket:'avatars'}),deps)).status===400);});
Deno.test('method contract',async()=>{const {deps}=harness();assert((await handleValidateChatMediaRequest(new Request('http://local.test',{method:'GET'}),deps)).status===405);});
Deno.test('broker rejects under-declared, malformed or wrong-type uploads before writing Storage',async()=>{
 for(const [body,type] of [[new Uint8Array(bytes.length+1),'text/plain'],[new Uint8Array(bytes.length),'text/plain'],[bytes,'text/html']] as const){
  const {calls,deps}=harness();const req=new Request('http://local.test',{method:'POST',headers:{authorization:'Bearer caller-token','x-chat-media-intent-id':ID,'content-type':type},body:new Uint8Array(body).buffer});
  assert((await handleValidateChatMediaRequest(req,deps)).status===422);assert(!calls.some(call=>call.url.includes('/storage/')));
 }
});
Deno.test('broker writes only validated exact bytes to the server-issued path',async()=>{
 const {calls,deps}=harness();const req=new Request('http://local.test',{method:'POST',headers:{authorization:'Bearer caller-token','x-chat-media-intent-id':ID,'content-type':'text/plain'},body:bytes.buffer});
 assert((await handleValidateChatMediaRequest(req,deps)).status===200);
 const upload=calls.find(call=>call.url.includes('/storage/')&&call.init?.method==='POST');assert(upload);
 assert((upload?.init?.headers as Record<string,string>).authorization==='Bearer test-server-secret');
 assert(new Uint8Array(upload?.init?.body as ArrayBuffer).length===bytes.length);
});
