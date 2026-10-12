import { MEDIA_TYPES, validateMediaBytes } from './mediaValidator.ts';
const assert=(condition:unknown)=>{if(!condition)throw new Error('assertion failed');};
const text=(value:string)=>new TextEncoder().encode(value);
Deno.test('file whitelist and maximum sizes',()=>{
 assert(Object.keys(MEDIA_TYPES).length===8);
 assert(!validateMediaBytes(text('MZ'), 'application/x-msdownload'));
 assert(!validateMediaBytes(new Uint8Array(10485761),'application/pdf'));
 assert(!validateMediaBytes(new Uint8Array(20971521),'video/mp4'));
 assert(!validateMediaBytes(new Uint8Array(),'text/plain'));
});
Deno.test('PDF signature and trailer both required',()=>{
 assert(validateMediaBytes(text('%PDF-1.4\n%%EOF'),'application/pdf'));
 assert(!validateMediaBytes(text('%PDF-1.4'),'application/pdf'));
 assert(!validateMediaBytes(text('<html>%%EOF'),'application/pdf'));
});
Deno.test('UTF8 documents reject binary and active HTML',()=>{
 assert(validateMediaBytes(text('Öğün,kalori\nKahvaltı,400'),'text/csv'));
 assert(!validateMediaBytes(text(' <script>alert(1)</script>'),'text/plain'));
 assert(!validateMediaBytes(new Uint8Array([255,0]),'text/plain'));
});
Deno.test('MP4 and MOV brands cannot be interchanged',()=>{
 const mp4=new Uint8Array(20);new DataView(mp4.buffer).setUint32(0,20);mp4.set(text('ftypisom'),4);
 assert(validateMediaBytes(mp4,'video/mp4'));assert(!validateMediaBytes(mp4,'video/quicktime'));
 mp4.set(text('qt  '),8);assert(validateMediaBytes(mp4,'video/quicktime'));assert(!validateMediaBytes(mp4,'video/mp4'));
 new DataView(mp4.buffer).setUint32(0,4097);assert(!validateMediaBytes(mp4,'video/quicktime'));
});
Deno.test('WebM requires EBML header and document type',()=>{
 const bytes=new Uint8Array([0x1a,0x45,0xdf,0xa3,...text('webm')]);assert(validateMediaBytes(bytes,'video/webm'));
 assert(!validateMediaBytes(text('webm fake'),'video/webm'));
});
// Minimal stored ZIP fixture; exercise central/local filenames and expansion budgets.
const zip=(names:string[],expanded=1)=>{
 const local:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0;
 for(const name of names){const n=text(name);const l=new Uint8Array(30+n.length+1),v=new DataView(l.buffer);v.setUint32(0,0x04034b50,true);v.setUint32(18,1,true);v.setUint32(22,expanded,true);v.setUint16(26,n.length,true);l.set(n,30);
 const c=new Uint8Array(46+n.length),d=new DataView(c.buffer);d.setUint32(0,0x02014b50,true);d.setUint32(20,1,true);d.setUint32(24,expanded,true);d.setUint16(28,n.length,true);d.setUint32(42,offset,true);c.set(n,46);local.push(l);central.push(c);offset+=l.length;}
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,names.length,true);e.setUint16(10,names.length,true);e.setUint32(12,central.reduce((sum,b)=>sum+b.length,0),true);e.setUint32(16,offset,true);
 const all=[...local,...central,end],out=new Uint8Array(all.reduce((sum,b)=>sum+b.length,0));let pos=0;for(const b of all){out.set(b,pos);pos+=b.length;}return out;
};
Deno.test('Office package structure, unsafe entries, duplicates and zip bombs',()=>{
 const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 assert(validateMediaBytes(zip(['[Content_Types].xml','word/document.xml']),mime));
 assert(!validateMediaBytes(zip(['word/document.xml']),mime));
 for(const name of ['../escape','word/vbaProject.bin','word/embeddings/a.bin','word/document.xml'])assert(!validateMediaBytes(zip(['[Content_Types].xml','word/document.xml',name]),mime));
 assert(!validateMediaBytes(zip(['[Content_Types].xml','word/document.xml'],30000000),mime));
});
