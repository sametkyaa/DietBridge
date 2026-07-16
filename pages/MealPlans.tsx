
import React, { useState, useEffect } from 'react';
import { useLocation , useNavigate} from 'react-router-dom';
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
  Calendar as CalendarIcon,
  ArrowUp,
  ArrowDown,
  Upload,
  Loader2
} from 'lucide-react';
import { RECIPES, USER_AVATAR } from '../constants';
import { Client, Recipe } from '../shared/types';
import { fetchDietitianClients } from '../features/clients/services/clientService';
import {
  createDailyMealPlan,
  mapMealTypeToDb,
  fetchWeeklyMealPlan,
  getMealPlanErrorLogContext,
  getMealPlanUserMessage,
  type MealInput,
} from '../features/meal-plans/services/mealPlanService';
import { supabase } from '../lib/supabaseClient';
import { isValidUuid } from '../shared/utils/uuid';

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

const LAST_MEAL_PLAN_CLIENT_KEY = 'dietbridge:lastMealPlanClientId';

interface PlannedMealContent {
  id: string;
  name: string;
  image: string | null;
  calories: number;
  macros: Recipe['macros'];
  source?: 'manual' | 'recipe';
  recipeId?: string | null;
}

// Plan State: { Day: { MealID: Content } }
type PlanState = Record<string, Record<string, PlannedMealContent | string | null>>;

