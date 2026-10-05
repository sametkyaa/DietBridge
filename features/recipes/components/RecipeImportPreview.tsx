import { draftIssues, type RecipeDraft } from '../../../supabase/functions/_shared/recipeContract';
import type { RecipeImportItem } from '../services/recipeImportService';
const inputClass='w-full rounded-lg border border-slate-200 p-2 text-sm';
export default function RecipeImportPreview({items,selected,onSelect,onEdit,busy,existingNames}:{items:RecipeImportItem[];selected:Set<string>;onSelect:(id:string,selected:boolean)=>void;onEdit:(id:string,draft:RecipeDraft)=>void;busy:boolean;existingNames:string[]}) {
  return <><p className="my-4 font-semibold">{items.length} tarif bulundu · {items.filter(item=>draftIssues(item.recipe_draft).length).length} tarifin kontrol edilmesi gerekiyor</p>
    {items.map((item,index)=>{const draft=item.recipe_draft,issues=draftIssues(draft),source=item.source_reference;
      const edit=(update:Partial<RecipeDraft>)=>onEdit(item.id,{...draft,...update});
      const duplicate=existingNames.some(name=>name.toLocaleLowerCase('tr-TR')===draft.name.toLocaleLowerCase('tr-TR'));
      return <fieldset key={item.id} disabled={busy} className="mb-4 rounded-xl border border-slate-200 p-3">
        <legend><label className="flex items-center gap-2"><input type="checkbox" aria-label={`Tarif ${index+1} seç`} checked={selected.has(item.id)} onChange={event=>onSelect(item.id,event.target.checked)} />Tarif {index+1}</label></legend>
        <p className="mb-2 text-xs text-slate-500">Kaynak: {source.sheet??source.section??'Belge'}{source.row?` · Satır ${source.row}`:''}{source.page?` · Sayfa ${source.page}`:''}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Tarif adı<input aria-label={`Tarif ${index+1} adı`} className={inputClass} value={draft.name} onChange={e=>edit({name:e.target.value})} /></label>
          <label className="text-sm">Öğün<select aria-label={`Tarif ${index+1} öğün`} className={inputClass} value={draft.mealType??''} onChange={e=>edit({mealType:(e.target.value||null) as RecipeDraft['mealType']})}><option value="">Öğün seçin</option><option value="breakfast">Kahvaltı</option><option value="lunch">Öğle</option><option value="dinner">Akşam</option><option value="snack">Ara Öğün</option></select></label>
          <label className="text-sm sm:col-span-2">Açıklama<textarea aria-label={`Tarif ${index+1} açıklama`} className={inputClass} value={draft.description??''} onChange={e=>edit({description:e.target.value||null})} /></label>
          {(['calories','protein','carbs','fat'] as const).map(key=><label key={key} className="text-sm">{key==='calories'?'Kalori':key==='protein'?'Protein (g)':key==='carbs'?'Karbonhidrat (g)':'Yağ (g)'}<input type="number" min="0" step={key==='calories'?'1':'any'} aria-label={`Tarif ${index+1} ${key}`} className={inputClass} value={(key==='calories'?draft.calories:draft.macros[key])??''} onChange={e=>{const value=e.target.value===''?null:Number(e.target.value);edit(key==='calories'?{calories:value}:{macros:{...draft.macros,[key]:value}});}} /></label>)}
        </div>
        {issues.map(issue=><p key={issue} className="mt-1 text-xs text-amber-800">{issue}</p>)}
        {duplicate&&<p className="mt-2 text-xs text-amber-800">Kayıtlı aynı adlı tarif var; yeni bir tarif oluşturulacak.</p>}
        {item.warnings.filter(warning=>warning.startsWith('Aynı adlı')).map(warning=><p key={warning} className="text-xs text-amber-800">{warning}</p>)}
      </fieldset>;
    })}
  </>;
}
