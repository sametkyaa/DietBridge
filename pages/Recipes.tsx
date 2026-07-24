import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Edit2, Flame, Loader2, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import {
  createRecipe,
  deleteRecipe,
  fetchRecipes,
  getRecipeUserMessage,
  type Recipe,
  type RecipeInput,
  type RecipeMealType,
  updateRecipe,
} from '../features/recipes/services/recipeService';

const MEAL_TYPE_OPTIONS: Array<{ value: RecipeMealType; label: string }> = [
  { value: 'breakfast', label: 'Kahvaltı' },
  { value: 'lunch', label: 'Öğle' },
  { value: 'dinner', label: 'Akşam' },
  { value: 'snack', label: 'Ara Öğün' },
];

const getMealTypeLabel = (mealType: RecipeMealType): string => (
  MEAL_TYPE_OPTIONS.find((option) => option.value === mealType)?.label ?? 'Ara Öğün'
);

type RecipeFormState = {
  name: string;
  description: string;
  mealType: RecipeMealType;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  imageFile: File | null;
};

const EMPTY_FORM: RecipeFormState = {
  name: '',
  description: '',
  mealType: 'breakfast',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  imageFile: null,
};

const toFormState = (recipe: Recipe): RecipeFormState => ({
  name: recipe.name,
  description: recipe.description ?? '',
  mealType: recipe.mealType,
  calories: String(recipe.calories),
  protein: String(recipe.macros.protein),
  carbs: String(recipe.macros.carbs),
  fat: String(recipe.macros.fat),
  imageFile: null,
});

const toInput = (form: RecipeFormState): RecipeInput => ({
  name: form.name,
  description: form.description,
  mealType: form.mealType,
  calories: Number(form.calories),
  macros: {
    protein: Number(form.protein),
    carbs: Number(form.carbs),
    fat: Number(form.fat),
  },
});