const MealPlans = () => {
  const navigate = useNavigate();
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

  // Modal State
  const [isAddMealModalOpen, setIsAddMealModalOpen] = useState(false);
  const [newMealType, setNewMealType] = useState('Ara Öğün');
  const [newMealTime, setNewMealTime] = useState('15:00');
  const [mealToDelete, setMealToDelete] = useState<string | null>(null);
  
  // Interaction State
  const [activeCell, setActiveCell] = useState<{ day: string; mealId: string } | null>(null);
  const [recipeSearch, setRecipeSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('Tümü');
  const [customMealText, setCustomMealText] = useState('');
  const [customMealCalories, setCustomMealCalories] = useState('');
  const [customMealProtein, setCustomMealProtein] = useState('');
  const [customMealCarbs, setCustomMealCarbs] = useState('');
  const [customMealFat, setCustomMealFat] = useState('');
  const [customMealPhoto, setCustomMealPhoto] = useState<File | null>(null);
  const [customMealPhotoPreview, setCustomMealPhotoPreview] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

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

  // Automatically select client if passed from navigation state or local storage
  useEffect(() => {
    const storedClientId = localStorage.getItem(LAST_MEAL_PLAN_CLIENT_KEY);
    if (storedClientId && !isValidUuid(storedClientId)) {
      localStorage.removeItem(LAST_MEAL_PLAN_CLIENT_KEY);
    }

    if (clients.length === 0) return;

    const navState = location.state as { clientId?: string } | null;
    
    // Priority 1: Navigation state
    if (navState?.clientId && isValidUuid(navState.clientId)) {
      const client = clients.find(c => c.id === navState.clientId);
      if (client) {
        setSelectedClient(prev => {
            if (prev?.id === client.id) return prev;
            return client;
        });
        localStorage.setItem(LAST_MEAL_PLAN_CLIENT_KEY, client.id);
        return;
      }
    }

    // Priority 2: LocalStorage
    setSelectedClient((currentSelected) => {
        if (!currentSelected) {
            const lastClientId = localStorage.getItem(LAST_MEAL_PLAN_CLIENT_KEY);
            if (lastClientId) {
                const client = clients.find(c => c.id === lastClientId);
                if (client) {
                    return client;
                } else {
                    localStorage.removeItem(LAST_MEAL_PLAN_CLIENT_KEY);
                }
            }
        } else {
            if (!isValidUuid(currentSelected.id)) {
                localStorage.removeItem(LAST_MEAL_PLAN_CLIENT_KEY);
                return null;
            }

            const stillExists = clients.some(c => c.id === currentSelected.id);
            if (!stillExists) {
                localStorage.removeItem(LAST_MEAL_PLAN_CLIENT_KEY);
                return null;
            }
        }
        return currentSelected;
    });
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

        // Process plans to reconstruct unique meal rows
        let localMeals: MealRow[] = [];
        const mealRowMap = new Map<string, any>();
        
        plans.forEach(p => {
            p.meals.forEach((m: any) => {
                const rowName = m.macros?._rowName || (
                    m.type === 'breakfast' ? 'Kahvaltı' :
                    m.type === 'lunch' ? 'Öğle' :
                    m.type === 'dinner' ? 'Akşam' : 'Ara Öğün'
                );
                const time = m.time || m.macros?._time || (m.type === 'breakfast' ? '08:00' : m.type === 'lunch' ? '12:30' : m.type === 'dinner' ? '19:00' : '15:00');
                const sortOrder = m.sort_order ?? m.macros?._sortOrder ?? 0;
                
                const key = `${rowName}-${time}-${sortOrder}`;
                if (!mealRowMap.has(key)) {
                    mealRowMap.set(key, { name: rowName, time, sortOrder });
                }
            });
        });

        if (mealRowMap.size > 0) {
            localMeals = Array.from(mealRowMap.values())
                .sort((a, b) => {
                    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                    return a.time.localeCompare(b.time);
                })
                .map((m, i) => ({
                    id: `meal-loaded-${i}`,
                    name: m.name,
                    time: m.time
                }));
        } else {
            localMeals = [
                { id: 'm1', name: 'Kahvaltı', time: '08:00' },
                { id: 'm2', name: 'Öğle', time: '12:30' },
                { id: 'm3', name: 'Akşam', time: '19:00' }
            ];
        }

        const newWeeklyPlan: PlanState = {};
        
        const findRowId = (m: any) => {
            const rowName = m.macros?._rowName || (
                    m.type === 'breakfast' ? 'Kahvaltı' :
                    m.type === 'lunch' ? 'Öğle' :
                    m.type === 'dinner' ? 'Akşam' : 'Ara Öğün'
            );
            const time = m.time || m.macros?._time || (m.type === 'breakfast' ? '08:00' : m.type === 'lunch' ? '12:30' : m.type === 'dinner' ? '19:00' : '15:00');
            const sortOrder = m.sort_order ?? m.macros?._sortOrder ?? 0;
            const index = Array.from(mealRowMap.keys()).indexOf(`${rowName}-${time}-${sortOrder}`);
            if (index !== -1 && localMeals[index]) return localMeals[index].id;
            
            return localMeals.find(r => mapMealTypeToDb(r.name) === m.type)?.id;
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

                p.meals.forEach((m: any) => {
                    const rowId = findRowId(m);

                    if (rowId) {
                         if (m.calories || m.macros || m.photo_url) {
                             const recipeObj: PlannedMealContent = {
                                 id: m.id,
                                 name: m.title,
                                 calories: m.calories,
                                 macros: m.macros || { protein: 0, carbs: 0, fat: 0 },
                                 image: m.photo_url,
                                 source: m.source === 'manual' ? 'manual' : 'recipe',
                                 recipeId: m.recipe_id ?? null,
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
      setCustomMealCalories('');
      setCustomMealProtein('');
      setCustomMealCarbs('');
      setCustomMealFat('');
      setCustomMealPhoto(null);
      setCustomMealPhotoPreview(null);
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

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(file.type)) {
         alert("Lütfen geçerli bir görsel yükleyin (jpg, png, webp)");
         return;
      }
      setCustomMealPhoto(file);
      setCustomMealPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleAddCustomMeal = async () => {
    if (!activeCell || !customMealText.trim() || !selectedClient) return;

    let photo_url = null;
    if (customMealPhoto) {
       setIsUploadingPhoto(true);
       const fileExt = customMealPhoto.name.split('.').pop();
       const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
       const filePath = `meal-plans/${selectedClient.id}/${fileName}`;

       const { error: uploadError } = await supabase.storage
         .from('meal-photos')
         .upload(filePath, customMealPhoto);

       if (uploadError) {
          setIsUploadingPhoto(false);
          alert("Görsel yüklenirken bir hata oluştu: " + uploadError.message);
          return;
       }

       const { data: publicUrlData } = supabase.storage.from('meal-photos').getPublicUrl(filePath);
       photo_url = publicUrlData.publicUrl;
       setIsUploadingPhoto(false);
    }

    const manualMeal: PlannedMealContent = {
       id: `manual-${Date.now()}`,
       name: customMealText,
       calories: parseInt(customMealCalories) || 0,
       macros: {
          protein: parseInt(customMealProtein) || 0,
          carbs: parseInt(customMealCarbs) || 0,
          fat: parseInt(customMealFat) || 0
       },
       image: photo_url,
       source: 'manual',
       recipeId: null,
    };

    setWeeklyPlan(prev => ({
      ...prev,
      [activeCell.day]: {
        ...(prev[activeCell.day] || {}),
        [activeCell.mealId]: manualMeal
      }
    }));
    
    // Clear inputs
    setCustomMealText('');
    setCustomMealCalories('');
    setCustomMealProtein('');
    setCustomMealCarbs('');
    setCustomMealFat('');
    setCustomMealPhoto(null);
    setCustomMealPhotoPreview(null);
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

  const handleAddMealSubmit = () => {
    if (!newMealType || !newMealTime) return;
    const newId = `meal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newMeal: MealRow = { 
      id: newId, 
      name: newMealType, 
      time: newMealTime 
    };
    
    const updatedMeals = [...meals, newMeal];
    updatedMeals.sort((a, b) => {
        if (a.time < b.time) return -1;
        if (a.time > b.time) return 1;
        return 0;
    });
    
    setMeals(updatedMeals);
    setIsAddMealModalOpen(false);
  };

  const handleMoveMeal = (index: number, direction: 'up' | 'down') => {
      const newMeals = [...meals];
      if (direction === 'up' && index > 0) {
          [newMeals[index - 1], newMeals[index]] = [newMeals[index], newMeals[index - 1]];
      } else if (direction === 'down' && index < newMeals.length - 1) {
          [newMeals[index + 1], newMeals[index]] = [newMeals[index], newMeals[index + 1]];
      }
      setMeals(newMeals);
  };

  const handleRemoveMeal = (e: React.MouseEvent, mealId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMealToDelete(mealId);
  };

  const executeRemoveMeal = () => {
    if (!mealToDelete) return;
    const mealId = mealToDelete;
    
    setMeals(prevMeals => prevMeals.filter(m => m.id !== mealId));
    
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

    if (activeCell?.mealId === mealId) {
      setActiveCell(null);
      setCustomMealText('');
      setCustomMealCalories('');
      setCustomMealProtein('');
      setCustomMealCarbs('');
      setCustomMealFat('');
      setCustomMealPhoto(null);
      setCustomMealPhotoPreview(null);
    }
    setMealToDelete(null);
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

    if (!isValidUuid(selectedClient.id)) {
      console.warn('[MealPlans] Geçersiz UUID alanı: meal_plans.client_id');
      localStorage.removeItem(LAST_MEAL_PLAN_CLIENT_KEY);
      setSelectedClient(null);
      alert('Seçili danışan bilgisi geçersiz. Danışanı yeniden seçip tekrar deneyin.');
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !isValidUuid(user.id)) {
        console.warn('[MealPlans] Geçersiz UUID alanı: meal_plans.dietitian_id');
        alert('Oturum bilgisi doğrulanamadı. Lütfen yeniden giriş yapın.');
        return;
      }

      const [year, month, day] = weekStartDate.split('-').map(Number);
      const start = new Date(Date.UTC(year, month - 1, day));
      
      // Loop through each day of the week (0 to 6)
      for (let i = 0; i < 7; i++) {
        const currentDayDate = new Date(start);
        currentDayDate.setUTCDate(start.getUTCDate() + i);
        const dateStr = currentDayDate.toISOString().split('T')[0];
        const dayName = DAYS[i]; // 'Pazartesi', 'Salı', etc.

        // Collect meals for this day
        const dayMeals: Omit<MealInput, 'plan_id'>[] = [];
        const dayPlan = weeklyPlan[dayName];
        
        if (dayPlan) {
          for (const mealId of Object.keys(dayPlan)) {
            const content = dayPlan[mealId];
            const mealRow = meals.find(m => m.id === mealId);
            if (!mealRow || !content) continue;

            const mealType = mapMealTypeToDb(mealRow.name);
            
            const mealData: Omit<MealInput, 'plan_id'> = {
              type: mealType,
              title: typeof content === 'string' ? content : content.name,
              is_eaten: false,
              sort_order: meals.findIndex(m => m.id === mealRow.id),
              time: mealRow.time,
              macros: { _rowName: mealRow.name }
            };

            if (typeof content !== 'string') {
              const hasPersistedRecipeId = Object.prototype.hasOwnProperty.call(content, 'recipeId');
              const recipeId = hasPersistedRecipeId ? content.recipeId : content.id;

              mealData.calories = content.calories;
              mealData.macros = { ...mealData.macros, ...content.macros };
              mealData.photo_url = content.image;
              mealData.source = content.source || 'recipe';
              mealData.recipe_id =
                mealData.source === 'recipe' && isValidUuid(recipeId) ? recipeId : null;
            } else {
              mealData.source = 'manual';
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
    } catch (error: unknown) {
      console.error('Plan kaydedilirken hata:', getMealPlanErrorLogContext(error));
      alert(getMealPlanUserMessage(error));
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
                           onClick={() => { setSelectedClient(client); localStorage.setItem(LAST_MEAL_PLAN_CLIENT_KEY, client.id); setIsClientDropdownOpen(false); }}
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

            <button onClick={() => navigate('/profile')} className="focus:outline-none hover:opacity-80 transition-opacity p-0 border-0 bg-transparent cursor-pointer rounded-full" aria-label="Profil sayfasına git" role="button">
            <img src={USER_AVATAR} className="w-10 h-10 rounded-full border border-slate-200 object-cover" alt="Dietitian" />
          </button>
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
                          <div className="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                             <button disabled={idx === 0} onClick={() => handleMoveMeal(idx, 'up')} className="p-0.5 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"><ArrowUp className="w-3.5 h-3.5" /></button>
                             <button disabled={idx === meals.length - 1} onClick={() => handleMoveMeal(idx, 'down')} className="p-0.5 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded disabled:opacity-30 disabled:cursor-not-allowed"><ArrowDown className="w-3.5 h-3.5" /></button>
                          </div>
                          <div className="flex flex-col items-center w-full px-1 gap-1 relative z-10 pl-5">
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
                               // Legacy Manual Text Content
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
                               // Recipe Card Content or Modern Manual Object
                               <div className="h-full bg-white rounded-xl border border-slate-200 shadow-sm p-2 flex flex-col gap-2 relative group/card animate-in zoom-in-95 duration-200">
                                  <button 
                                    onClick={(e) => handleClearCell(e, day, meal.id)}
                                    className="absolute -top-1.5 -right-1.5 bg-white text-slate-400 hover:text-red-500 border border-slate-200 rounded-full p-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity shadow-sm z-20"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                  <div className="h-20 w-full rounded-lg overflow-hidden relative bg-slate-100 flex items-center justify-center">
                                     {cellContent.image ? (
                                         <img src={cellContent.image} alt={cellContent.name} className="w-full h-full object-cover" />
                                     ) : (
                                         <span className="text-slate-400 text-xs font-medium px-2 text-center">{cellContent.name}</span>
                                     )}
                                     {cellContent.image && (
                                         <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-2">
                                            <p className="text-white text-[10px] font-bold line-clamp-1">{cellContent.name}</p>
                                         </div>
                                     )}
                                  </div>
                                  <div className="flex justify-between items-center px-1">
                                     <span className="text-[10px] font-bold text-orange-500 flex items-center gap-0.5">
                                       <Flame className="w-3 h-3" /> {cellContent.calories || 0}
                                     </span>
                                     <span className="text-[10px] text-slate-400">{cellContent.macros?.protein || 0}g Prot</span>
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
                      onClick={() => setIsAddMealModalOpen(true)}
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
                   <div className="flex flex-col gap-3">
                      <input 
                        type="text"
                        value={customMealText}
                        onChange={(e) => setCustomMealText(e.target.value)}
                        placeholder="Yemek Adı (Örn: 2 Haşlanmış Yumurta...)"
                        className="w-full text-sm px-3 py-2 rounded-lg border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-700 bg-white"
                      />
                      
                      <div className="flex gap-2">
                        <input
                           type="number"
                           placeholder="Kalori (kcal)"
                           value={customMealCalories}
                           onChange={(e) => setCustomMealCalories(e.target.value)}
                           className="flex-1 min-w-0 text-sm px-3 py-2 rounded-lg border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-700 bg-white"
                        />
                        <input
                           type="number"
                           placeholder="Protein (g)"
                           value={customMealProtein}
                           onChange={(e) => setCustomMealProtein(e.target.value)}
                           className="flex-1 min-w-0 text-sm px-3 py-2 rounded-lg border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-700 bg-white"
                        />
                      </div>
                      
                      <div className="flex gap-2">
                        <input
                           type="number"
                           placeholder="Karb (g)"
                           value={customMealCarbs}
                           onChange={(e) => setCustomMealCarbs(e.target.value)}
                           className="flex-1 min-w-0 text-sm px-3 py-2 rounded-lg border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-700 bg-white"
                        />
                        <input
                           type="number"
                           placeholder="Yağ (g)"
                           value={customMealFat}
                           onChange={(e) => setCustomMealFat(e.target.value)}
                           className="flex-1 min-w-0 text-sm px-3 py-2 rounded-lg border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-700 bg-white"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                         {customMealPhotoPreview ? (
                            <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-indigo-200 flex-shrink-0">
                               <img src={customMealPhotoPreview} className="w-full h-full object-cover" />
                               <button 
                                 onClick={() => {
                                    setCustomMealPhoto(null);
                                    setCustomMealPhotoPreview(null);
                                 }}
                                 className="absolute -top-1 -right-1 bg-white rounded-full text-red-500 shadow-sm"
                               >
                                 <X className="w-4 h-4" />
                               </button>
                            </div>
                         ) : (
                            <label className="flex-1 flex flex-col items-center justify-center h-16 border-2 border-dashed border-indigo-200 rounded-lg bg-indigo-50/50 cursor-pointer hover:bg-indigo-100/50 transition-colors">
                               <div className="flex items-center gap-2 text-indigo-500">
                                  <Upload className="w-4 h-4" />
                                  <span className="text-[11px] font-medium">Görsel (Opsiyonel)</span>
                               </div>
                               <input 
                                  type="file" 
                                  accept="image/jpeg, image/png, image/webp" 
                                  className="hidden" 
                                  onChange={handlePhotoChange} 
                               />
                            </label>
                         )}
                         
                         <button 
                           onClick={handleAddCustomMeal}
                           disabled={!customMealText.trim() || isUploadingPhoto}
                           className="h-16 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex flex-col items-center justify-center gap-1 font-medium flex-shrink-0"
                         >
                            {isUploadingPhoto ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                            <span className="text-[10px]">{isUploadingPhoto ? 'Yükleniyor...' : 'Ekle'}</span>
                         </button>
                      </div>
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


      {isAddMealModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
             <div className="p-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4">Yeni Öğün Ekle</h3>
                <div className="space-y-4">
                   <div>
                     <label className="block text-sm font-bold text-slate-700 mb-1.5">Öğün Tipi</label>
                     <select 
                       value={newMealType}
                       onChange={(e) => setNewMealType(e.target.value)}
                       className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                     >
                       {MEAL_OPTIONS.map(opt => (
                         <option key={opt} value={opt}>{opt}</option>
                       ))}
                     </select>
                   </div>
                   <div>
                     <label className="block text-sm font-bold text-slate-700 mb-1.5">Öğün Saati</label>
                     <input 
                       type="time" 
                       value={newMealTime}
                       onChange={(e) => setNewMealTime(e.target.value)}
                       onClick={(e) => {
                         try {
                           if ('showPicker' in HTMLInputElement.prototype) {
                             (e.target as HTMLInputElement).showPicker();
                           }
                         } catch (err) {
                           // Ignore unsupported
                         }
                       }}
                       className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer"
                     />
                   </div>
                </div>
                <div className="mt-6 flex gap-3 justify-end">
                   <button onClick={() => setIsAddMealModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors">İptal</button>
                   <button onClick={handleAddMealSubmit} className="px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary-dark rounded-lg shadow-md shadow-primary/30 transition-all active:scale-95">Ekle</button>
                </div>
             </div>
          </div>
        </div>
      )}

      {mealToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
             <div className="p-6">
                <div className="flex items-center gap-3 mb-2 text-red-600">
                   <div className="p-2 bg-red-50 rounded-full"><Trash2 className="w-5 h-5" /></div>
                   <h3 className="text-lg font-bold text-slate-800">Öğünü Sil</h3>
                </div>
                <p className="text-sm text-slate-600 mb-6 pl-12">Bu öğün satırını silmek istiyor musunuz?</p>
                <div className="flex gap-3 justify-end">
                   <button onClick={() => setMealToDelete(null)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors">Vazgeç</button>
                   <button onClick={executeRemoveMeal} className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-md shadow-red-600/30 transition-all active:scale-95">Evet, Sil</button>
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MealPlans;
