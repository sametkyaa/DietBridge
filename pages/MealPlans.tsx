
import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { 
  Search, 
  ChevronDown, 
  Plus, 
  Save, 
  Trash2, 
  Copy, 
  Wand2, 
  Info, 
  Flame, 
  Clock, 
  AlertCircle,
  ThumbsUp,
  X,
  Edit2,
  MoreHorizontal,
  Type,
  Check,
  Calendar as CalendarIcon
} from 'lucide-react';
import { RECIPES, USER_AVATAR } from '../constants';
import { Client, Recipe } from '../shared/types';
import { fetchDietitianClients } from '../features/clients/services/clientService';
import { createDailyMealPlan, mapMealTypeToDb, fetchWeeklyMealPlan } from '../features/meal-plans/services/mealPlanService';
import { supabase } from '../lib/supabaseClient';

// --- Extended Mock Data for Client Specifics ---
const CLIENT_DETAILS: Record<string, { notes: string; likes: string[]; dislikes: string[]; allergies: string[] }> = {
  '1': {
    notes: 'Yüksek sodyumlu gıdalardan kaçınmalı. Sıcak kahvaltıları tercih ediyor.',
    likes: ['Yumurta', 'Avokado', 'Izgara Somon'],
    dislikes: ['Brokoli', 'Mantar'],
    allergies: ['Laktoz İntoleransı']
  },
  '2': {
    notes: 'Protein ağırlıklı beslenmek istiyor. Antrenman günleri karbonhidrat artırılabilir.',
    likes: ['Tavuk', 'Pirinç', 'Kırmızı Et'],
    dislikes: ['Kabak', 'Patlıcan'],
    allergies: []
  },
  // Default fallback for others
  'default': {
    notes: 'Standart beslenme düzeni.',
    likes: [],
    dislikes: [],
    allergies: []
  }
};

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const MEAL_OPTIONS = ['Kahvaltı', 'Öğle', 'Akşam', 'Ara Öğün', 'Antrenman Öncesi', 'Antrenman Sonrası', 'Gece Ara Öğünü'];

// Interface for Dynamic Meals
interface MealRow {
  id: string;
  name: string;
  time: string;
}

// Plan State: { Day: { MealID: Content } }
type PlanState = Record<string, Record<string, Recipe | string | null>>;

