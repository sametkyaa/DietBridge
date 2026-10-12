const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
const stub = require(path.join(root, 'lib/supabaseClient.js'));
const policy = require(path.join(root, 'features/chat/utils/chatMediaPolicy.js'));
const service = require(path.join(root, 'features/chat/services/chatMediaService.js'));
const C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', I='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', M='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const objectPath=`pending/${C}/${I}.txt`;
const descriptor=policy.normalizeChatMediaFile({name:'not.txt',mimeType:'text/plain',byteSize:4});
const harness=()=>{
 const calls=[]; let failFinal=true;
 stub.__setRpcHandler(async(name,args)=>{calls.push(name);
  if(name==='create_chat_media_upload_intent')return {data:{id:I,conversation_id:C,client_message_id:M,bucket_id:'chat-media',object_path:objectPath,expected_mime:'text/plain',declared_byte_size:4,file_name:'not.txt'},error:null};
  if(name==='finalize_chat_media_message'){if(failFinal){failFinal=false;return {error:{message:'temporary'}};}return {data:{id:M,conversation_id:C,client_message_id:M},error:null};}
  return {data:null,error:null};
 });
 stub.__setStorageHandler(()=>({upload:async()=>{calls.push('upload');return {error:null};}}));
 stub.__setFunctionHandler(async()=>{calls.push('broker');return {data:{data:{validated:true}},error:null};});
 return calls;
};
test('file extension, MIME and exact limits are enforced before network access',()=>{
 assert.equal(policy.normalizeChatMediaFile({name:'Öğün.PDF',mimeType:'application/octet-stream',byteSize:10485760}).kind,'file');
 assert.equal(policy.normalizeChatMediaFile({name:'video.mp4',mimeType:'video/mp4',byteSize:20971520}).kind,'video');
 for(const file of [{name:'bad.pdf',mimeType:'video/mp4',byteSize:3},{name:'bad.zip',byteSize:3},{name:'big.pdf',byteSize:10485761},{name:'big.mp4',byteSize:20971521},{name:'empty.txt',byteSize:0}])assert.throws(()=>policy.normalizeChatMediaFile(file));
});
test('retry after a failed finalize reuses the validated object and intent',async()=>{
 const calls=harness(), operation={};
 const args={conversationId:C,clientMessageId:M,descriptor,body:new Blob(['test']),caption:'',operation,isCurrent:()=>true,onStage:()=>{}};
 await assert.rejects(service.sendChatMedia(args));
 assert.deepEqual(await service.sendChatMedia(args),{messageId:M,conversationId:C});
 assert.deepEqual(calls,['create_chat_media_upload_intent','broker','finalize_chat_media_message','finalize_chat_media_message']);
 assert.equal(operation.finalized,true);
});
test('cancellation after intent creation aborts without uploading',async()=>{
 const calls=harness();
 assert.equal(await service.sendChatMedia({conversationId:C,clientMessageId:M,descriptor,body:new Blob(['test']),caption:'',operation:{},isCurrent:()=>false,onStage:()=>{}}),null);
 assert.deepEqual(calls,['create_chat_media_upload_intent','abort_chat_image_upload']);
});
test('invalid attachment bucket, size or MIME cannot create a signed URL',async()=>{
 const calls=[];stub.__setStorageHandler(()=>{calls.push('storage');return {};});
 await assert.rejects(service.getChatMediaUrl({id:M,messageKind:'file',deletedAt:null,attachment:{id:I,messageId:M,bucketId:'avatars',objectPath,mimeType:'text/plain',byteSize:4,width:0,height:0,deletedAt:null}}));
 assert.deepEqual(calls,[]);
});
test('old text and image rows require no new metadata query',async()=>{
 stub.__setFromHandler(()=>{throw new Error('unexpected query');});const rows=[{message_kind:'text'},{message_kind:'image'}];
 assert.equal(await service.enrichChatMediaRows(rows),rows);
});
