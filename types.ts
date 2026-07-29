export interface Client {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: 'Aktif' | 'Pasif';
  goal: 'Kilo Verme' | 'Kas Kazanımı' | 'Sağlıklı Yaşam' | 'Koruma' | 'Sporcu Beslenmesi';
  startDate: string;
  duration: string;
  currentWeight: string;
  weeklyChange: number;
  compliance: number;
}

export interface Task {
  id: string;
  title: string;
  clientName: string;
  clientAvatar: string;
  timeInfo: string;
  isCompleted: boolean;
}

export interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  clientAvatar?: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  duration: string;
  type: 'Görüntülü Görüşme' | 'Yüzyüze' | 'Telefon Görüşmesi';
  status: 'upcoming' | 'completed' | 'cancelled';
}

export type RecipeCategory = 'Kahvaltı' | 'Ara Öğün' | 'Öğle Yemeği' | 'Akşam Yemeği' | 'Tatlı';

export interface Recipe {
  id: string;
  name: string;
  image: string;
  category: RecipeCategory;
  calories: number;
  cuisine?: string;
  createdAt: string;
  prepTime: string;
  servings: number;
  ingredients: string[];
  instructions: string[];
  macros: {
    protein: number;
    carbs: number;
    fat: number;
  };
}
