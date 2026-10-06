import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { Badge, Button, Callout, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Icon, Input, LoadingState, Modal, PageContainer, PageHeader, SearchInput, Select, Textarea } from '../shared/ui';
import './Nutrition.css';
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
const RecipeImportDialog = lazy(() => import('../features/recipes/components/RecipeImportDialog'));

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
  const [isImportOpen, setIsImportOpen] = useState(false);

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
    setError(null);
    setSuccessMessage(null);
    setEditingRecipe(null);
    setForm(EMPTY_FORM);
    setIsFormOpen(true);
  };

  const openEditForm = (recipe: Recipe) => {
    setError(null);
    setSuccessMessage(null);
    setEditingRecipe(recipe);
    setForm(toFormState(recipe));
    setIsFormOpen(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSuccessMessage(null);
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
    if (!recipeToDelete || isDeleting) return;
    setIsDeleting(true);
    setSuccessMessage(null);
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
    <PageContainer className="nutrition-page recipes-page">
      {isImportOpen && <Suspense fallback={<LoadingState label="İçe aktarma açılıyor…" />}><RecipeImportDialog existingNames={recipes.map(recipe => recipe.name)} onClose={() => setIsImportOpen(false)} onSaved={count => { setIsImportOpen(false); setSuccessMessage(`${count} tarif kaydedildi.`); void loadRecipes(); }} /></Suspense>}
      <PageHeader title="Tarifler" description="Tariflerinizi düzenleyin, beslenme planlarında kolayca kullanın." actions={<>
        {import.meta.env.VITE_RECIPE_IMPORT_ENABLED === 'true' && <Button leftIcon="paperclip" onClick={() => setIsImportOpen(true)}>Dosyadan içe aktar</Button>}
        <Button variant="primary" leftIcon="plus" onClick={openCreateForm}>Yeni tarif</Button>
      </>} />
      {error && !isFormOpen && !recipeToDelete && recipes.length > 0 && <Callout tone="bad" role="alert" className="nutrition-notice">{error}<Button size="sm" onClick={() => void loadRecipes()}>Tekrar dene</Button></Callout>}
      {successMessage && <Callout tone="ok" role="status" className="nutrition-notice">{successMessage}</Callout>}
      <Card padding="none" className="recipe-library">
        <div className="recipe-library-heading"><CardHeader title="Tarif kütüphanesi" description="Size ait tarifler ve besin değerleri" addon={<Badge size="sm">{recipes.length}</Badge>} /></div>
        <div className="recipe-filter-row">
          <SearchInput label="Kütüphanede tarif ara" placeholder="Tarif adıyla ara…" value={search} onChange={event => setSearch(event.target.value)} />
          <div className="recipe-category-filters" role="group" aria-label="Öğün tipi filtresi">
            {[{ value: 'all' as const, label: 'Tümü' }, ...MEAL_TYPE_OPTIONS].map(option => <button key={option.value} type="button" aria-pressed={mealTypeFilter === option.value} className={mealTypeFilter === option.value ? 'active' : ''} onClick={() => setMealTypeFilter(option.value)}>{option.label}<span>{option.value === 'all' ? recipes.length : recipes.filter(recipe => recipe.mealType === option.value).length}</span></button>)}
          </div>
        </div>
        <div className="recipe-library-body">
          {isLoading ? <LoadingState label="Tarifler yükleniyor…" variant="skeleton" rows={3} /> : error && recipes.length === 0 && !isFormOpen ? <ErrorState description={error} onRetry={() => void loadRecipes()} /> : recipes.length === 0 ? <EmptyState icon="bowl-food" title="Henüz tarif eklenmedi." description="İlk tarifinizi ekleyin ve beslenme planlarında kullanın." action={<Button variant="primary" leftIcon="plus" onClick={openCreateForm}>Yeni tarif</Button>} /> : filteredRecipes.length === 0 ? <EmptyState icon="magnifying-glass" title="Aramanızla eşleşen tarif bulunamadı." description="Başka bir sözcük deneyin veya öğün filtresini değiştirin." action={<Button onClick={() => { setSearch(''); setMealTypeFilter('all'); }}>Filtreleri temizle</Button>} /> : <div className="recipe-grid">
            {filteredRecipes.map(recipe => <Card key={recipe.id} as="article" padding="none" className="recipe-card">
              <div className="recipe-overview">
                {recipe.imagePreview ? <img src={recipe.imagePreview} alt={recipe.name} className="recipe-thumbnail" loading="lazy" /> : <div className="recipe-thumbnail recipe-image-empty" aria-label="Tarif görseli yok"><Icon name="bowl-food" size={29} /></div>}
                <div><Badge size="sm" tone="brand">{getMealTypeLabel(recipe.mealType)}</Badge><h2>{recipe.name}</h2><p>{recipe.description || 'Açıklama eklenmemiş.'}</p></div>
              </div>
              <div className="recipe-macros">{[{ label: 'Protein', value: recipe.macros.protein }, { label: 'Karbonhidrat', value: recipe.macros.carbs }, { label: 'Yağ', value: recipe.macros.fat }].map(macro => <div key={macro.label}><span>{macro.label}</span><b>{macro.value}<small> g</small></b></div>)}</div>
              <div className="recipe-footer"><span className="recipe-calories"><Icon name="flame" size={17} /><b>{recipe.calories}</b> kcal</span><div><Button size="sm" variant="ghost" leftIcon="pencil-simple" onClick={() => openEditForm(recipe)}>Düzenle</Button><button type="button" aria-label={`${recipe.name} tarifini sil`} className="recipe-delete" onClick={() => { setError(null); setRecipeToDelete(recipe); }}><Trash2 size={16} /></button></div></div>
            </Card>)}
          </div>}
        </div>
        {!isLoading && <div className="library-footer"><span>{filteredRecipes.length} tarif gösteriliyor</span><span>1 porsiyon için besin değerleri</span></div>}
      </Card>
      <Modal open={isFormOpen} onClose={() => setIsFormOpen(false)} dismissible={!isSubmitting} title={editingRecipe ? 'Tarifi düzenle' : 'Yeni tarif'} description="Tarif bilgileri ve bir porsiyon için besin değerleri." size="lg" footer={<><Button disabled={isSubmitting} onClick={() => setIsFormOpen(false)}>Vazgeç</Button><Button type="submit" form="recipe-form" variant="primary" loading={isSubmitting}>{editingRecipe ? 'Değişiklikleri kaydet' : 'Tarifi oluştur'}</Button></>}>
        {error && <Callout tone="bad" role="alert">{error}</Callout>}
        <form id="recipe-form" onSubmit={handleSubmit} className="nutrition-form">
          <Input label="Tarif adı" maxLength={160} required disabled={isSubmitting} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
          <Textarea label="Açıklama" maxLength={2000} rows={2} disabled={isSubmitting} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} />
          <div className="nutrition-form-two"><Select label="Öğün tipi" disabled={isSubmitting} value={form.mealType} onChange={event => setForm(current => ({ ...current, mealType: event.target.value as RecipeMealType }))} options={MEAL_TYPE_OPTIONS} /><Input label="Kalori" trailing="kcal" type="number" min={0} required disabled={isSubmitting} value={form.calories} onChange={event => setForm(current => ({ ...current, calories: event.target.value }))} /></div>
          <div className="nutrition-form-three">{(['protein', 'carbs', 'fat'] as const).map((key, index) => <Input key={key} label={['Protein', 'Karbonhidrat', 'Yağ'][index]} trailing="g" type="number" min={0} step="any" required disabled={isSubmitting} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} />)}</div>
          {editingRecipe?.imagePreview && !form.imageFile && <img src={editingRecipe.imagePreview} alt="Mevcut tarif görseli" className="recipe-form-photo" />}
          <label className="nutrition-image-input"><Camera size={23} /><b>{form.imageFile?.name || 'Tarif görseli seç'}</b><span>JPG, PNG veya WebP · En fazla 5 MiB</span><input aria-label="Tarif görseli seç" type="file" disabled={isSubmitting} accept="image/jpeg,image/png,image/webp" onChange={event => setForm(current => ({ ...current, imageFile: event.target.files?.[0] ?? null }))} /></label>
        </form>
      </Modal>
      <ConfirmDialog open={recipeToDelete !== null} onCancel={() => setRecipeToDelete(null)} onConfirm={() => void handleDelete()} title="Tarifi sil" description={`${recipeToDelete?.name ?? ''} silinsin mi? Bu işlem geri alınamaz.`} confirmLabel="Sil" tone="danger" busy={isDeleting}>{error && <Callout tone="bad" role="alert">{error}</Callout>}</ConfirmDialog>
    </PageContainer>
  );
};

export default Recipes;
