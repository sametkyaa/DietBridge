import React, { useState } from 'react';
import { Search, Bell, Plus, Filter, Download, MoreVertical, Edit2, Trash2, Eye, Copy, X, Upload, Clock, Users, Flame } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RECIPES, USER_AVATAR } from '../constants';
import { Recipe, RecipeCategory } from '../types';

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

const RecipeRow: React.FC<{ recipe: Recipe }> = ({ recipe }) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <tr 
      onClick={() => navigate(`/recipes/${recipe.id}`)}
      className="hover:bg-slate-50 cursor-pointer transition-colors bg-white border-b border-slate-50 last:border-0"
    >
      <td className="px-6 py-4">
        <img src={recipe.image} alt={recipe.name} className="w-12 h-12 rounded-lg object-cover shadow-sm transition-all" />
      </td>
      <td className="px-6 py-4">
        <p className="font-semibold text-slate-800">{recipe.name}</p>
      </td>
      <td className="px-6 py-4">
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${getCategoryColor(recipe.category)}`}>
          {recipe.category}
        </span>
      </td>
      <td className="px-6 py-4">
         <div className="flex items-center gap-1 font-medium text-slate-600">
            <Flame className="w-4 h-4 text-orange-500" />
            {recipe.calories} kcal
         </div>
      </td>
      <td className="px-6 py-4 text-slate-500 font-medium">
        {recipe.cuisine || '-'}
      </td>
      <td className="px-6 py-4 text-slate-500 text-sm">
        {recipe.createdAt}
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/recipes/${recipe.id}`);
              }}
              className="p-2 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded-lg transition-colors" 
              title="Detayları Gör"
            >
              <Eye className="w-4 h-4" />
            </button>
            <div className="relative">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsDropdownOpen(!isDropdownOpen);
                  }}
                  className={`p-2 rounded-lg transition-colors ${isDropdownOpen ? 'text-slate-600 bg-slate-100' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                >
                    <MoreVertical className="w-4 h-4" />
                </button>
                
                {/* Dropdown Menu */}
                {isDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-10 cursor-default" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsDropdownOpen(false);
                      }} 
                    />
                    <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-lg shadow-lg border border-slate-100 py-1 z-20">
                        <button className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                            <Edit2 className="w-3 h-3" /> Düzenle
                        </button>
                        <button className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                            <Copy className="w-3 h-3" /> Kopyala
                        </button>
                        <div className="h-px bg-slate-100 my-1"></div>
                        <button className="w-full text-left px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2">
                            <Trash2 className="w-3 h-3" /> Sil
                        </button>
                    </div>
                  </>
                )}
            </div>
        </div>
      </td>
    </tr>
  );
};

const RecipeCard: React.FC<{ recipe: Recipe }> = ({ recipe }) => {
  const navigate = useNavigate();
  return (
    <div 
      onClick={() => navigate(`/recipes/${recipe.id}`)}
      className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer"
    >
      <div className="flex items-start gap-4 mb-3">
        <img src={recipe.image} alt={recipe.name} className="w-16 h-16 rounded-lg object-cover shadow-sm" />
        <div className="flex-1">
            <div className="flex justify-between items-start">
                <h3 className="font-bold text-slate-800 line-clamp-1">{recipe.name}</h3>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${getCategoryColor(recipe.category)}`}>
                    {recipe.category}
                </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{recipe.cuisine} • {recipe.createdAt}</p>
        </div>
      </div>
      
      <div className="flex justify-between items-center border-t border-slate-100 pt-3">
        <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs font-bold text-slate-700">
                <Flame className="w-3 h-3 text-orange-500" /> {recipe.calories} kcal
            </span>
            <span className="flex items-center gap-1 text-xs text-slate-500">
                <Clock className="w-3 h-3" /> {recipe.prepTime}
            </span>
        </div>
        <div className="flex gap-2">
             <button 
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/recipes/${recipe.id}`);
                }}
                className="p-1.5 bg-slate-50 text-slate-400 hover:text-primary rounded-lg"
             >
                <Eye className="w-4 h-4" />
             </button>
             <button className="p-1.5 bg-slate-50 text-slate-400 hover:text-red-500 rounded-lg">
                <Trash2 className="w-4 h-4" />
             </button>
        </div>
      </div>
    </div>
  );
};

const Recipes = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const navigate = useNavigate();

  // Filter recipes
  const filteredRecipes = RECIPES.filter(recipe => 
    recipe.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen md:h-screen flex flex-col relative">
       {/* Header */}
       <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-4 flex-shrink-0">
        <div className="w-full md:w-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Tarifler</h1>
            <p className="text-slate-500 mt-1 text-sm md:text-base">Kendi tariflerinizi oluşturun, kategorilere ayırın ve yönetin.</p>
          </div>
          {/* Mobile Profile Pic */}
          <div className="md:hidden">
             <img src={USER_AVATAR} alt="Profil" className="w-10 h-10 rounded-full border border-slate-200 object-cover" />
          </div>
        </div>
        
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 w-full md:w-auto">
          <div className="flex gap-2">
              <button 
                onClick={() => setIsFilterModalOpen(true)}
                className="flex-1 md:flex-none flex justify-center items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-medium shadow-sm transition-all text-sm"
              >
                <Filter className="w-4 h-4" />
                Filtrele
              </button>
              <button className="flex-1 md:flex-none flex justify-center items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-medium shadow-sm transition-all text-sm">
                <Download className="w-4 h-4" />
                Dışa Aktar
              </button>
          </div>
          <button 
            onClick={() => setIsCreateModalOpen(true)}
            className="flex justify-center items-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl font-medium shadow-sm transition-all active:scale-95 text-sm md:text-base"
          >
             <Plus className="w-5 h-5" />
             Yeni Tarif Oluştur
          </button>

          {/* Desktop User Info */}
          <div className="hidden md:block w-px h-8 bg-slate-200 mx-2"></div>
          <button className="hidden md:block p-2.5 rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
            <Bell className="w-5 h-5" />
          </button>
          <img
            src={USER_AVATAR}
            alt="Profil"
            className="hidden md:block w-10 h-10 rounded-full border border-slate-200 object-cover"
          />
        </div>
      </header>

      {/* Content Container */}
      <div className="bg-transparent md:bg-white rounded-none md:rounded-2xl shadow-none md:shadow-sm border-0 md:border border-slate-200 overflow-hidden flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="p-0 md:p-4 mb-4 md:mb-0 md:border-b border-slate-200">
             <div className="relative w-full md:max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Tarife göre filtrele..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-3 md:py-2 rounded-xl md:rounded-lg border border-slate-200 bg-white md:bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm transition-all shadow-sm md:shadow-none"
                />
             </div>
        </div>
        
        {/* Scrollable Content */}
        <div className="overflow-visible md:overflow-auto flex-1">
          {/* Desktop Table */}
          <table className="w-full text-left text-sm hidden md:table">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Foto</th>
                <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Tarif Adı</th>
                <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Kategori</th>
                <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Kalori</th>
                <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Mutfak</th>
                <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Oluşturulma Tarihi</th>
                <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredRecipes.map((recipe) => (
                <RecipeRow key={recipe.id} recipe={recipe} />
              ))}
              {filteredRecipes.length === 0 && (
                <tr>
                   <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                     Aradığınız kriterlere uygun tarif bulunamadı.
                   </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4 pb-4">
             {filteredRecipes.map((recipe) => (
               <RecipeCard key={recipe.id} recipe={recipe} />
             ))}
             {filteredRecipes.length === 0 && (
                <div className="text-center py-10 text-slate-500">
                   Tarif bulunamadı.
                </div>
             )}
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white z-10">
                    <h2 className="text-xl font-bold text-slate-800">Yeni Tarif Oluştur</h2>
                    <button onClick={() => setIsCreateModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="p-6 space-y-6">
                    {/* Photo Upload */}
                    <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer group">
                        <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center text-slate-400 group-hover:text-primary mb-3">
                            <Upload className="w-6 h-6" />
                        </div>
                        <p className="text-sm font-medium text-slate-600">Tarif fotoğrafı yüklemek için tıklayın</p>
                        <p className="text-xs text-slate-400 mt-1">PNG, JPG (Max. 5MB)</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">Tarif Adı</label>
                            <input type="text" placeholder="Örn: Avokadolu Yumurta" className="w-full px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">Kategori</label>
                            <select className="w-full px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all">
                                <option>Seçiniz</option>
                                <option>Kahvaltı</option>
                                <option>Ara Öğün</option>
                                <option>Öğle Yemeği</option>
                                <option>Akşam Yemeği</option>
                                <option>Tatlı</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">Kalori (kcal)</label>
                            <input type="number" placeholder="0" className="w-full px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">Hazırlama Süresi (dk)</label>
                            <input type="number" placeholder="0" className="w-full px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all" />
                        </div>
                         <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">Porsiyon Sayısı</label>
                            <input type="number" placeholder="1" className="w-full px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all" />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-slate-700">Malzemeler</label>
                        <textarea rows={4} placeholder="Her satıra bir malzeme yazın..." className="w-full px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none"></textarea>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-slate-700">Hazırlanış Adımları</label>
                        <textarea rows={6} placeholder="Adım adım hazırlanış..." className="w-full px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none"></textarea>
                    </div>
                </div>

                <div className="p-6 border-t border-slate-100 flex justify-end gap-3 sticky bottom-0 bg-white">
                    <button onClick={() => setIsCreateModalOpen(false)} className="px-6 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">
                        İptal
                    </button>
                    <button onClick={() => setIsCreateModalOpen(false)} className="px-6 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary-dark transition-colors shadow-sm shadow-primary/30">
                        Kaydet
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Filter Modal */}
      {isFilterModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
             <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-800">Filtrele</h2>
                    <button onClick={() => setIsFilterModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-6 space-y-6">
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-slate-800">Kategoriler</label>
                        <div className="flex flex-wrap gap-2">
                            {['Kahvaltı', 'Ara Öğün', 'Öğle Yemeği', 'Akşam Yemeği', 'Tatlı'].map((cat) => (
                                <label key={cat} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer text-sm text-slate-600 select-none">
                                    <input type="checkbox" className="rounded text-primary focus:ring-primary" />
                                    {cat}
                                </label>
                            ))}
                        </div>
                    </div>
                    
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-slate-800 flex justify-between">
                            Kalori Aralığı
                            <span className="text-primary text-xs font-normal">0 - 1000+ kcal</span>
                        </label>
                        <input type="range" className="w-full accent-primary h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer" />
                        <div className="flex justify-between text-xs text-slate-400">
                            <span>0</span>
                            <span>500</span>
                            <span>1000+</span>
                        </div>
                    </div>
                </div>
                <div className="p-5 border-t border-slate-100 flex justify-end gap-3">
                    <button onClick={() => setIsFilterModalOpen(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Temizle</button>
                    <button onClick={() => setIsFilterModalOpen(false)} className="flex-1 px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary-dark shadow-sm">Uygula</button>
                </div>
             </div>
        </div>
      )}
    </div>
  );
};

export default Recipes;