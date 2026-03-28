
export interface Client {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: 'Aktif' | 'Pasif';
  goal: string; // Changed from union type to string to match DB text field
  startDate: string;
  duration: string;
  currentWeight: string;
  startWeight?: string; // Added for detail view
  targetWeight?: string; // Added for detail view
  weeklyChange: number;
  compliance: number;
  bloodType?: string;
  chronicConditions?: string[];
  medications?: string[];
  heightCm?: number;
  lastLabDate?: string;
  activityLevel?: string;
  sleepHours?: number;
  smokingStatus?: string;
  alcoholUse?: string;
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
  duration: string | number; // Allow both for compatibility
  type: 'Görüntülü Görüşme' | 'Yüzyüze' | 'Telefon Görüşmesi';
  status: 'upcoming' | 'completed' | 'cancelled';
}

export interface Message {
  id: string;
  sender: 'me' | 'other';
  text: string;
  time: string;
}

export interface Conversation {
  id: string;
  clientName: string;
  clientAvatar: string;
  lastMessage: string;
  lastMessageTime: string;
  isOnline: boolean;
  messages: Message[];
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

export interface DietitianProfile {
  id?: string; // Database ID
  user_id: string; // Link to Supabase Auth (was auth_user_id)
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  university: string;
  graduation_year: number;
  experience_years: number;
  specialization: string;
  bio: string;
  diploma_url: string;
  avatar_url?: string;
  is_verified?: boolean; // Added for new schema
  verification_status?: 'pending' | 'approved' | 'rejected';
  verified_at?: string | null;
  rejection_reason?: string | null;
  created_at?: string;
}
