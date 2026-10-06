import { Fragment } from 'react';
import { draftIssues, type RecipeDraft } from '../../../supabase/functions/_shared/recipeContract';
import type { RecipeImportItem } from '../services/recipeImportService';
import { Icon, cx } from '../../../shared/ui';

const inputClass = 'h-9 w-full rounded-control border border-line-strong bg-surface px-2.5 text-13.5 text-ink focus:border-brand focus:outline-none focus:shadow-focus disabled:bg-sunk';
const NUTRITION_FIELDS = [
  ['calories', 'Kalori', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Karbonhidrat', 'g'],
  ['fat', 'Yağ', 'g'],
] as const;

export default function RecipeImportPreview({ items, selected, onSelect, onEdit, busy, existingNames, fileName = null }: { items: RecipeImportItem[]; selected: Set<string>; onSelect: (id: string, selected: boolean) => void; onEdit: (id: string, draft: RecipeDraft) => void; busy: boolean; existingNames: string[]; fileName?: string | null }) {
  const needsReview = items.filter((item) => draftIssues(item.recipe_draft).length).length;
  return (
    <>
      <p className="m-0 flex flex-wrap items-center gap-2 text-13.5 font-semibold">
        {items.length} tarif bulundu · {needsReview} tarifin kontrol edilmesi gerekiyor
        {fileName && <span className="ml-auto font-normal text-ink-3">{fileName}</span>}
      </p>
      <p className="m-0 -mt-2 text-12.5 text-ink-3">Boş bırakılan besin değerleri tahmin edilmez; kaydetmeden önce elle girin veya tarifi seçmeyin.</p>
      {items.map((item, index) => {
        const draft = item.recipe_draft;
        const issues = draftIssues(draft);
        const source = item.source_reference;
        const edit = (update: Partial<RecipeDraft>) => onEdit(item.id, { ...draft, ...update });
        const duplicate = existingNames.some((name) => name.toLocaleLowerCase('tr-TR') === draft.name.toLocaleLowerCase('tr-TR'));
        const isSelected = selected.has(item.id);
        return (
          <Fragment key={item.id}>
            <fieldset disabled={busy} className={cx('m-0 rounded-card border p-3.5', isSelected ? 'border-brand' : 'border-line', issues.length > 0 && 'border-warn')}>
              <legend className="px-1">
                <label className="flex items-center gap-2 text-13.5 font-semibold">
                  <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--db-brand))]" aria-label={`Tarif ${index + 1} seç`} checked={isSelected} onChange={(event) => onSelect(item.id, event.target.checked)} />
                  Tarif {index + 1}
                </label>
              </legend>
              <p className="m-0 mb-2.5 text-12 text-ink-3">Kaynak: {source.sheet ?? source.section ?? 'Belge'}{source.row ? ` · Satır ${source.row}` : ''}{source.page ? ` · Sayfa ${source.page}` : ''}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-12.5 font-medium text-ink-2">Tarif adı<input aria-label={`Tarif ${index + 1} adı`} className={inputClass} value={draft.name} onChange={(e) => edit({ name: e.target.value })} /></label>
                <label className="flex flex-col gap-1 text-12.5 font-medium text-ink-2">Öğün
                  <select aria-label={`Tarif ${index + 1} öğün`} className={inputClass} value={draft.mealType ?? ''} onChange={(e) => edit({ mealType: (e.target.value || null) as RecipeDraft['mealType'] })}>
                    <option value="">Öğün seçin</option><option value="breakfast">Kahvaltı</option><option value="lunch">Öğle</option><option value="dinner">Akşam</option><option value="snack">Ara Öğün</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-12.5 font-medium text-ink-2 sm:col-span-2">Açıklama
                  <textarea aria-label={`Tarif ${index + 1} açıklama`} rows={2} className={cx(inputClass, 'h-auto py-2')} value={draft.description ?? ''} onChange={(e) => edit({ description: e.target.value || null })} />
                </label>
                <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-4">
                  {NUTRITION_FIELDS.map(([key, label, unit]) => (
                    <label key={key} className="flex flex-col gap-1 text-12.5 font-medium text-ink-2">{label} ({unit})
                      <input
                        type="number"
                        min="0"
                        step={key === 'calories' ? '1' : 'any'}
                        aria-label={`Tarif ${index + 1} ${key}`}
                        className={inputClass}
                        value={(key === 'calories' ? draft.calories : draft.macros[key]) ?? ''}
                        onChange={(e) => { const value = e.target.value === '' ? null : Number(e.target.value); edit(key === 'calories' ? { calories: value } : { macros: { ...draft.macros, [key]: value } }); }}
                      />
                    </label>
                  ))}
                </div>
              </div>
              {issues.map((issue) => <p key={issue} className="m-0 mt-2 flex items-center gap-1.5 text-12.5 font-medium text-warn"><Icon name="warning-circle" size={14} />{issue}</p>)}
              {duplicate && <p className="m-0 mt-2 flex items-center gap-1.5 text-12.5 text-ink-2"><Icon name="info" size={14} />Kayıtlı aynı adlı tarif var; yeni bir tarif oluşturulacak.</p>}
              {item.warnings.filter((warning) => warning.startsWith('Aynı adlı')).map((warning) => <p key={warning} className="m-0 mt-1 text-12.5 text-ink-2">{warning}</p>)}
            </fieldset>
          </Fragment>
        );
      })}
    </>
  );
}
