import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { draftIssues,draftToRecipeInput,normalizeRecipeInput } from '../supabase/functions/_shared/recipeContract.ts';
import { IMPORT_MIMES,validateFileBytes,validateFileMetadata,validateArchivePayload } from '../supabase/functions/_shared/recipeFiles.ts';
import { inferMapping,mapTables,parseCsv,readWorkbook } from '../supabase/functions/_shared/recipeSpreadsheet.ts';
import { handleRecipeImport } from '../supabase/functions/process-recipe-import/handler.ts';
import { handleImportCleanup } from '../supabase/functions/cleanup-recipe-imports/handler.ts';
export const limits={maxBytes:5242880,maxRecipes:20,maxRows:200,maxColumns:50,maxExpandedBytes:20971520,retentionHours:24};
const encode=value=>new TextEncoder().encode(value);
const csv='Tarif Adı;Öğün;kcal;Protein;Karb;Yağ;Malzemeler;Yapılış\r\nMercimek;Öğle;200;12;30;5;Mercimek ve su;Haşlayın\r\n';
const recipe={name:'Mercimek',mealType:'lunch',description:null,calories:200,macros:{protein:12,carbs:30,fat:5}};
test('CSV aliases, provenance and ingredients use the manual create contract',()=>{
  const [item]=mapTables(parseCsv(encode(csv),limits),{},limits);
  assert.equal(item.validationState,'valid');assert.deepEqual(item.source,{sheet:'CSV',row:2});
  assert.deepEqual(draftToRecipeInput(item.draft),normalizeRecipeInput({...recipe,description:'Malzemeler: Mercimek ve su\n\nHazırlanış: Haşlayın'}));
});
test('missing and invalid nutrients remain null; unsupported meal type needs review',()=>{
  const [item]=mapTables(parseCsv(encode('Ad,Kalori,Protein,Karbonhidrat,Yağ,Öğün\nTarif,abc,,2.5,-3,Özel\n'),limits),{},limits);
  assert.equal(item.draft.calories,null);assert.equal(item.draft.macros.protein,null);assert.equal(item.draft.macros.carbs,2.5);assert.equal(item.draft.macros.fat,-3);assert.equal(item.draft.mealType,null);
  assert.equal(item.validationState,'needs_review');assert.throws(()=>draftToRecipeInput(item.draft));
});
test('quoted CSV preserves multiline text and rejects unterminated quotes',()=>{
  assert.equal(parseCsv(encode('Ad,Açıklama\n"Çorba","Önce\nsonra"\n'),limits)[0].rows[1][1],'Önce\nsonra');
  assert.throws(()=>parseCsv(encode('Ad,Açıklama\n"Çorba,eksik'),limits));
});
for(const type of ['xls','xlsx'])test(`valid ${type.toUpperCase()} workbook parses deterministically`,async()=>{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Tarif','Öğün','Kalori','Protein','Karbonhidrat','Yağ'],['Tarif','Akşam',300,20,30,10]]),'Tarifler');
  const bytes=new Uint8Array(XLSX.write(book,{type:'buffer',bookType:type}));validateFileBytes(bytes,type,limits);await validateArchivePayload(bytes,type,limits);
  const [item]=mapTables(readWorkbook(bytes,XLSX,limits),{},limits);assert.equal(item.draft.mealType,'dinner');assert.equal(item.draft.calories,300);assert.equal(item.source.sheet,'Tarifler');
});
test('ambiguous columns require explicit unique mapping, no LLM header interpretation',()=>{
  const tables=parseCsv(encode('Tarif,Ad,Kalori\nÇorba,Çorba,100\n'),limits);
  assert.equal(inferMapping(tables[0].rows[0]).ambiguous,true);assert.throws(()=>mapTables(tables,{},limits),/column_mapping_required/);
  assert.equal(mapTables(tables,{CSV:{name:1,calories:2}},limits)[0].draft.name,'Çorba');
  assert.throws(()=>mapTables(tables,{CSV:{name:1,calories:1}},limits));
});
test('same-name variations are preserved with warning, not deduplicated',()=>{
  const items=mapTables(parseCsv(encode('Ad\nÇorba\nÇorba\n'),limits),{},limits);
  assert.equal(items.length,2);assert.ok(items[1].warnings.some(w=>w.startsWith('Aynı adlı')));
});
test('source rows preserve CSV blank lines and worksheet starting coordinates',()=>{
  const items=mapTables(parseCsv(encode('Ad\nÇorba\n\nSalata\n'),limits),{},limits);assert.equal(items[1].source.row,4);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,{'B5':{t:'s',v:'Ad'},'B6':{t:'s',v:'Tarif'},'!ref':'B5:B6'},'Tarifler');
  const bytes=new Uint8Array(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
  assert.equal(mapTables(readWorkbook(bytes,XLSX,limits),{},limits)[0].source.row,6);
});
test('MIME spoofing, traversal, oversize, empty and corrupt workbook are rejected',()=>{
  for(const [name,mime,size] of [['../a.csv','text/csv',3],['a.csv','application/pdf',3],['a.csv','text/csv',0],['a.csv','text/csv',limits.maxBytes+1]])assert.throws(()=>validateFileMetadata(name,mime,size,limits));
  assert.throws(()=>validateFileBytes(encode('CSV pretending XLSX'),'xlsx',limits));
  assert.throws(()=>validateFileBytes(new Uint8Array(),'csv',limits));
  assert.throws(()=>validateFileBytes(encode('%PDF-1.7\n/Encrypt true\n%%EOF'),'pdf',limits));
  assert.throws(()=>readWorkbook(encode('corrupt'),XLSX,limits));
});
test('spreadsheet row, column and recipe counts are bounded',()=>{
  assert.throws(()=>parseCsv(encode('Ad\n'+Array.from({length:201},()=> 'Tarif').join('\n')),limits));
  assert.throws(()=>mapTables(parseCsv(encode('Ad\n'+Array.from({length:21},()=> 'Tarif').join('\n')),limits),{},limits),/too_many_recipes/);
});
test('worksheet dimensions are rejected before synthetic column conversion',async()=>{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Ad'],['Tarif']]),'Tarifler');
  const archive=XLSX.CFB.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  const entry=archive.FileIndex.find(value=>value.name==='sheet1.xml');
  entry.content=Buffer.from(Buffer.from(entry.content).toString().replace(/<dimension ref="[^"]+"\/>/,'<dimension ref="A1:XFD2"/>'));entry.size=entry.content.length;
  const bytes=new Uint8Array(XLSX.CFB.write(archive,{fileType:'zip',type:'buffer'}));
  validateFileBytes(bytes,'xlsx',limits);await validateArchivePayload(bytes,'xlsx',limits);
  let converted=0;
  const reader={read:XLSX.read,utils:{sheet_to_json:(...args)=>{converted++;return XLSX.utils.sheet_to_json(...args);}}};
  assert.throws(()=>readWorkbook(bytes,reader,limits),/invalid_file/);assert.equal(converted,0);
});
const actor='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const request=()=>new Request('http://localhost/process',{method:'POST',headers:{Authorization:'Bearer fake-local-only'},body:JSON.stringify({jobId:id})});
function dependencies(bytes=encode(csv)) {
  const calls=[];return {calls,deps:{authenticate:async()=>actor,limits:async()=>limits,claim:async()=>({id,dietitian_id:actor,status:'processing',source_file_name:'a.csv',source_mime_type:IMPORT_MIMES.csv,file_size:bytes.length,source_storage_path:`${actor}/${id}/source.csv`}),download:async()=>bytes,workbook:async()=>XLSX,extract:async()=>{calls.push('provider');throw new Error('unexpected provider');},finish:async(_id,_actor,items,error)=>{calls.push({items,error});return true;},cleanup:async()=>{calls.push('cleanup');}}};
}
test('CSV worker writes draft metadata only and has zero provider calls',async()=>{
  const {calls,deps}=dependencies();const result=await handleRecipeImport(request(),deps);assert.equal(result.status,200);assert.equal(calls.includes('provider'),false);assert.equal(calls[0].items.length,1);assert.equal(calls[0].error,null);
  assert.equal('save' in deps,false);assert.equal('recipes' in deps,false);
});
test('unauthorized and duplicate processing stop before download/provider',async()=>{
  const {calls,deps}=dependencies();deps.authenticate=async()=>{throw new Error('no auth');};assert.equal((await handleRecipeImport(request(),deps)).status,401);assert.deepEqual(calls,[]);
  deps.authenticate=async()=>actor;deps.claim=async()=>null;assert.equal((await handleRecipeImport(request(),deps)).status,409);assert.deepEqual(calls,[]);
});
test('a failed finish cannot produce fake success; cleanup failure is durably retried',async()=>{
  const {deps}=dependencies();deps.finish=async()=>{throw new Error('DB failed');};assert.equal((await handleRecipeImport(request(),deps)).status,503);
  const second=dependencies();second.deps.cleanup=async()=>{throw new Error('retry durable');};assert.equal((await handleRecipeImport(request(),second.deps)).status,200);
});
test('cleanup authorizes, removes payload first, acknowledges only success and retries',async()=>{
  const calls=[];const deps={authorized:()=>false,candidates:async()=>[{id,source_storage_path:'own.csv'},{id:null,source_storage_path:'orphan.csv'}],remove:async path=>{calls.push(path);if(path==='own.csv')throw new Error('temporary failure');},acknowledge:async id=>calls.push(id)};
  const req=()=>new Request('http://localhost/cleanup',{method:'POST'});
  assert.equal((await handleImportCleanup(req(),deps)).status,401);assert.deepEqual(calls,[]);
  deps.authorized=()=>true;const first=await handleImportCleanup(req(),deps);assert.equal(first.status,503);assert.deepEqual(calls,['own.csv','orphan.csv']);
  deps.remove=async path=>calls.push(path);assert.equal((await handleImportCleanup(req(),deps)).status,200);assert.equal(calls.filter(value=>value===id).length,1);
});
test('canonical nutrition zero is allowed only when supplied and macro shape is strict',()=>{
  assert.deepEqual(draftIssues({...recipe,calories:0,macros:{protein:0,carbs:0,fat:0}}),[]);
  assert.throws(()=>normalizeRecipeInput({...recipe,macros:{...recipe.macros,extra:1}}));
});