const MealPlans = () => {
  const location = useLocation();
  // --- State ---
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [weekStartDate, setWeekStartDate] = useState<string>(new Date().toISOString().split('T')[0]); // Default to today
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  
  // Dynamic Meals State (Editable)
  const [meals, setMeals] = useState<MealRow[]>([
    { id: 'm1', name: 'Kahvaltı', time: '08:00' },
    { id: 'm2', name: 'Öğle', time: '12:30' },
    { id: 'm3', name: 'Akşam', time: '19:00' }
  ]);

  const [weeklyPlan, setWeeklyPlan] = useState<PlanState>({});
  
  // Interaction State
  const [activeCell, setActiveCell] = useState<{ day: string; mealId: string } | null>(null);
  const [recipeSearch, setRecipeSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Tümü');
  const [customMealText, setCustomMealText] = useState('');

  // Fetch Clients
  useEffect(() => {
    const loadClients = async () => {
      setLoadingClients(true);
      try {
        const data = await fetchDietitianClients();
        setClients(data);
      } catch (err) {
        console.error("Failed to load clients for meal plans:", err);
      } finally {
        setLoadingClients(false);
      }
    };
    loadClients();
  }, []);

  // Automatically select client if passed from navigation state
  useEffect(() => {
    const navState = location.state as { clientId?: string } | null;
    if (navState?.clientId && clients.length > 0) {
      const client = clients.find(c => c.id === navState.clientId);
      if (client) {
        setSelectedClient(client);
      }
    }
  }, [location.state, clients]);

  // Fetch Weekly Plan
  useEffect(() => {
    let isMounted = true;

    const loadWeeklyPlan = async () => {
      if (!selectedClient) {
        setWeeklyPlan({});
        return;
      }
      
      setIsLoadingPlan(true);
      setWeeklyPlan({}); // Clear immediately to avoid showing stale data
      
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !isMounted) return;

        // Calculate dates (UTC)
        const [year, month, day] = weekStartDate.split('-').map(Number);
        const start = new Date(Date.UTC(year, month - 1, day));
        const end = new Date(start);
        end.setUTCDate(start.getUTCDate() + 6);
        const endDateStr = end.toISOString().split('T')[0];

        const plans = await fetchWeeklyMealPlan(selectedClient.id, user.id, weekStartDate, endDateStr);
        
        if (!isMounted) return;

        if (!plans || plans.length === 0) {
            // Reset to default meals if no plan exists
            setMeals([
                { id: 'm1', name: 'Kahvaltı', time: '08:00' },
                { id: 'm2', name: 'Öğle', time: '12:30' },
                { id: 'm3', name: 'Akşam', time: '19:00' }
            ]);
            return;
        }

        // Process plans to find max snacks
        let maxSnacks = 0;
        plans.forEach(p => {
            const snacks = p.meals.filter((m: any) => m.type === 'snack');
            if (snacks.length > maxSnacks) maxSnacks = snacks.length;
        });

        // Start with DEFAULT meals to avoid stale state from previous views
        let localMeals = [
            { id: 'm1', name: 'Kahvaltı', time: '08:00' },
            { id: 'm2', name: 'Öğle', time: '12:30' },
            { id: 'm3', name: 'Akşam', time: '19:00' }
        ];
        
        // Add necessary snack rows
        for (let i = 0; i < maxSnacks; i++) {
            const newId = `meal-auto-${Date.now()}-${i}`;
            localMeals.push({ id: newId, name: 'Ara Öğün', time: '15:00' });
        }

        // Map data to weeklyPlan
        const newWeeklyPlan: PlanState = {};
        
        const findRowId = (type: string, snackIndex: number) => {
            if (type === 'breakfast') return localMeals.find(r => r.name === 'Kahvaltı')?.id;
            if (type === 'lunch') return localMeals.find(r => r.name === 'Öğle')?.id;
            if (type === 'dinner') return localMeals.find(r => r.name === 'Akşam')?.id;
            if (type === 'snack') {
                const snackRows = localMeals.filter(r => r.name === 'Ara Öğün');
                return snackRows[snackIndex]?.id;
            }
            return null;
        };

        plans.forEach(p => {
            // Parse plan_date safely as UTC
            const [pYear, pMonth, pDay] = p.plan_date.split('-').map(Number);
            const pDate = new Date(Date.UTC(pYear, pMonth - 1, pDay));
            
            // sDate is already UTC (start variable)
            const diffTime = pDate.getTime() - start.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays >= 0 && diffDays < 7) {
                const dayName = DAYS[diffDays];
                if (!newWeeklyPlan[dayName]) newWeeklyPlan[dayName] = {};

                let snackCount = 0;
                p.meals.forEach((m: any) => {
                    let rowId;
                    if (m.type === 'snack') {
                        rowId = findRowId('snack', snackCount);
                        snackCount++;
                    } else {
                        rowId = findRowId(m.type, 0);
                    }

                    if (rowId) {
                         if (m.calories || m.macros || m.photo_url) {
                             const category = m.type === 'breakfast' ? 'Kahvaltı' :
                                              m.type === 'lunch' ? 'Öğle Yemeği' :
                                              m.type === 'dinner' ? 'Akşam Yemeği' : 'Ara Öğün';

                             const recipeObj: Recipe = {
                                 id: m.id,
                                 name: m.title,
                                 calories: m.calories,
                                 macros: m.macros || { protein: 0, carbs: 0, fat: 0 },
                                 image: m.photo_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c',
                                 category: category,
                                 prepTime: '15 dk',
                                 ingredients: [],
                                 instructions: [],
                                 createdAt: new Date().toISOString(),
                                 servings: 1,
                                 cuisine: 'Genel'
                             };
                             newWeeklyPlan[dayName][rowId] = recipeObj;
                         } else {
                             newWeeklyPlan[dayName][rowId] = m.title;
                         }
                    }
                });
            }
        });

        setMeals(localMeals);
        setWeeklyPlan(newWeeklyPlan);

      } catch (error) {
        console.error('Error loading plan:', error);
        // Reset to default meals on error to avoid stale structure
        if (isMounted) {
            setMeals([
                { id: 'm1', name: 'Kahvaltı', time: '08:00' },
                { id: 'm2', name: 'Öğle', time: '12:30' },
                { id: 'm3', name: 'Akşam', time: '19:00' }
            ]);
        }
      } finally {
        if (isMounted) setIsLoadingPlan(false);
      }
    };

    loadWeeklyPlan();

    return () => {
        isMounted = false;
    };
  }, [selectedClient, weekStartDate]);

  // --- Helpers ---
  const getClientDetails = (id: string) => CLIENT_DETAILS[id] || CLIENT_DETAILS['default'];

  const handleCellClick = (day: string, mealId: string) => {
    // If clicking the already active cell, just toggle off (optional, or keep it open)
    // Here we reset input if clicking a new cell
    const currentContent = weeklyPlan[day]?.[mealId];

    if (activeCell?.day === day && activeCell?.mealId === mealId) {
      setActiveCell(null); 
      setCustomMealText('');
    } else {
      setActiveCell({ day, mealId });
      // If the cell has string content, pre-fill the input
      if (typeof currentContent === 'string') {
        setCustomMealText(currentContent);
      } else {
        setCustomMealText('');
      }
    }
  };

  const handleRecipeSelect = (recipe: Recipe) => {
    if (!activeCell) return;
    
    setWeeklyPlan(prev => ({
      ...prev,
      [activeCell.day]: {
        ...(prev[activeCell.day] || {}),
        [activeCell.mealId]: recipe
      }
    }));
    // Optional: Clear text input after recipe select
    setCustomMealText('');
  };

  const handleAddCustomMeal = () => {
    if (!activeCell || !customMealText.trim()) return;

    setWeeklyPlan(prev => ({
      ...prev,
      [activeCell.day]: {
        ...(prev[activeCell.day] || {}),
        [activeCell.mealId]: customMealText
      }
    }));
  };

  const handleClearCell = (e: React.MouseEvent, day: string, mealId: string) => {
    e.stopPropagation();
    setWeeklyPlan(prev => {
      // Create a deep copy for the day being modified
      const newPlan = { ...prev };
      if (newPlan[day]) {
        newPlan[day] = { ...newPlan[day] };
        delete newPlan[day][mealId];
      }
      return newPlan;
    });
    
    // If clearing the active cell, reset the custom text input too
    if (activeCell?.day === day && activeCell?.mealId === mealId) {
        setCustomMealText('');
    }
  };

  // --- Dynamic Meal Functions ---

  const handleAddMeal = () => {
    const newId = `meal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newMeal: MealRow = { 
      id: newId, 
      name: 'Ara Öğün', 
      time: '15:00' 
    };
    setMeals([...meals, newMeal]);
  };

  const handleRemoveMeal = (e: React.MouseEvent, mealId: string) => {
    // Stop propagation to prevent triggering parent clicks
    e.preventDefault();
    e.stopPropagation();
    
    if (window.confirm('Bu öğün satırını silmek istediğinize emin misiniz?')) {
      // 1. Remove from meals array
      setMeals(prevMeals => prevMeals.filter(m => m.id !== mealId));
      
      // 2. Remove associated data from weekly plan
      setWeeklyPlan(prevPlan => {
        const newPlan = { ...prevPlan };
        Object.keys(newPlan).forEach(day => {
          if (newPlan[day]) {
            const dayPlan = { ...newPlan[day] };
            if (dayPlan[mealId]) {
              delete dayPlan[mealId];
              newPlan[day] = dayPlan;
            }
          }
        });
        return newPlan;
      });

      // 3. Clear active cell if it was the deleted meal
      if (activeCell?.mealId === mealId) {
        setActiveCell(null);
        setCustomMealText('');
      }
    }
  };

  const handleUpdateMeal = (id: string, field: 'name' | 'time', value: string) => {
    setMeals(meals.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleAutoSuggest = () => {
    if (!selectedClient) return;
    const newPlan = { ...weeklyPlan };
    DAYS.forEach(day => {
      if (!newPlan[day]) newPlan[day] = {};
      meals.forEach(meal => {
        if (!newPlan[day][meal.id]) {
          const randomRecipe = RECIPES[Math.floor(Math.random() * RECIPES.length)];
          newPlan[day][meal.id] = randomRecipe;
        }
      });
    });
    setWeeklyPlan(newPlan);
  };

  const handleSavePlan = async () => {
    if (!selectedClient) {
      alert('Lütfen bir danışan seçiniz.');
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Kullanıcı oturumu bulunamadı.');

      const [year, month, day] = weekStartDate.split('-').map(Number);
      const start = new Date(Date.UTC(year, month - 1, day));
      
      // Loop through each day of the week (0 to 6)
      for (let i = 0; i < 7; i++) {
        const currentDayDate = new Date(start);
        currentDayDate.setUTCDate(start.getUTCDate() + i);
        const dateStr = currentDayDate.toISOString().split('T')[0];
        const dayName = DAYS[i]; // 'Pazartesi', 'Salı', etc.

        // Collect meals for this day
        const dayMeals = [];
        const dayPlan = weeklyPlan[dayName];
        
        if (dayPlan) {
          for (const [mealId, content] of Object.entries(dayPlan)) {
            const mealRow = meals.find(m => m.id === mealId);
            if (!mealRow || !content) continue;

            const mealType = mapMealTypeToDb(mealRow.name);
            
            let mealData: any = {
              type: mealType,
              title: typeof content === 'string' ? content : content.name,
              is_eaten: false
            };

            if (typeof content !== 'string') {
              // It's a recipe
              mealData.calories = content.calories;
              mealData.macros = content.macros;
              mealData.photo_url = content.image;
            }

            dayMeals.push(mealData);
          }
        }

        // Create plan for this day
        await createDailyMealPlan({
          client_id: selectedClient.id,
          dietitian_id: user.id,
          plan_date: dateStr,
          notes: getClientDetails(selectedClient.id).notes
        }, dayMeals);
      }

      alert('Haftalık plan başarıyla kaydedildi!');
    } catch (error: any) {
      console.error('Plan kaydedilirken hata:', error);
      alert('Plan kaydedilirken bir hata oluştu: ' + (error.message || error));
    } finally {
      setIsSaving(false);
    }
  };

  const filteredRecipes = RECIPES.filter(r => {
    const matchesSearch = r.name.toLowerCase().includes(recipeSearch.toLowerCase());
    const matchesCategory = selectedCategory === 'Tümü' || 
                            (selectedCategory === 'Kahvaltı' && r.category === 'Kahvaltı') ||
                            (selectedCategory === 'Ana Yemek' && (r.category === 'Öğle Yemeği' || r.category === 'Akşam Yemeği')) ||
                            (selectedCategory === 'Ara Öğün' && (r.category === 'Ara Öğün' || r.category === 'Tatlı'));
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="flex h-screen bg-background-light overflow-hidden">
      
      {/* --- LEFT SIDE: Main Planning Area --- */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        
        {/* Header Section */}
        <header className="px-8 py-6 bg-white border-b border-slate-200 flex justify-between items-center z-20 shadow-sm flex-shrink-0">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Haftalık Yemek Planı</h1>
            <p className="text-sm text-slate-500 mt-1">Danışan için haftalık beslenme programını oluşturun.</p>
          </div>

          <div className="flex items-center gap-4">
            {/* Client Selector */}
            <div className="relative">
              <button 
                onClick={() => setIsClientDropdownOpen(!isClientDropdownOpen)}
                className="flex items-center gap-3 bg-slate-50 border border-slate-200 hover:border-emerald-500/50 hover:bg-emerald-50/30 px-4 py-2.5 rounded-xl transition-all min-w-[240px]"
              >
                {selectedClient ? (
                  <>
                    <img src={selectedClient.avatar} alt={selectedClient.name} className="w-8 h-8 rounded-full object-cover" />
                    <div className="text-left flex-1">
                      <p className="text-xs text-slate-500 font-medium">Seçili Danışan</p>
                      <p className="text-sm font-bold text-slate-800">{selectedClient.name}</p>
                    </div>
                  </>
                ) : (
                  <span className="text-slate-500 font-medium flex-1 text-left">Danışan Seçiniz...</span>
                )}
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isClientDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isClientDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsClientDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-100 z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                    <div className="p-2">
                       <div className="relative mb-2">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                          <input type="text" placeholder="Ara..." className="w-full pl-9 pr-3 py-2 bg-slate-50 rounded-lg text-sm border-none focus:ring-1 focus:ring-primary" />
                       </div>
                       {clients.map(client => (
                         <button
                           key={client.id}
                           onClick={() => { setSelectedClient(client); setIsClientDropdownOpen(false); }}
                           className="w-full flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg transition-colors group"
                         >
                           <img src={client.avatar} className="w-8 h-8 rounded-full object-cover group-hover:ring-2 ring-primary/20" alt={client.name} />
                           <div className="text-left">
                              <p className="text-sm font-semibold text-slate-700">{client.name}</p>
                              <p className="text-sm text-slate-400">{client.goal}</p>
                           </div>
                         </button>
                       ))}
                       {clients.length === 0 && !loadingClients && (
                         <div className="p-4 text-center text-slate-400 text-sm">Danışan bulunamadı.</div>
                       )}
                       {loadingClients && (
                         <div className="p-4 text-center text-slate-400 text-sm">Yükleniyor...</div>
                       )}
                    </div>
                  </div>
                </>
              )}
            </div>
            
            <div className="h-8 w-px bg-slate-200"></div>

            {/* Date Picker */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-2.5 rounded-xl">
              <CalendarIcon className="w-4 h-4 text-slate-400" />
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 font-bold uppercase leading-none">Başlangıç Tarihi</span>
                <input 
                  type="date" 
                  value={weekStartDate}
                  onChange={(e) => setWeekStartDate(e.target.value)}
                  className="bg-transparent text-sm font-bold text-slate-700 focus:outline-none p-0 h-4 leading-none w-28"
                />
              </div>
            </div>

            <div className="h-8 w-px bg-slate-200"></div>

            <img src={USER_AVATAR} className="w-10 h-10 rounded-full border border-slate-200 object-cover" alt="Dietitian" />
          </div>
        </header>

        {/* Weekly Grid Area */}
        <div className="flex-1 overflow-auto p-8 relative">
           {!selectedClient ? (
             <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                <div className="bg-slate-100 p-6 rounded-full mb-4">
                  <Search className="w-12 h-12 text-slate-400" />
                </div>
                <h2 className="text-xl font-bold text-slate-700">Plan Oluşturmaya Başlayın</h2>
                <p className="text-slate-500 mt-2 max-w-md">Sol üst köşedeki menüden bir danışan seçerek haftalık beslenme programını oluşturmaya başlayabilirsiniz.</p>
             </div>
           ) : (
             <>
               {/* Grid Controls */}
               <div className="flex justify-between items-center mb-6">
                  <div className="flex gap-2">
                    <button onClick={() => setWeeklyPlan({})} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-sm font-medium shadow-sm">
                      <Trash2 className="w-4 h-4" /> Temizle
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm">
                      <Copy className="w-4 h-4" /> Geçen Haftayı Kopyala
                    </button>
                  </div>
                  <div className="flex gap-3">
                     <button onClick={handleAutoSuggest} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-bold shadow-sm">
                        <Wand2 className="w-4 h-4" /> AI Öneri (Otomatik Doldur)
                     </button>
                     <button 
                        onClick={handleSavePlan}
                        disabled={isSaving || !selectedClient}
                        className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-all text-sm font-bold shadow-md shadow-primary/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                     >
                        {isSaving ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            Kaydediliyor...
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" /> Planı Kaydet
                          </>
                        )}
                     </button>
                  </div>
               </div>

               {/* The Grid */}
               <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-w-[900px] relative">
                  {/* Loading Overlay */}
                  {isLoadingPlan && (
                    <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-50 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"></div>
                        <p className="text-sm font-bold text-emerald-600">Plan Yükleniyor...</p>
                      </div>
                    </div>
                  )}

                  {/* Header Row */}
                  <div className="grid grid-cols-8 divide-x divide-slate-100 border-b border-slate-200 bg-slate-50">
                     <div className="p-4 flex items-center justify-center font-bold text-slate-400 text-xs uppercase tracking-wider bg-slate-50/80">
                        Öğünler
                     </div>
                     {DAYS.map(day => (
                       <div key={day} className="p-4 text-center font-bold text-slate-700 text-sm">
                         {day}
                       </div>
                     ))}
                  </div>

                  {/* Dynamic Meal Rows */}
                  {meals.map((meal, idx) => (
                    <div key={meal.id} className={`grid grid-cols-8 divide-x divide-slate-100 ${idx !== meals.length - 1 ? 'border-b border-slate-100' : ''}`}>
                       
                       {/* Row Header (Editable Meal Name & Time) */}
                       <div className="bg-slate-50/50 p-2 flex flex-col justify-center items-center group relative border-r border-slate-100 hover:bg-slate-100/80 transition-colors">
                          
                          <div className="flex flex-col items-center w-full px-1 gap-1 relative z-10">
                             {/* Meal Type Dropdown */}
                             <div className="relative w-full">
                                <select 
                                   value={meal.name}
                                   onChange={(e) => handleUpdateMeal(meal.id, 'name', e.target.value)}
                                   className="appearance-none w-full text-center font-bold text-slate-700 text-sm bg-transparent border-b border-transparent hover:border-primary/30 focus:border-primary focus:outline-none py-1 cursor-pointer transition-colors"
                                >
                                   {MEAL_OPTIONS.map(opt => (
                                     <option key={opt} value={opt}>{opt}</option>
                                   ))}
                                </select>
                             </div>

                             {/* Time Input - Manual Text Entry */}
                             <div className="relative group/time">
                                <input 
                                  type="text" 
                                  value={meal.time}
                                  placeholder="00:00"
                                  maxLength={5}
                                  onChange={(e) => handleUpdateMeal(meal.id, 'time', e.target.value)}
                                  className="bg-transparent text-center text-[11px] text-slate-500 font-medium uppercase tracking-wider w-16 cursor-text hover:text-primary focus:outline-none focus:text-primary border border-transparent hover:border-slate-200 rounded px-1"
                                />
                             </div>
                          </div>

                          <button 
                             type="button"
                             onClick={(e) => handleRemoveMeal(e, meal.id)}
                             className="absolute top-1 right-1 z-50 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
                             title="Bu öğünü sil"
                          >
                             <Trash2 className="w-3.5 h-3.5" />
                          </button>
                       </div>

                       {/* Day Cells */}
                       {DAYS.map(day => {
                         const cellContent = weeklyPlan[day]?.[meal.id];
                         const isActive = activeCell?.day === day && activeCell?.mealId === meal.id;

                         return (
                           <div 
                             key={`${day}-${meal.id}`}
                             onClick={() => handleCellClick(day, meal.id)}
                             className={`
                               relative min-h-[140px] p-2 transition-all cursor-pointer group
                               ${isActive ? 'bg-emerald-50 ring-2 ring-inset ring-primary z-10' : 'hover:bg-slate-50 bg-white'}
                             `}
                           >
                             {!cellContent ? (
                               <div className={`h-full border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-400 transition-colors ${isActive ? 'border-emerald-300 bg-white' : 'group-hover:border-slate-300'}`}>
                                  <Plus className={`w-5 h-5 ${isActive ? 'text-emerald-500' : ''}`} />
                                  <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">Ekle</span>
                               </div>
                             ) : typeof cellContent === 'string' ? (
                               // Manual Text Content
                               <div className="h-full bg-slate-100 rounded-xl p-3 text-sm text-slate-700 relative group/text">
                                  <button 
                                    onClick={(e) => handleClearCell(e, day, meal.id)}
                                    className="absolute -top-1.5 -right-1.5 bg-white text-slate-400 hover:text-red-500 border border-slate-200 rounded-full p-0.5 opacity-0 group-hover/text:opacity-100 transition-opacity shadow-sm z-20"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                 {cellContent}
                               </div>
                             ) : (
                               // Recipe Card Content
                               <div className="h-full bg-white rounded-xl border border-slate-200 shadow-sm p-2 flex flex-col gap-2 relative group/card animate-in zoom-in-95 duration-200">
                                  <button 
                                    onClick={(e) => handleClearCell(e, day, meal.id)}
                                    className="absolute -top-1.5 -right-1.5 bg-white text-slate-400 hover:text-red-500 border border-slate-200 rounded-full p-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity shadow-sm z-20"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                  <div className="h-20 w-full rounded-lg overflow-hidden relative">
                                     <img src={cellContent.image} alt={cellContent.name} className="w-full h-full object-cover" />
                                     <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-2">
                                        <p className="text-white text-[10px] font-bold line-clamp-1">{cellContent.name}</p>
                                     </div>
                                  </div>
                                  <div className="flex justify-between items-center px-1">
                                     <span className="text-[10px] font-bold text-orange-500 flex items-center gap-0.5">
                                       <Flame className="w-3 h-3" /> {cellContent.calories}
                                     </span>
                                     <span className="text-[10px] text-slate-400">{cellContent.macros.protein}g Prot</span>
                                  </div>
                               </div>
                             )}
                           </div>
                         );
                       })}
                    </div>
                  ))}

                  {/* Add New Meal Row Button */}
                  <div className="border-t border-slate-200 bg-slate-50 p-2">
                    <button 
                      onClick={handleAddMeal}
                      className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 font-medium hover:border-primary hover:text-primary hover:bg-emerald-50 transition-all flex items-center justify-center gap-2"
                    >
                       <Plus className="w-4 h-4" /> Yeni Öğün Ekle
                    </button>
                  </div>
               </div>
             </>
           )}
        </div>
      </div>

      {/* --- RIGHT SIDE: Sidebar (Client Info & Recipes) --- */}
      <aside className="w-96 bg-white border-l border-slate-200 flex flex-col h-full shadow-lg z-30">
        
        {/* 1. Client Info Panel (Conditional) */}
        {selectedClient ? (
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
             <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                  <Info className="w-4 h-4 text-primary" /> Danışan Bilgileri
                </h3>
             </div>
             
             <div className="space-y-4">
                {/* Notes */}
                <div className="bg-white p-3 rounded-xl border border-yellow-100 shadow-sm">
                   <p className="text-xs font-bold text-yellow-600 mb-1">Diyetisyen Notu</p>
                   <p className="text-xs text-slate-600 leading-relaxed">
                     {getClientDetails(selectedClient.id).notes}
                   </p>
                </div>

                {/* Tags Grid */}
                <div className="grid grid-cols-2 gap-3">
                   {/* Allergies */}
                   <div className="bg-white p-3 rounded-xl border border-red-100 shadow-sm">
                      <p className="text-xs font-bold text-red-500 mb-2 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Alerji / Kısıt
                      </p>
                      <div className="flex flex-wrap gap-1">
                         {getClientDetails(selectedClient.id).allergies.length > 0 ? (
                           getClientDetails(selectedClient.id).allergies.map(a => (
                             <span key={a} className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[10px] font-medium">{a}</span>
                           ))
                         ) : <span className="text-[10px] text-slate-400">Yok</span>}
                      </div>
                   </div>
                   
                   {/* Likes */}
                   <div className="bg-white p-3 rounded-xl border border-emerald-100 shadow-sm">
                      <p className="text-xs font-bold text-emerald-600 mb-2 flex items-center gap-1">
                        <ThumbsUp className="w-3 h-3" /> Tercihler
                      </p>
                      <div className="flex flex-wrap gap-1">
                         {getClientDetails(selectedClient.id).likes.map(l => (
                             <span key={l} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-medium">{l}</span>
                         ))}
                      </div>
                   </div>
                </div>
             </div>
          </div>
        ) : (
          <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
             <p>Danışan bilgileri burada görünecek.</p>
          </div>
        )}

        {/* 2. Recipes Panel */}
        <div className="flex-1 flex flex-col min-h-0 bg-white">
           <div className="p-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 mb-3 px-1">Öğün Ekle</h3>

              {/* Manual Entry Section (Visible when cell is active) */}
              {activeCell && (
                <div className="mb-6 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 animate-in slide-in-from-right-4 duration-300">
                   <div className="flex items-center gap-2 mb-2 text-indigo-700 font-bold text-xs uppercase tracking-wide">
                      <Edit2 className="w-3 h-3" />
                      Manuel Ekleme / Düzenleme
                   </div>
                   <div className="flex gap-2">
                      <input 
                        type="text"
                        value={customMealText}
                        onChange={(e) => setCustomMealText(e.target.value)}
                        placeholder="Örn: 2 Haşlanmış Yumurta..."
                        className="flex-1 text-sm px-3 py-2 rounded-lg border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-700 bg-white"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCustomMeal()}
                      />
                      <button 
                        onClick={handleAddCustomMeal}
                        disabled={!customMealText.trim()}
                        className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                         <Check className="w-4 h-4" />
                      </button>
                   </div>
                </div>
              )}
              
              <div className="flex justify-between items-end mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase">Kayıtlı Tarifler</span>
              </div>

              {/* Search */}
              <div className="relative mb-3">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                 <input 
                   type="text" 
                   placeholder="Tarif ara..." 
                   className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                   value={recipeSearch}
                   onChange={(e) => setRecipeSearch(e.target.value)}
                 />
              </div>

              {/* Category Pills */}
              <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
                 {['Tümü', 'Kahvaltı', 'Ana Yemek', 'Ara Öğün'].map(cat => (
                   <button
                     key={cat}
                     onClick={() => setSelectedCategory(cat)}
                     className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                       selectedCategory === cat 
                         ? 'bg-slate-800 text-white' 
                         : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                     }`}
                   >
                     {cat}
                   </button>
                 ))}
              </div>
           </div>

           {/* Recipe List */}
           <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {activeCell && (
                 <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-lg mb-4 text-xs text-emerald-700 flex items-center gap-2 sticky top-0 z-10 shadow-sm animate-in slide-in-from-top-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    {/* Find meal name for active cell */}
                    <strong>{activeCell.day} - {meals.find(m => m.id === activeCell.mealId)?.name}</strong> seçildi.
                 </div>
              )}

              {filteredRecipes.map(recipe => (
                <div 
                  key={recipe.id}
                  onClick={() => handleRecipeSelect(recipe)}
                  className={`flex gap-3 p-2 rounded-xl border transition-all cursor-pointer group ${
                    activeCell 
                      ? 'hover:border-primary hover:bg-emerald-50/30 border-slate-100' 
                      : 'hover:border-slate-300 border-slate-100 opacity-60'
                  }`}
                >
                   <img src={recipe.image} alt={recipe.name} className="w-16 h-16 rounded-lg object-cover bg-slate-100" />
                   <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                         <h4 className="font-bold text-slate-800 text-sm truncate pr-2">{recipe.name}</h4>
                         {activeCell && (
                           <Plus className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                         )}
                      </div>
                      <p className="text-xs text-slate-500 mb-1">{recipe.category}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                         <span className="text-[10px] font-bold text-orange-500 flex items-center gap-1">
                            <Flame className="w-3 h-3" /> {recipe.calories}
                         </span>
                         <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {recipe.prepTime}
                         </span>
                      </div>
                   </div>
                </div>
              ))}
              
              {filteredRecipes.length === 0 && (
                <div className="text-center py-8 text-slate-400 text-xs">
                   Tarif bulunamadı.
                </div>
              )}
           </div>
        </div>
      </aside>

    </div>
  );
};

export default MealPlans;