const Recipes = () => {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mealTypeFilter, setMealTypeFilter] = useState<'all' | RecipeMealType>('all');
  const [form, setForm] = useState<RecipeFormState>(EMPTY_FORM);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recipeToDelete, setRecipeToDelete] = useState<Recipe | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadRecipes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRecipes(await fetchRecipes());
    } catch (loadError) {
      setError(getRecipeUserMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadRecipes(); }, [loadRecipes]);

  const filteredRecipes = recipes.filter((recipe) => (
    (mealTypeFilter === 'all' || recipe.mealType === mealTypeFilter)
    && recipe.name.toLocaleLowerCase('tr-TR').includes(search.trim().toLocaleLowerCase('tr-TR'))
  ));

  const openCreateForm = () => {
    setEditingRecipe(null);
    setForm(EMPTY_FORM);
    setIsFormOpen(true);
  };

  const openEditForm = (recipe: Recipe) => {
    setEditingRecipe(recipe);
    setForm(toFormState(recipe));
    setIsFormOpen(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const saved = editingRecipe
        ? await updateRecipe(editingRecipe.id, toInput(form), form.imageFile)
        : await createRecipe(toInput(form), form.imageFile);
      setRecipes((current) => editingRecipe
        ? current.map((recipe) => recipe.id === saved.id ? saved : recipe)
        : [saved, ...current]);
      setSuccessMessage(editingRecipe ? 'Tarif güncellendi.' : 'Tarif oluşturuldu.');
      setIsFormOpen(false);
    } catch (submitError) {
      setError(getRecipeUserMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!recipeToDelete) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteRecipe(recipeToDelete.id);
      setRecipes((current) => current.filter((recipe) => recipe.id !== recipeToDelete.id));
      setSuccessMessage('Tarif silindi.');
      setRecipeToDelete(null);
    } catch (deleteError) {
      setError(getRecipeUserMessage(deleteError));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col p-4 md:h-screen md:p-8">
      <header className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 md:text-3xl">Tarifler</h1>
          <p className="mt-1 text-sm text-slate-500">Kayıtlı tariflerinizi yönetin ve haftalık planlarda kullanın.</p>
        </div>
        <button type="button" onClick={openCreateForm} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary/30 hover:bg-primary-dark">
          <Plus className="h-5 w-5" /> Yeni Tarif
        </button>
      </header>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert"><p>{error}</p><button type="button" onClick={() => void loadRecipes()} className="mt-3 min-h-11 rounded-lg border border-rose-300 bg-white px-4 font-semibold">Tekrar dene</button></div>}
      {successMessage && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">{successMessage}</div>}

      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row">
          <label className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tarif ara..." className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" /></label>
          <select value={mealTypeFilter} onChange={(event) => setMealTypeFilter(event.target.value as 'all' | RecipeMealType)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="all">Tüm öğün tipleri</option>{MEAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {isLoading ? <p className="p-8 text-center text-sm text-slate-500">Tarifler yükleniyor...</p> : recipes.length === 0 ? <div className="p-8 text-center"><p className="text-slate-500">Henüz kayıtlı tarif bulunmuyor.</p><button type="button" onClick={openCreateForm} className="mt-4 min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white">İlk tarifi oluştur</button></div> : filteredRecipes.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">Aramanızla eşleşen tarif bulunamadı.</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filteredRecipes.map((recipe) => <article key={recipe.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex gap-3 p-4">{recipe.imagePreview ? <img src={recipe.imagePreview} alt={recipe.name} className="h-16 w-16 rounded-lg object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-400">Tarif</div>}<div className="min-w-0 flex-1"><h2 className="truncate font-bold text-slate-800">{recipe.name}</h2><span className="mt-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{getMealTypeLabel(recipe.mealType)}</span><p className="mt-2 flex items-center gap-1 text-xs font-semibold text-orange-600"><Flame className="h-3.5 w-3.5" /> {recipe.calories} kcal</p></div></div><div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-600">P {recipe.macros.protein}g · K {recipe.macros.carbs}g · Y {recipe.macros.fat}g</div><div className="flex justify-end gap-2 border-t border-slate-100 p-2"><button type="button" onClick={() => openEditForm(recipe)} className="min-h-11 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-50"><Edit2 className="inline h-4 w-4" /> Düzenle</button><button type="button" onClick={() => setRecipeToDelete(recipe)} className="min-h-11 rounded-lg px-3 text-sm text-rose-600 hover:bg-rose-50"><Trash2 className="inline h-4 w-4" /> Sil</button></div></article>)}</div>}
        </div>
      </section>

      {isFormOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"><form onSubmit={handleSubmit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 className="text-lg font-bold text-slate-800">{editingRecipe ? 'Tarifi Düzenle' : 'Yeni Tarif'}</h2><button type="button" onClick={() => setIsFormOpen(false)} className="rounded-full p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="space-y-4 p-5"><label className="block text-sm font-semibold text-slate-700">Tarif adı<input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 font-normal" /></label><label className="block text-sm font-semibold text-slate-700">Açıklama<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 p-3 font-normal" rows={3} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Öğün tipi<select value={form.mealType} onChange={(event) => setForm((current) => ({ ...current, mealType: event.target.value as RecipeMealType }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 font-normal">{MEAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Kalori<input required min="0" type="number" value={form.calories} onChange={(event) => setForm((current) => ({ ...current, calories: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Protein (g)<input required min="0" type="number" value={form.protein} onChange={(event) => setForm((current) => ({ ...current, protein: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Karbonhidrat (g)<input required min="0" type="number" value={form.carbs} onChange={(event) => setForm((current) => ({ ...current, carbs: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 font-normal" /></label><label className="text-sm font-semibold text-slate-700">Yağ (g)<input required min="0" type="number" value={form.fat} onChange={(event) => setForm((current) => ({ ...current, fat: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 font-normal" /></label><label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 text-sm text-slate-600"><Upload className="h-4 w-4" /> Görsel seç<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => setForm((current) => ({ ...current, imageFile: event.target.files?.[0] ?? null }))} /></label></div>{form.imageFile && <p className="text-xs text-slate-500">Seçilen görsel: {form.imageFile.name}</p>}</div><div className="flex justify-end gap-3 border-t border-slate-100 p-5"><button type="button" onClick={() => setIsFormOpen(false)} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-600">İptal</button><button disabled={isSubmitting} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60">{isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}{editingRecipe ? 'Güncelle' : 'Oluştur'}</button></div></form></div>}

      {recipeToDelete && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"><div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-bold text-slate-800">Tarifi sil</h2><p className="mt-2 text-sm text-slate-600"><strong>{recipeToDelete.name}</strong> silinsin mi? Bu işlem geri alınamaz.</p><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setRecipeToDelete(null)} disabled={isDeleting} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-600">Vazgeç</button><button type="button" onClick={() => void handleDelete()} disabled={isDeleting} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-60">{isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}Sil</button></div></div></div>}
    </div>
  );
};

export default Recipes;
