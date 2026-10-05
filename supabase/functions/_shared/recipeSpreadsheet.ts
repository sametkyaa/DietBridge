import { draftIssues, type RecipeDraft } from './recipeContract.ts';
import { ImportError, type ImportLimits } from './recipeFiles.ts';
export type ColumnField='name'|'description'|'mealType'|'calories'|'protein'|'carbs'|'fat'|'ingredients'|'instructions';
export type ColumnMapping=Partial<Record<ColumnField,number>>;
export interface SheetTable { name:string; rows:unknown[][]; firstRow?:number }
export interface ImportItem { draft:RecipeDraft; source:{sheet?:string;row?:number;page?:number|null;section?:string|null};validationState:'valid'|'needs_review';warnings:string[] }
const aliases:Record<ColumnField,string[]>={
  name:['tarif','tarifadi','ad','name','recipe','recipename'],description:['aciklama','description'],mealType:['ogun','ogunturu','mealtype'],calories:['kalori','kcal','calories'],
  protein:['protein'],carbs:['karbonhidrat','karb','carbs','carbohydrates'],fat:['yag','fat'],ingredients:['malzemeler','ingredients'],instructions:['hazirlanis','yapilis','instructions'],
};
export const normalizeHeader=(value:unknown)=>String(value??'').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
export function inferMapping(headers:unknown[]):{mapping:ColumnMapping;ambiguous:boolean} {
  const mapping:ColumnMapping={};let ambiguous=false;
  for(const field of Object.keys(aliases) as ColumnField[]){const matches=headers.flatMap((h,i)=>aliases[field].includes(normalizeHeader(h))?[i]:[]);if(matches.length===1)mapping[field]=matches[0];else if(matches.length>1)ambiguous=true;}
  if(mapping.name===undefined)ambiguous=true;
  return {mapping,ambiguous};
}
export function parseCsv(bytes:Uint8Array,limits:ImportLimits):SheetTable[] {
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');
  const first=text.split(/\r?\n/)[0];const delimiter=(first.match(/;/g)?.length??0)>(first.match(/,/g)?.length??0)?';':',';
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  const finishCell=()=>{if(cell.length>5000)throw new ImportError('invalid_file');row.push(cell);cell='';closed=false;if(row.length>limits.maxColumns)throw new ImportError('invalid_file');};
  const finishRow=()=>{finishCell();rows.push(row);row=[];if(rows.length>limits.maxRows+1)throw new ImportError('invalid_file');};
  for(let i=0;i<text.length;i++){const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
    else if(c==='"'){if(cell||closed)throw new ImportError('invalid_file');quoted=true;}
    else if(c===delimiter)finishCell();else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;finishRow();}
    else {if(closed&&!/\s/.test(c))throw new ImportError('invalid_file');if(!closed)cell+=c;}
    if(cell.length>5000)throw new ImportError('invalid_file');
  }
  if(quoted)throw new ImportError('invalid_file');if(cell||row.length||closed)finishRow();
  if(rows.length<2)throw new ImportError('empty_output');return [{name:'CSV',rows}];
}
export interface WorkbookReader {
  read(bytes:Uint8Array,options:Record<string,unknown>):{SheetNames:string[];Sheets:Record<string,unknown>};
  utils:{sheet_to_json(sheet:unknown,options:Record<string,unknown>):unknown[][]};
}
function boundedWorksheetRange(sheet:unknown,limits:ImportLimits):{s:{r:number;c:number};e:{r:number;c:number}}|null {
  if(!sheet||typeof sheet!=='object')throw new ImportError('invalid_file');
  const ref=(sheet as Record<string,unknown>)['!ref'];
  if(ref===undefined)return null;
  if(typeof ref!=='string'||ref.length>40)throw new ImportError('invalid_file');
  const match=/^([A-Z]{1,7})([1-9]\d{0,6})(?::([A-Z]{1,7})([1-9]\d{0,6}))?$/.exec(ref);
  if(!match)throw new ImportError('invalid_file');
  const column=(value:string)=>Array.from(value).reduce((total,char)=>total*26+char.charCodeAt(0)-64,0)-1;
  const s={c:column(match[1]),r:Number(match[2])-1},e={c:column(match[3]??match[1]),r:Number(match[4]??match[2])-1};
  // Bound absolute coordinates before SheetJS allocates synthetic cells from !ref.
  if(s.c>e.c||s.r>e.r||e.c>=limits.maxColumns||e.r>limits.maxRows)throw new ImportError('invalid_file');
  return {s,e};
}
export function readWorkbook(bytes:Uint8Array,reader:WorkbookReader,limits:ImportLimits):SheetTable[] {
  try {
    const book=reader.read(bytes,{type:'array',cellDates:false,cellFormula:false,bookVBA:false,sheetRows:limits.maxRows+2});
    if(!book.SheetNames.length||book.SheetNames.length>10)throw new ImportError('invalid_file');
    const tables=book.SheetNames.map(name=>{
      const sheet=book.Sheets[name],range=boundedWorksheetRange(sheet,limits);
      return {name,firstRow:range?range.s.r+1:1,rows:range?reader.utils.sheet_to_json(sheet,{header:1,defval:null,raw:true,blankrows:true,range}):[]};
    }).filter(t=>t.rows.length>1);
    if(!tables.length)throw new ImportError('empty_output');
    if(tables.some(t=>t.rows.length>limits.maxRows+1||t.rows.some(row=>row.length>limits.maxColumns||row.some(c=>String(c??'').length>5000))))throw new ImportError('invalid_file');
    return tables;
  }catch(error){if(error instanceof ImportError)throw error;throw new ImportError('invalid_file');}
}
const numeric=(value:unknown):number|null=>{
  if(value==null||String(value).trim()==='')return null;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const text=String(value).trim();if(!/^-?\d+(?:[.,]\d+)?$/.test(text))return null;
  const number=Number(text.replace(',','.'));return Number.isFinite(number)?number:null;
};
const meals:Record<string,RecipeDraft['mealType']>={breakfast:'breakfast',kahvalti:'breakfast',lunch:'lunch',ogle:'lunch',dinner:'dinner',aksam:'dinner',snack:'snack',araogun:'snack'};
export function mapTables(tables:SheetTable[],mappings:Record<string,ColumnMapping>,limits:ImportLimits):ImportItem[] {
  const items:ImportItem[]=[];const names=new Set<string>();
  for(const table of tables){const inferred=inferMapping(table.rows[0]);const mapping=mappings[table.name]??inferred.mapping;
    if(!mappings[table.name]&&inferred.ambiguous)throw new ImportError('column_mapping_required');
    const columns=Object.values(mapping);if(mapping.name===undefined||new Set(columns).size!==columns.length||columns.some(i=>!Number.isInteger(i)||i<0||i>=table.rows[0].length))throw new ImportError('column_mapping_required');
    for(let i=1;i<table.rows.length;i++){const row=table.rows[i];if(row.every(c=>c==null||String(c).trim()===''))continue;
      const value=(field:ColumnField)=>mapping[field]===undefined?null:row[mapping[field]!];
      const description=[value('description'),value('ingredients')?`Malzemeler: ${value('ingredients')}`:null,value('instructions')?`Hazırlanış: ${value('instructions')}`:null].filter(v=>v!=null&&String(v).trim()).join('\n\n')||null;
      const draft:RecipeDraft={name:String(value('name')??'').trim(),description,mealType:meals[normalizeHeader(value('mealType'))]??null,calories:numeric(value('calories')),macros:{protein:numeric(value('protein')),carbs:numeric(value('carbs')),fat:numeric(value('fat'))}};
      const warnings=draftIssues(draft),name=normalizeHeader(draft.name);if(names.has(name))warnings.push('Aynı adlı tarif var; seçiminizi kontrol edin.');names.add(name);
      items.push({draft,source:{sheet:table.name,row:(table.firstRow??1)+i},validationState:draftIssues(draft).length?'needs_review':'valid',warnings});
      if(items.length>limits.maxRecipes)throw new ImportError('too_many_recipes');
    }
  }if(!items.length)throw new ImportError('empty_output');return items;
}
