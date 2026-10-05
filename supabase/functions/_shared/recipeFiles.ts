export interface ImportLimits { maxBytes: number; maxRecipes: number; maxRows: number; maxColumns: number; maxExpandedBytes: number; retentionHours: number }
export const IMPORT_MIMES: Record<string,string> = {
  csv:'text/csv', xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf:'application/pdf', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png',
};
export class ImportError extends Error { constructor(code: string) { super(code); this.name='ImportError'; } }
const crcTable=Uint32Array.from({length:256},(_,value)=>{let crc=value;for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;});
const updateCrc=(crc:number,bytes:Uint8Array)=>{for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return crc>>>0;};
export function validateFileMetadata(name:string,mime:string,size:number,limits:ImportLimits):string {
  if (!name || name.length>160 || /[\\/\x00-\x1f\x7f]/.test(name) || !Number.isInteger(size) || size<=0 || size>limits.maxBytes) throw new ImportError('invalid_file');
  const ext=name.split('.').at(-1)?.toLowerCase()??'';
  if (!IMPORT_MIMES[ext] || IMPORT_MIMES[ext]!==mime) throw new ImportError('unsupported_file');
  return ext;
}
export function inspectZip(bytes:Uint8Array,limits:ImportLimits,requiredPrefix:string):void {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
  if(eocd<0 || view.getUint16(eocd+4,true)!==0 || view.getUint16(eocd+6,true)!==0) throw new ImportError('invalid_file');
  const count=view.getUint16(eocd+10,true),seen=new Set<string>();let offset=view.getUint32(eocd+16,true),expanded=0,hasContent=false;
  if(count<1 || count>2000) throw new ImportError('invalid_file');
  for(let i=0;i<count;i++) {
    if(offset+46>eocd || view.getUint32(offset,true)!==0x02014b50 || (view.getUint16(offset+8,true)&1)) throw new ImportError('invalid_file');
    const compressed=view.getUint32(offset+20,true),size=view.getUint32(offset+24,true),len=view.getUint16(offset+28,true);
    if(size===0xffffffff || compressed===0xffffffff) throw new ImportError('invalid_file');
    const end=offset+46+len+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);
    if(end>eocd) throw new ImportError('invalid_file');
    const path=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+len));
    if(path.startsWith('/') || path.includes('..') || path.includes('\\')||seen.has(path)) throw new ImportError('invalid_file');seen.add(path);
    expanded+=size;if(expanded>limits.maxExpandedBytes || (size>1000000 && size>Math.max(1,compressed)*100)) throw new ImportError('invalid_file');
    if(path===requiredPrefix)hasContent=true;
    // Require matching bounded local header; reject forged directory offsets/sizes.
    const local=view.getUint32(offset+42,true);
    if(local+30>bytes.length || view.getUint32(local,true)!==0x04034b50) throw new ImportError('invalid_file');
    const flags=view.getUint16(offset+8,true);
    if(view.getUint16(local+6,true)!==flags||view.getUint16(local+8,true)!==view.getUint16(offset+10,true))throw new ImportError('invalid_file');
    if(!(flags&8)&&(view.getUint32(local+14,true)!==view.getUint32(offset+16,true)||view.getUint32(local+18,true)!==compressed||view.getUint32(local+22,true)!==size))throw new ImportError('invalid_file');
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
    if(start+compressed>offset || new TextDecoder().decode(bytes.subarray(local+30,local+30+view.getUint16(local+26,true)))!==path) throw new ImportError('invalid_file');
    offset=end;
  }
  if(!hasContent)throw new ImportError('invalid_file');
}
export function validateFileBytes(bytes:Uint8Array,ext:string,limits:ImportLimits):void {
  if(!bytes.length || bytes.length>limits.maxBytes)throw new ImportError('invalid_file');
  const magic=(values:number[])=>values.every((value,index)=>bytes[index]===value);
  if(ext==='csv') {
    if(bytes.includes(0))throw new ImportError('invalid_file');
    try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new ImportError('invalid_file');}
  } else if(ext==='xlsx'||ext==='docx') {
    if(!magic([0x50,0x4b,3,4]))throw new ImportError('invalid_file');
    inspectZip(bytes,limits,ext==='xlsx'?'xl/workbook.xml':'word/document.xml');
  } else if(ext==='xls'||ext==='doc') {
    if(!magic([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))throw new ImportError('invalid_file');
    const directory=new TextDecoder('utf-16le').decode(bytes);
    if(ext==='doc'&&!directory.includes('WordDocument'))throw new ImportError('invalid_file');
  } else if(ext==='pdf') {
    const text=new TextDecoder('latin1').decode(bytes);
    if(!text.startsWith('%PDF-') || !text.includes('%%EOF') || /\/Encrypt\b/.test(text))throw new ImportError('invalid_file');
  } else if(ext==='jpg'||ext==='jpeg') {
    if(!magic([0xff,0xd8,0xff]) || bytes.at(-2)!==0xff || bytes.at(-1)!==0xd9)throw new ImportError('invalid_file');
    // Locate SOF dimensions before sending a decompression bomb to a provider.
    let offset=2,found=false;
    while(offset+8<bytes.length){if(bytes[offset]!==255)break;const marker=bytes[offset+1];offset+=2;
      if(marker===0xda)break;if(marker===0xd8 || marker===0xd9 || marker===0x01 || (marker>=0xd0&&marker<=0xd7))continue;
      const size=(bytes[offset]<<8)|bytes[offset+1];if(size<2||offset+size>bytes.length)throw new ImportError('invalid_file');
      if([0xc0,0xc1,0xc2].includes(marker)){const h=(bytes[offset+3]<<8)|bytes[offset+4],w=(bytes[offset+5]<<8)|bytes[offset+6];if(!w||!h||w*h>25000000)throw new ImportError('invalid_file');found=true;}
      offset+=size;
    }if(!found)throw new ImportError('invalid_file');
  } else if(ext==='png') {
    if(!magic([137,80,78,71,13,10,26,10]) || bytes.length<45)throw new ImportError('invalid_file');
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),w=v.getUint32(16),h=v.getUint32(20);
    if(!w||!h||w*h>25000000 || new TextDecoder().decode(bytes.subarray(12,16))!=='IHDR')throw new ImportError('invalid_file');
    if(new TextDecoder().decode(bytes.subarray(bytes.length-8,bytes.length-4))!=='IEND')throw new ImportError('invalid_file');
  } else throw new ImportError('unsupported_file');
}
// A forged ZIP directory can understate expansion. Measure actual decompression
// before SheetJS or a document provider sees the archive. No files are extracted.
export async function validateArchivePayload(bytes:Uint8Array,ext:string,limits:ImportLimits):Promise<void> {
  if(ext!=='xlsx'&&ext!=='docx')return;
  inspectZip(bytes,limits,ext==='xlsx'?'xl/workbook.xml':'word/document.xml');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=bytes.length-22;
  while(eocd>=0&&view.getUint32(eocd,true)!==0x06054b50)eocd--;
  let offset=view.getUint32(eocd+16,true),total=0;
  for(let i=0;i<view.getUint16(eocd+10,true);i++){
    const method=view.getUint16(offset+10,true),compressed=view.getUint32(offset+20,true),expected=view.getUint32(offset+24,true),local=view.getUint32(offset+42,true);
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true),payload=bytes.slice(start,start+compressed);
    if(method!==0&&method!==8)throw new ImportError('invalid_file');
    let crc=0xffffffff;
    if(method===0){if(compressed!==expected)throw new ImportError('invalid_file');total+=expected;crc=updateCrc(crc,payload);}
    else {
      let actual=0;try{
        const stream=new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw'));const reader=stream.getReader();
        for(;;){const {value,done}=await reader.read();if(done)break;actual+=value.length;if(actual>expected||total+actual>limits.maxExpandedBytes){await reader.cancel();throw new ImportError('invalid_file');}crc=updateCrc(crc,value);}
      }catch{throw new ImportError('invalid_file');}
      if(actual!==expected)throw new ImportError('invalid_file');total+=actual;
    }
    if(((crc^0xffffffff)>>>0)!==view.getUint32(offset+16,true))throw new ImportError('invalid_file');
    offset+=46+view.getUint16(offset+28,true)+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);
    if(total>limits.maxExpandedBytes)throw new ImportError('invalid_file');
  }
}
