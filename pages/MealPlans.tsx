
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation , useNavigate} from 'react-router-dom';
import { 
  Search, 
  ChevronDown, 
  Plus, 
  Save, 
  Trash2, 
  Copy, 
  Info, 
  Flame, 
  AlertCircle,
  X,
  Edit2,
  Check,
  Calendar as CalendarIcon,
  ArrowUp,
  ArrowDown,
  Upload,
  Loader2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import { USER_AVATAR } from '../constants';
import { Client } from '../shared/types';
import {
  fetchActiveDietitianClientList,
  fetchClientDetails,
  type ActiveClientDetails,
} from '../features/clients/services/clientService';
import {
  mapMealTypeToDb,
  fetchWeeklyMealPlan,
  getMealPlanErrorLogContext,
  getMealPlanUserMessage,
  saveWeeklyMealPlan,
  type CanonicalDailyMealPlan,
  type CanonicalMeal,
  type WeeklyMealInput,
  type WeeklyMealPlanDayInput,
} from '../features/meal-plans/services/mealPlanService';
import {
  cleanupFailedMealPhotoUploads,
  createMealPhotoLocalPreview,
  getMealPhotoPreviewUrls,
  isCanonicalMealPhotoPath,
  processPendingMealPhotoCleanup,
  uploadMealPhoto,
  validateMealPhotoFile,
} from '../features/meal-plans/services/mealPhotoService';
import { supabase } from '../lib/supabaseClient';
import { isValidUuid } from '../shared/utils/uuid';
import {
  getMealPlanWeekDates,
  mapWeeklyPlansByDate,
  MEAL_PLAN_WEEKDAY_LABELS,
  normalizeMealPlanWeekStart,
  shiftMealPlanWeek,
} from '../features/meal-plans/services/mealPlanReadModel';

const DAYS = MEAL_PLAN_WEEKDAY_LABELS;
const MEAL_OPTIONS = ['Kahvaltı', 'Öğle', 'Akşam', 'Ara Öğün', 'Antrenman Öncesi', 'Antrenman Sonrası', 'Gece Ara Öğünü'];

// Interface for Dynamic Meals
interface MealRow {
  id: string;
  name: string;
  time: string;
}

const getCurrentMondayIso = (): string => {
  const today = new Date();
  return normalizeMealPlanWeekStart(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
  );
};

interface PlannedMealContent {
  id: string;
  mealId?: string;
  name: string;
  image: string | null;
  imagePreview?: string | null;
  pendingPhoto?: File | null;
  calories: number;
  macros: MealMacros;
  source?: 'manual';
  recipeId?: string | null;
  isEaten?: boolean;
}

interface MealMacros {
  protein?: number;
  carbs?: number;
  fat?: number;
  [key: string]: unknown;
}

// Plan State: { Day: { MealID: Content } }
type PlanState = Record<string, Record<string, PlannedMealContent | string | null>>;
type PlanNotesState = Record<string, string | null>;

const DEFAULT_MEAL_ROWS: MealRow[] = [
  { id: 'm1', name: 'Kahvaltı', time: '08:00' },
  { id: 'm2', name: 'Öğle', time: '12:30' },
  { id: 'm3', name: 'Akşam', time: '19:00' },
];

type MealPlanReadMeal = Omit<CanonicalMeal, 'plan_id'>;
type MealPlanReadDay = Omit<CanonicalDailyMealPlan, 'meals'> & { meals: MealPlanReadMeal[] };

const getMealRowDetails = (meal: MealPlanReadMeal) => {
  const mealMacros = meal.macros as Record<string, unknown>;
  const rowName = typeof mealMacros?._rowName === 'string'
    ? mealMacros._rowName
    : meal.type === 'breakfast' ? 'Kahvaltı'
      : meal.type === 'lunch' ? 'Öğle'
        : meal.type === 'dinner' ? 'Akşam'
          : 'Ara Öğün';
  const time = meal.time || (typeof mealMacros?._time === 'string' ? mealMacros._time : '15:00');
  return { rowName, time, sortOrder: meal.sort_order, key: `${rowName}-${time}-${meal.sort_order}` };
};

const mapCanonicalPlansToEditor = (
  plans: MealPlanReadDay[],
  weekStart: string,
  photoPreviews: Map<string, string>,
): { meals: MealRow[]; weeklyPlan: PlanState; planNotes: PlanNotesState; isEmpty: boolean } => {
  const plansByDate = mapWeeklyPlansByDate(plans, weekStart);
  const orderedPlans = getMealPlanWeekDates(weekStart)
    .map((date) => plansByDate.get(date))
    .filter((plan): plan is MealPlanReadDay => Boolean(plan));
  const rowDetails = new Map<string, ReturnType<typeof getMealRowDetails>>();

  orderedPlans.forEach((plan) => plan.meals.forEach((meal) => {
    const details = getMealRowDetails(meal);
    if (!rowDetails.has(details.key)) rowDetails.set(details.key, details);
  }));

  const orderedRows = [...rowDetails.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.time.localeCompare(right.time) || left.key.localeCompare(right.key));
  const meals = orderedRows.length === 0
    ? DEFAULT_MEAL_ROWS.map((meal) => ({ ...meal }))
    : orderedRows.map((details, index) => ({ id: `meal-loaded-${index}`, name: details.rowName, time: details.time }));
  const rowIdByKey = new Map(orderedRows.map((details, index) => [details.key, meals[index].id]));
  const weeklyPlan: PlanState = {};
  const planNotes: PlanNotesState = {};
  const weekDates = getMealPlanWeekDates(weekStart);

  orderedPlans.forEach((plan) => {
    const dayIndex = weekDates.indexOf(plan.plan_date);
    if (dayIndex < 0) return;
    const dayName = DAYS[dayIndex];
    weeklyPlan[dayName] = {};
    planNotes[dayName] = plan.notes ?? null;
    plan.meals.forEach((meal) => {
      const rowId = rowIdByKey.get(getMealRowDetails(meal).key);
      if (!rowId) return;
      weeklyPlan[dayName][rowId] = {
        id: meal.id,
        mealId: meal.id,
        name: meal.title,
        image: meal.photo_url,
        imagePreview: isCanonicalMealPhotoPath(meal.photo_url) ? photoPreviews.get(meal.photo_url) ?? null : null,
        calories: meal.calories ?? 0,
        macros: meal.macros as MealMacros,
        source: 'manual',
        recipeId: null,
        isEaten: meal.is_eaten,
      };
    });
  });

  return { meals, weeklyPlan, planNotes, isEmpty: orderedPlans.every((plan) => plan.meals.length === 0) };
};

const createPreviousWeekCopy = (
  plans: MealPlanReadDay[],
  previousWeekStart: string,
): { meals: MealRow[]; weeklyPlan: PlanState; planNotes: PlanNotesState; isEmpty: boolean } => {
  const plansByDate = mapWeeklyPlansByDate(plans, previousWeekStart);
  const orderedPlans = getMealPlanWeekDates(previousWeekStart)
    .map((date) => plansByDate.get(date))
    .filter((plan): plan is MealPlanReadDay => Boolean(plan));
  const rowDetails = new Map<string, ReturnType<typeof getMealRowDetails>>();

  orderedPlans.forEach((plan) => plan.meals.forEach((meal) => {
    const details = getMealRowDetails(meal);
    if (!rowDetails.has(details.key)) rowDetails.set(details.key, details);
  }));

  const orderedRows = [...rowDetails.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.time.localeCompare(right.time) || left.key.localeCompare(right.key));
  const meals = orderedRows.map((details, index) => ({ id: `copy-row-${index}`, name: details.rowName, time: details.time }));
  const rowIdByKey = new Map(orderedRows.map((details, index) => [details.key, meals[index].id]));
  const weeklyPlan: PlanState = {};
  const planNotes: PlanNotesState = {};
  const weekDates = getMealPlanWeekDates(previousWeekStart);

  orderedPlans.forEach((plan) => {
    const dayIndex = weekDates.indexOf(plan.plan_date);
    if (dayIndex < 0) return;
    const dayName = DAYS[dayIndex];
    weeklyPlan[dayName] = {};
    planNotes[dayName] = plan.notes ?? null;
    plan.meals.forEach((meal) => {
      const rowId = rowIdByKey.get(getMealRowDetails(meal).key);
      if (!rowId) return;
      weeklyPlan[dayName][rowId] = {
        id: `copy-${dayName}-${rowId}`,
        name: meal.title,
        image: null,
        imagePreview: null,
        calories: meal.calories ?? 0,
        macros: meal.macros as MealMacros,
        source: 'manual',
        recipeId: null,
        isEaten: false,
      };
    });
  });

  return { meals, weeklyPlan, planNotes, isEmpty: orderedPlans.every((plan) => plan.meals.length === 0) };
};

const MealPlans = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // --- State ---
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientLoadAttempt, setClientLoadAttempt] = useState(0);
  const [dietitianId, setDietitianId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [weekStartDate, setWeekStartDate] = useState<string>(getCurrentMondayIso);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [isPlanEmpty, setIsPlanEmpty] = useState(false);
  const planRequestRef = useRef(0);
  const [planNotes, setPlanNotes] = useState<PlanNotesState>({});
  const [clientDetails, setClientDetails] = useState<ActiveClientDetails | null>(null);
  const [isLoadingClientDetails, setIsLoadingClientDetails] = useState(false);
  const [clientDetailsError, setClientDetailsError] = useState<string | null>(null);
  const [isClientDetailsEmpty, setIsClientDetailsEmpty] = useState(false);
  const [clientDetailsLoadAttempt, setClientDetailsLoadAttempt] = useState(0);
  const clientDetailsRequestRef = useRef(0);
  const [isCopyingPreviousWeek, setIsCopyingPreviousWeek] = useState(false);
  const [copyInfo, setCopyInfo] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyConfirmation, setCopyConfirmation] = useState<{
    meals: MealRow[];
    weeklyPlan: PlanState;
    planNotes: PlanNotesState;
  } | null>(null);
  const copyRequestRef = useRef(0);
  const copyInFlightRef = useRef(false);
  const copyTargetRef = useRef('');
  
  // Dynamic Meals State (Editable)
  const [meals, setMeals] = useState<MealRow[]>(DEFAULT_MEAL_ROWS);

  const [weeklyPlan, setWeeklyPlan] = useState<PlanState>({});

  // Modal State
  const [isAddMealModalOpen, setIsAddMealModalOpen] = useState(false);
  const [newMealType, setNewMealType] = useState('Ara Öğün');
  const [newMealTime, setNewMealTime] = useState('15:00');
  const [mealToDelete, setMealToDelete] = useState<string | null>(null);
  
  // Interaction State
  const [activeCell, setActiveCell] = useState<{ day: string; mealId: string } | null>(null);
  const [customMealText, setCustomMealText] = useState('');
  const [customMealCalories, setCustomMealCalories] = useState('');
  const [customMealProtein, setCustomMealProtein] = useState('');
  const [customMealCarbs, setCustomMealCarbs] = useState('');
  const [customMealFat, setCustomMealFat] = useState('');
  const [customMealPhoto, setCustomMealPhoto] = useState<File | null>(null);
  const [customMealPhotoPreview, setCustomMealPhotoPreview] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoCleanupWarning, setPhotoCleanupWarning] = useState<string | null>(null);

  copyTargetRef.current = `${selectedClient?.id ?? ''}:${normalizeMealPlanWeekStart(weekStartDate)}`;


  const selectClient = useCallback((client: Client | null) => {
    setSelectedClient(client);
    if (!dietitianId) return;
    const storageKey = `dietbridge:meal-plans:last-client:${dietitianId}`;
    if (client) localStorage.setItem(storageKey, client.id);
    else localStorage.removeItem(storageKey);
  }, [dietitianId]);

  useEffect(() => {
    let active = true;
    const loadClients = async () => {
      setLoadingClients(true);
      setClientError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !isValidUuid(user.id)) throw new Error('AUTH_REQUIRED');
        const result = await fetchActiveDietitianClientList();
        if (!active) return;
        if (result.status === 'error') throw new Error(result.userMessage);

        const activeClients = result.clients;
        setDietitianId(user.id);
        setClients(activeClients);
        const storageKey = `dietbridge:meal-plans:last-client:${user.id}`;
        const storedClientId = localStorage.getItem(storageKey);
        const navClientId = (location.state as { clientId?: string } | null)?.clientId;
        const preferredId = [navClientId, storedClientId].find((id) => id && isValidUuid(id));
        const nextClient = activeClients.find((client) => client.id === preferredId)
          ?? activeClients[0]
          ?? null;
        if (storedClientId && !activeClients.some((client) => client.id === storedClientId)) {
          localStorage.removeItem(storageKey);
        }
        setSelectedClient(nextClient);
        if (nextClient) localStorage.setItem(storageKey, nextClient.id);
      } catch (error) {
        if (!active) return;
        console.error('Failed to load active clients for meal plans:', error);
        setDietitianId(null);
        setClients([]);
        setSelectedClient(null);
        setClientError('Aktif danışanlar yüklenemedi. Lütfen tekrar deneyin.');
      } finally {
        if (active) setLoadingClients(false);
      }
    };
    void loadClients();
    return () => { active = false; };
  }, [clientLoadAttempt, location.state]);

  const loadWeeklyPlan = useCallback(async () => {
    const requestId = ++planRequestRef.current;
    if (!selectedClient || !dietitianId) {
      setWeeklyPlan({});
      setPlanNotes({});
      setIsPlanEmpty(false);
      setPlanError(null);
      setIsLoadingPlan(false);
      return;
    }

    const snapshot = {
      clientId: selectedClient.id,
      dietitianId,
      weekStart: normalizeMealPlanWeekStart(weekStartDate),
    };
    setIsLoadingPlan(true);
    setPlanError(null);
    setWeeklyPlan({});
    try {
      const plans = await fetchWeeklyMealPlan(
        snapshot.clientId,
        snapshot.dietitianId,
        snapshot.weekStart,
        getMealPlanWeekDates(snapshot.weekStart)[6],
      );
      const photoPreviews = await getMealPhotoPreviewUrls(
        plans.flatMap((plan) => plan.meals.flatMap((meal) => (
          isCanonicalMealPhotoPath(meal.photo_url) ? [meal.photo_url] : []
        ))),
      );
      if (requestId !== planRequestRef.current) return;
      const editor = mapCanonicalPlansToEditor(plans, snapshot.weekStart, photoPreviews);
      setMeals(editor.meals);
      setWeeklyPlan(editor.weeklyPlan);
      setPlanNotes(editor.planNotes);
      setIsPlanEmpty(editor.isEmpty);
    } catch (error) {
      if (requestId !== planRequestRef.current) return;
      console.error('Error loading plan:', getMealPlanErrorLogContext(error));
      setPlanError('Plan yüklenemedi. Lütfen aynı hafta için tekrar deneyin.');
      setIsPlanEmpty(false);
    } finally {
      if (requestId === planRequestRef.current) setIsLoadingPlan(false);
    }
  }, [dietitianId, selectedClient, weekStartDate]);

  useEffect(() => {
    void loadWeeklyPlan();
  }, [loadWeeklyPlan]);

  useEffect(() => {
    const requestId = ++clientDetailsRequestRef.current;
    if (!selectedClient) {
      setClientDetails(null);
      setClientDetailsError(null);
      setIsClientDetailsEmpty(false);
      setIsLoadingClientDetails(false);
      return;
    }

    const loadClientDetails = async () => {
      setIsLoadingClientDetails(true);
      setClientDetailsError(null);
      setIsClientDetailsEmpty(false);
      try {
        const result = await fetchClientDetails(selectedClient.id);
        if (requestId !== clientDetailsRequestRef.current) return;
        if (result.status === 'active') {
          setClientDetails(result.client);
          setIsClientDetailsEmpty(false);
        } else if (result.status === 'error') {
          setClientDetails(null);
          setClientDetailsError(result.userMessage);
          setIsClientDetailsEmpty(false);
        } else {
          setClientDetails(null);
          setIsClientDetailsEmpty(true);
        }
      } catch {
        if (requestId !== clientDetailsRequestRef.current) return;
        setClientDetails(null);
        setIsClientDetailsEmpty(false);
        setClientDetailsError('Danışan bilgileri şu anda yüklenemiyor. Lütfen tekrar deneyin.');
      }
      if (requestId !== clientDetailsRequestRef.current) return;
      setIsLoadingClientDetails(false);
    };

    void loadClientDetails();
  }, [clientDetailsLoadAttempt, selectedClient]);

  useEffect(() => {
    copyRequestRef.current += 1;
    setCopyConfirmation(null);
    setCopyInfo(null);
    setCopyError(null);
  }, [selectedClient?.id, weekStartDate]);

  const hasEditorMeals = Object.values(weeklyPlan)
    .some((day) => Object.values(day).some(Boolean));

  const applyPreviousWeekCopy = (copy: NonNullable<typeof copyConfirmation>) => {
    setMeals(copy.meals);
    setWeeklyPlan(copy.weeklyPlan);
    setPlanNotes(copy.planNotes);
    setIsPlanEmpty(Object.keys(copy.weeklyPlan).length === 0);
    setActiveCell(null);
    setCopyConfirmation(null);
    setCopyInfo('Önceki haftanın planı editöre kopyalandı. Kalıcı hale getirmek için Planı Kaydet’i kullanın.');
  };

  const handleCopyPreviousWeek = async () => {
    if (!selectedClient || !dietitianId || copyInFlightRef.current) return;
    copyInFlightRef.current = true;
    const requestId = ++copyRequestRef.current;
    const snapshot = {
      clientId: selectedClient.id,
      dietitianId,
      weekStart: normalizeMealPlanWeekStart(weekStartDate),
    };
    const targetKey = `${snapshot.clientId}:${snapshot.weekStart}`;
    setIsCopyingPreviousWeek(true);
    setCopyInfo(null);
    setCopyError(null);

    try {
      const previousWeekStart = shiftMealPlanWeek(snapshot.weekStart, -1);
      const plans = await fetchWeeklyMealPlan(
        snapshot.clientId,
        snapshot.dietitianId,
        previousWeekStart,
        getMealPlanWeekDates(previousWeekStart)[6],
      );
      if (requestId !== copyRequestRef.current || copyTargetRef.current !== targetKey) return;
      const copy = createPreviousWeekCopy(plans, previousWeekStart);
      if (copy.isEmpty) {
        setCopyInfo('Önceki haftada kopyalanacak öğün yok.');
        return;
      }
      if (hasEditorMeals) {
        setCopyConfirmation(copy);
        return;
      }
      applyPreviousWeekCopy(copy);
    } catch (error) {
      if (requestId !== copyRequestRef.current || copyTargetRef.current !== targetKey) return;
      console.error('Previous meal plan copy failed:', getMealPlanErrorLogContext(error));
      setCopyError('Önceki hafta planı yüklenemedi. Mevcut editör değişmedi; lütfen tekrar deneyin.');
    } finally {
      if (requestId === copyRequestRef.current) setIsCopyingPreviousWeek(false);
      copyInFlightRef.current = false;
    }
  };

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

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        validateMealPhotoFile(file);
      } catch {
        alert('Lütfen en fazla 5 MiB boyutunda JPEG, PNG veya WebP görsel seçin.');
        return;
      }
      setCustomMealPhoto(file);
      setCustomMealPhotoPreview(createMealPhotoLocalPreview(file));
    }
  };

  const handleAddCustomMeal = () => {
    if (!activeCell || !customMealText.trim() || !selectedClient) return;

    const manualMeal: PlannedMealContent = {
       id: `manual-${Date.now()}`,
       name: customMealText,
       calories: parseInt(customMealCalories) || 0,
       macros: {
          protein: parseInt(customMealProtein) || 0,
          carbs: parseInt(customMealCarbs) || 0,
          fat: parseInt(customMealFat) || 0
       },
       image: null,
       imagePreview: customMealPhotoPreview,
       pendingPhoto: customMealPhoto,
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

  const handleSavePlan = async () => {
    if (!selectedClient) {
      alert('Lütfen bir danışan seçiniz.');
      return;
    }

    if (!isValidUuid(selectedClient.id)) {
      console.warn('[MealPlans] Geçersiz UUID alanı: meal_plans.client_id');
      selectClient(null);
      alert('Seçili danışan bilgisi geçersiz. Danışanı yeniden seçip tekrar deneyin.');
      return;
    }

    setIsSaving(true);
    setPhotoCleanupWarning(null);
    const uploadedPhotoPaths: string[] = [];
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !isValidUuid(user.id)) {
        console.warn('[MealPlans] Geçersiz UUID alanı: meal_plans.dietitian_id');
        alert('Oturum bilgisi doğrulanamadı. Lütfen yeniden giriş yapın.');
        return;
      }

      const normalizedWeekStart = normalizeMealPlanWeekStart(weekStartDate);
      const weekDates = getMealPlanWeekDates(normalizedWeekStart);
      
      const weeklyPayload: WeeklyMealPlanDayInput[] = [];
      setIsUploadingPhoto(true);

      // Build the complete Monday-Sunday payload before the single RPC call.
      for (let i = 0; i < 7; i++) {
        const dateStr = weekDates[i];
        const dayName = DAYS[i]; // 'Pazartesi', 'Salı', etc.

        // Collect meals for this day
        const dayMeals: WeeklyMealInput[] = [];
        const dayPlan = weeklyPlan[dayName];
        
        if (dayPlan) {
          for (const mealId of Object.keys(dayPlan)) {
            const content = dayPlan[mealId];
            const mealRow = meals.find(m => m.id === mealId);
            if (!mealRow || !content) continue;

            const mealType = mapMealTypeToDb(mealRow.name);
            
            const mealData: WeeklyMealInput = {
              type: mealType,
              title: typeof content === 'string' ? content : content.name,
              sort_order: meals.findIndex(m => m.id === mealRow.id),
              time: mealRow.time,
              macros: { _rowName: mealRow.name },
              source: 'manual',
              recipe_id: null,
            };

            if (typeof content !== 'string') {
              if (content.mealId) mealData.id = content.mealId;
              mealData.calories = content.calories;
              mealData.macros = { ...mealData.macros, ...content.macros };
              if (content.pendingPhoto) {
                const uploadedPath = await uploadMealPhoto({
                  file: content.pendingPhoto,
                  clientId: selectedClient.id,
                  dietitianId: user.id,
                });
                uploadedPhotoPaths.push(uploadedPath);
                mealData.photo_url = uploadedPath;
              } else if (isCanonicalMealPhotoPath(content.image)) {
                mealData.photo_url = content.image;
              } else {
                mealData.photo_url = null;
              }
              mealData.source = 'manual';
              mealData.recipe_id = null;
            }

            dayMeals.push(mealData);
          }
        }

        weeklyPayload.push({
          plan_date: dateStr,
          notes: planNotes[dayName] ?? null,
          meals: dayMeals,
        });
      }

      const savedWeek = await saveWeeklyMealPlan(selectedClient.id, normalizedWeekStart, weeklyPayload);
      const photoPreviews = await getMealPhotoPreviewUrls(
        savedWeek.plans.flatMap((plan) => plan.meals.flatMap((meal) => (
          isCanonicalMealPhotoPath(meal.photo_url) ? [meal.photo_url] : []
        ))),
      );
      const editor = mapCanonicalPlansToEditor(savedWeek.plans, normalizedWeekStart, photoPreviews);
      setMeals(editor.meals);
      setWeeklyPlan(editor.weeklyPlan);
      setPlanNotes(editor.planNotes);
      setIsPlanEmpty(editor.isEmpty);

      const cleanup = await processPendingMealPhotoCleanup();
      setPhotoCleanupWarning(cleanup.warning);

      alert('Haftalık plan başarıyla kaydedildi!');
    } catch (error: unknown) {
      if (uploadedPhotoPaths.length > 0) {
        const cleanup = await cleanupFailedMealPhotoUploads(uploadedPhotoPaths);
        setPhotoCleanupWarning(cleanup.warning);
      }
      console.error('Plan kaydedilirken hata:', getMealPlanErrorLogContext(error));
      alert(getMealPlanUserMessage(error));
    } finally {
      setIsUploadingPhoto(false);
      setIsSaving(false);
    }
  };

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
                          <input
                            type="search"
                            value={clientSearch}
                            onChange={(event) => setClientSearch(event.target.value)}
                            placeholder="Ara..."
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 rounded-lg text-sm border-none focus:ring-1 focus:ring-primary"
                          />
                       </div>
                       {clients.filter((client) => (
                         `${client.name} ${client.goal}`.toLocaleLowerCase('tr-TR')
                           .includes(clientSearch.trim().toLocaleLowerCase('tr-TR'))
                       )).map(client => (
                         <button
                           key={client.id}
                           onClick={() => { selectClient(client); setIsClientDropdownOpen(false); }}
                           className="w-full flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg transition-colors group"
                         >
                           <img src={client.avatar} className="w-8 h-8 rounded-full object-cover group-hover:ring-2 ring-primary/20" alt={client.name} />
                           <div className="text-left">
                              <p className="text-sm font-semibold text-slate-700">{client.name}</p>
                              <p className="text-sm text-slate-400">{client.goal}</p>
                           </div>
                         </button>
                       ))}
                       {clientError && (
                         <div className="p-3 text-center text-rose-600 text-sm">
                           <p>{clientError}</p>
                           <button type="button" onClick={() => setClientLoadAttempt((attempt) => attempt + 1)} className="mt-2 min-h-11 px-3 text-sm font-semibold underline">Tekrar dene</button>
                         </div>
                       )}
                       {!clientError && clients.length === 0 && !loadingClients && (
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
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 px-2 py-1.5 rounded-xl">
              <button type="button" aria-label="Önceki hafta" onClick={() => setWeekStartDate((value) => shiftMealPlanWeek(value, -1))} className="min-h-11 min-w-11 rounded-lg text-slate-500 hover:bg-white"><ChevronLeft className="mx-auto h-4 w-4" /></button>
              <CalendarIcon className="w-4 h-4 text-slate-400" />
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-400 font-bold uppercase leading-none">Başlangıç Tarihi</span>
                <input 
                  type="date" 
                  value={weekStartDate}
                  onChange={(e) => {
                    if (e.target.value) setWeekStartDate(normalizeMealPlanWeekStart(e.target.value));
                  }}
                  className="bg-transparent text-sm font-bold text-slate-700 focus:outline-none p-0 h-4 leading-none w-28"
                />
              </div>
              <button type="button" aria-label="Sonraki hafta" onClick={() => setWeekStartDate((value) => shiftMealPlanWeek(value, 1))} className="min-h-11 min-w-11 rounded-lg text-slate-500 hover:bg-white"><ChevronRight className="mx-auto h-4 w-4" /></button>
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
                <h2 className="text-xl font-bold text-slate-700">{loadingClients ? 'Aktif danışanlar yükleniyor' : clientError ? 'Danışanlar yüklenemedi' : 'Aktif danışan yok'}</h2>
                <p className="text-slate-500 mt-2 max-w-md">{loadingClients ? 'Aktif danışanlar güvenli biçimde doğrulanıyor.' : clientError ? clientError : 'Plan oluşturmak için aktif danışan ilişkisinin bulunması gerekir.'}</p>
                {clientError && <button type="button" onClick={() => setClientLoadAttempt((attempt) => attempt + 1)} className="mt-4 min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700">Tekrar dene</button>}
             </div>
           ) : (
             <>
               {photoCleanupWarning && (
                 <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
                   <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                   <span>{photoCleanupWarning}</span>
                 </div>
               )}
               {copyError && (
                 <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800" role="alert">
                   <p className="font-semibold">{copyError}</p>
                   <button type="button" onClick={() => void handleCopyPreviousWeek()} disabled={isCopyingPreviousWeek} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-300 bg-white px-4 text-sm font-semibold disabled:opacity-50">
                     <RotateCcw className="h-4 w-4" /> Tekrar dene
                   </button>
                 </div>
               )}
               {copyInfo && (
                 <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-800" role="status">
                   {copyInfo}
                 </div>
               )}
               {copyConfirmation && (
                 <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900" role="alert">
                   <p className="font-semibold">Mevcut hafta editöründe öğünler var.</p>
                   <p className="mt-1 text-sm">Önceki haftayı kopyalamak, yalnız editördeki mevcut öğünleri değiştirir; henüz veritabanına kayıt yapılmaz.</p>
                   <div className="mt-3 flex flex-wrap gap-2">
                     <button type="button" onClick={() => { setCopyConfirmation(null); setCopyInfo('Kopyalama iptal edildi.'); }} className="min-h-11 rounded-lg border border-amber-300 bg-white px-4 text-sm font-semibold">İptal</button>
                     <button type="button" onClick={() => applyPreviousWeekCopy(copyConfirmation)} className="min-h-11 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white">Editörde değiştir</button>
                   </div>
                 </div>
               )}
               {planError && (
                 <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-800" role="alert">
                   <p className="font-semibold">{planError}</p>
                   <button type="button" onClick={() => void loadWeeklyPlan()} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-300 bg-white px-4 text-sm font-semibold"><RotateCcw className="h-4 w-4" /> Aynı haftayı tekrar dene</button>
                 </div>
               )}
               {!planError && <>
               {/* Grid Controls */}
               <div className="flex justify-between items-center mb-6">
                  <div className="flex gap-2">
                    <button onClick={() => { setWeeklyPlan({}); setPlanNotes({}); }} className="flex min-h-11 items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-sm font-medium shadow-sm">
                      <Trash2 className="w-4 h-4" /> Temizle
                    </button>
                    <button type="button" onClick={() => void handleCopyPreviousWeek()} disabled={isCopyingPreviousWeek} className="flex min-h-11 items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
                      {isCopyingPreviousWeek ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />} {isCopyingPreviousWeek ? 'Kopyalanıyor...' : 'Geçen Haftayı Kopyala'}
                    </button>
                  </div>
                  <div className="flex gap-3">
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

                  {isPlanEmpty && !isLoadingPlan && (
                    <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
                      Bu hafta için kaydedilmiş öğün yok. Boş bir plan oluşturabilirsiniz.
                    </div>
                  )}

                  {/* Header Row */}
                  <div className="grid grid-cols-8 divide-x divide-slate-100 border-b border-slate-200 bg-slate-50">
                     <div className="p-4 flex items-center justify-center font-bold text-slate-400 text-xs uppercase tracking-wider bg-slate-50/80">
                        Öğünler
                     </div>
                     {DAYS.map((day, index) => (
                       <div key={day} className="p-4 text-center font-bold text-slate-700 text-sm">
                         <div>{day}</div>
                         <div className="mt-1 text-xs font-medium text-slate-400">{getMealPlanWeekDates(weekStartDate)[index]}</div>
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
                               // Manual meal content
                               <div className="h-full bg-white rounded-xl border border-slate-200 shadow-sm p-2 flex flex-col gap-2 relative group/card animate-in zoom-in-95 duration-200">
                                  <button 
                                    onClick={(e) => handleClearCell(e, day, meal.id)}
                                    className="absolute -top-1.5 -right-1.5 bg-white text-slate-400 hover:text-red-500 border border-slate-200 rounded-full p-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity shadow-sm z-20"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                  <div className="h-20 w-full rounded-lg overflow-hidden relative bg-slate-100 flex items-center justify-center">
                                     {(cellContent.imagePreview ?? (isCanonicalMealPhotoPath(cellContent.image) ? null : cellContent.image)) ? (
                                         <img
                                           src={cellContent.imagePreview ?? (isCanonicalMealPhotoPath(cellContent.image) ? '' : cellContent.image ?? '')}
                                           alt={cellContent.name}
                                           className="w-full h-full object-cover"
                                         />
                                     ) : (
                                         <span className="text-slate-400 text-xs font-medium px-2 text-center">{cellContent.name}</span>
                                     )}
                                     {(cellContent.imagePreview ?? (isCanonicalMealPhotoPath(cellContent.image) ? null : cellContent.image)) && (
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
               </>}
             </>
           )}
        </div>
      </div>

      {/* --- RIGHT SIDE: Sidebar (Client Info & Recipes) --- */}
      <aside className="w-96 bg-white border-l border-slate-200 flex flex-col h-full shadow-lg z-30">
        
        {/* 1. Client Info Panel (Conditional) */}
        {selectedClient ? (
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-800 flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> Danışan Bilgileri
            </h3>
            {isLoadingClientDetails ? (
              <p className="text-xs text-slate-500">Danışan ayrıntıları yükleniyor...</p>
            ) : clientDetailsError ? (
              <div className="text-xs text-rose-700" role="alert">
                <p>{clientDetailsError}</p>
                <button type="button" onClick={() => setClientDetailsLoadAttempt((attempt) => attempt + 1)} className="mt-2 min-h-11 rounded-lg border border-rose-200 bg-white px-3 font-semibold">Tekrar dene</button>
              </div>
            ) : clientDetails ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white p-3 rounded-xl border border-red-100 shadow-sm">
                  <p className="text-xs font-bold text-red-500 mb-2 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Alerji / Kısıt</p>
                  <div className="flex flex-wrap gap-1">
                    {clientDetails.foodIntolerances.length > 0 ? clientDetails.foodIntolerances.map((item) => <span key={item} className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[10px] font-medium">{item}</span>) : <span className="text-[10px] text-slate-400">Yok</span>}
                  </div>
                </div>
                <div className="bg-white p-3 rounded-xl border border-emerald-100 shadow-sm">
                  <p className="text-xs font-bold text-emerald-600 mb-2">Sevmedikleri</p>
                  <div className="flex flex-wrap gap-1">
                    {clientDetails.dislikedFoods.length > 0 ? clientDetails.dislikedFoods.map((item) => <span key={item} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px] font-medium">{item}</span>) : <span className="text-[10px] text-slate-400">Yok</span>}
                  </div>
                </div>
              </div>
            ) : <p className="text-xs text-slate-400">{isClientDetailsEmpty ? 'Yok' : 'Danışan ayrıntısı bulunamadı.'}</p>}
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
              {!activeCell && (
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Manuel öğün eklemek veya düzenlemek için plandan bir hücre seçin.</p>
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
                         } catch {
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
