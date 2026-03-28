import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Users, Flame, ChefHat, Info, CheckCircle2 } from 'lucide-react';
import { RECIPES } from '../constants';
import { RecipeCategory } from '../types';

const RecipeDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const recipe = RECIPES.find(r => r.id === id);

  if (!recipe) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-screen">
        <h2 className="text-2xl font-bold text-slate-800">Tarif Bulunamadı</h2>
        <button onClick={() => navigate('/recipes')} className="mt-4 text-primary font-medium hover:underline">
          Tariflere Dön
        </button>
      </div>
    );
  }

  const getCategoryColor = (category: RecipeCategory) => {
    switch (category) {
      case 'Kahvaltı': return 'bg-yellow-100 text-yellow-700';
      case 'Ara Öğün': return 'bg-blue-100 text-blue-700';
      case 'Öğle Yemeği': return 'bg-emerald-100 text-emerald-700';
      case 'Akşam Yemeği': return 'bg-purple-100 text-purple-700';
      case 'Tatlı': return 'bg-pink-100 text-pink-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen pb-20">
      <button 
        onClick={() => navigate('/recipes')}
        className="flex items-center gap-2 text-slate-500 hover:text-primary transition-colors mb-6 font-medium group"
      >
        <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
        Listeye Dön
      </button>

      {/* Hero Section */}
      <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100 mb-8">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="w-full md:w-1/3">
             <img src={recipe.image} alt={recipe.name} className="w-full h-64 md:h-full object-cover rounded-2xl shadow-md" />
          </div>
          <div className="w-full md:w-2/3 flex flex-col justify-center">
             <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${getCategoryColor(recipe.category)}`}>
                   {recipe.category}
                </span>
                {recipe.cuisine && (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                    {recipe.cuisine} Mutfak
                  </span>
                )}
             </div>
             <h1 className="text-3xl md:text-4xl font-bold text-slate-800 mb-6">{recipe.name}</h1>
             
             <div className="flex flex-wrap gap-4 md:gap-8 border-t border-slate-100 pt-6">
                <div className="flex items-center gap-3">
                   <div className="p-2.5 bg-orange-50 text-orange-500 rounded-xl">
                      <Flame className="w-6 h-6" />
                   </div>
                   <div>
                      <p className="text-xs text-slate-500 font-medium uppercase">Kalori</p>
                      <p className="font-bold text-slate-800">{recipe.calories} kcal</p>
                   </div>
                </div>
                <div className="flex items-center gap-3">
                   <div className="p-2.5 bg-blue-50 text-blue-500 rounded-xl">
                      <Clock className="w-6 h-6" />
                   </div>
                   <div>
                      <p className="text-xs text-slate-500 font-medium uppercase">Süre</p>
                      <p className="font-bold text-slate-800">{recipe.prepTime}</p>
                   </div>
                </div>
                <div className="flex items-center gap-3">
                   <div className="p-2.5 bg-purple-50 text-purple-500 rounded-xl">
                      <Users className="w-6 h-6" />
                   </div>
                   <div>
                      <p className="text-xs text-slate-500 font-medium uppercase">Porsiyon</p>
                      <p className="font-bold text-slate-800">{recipe.servings} Kişilik</p>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
         {/* Left Column: Ingredients & Nutrition */}
         <div className="space-y-8">
            {/* Ingredients */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
               <div className="bg-emerald-50/50 p-4 border-b border-emerald-100">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                     <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                     Malzemeler
                  </h3>
               </div>
               <div className="p-6">
                  <ul className="space-y-4">
                     {recipe.ingredients.map((ing, idx) => (
                        <li key={idx} className="flex items-start gap-3 text-slate-600 text-sm">
                           <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                           <span className="leading-relaxed">{ing}</span>
                        </li>
                     ))}
                  </ul>
               </div>
            </div>

            {/* Nutrition Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
               <div className="bg-slate-50 p-4 border-b border-slate-100">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                     <Info className="w-4 h-4 text-slate-400" />
                     Besin Değerleri <span className="text-xs font-normal text-slate-400 ml-auto">(1 Porsiyon)</span>
                  </h3>
               </div>
               <div className="p-6 space-y-5">
                  <div>
                     <div className="flex justify-between text-sm mb-1.5">
                        <span className="font-medium text-slate-600">Protein</span>
                        <span className="font-bold text-slate-800">{recipe.macros.protein}g</span>
                     </div>
                     <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(recipe.macros.protein * 2, 100)}%` }}></div>
                     </div>
                  </div>
                  <div>
                     <div className="flex justify-between text-sm mb-1.5">
                        <span className="font-medium text-slate-600">Karbonhidrat</span>
                        <span className="font-bold text-slate-800">{recipe.macros.carbs}g</span>
                     </div>
                     <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-400 rounded-full" style={{ width: `${Math.min(recipe.macros.carbs, 100)}%` }}></div>
                     </div>
                  </div>
                  <div>
                     <div className="flex justify-between text-sm mb-1.5">
                        <span className="font-medium text-slate-600">Yağ</span>
                        <span className="font-bold text-slate-800">{recipe.macros.fat}g</span>
                     </div>
                     <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${Math.min(recipe.macros.fat * 3, 100)}%` }}></div>
                     </div>
                  </div>
               </div>
            </div>
         </div>

         {/* Right Column: Instructions */}
         <div className="md:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 h-full">
               <div className="p-6 md:p-8">
                  <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                     <ChefHat className="w-6 h-6 text-slate-400" />
                     Hazırlanışı
                  </h3>
                  <div className="space-y-8 relative pl-2">
                     {/* Timeline Line */}
                     <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-slate-100"></div>

                     {recipe.instructions.map((step, idx) => (
                        <div key={idx} className="relative flex gap-6 group">
                           <div className="w-10 h-10 rounded-full bg-white border-2 border-slate-100 group-hover:border-primary text-slate-400 group-hover:text-primary font-bold flex items-center justify-center flex-shrink-0 z-10 transition-colors">
                              {idx + 1}
                           </div>
                           <div className="flex-1 pt-2">
                              <p className="text-slate-600 leading-relaxed group-hover:text-slate-800 transition-colors">
                                 {step}
                              </p>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default RecipeDetails;