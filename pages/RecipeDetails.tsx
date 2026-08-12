import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChefHat, Clock, Flame, Info, Users } from 'lucide-react';
import {
  fetchRecipe,
  getRecipeUserMessage,
  type Recipe,
  type RecipeMealType,
} from '../features/recipes/services/recipeService';

const MEAL_TYPE_LABELS: Record<RecipeMealType, string> = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle',
  dinner: 'Akşam',
  snack: 'Ara Öğün',
};

const RecipeDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    if (!id) {
      setIsLoading(false);
      setError('Tarif bulunamadı veya bu tarife erişim yetkiniz yok.');
      return () => { active = false; };
    }
    void fetchRecipe(id)
      .then((nextRecipe) => {
        if (active) setRecipe(nextRecipe);
      })
      .catch((cause) => {
        if (active) setError(getRecipeUserMessage(cause));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [id]);

  return (
    <div className="mx-auto min-h-screen max-w-7xl p-4 pb-20 md:p-8">
      <button
        type="button"
        onClick={() => navigate('/recipes')}
        className="mb-6 flex items-center gap-2 font-medium text-slate-500 transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-5 w-5" /> Tariflere dön
      </button>

      {isLoading ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-12 text-center text-sm text-slate-500" role="status">
          Tarif yükleniyor...
        </div>
      ) : error || !recipe ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center" role="alert">
          <h1 className="text-xl font-bold text-slate-800">Tarif yüklenemedi</h1>
          <p className="mt-2 text-sm text-slate-600">{error ?? 'Tarif bulunamadı.'}</p>
          <button type="button" onClick={() => navigate('/recipes')} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
            Tariflere dön
          </button>
        </div>
      ) : (
        <>
          <section className="mb-8 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm md:p-8">
            <div className="flex flex-col gap-8 md:flex-row">
              <div className="w-full md:w-1/3">
                {recipe.imagePreview ? (
                  <img src={recipe.imagePreview} alt={recipe.name} className="h-64 w-full rounded-2xl object-cover shadow-md md:h-full" />
                ) : (
                  <div className="flex h-64 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-400 md:h-full">Görsel yok</div>
                )}
              </div>
              <div className="flex w-full flex-col justify-center md:w-2/3">
                <span className="mb-4 w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                  {MEAL_TYPE_LABELS[recipe.mealType]}
                </span>
                <h1 className="mb-6 text-3xl font-bold text-slate-800 md:text-4xl">{recipe.name}</h1>
                {recipe.description && <p className="mb-6 whitespace-pre-wrap text-sm leading-6 text-slate-600">{recipe.description}</p>}
                <div className="flex flex-wrap gap-4 border-t border-slate-100 pt-6 md:gap-8">
                  <div className="flex items-center gap-3"><Flame className="h-6 w-6 text-orange-500" /><div><p className="text-xs text-slate-500">Kalori</p><p className="font-bold text-slate-800">{recipe.calories} kcal</p></div></div>
                  <div className="flex items-center gap-3"><Clock className="h-6 w-6 text-blue-500" /><div><p className="text-xs text-slate-500">Güncellendi</p><p className="font-bold text-slate-800">{new Date(recipe.updatedAt).toLocaleDateString('tr-TR')}</p></div></div>
                  <div className="flex items-center gap-3"><Users className="h-6 w-6 text-purple-500" /><div><p className="text-xs text-slate-500">Protein</p><p className="font-bold text-slate-800">{recipe.macros.protein} g</p></div></div>
                </div>
              </div>
            </div>
          </section>
          <section className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h2 className="mb-5 flex items-center gap-2 text-lg font-bold text-slate-800"><Info className="h-5 w-5 text-slate-400" /> Besin değerleri</h2>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between"><span className="text-slate-600">Protein</span><strong>{recipe.macros.protein} g</strong></div>
                <div className="flex justify-between"><span className="text-slate-600">Karbonhidrat</span><strong>{recipe.macros.carbs} g</strong></div>
                <div className="flex justify-between"><span className="text-slate-600">Yağ</span><strong>{recipe.macros.fat} g</strong></div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <h2 className="mb-5 flex items-center gap-2 text-lg font-bold text-slate-800"><ChefHat className="h-5 w-5 text-slate-400" /> Tarif kaydı</h2>
              <p className="text-sm leading-6 text-slate-600">Bu detay, yalnızca oturum açmış diyetisyenin sahip olduğu canonical tarif kaydından okunur.</p>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default RecipeDetails;
