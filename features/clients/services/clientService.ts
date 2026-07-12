
import { supabase } from '../../../lib/supabaseClient';
import { Client } from '../../../shared/types';
import { USER_AVATAR } from '../../../shared/constants';

export function resolveProfilePhotoUrl(
  storedValue: string | null | undefined
): string | null {
  if (!storedValue) return null;

  if (/^https?:\/\//i.test(storedValue)) {
    return storedValue;
  }

  try {
    const { data } = supabase.storage.from('avatars').getPublicUrl(storedValue);
    if (data?.publicUrl) {
      return data.publicUrl;
    }
  } catch (e) {
    console.error("Error resolving profile photo:", e);
  }
  return null;
}

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: 'Hareketsiz',
  lightly_active: 'Az Aktif',
  moderately_active: 'Orta Aktif',
  very_active: 'Çok Aktif',
  extra_active: 'Ekstra Aktif',
};

const SMOKING_LABELS: Record<string, string> = {
  smoker: 'Kullanıyor',
  non_smoker: 'Kullanmıyor',
  occasionally: 'Ara Sıra',
};

const ALCOHOL_LABELS: Record<string, string> = {
  uses: 'Kullanıyor',
  does_not_use: 'Kullanmıyor',
  occasionally: 'Ara Sıra',
};

interface ClientBaseProfileRow {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
}

interface ClientDetailsProfileRow {
  goal: string | null;
  diet_start_date: string | null;
  current_weight: number | null;
  compliance_score: number | null;
  start_weight: number | null;
  target_weight: number | null;
  height_cm: number | null;
  last_lab_date: string | null;
  activity_level: string | null;
  sleep_hours: number | string | null;
  smoking_status: string | null;
  alcohol_use: string | null;
  daily_water_goal_ml: number | null;
  food_intolerances: unknown;
  chronic_conditions: unknown;
  medications: unknown;
  blood_type: string | null;
}


/**
 * Fetches clients associated with the logged-in dietitian.
 */
export const fetchDietitianClients = async (): Promise<Client[]> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('dietitian_clients')
      .select(`
        status,
        client:client_id (
          id,
          full_name,
          avatar_url,
          email,
          client_profiles (
            goal,
            diet_start_date,
            current_weight,
            compliance_score,
            start_weight,
            target_weight,
            height_cm,
            last_lab_date,
            activity_level,
            sleep_hours,
            smoking_status,
            alcohol_use,
            blood_types (
              code
            )
          ),
          client_medical_conditions (
            medical_conditions (
              name
            )
          ),
          client_medications (
            medications_catalog (
              name
            )
          )
        )
      `)
      .eq('dietitian_id', user.id)
      .in('status', ['active', 'pending']);

    if (error) {
      console.error('Supabase clients fetch returned error:', error.message);
      throw error; 
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Map Supabase DB shape to App UI shape
    return data.map((item: any) => {
      const client = item.client;
      // client_profiles is likely an array due to the join, even if 1:1 logically
      const profile = Array.isArray(client.client_profiles) 
        ? client.client_profiles[0] 
        : client.client_profiles || {};
      
      const bloodType = profile.blood_types?.code || undefined;
      
      const chronicConditions = Array.isArray(client.client_medical_conditions)
        ? client.client_medical_conditions.map((c: any) => c.medical_conditions?.name).filter(Boolean)
        : [];

      const medications = Array.isArray(client.client_medications)
        ? client.client_medications.map((m: any) => m.medications_catalog?.name).filter(Boolean)
        : [];

      return {
        id: client.id,
        name: client.full_name || 'İsimsiz Danışan',
        email: client.email || '',
        avatar: resolveProfilePhotoUrl(client.avatar_url) || USER_AVATAR,
        profilePhotoUrl: resolveProfilePhotoUrl(client.avatar_url),
        status: item.status === 'active' ? 'Aktif' : item.status === 'pending' ? 'Onay Bekliyor' : 'Pasif',
        goal: profile.goal || 'Sağlıklı Yaşam',
        startDate: profile.diet_start_date ? new Date(profile.diet_start_date).toLocaleDateString('tr-TR') : '-',
        duration: '1 Ay', // Calculated or static
        currentWeight: profile.current_weight ? `${profile.current_weight} kg` : '-',
        startWeight: profile.start_weight ? `${profile.start_weight} kg` : undefined,
        targetWeight: profile.target_weight ? `${profile.target_weight} kg` : undefined,
        weeklyChange: 0, // Needs calculation from daily_logs
        compliance: profile.compliance_score || 0,
        bloodType,
        chronicConditions,
        medications,
        heightCm: profile.height_cm,
        lastLabDate: profile.last_lab_date ? new Date(profile.last_lab_date).toLocaleDateString('tr-TR') : undefined,
        activityLevel: ACTIVITY_LABELS[profile.activity_level] || profile.activity_level,
        sleepHours: profile.sleep_hours,
        smokingStatus: SMOKING_LABELS[profile.smoking_status] || profile.smoking_status,
        alcoholUse: ALCOHOL_LABELS[profile.alcohol_use] || profile.alcohol_use,
      };
    });
  } catch (err: any) {
    console.error('Network error or exception in fetchDietitianClients:', err.message || err);
    throw err;
  }
};

/**
 * Fetch a single client's details
 */
export function normalizeMultiValue(value: any): string[] {
  if (value === null || value === undefined || value === "") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (!trimmedValue) return [];

    try {
      const parsedValue = JSON.parse(trimmedValue);
      if (Array.isArray(parsedValue)) {
        return parsedValue.map(item => String(item).trim()).filter(Boolean);
      }
    } catch {
      // Not JSON
    }

    return trimmedValue.split(",").map(item => item.trim()).filter(Boolean);
  }

  return [];
}


export const fetchClientDetails = async (clientId: string): Promise<Client | null> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // 1. Verify dietitian-client relationship
    const { data: relation, error: relationError } = await supabase
      .from('dietitian_clients')
      .select('client_id, status')
      .eq('dietitian_id', user.id)
      .eq('client_id', clientId)
      .maybeSingle();

    if (relationError) throw relationError;
    if (!relation) {
      console.warn("No active relation found for client:", clientId);
      return null;
    }

    // 2. Fetch profile data
    const { data: userProfile, error: userProfileError } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, email, phone')
      .eq('id', clientId)
      .maybeSingle();

    if (userProfileError) throw userProfileError;

    // 3. Fetch client profile data
    const { data: clientProfile, error: clientProfileError } = await supabase
      .from('client_profiles')
      .select(`
        goal,
        diet_start_date,
        current_weight,
        compliance_score,
        start_weight,
        target_weight,
        height_cm,
        last_lab_date,
        activity_level,
        sleep_hours,
        smoking_status,
        alcohol_use,
        daily_water_goal_ml,
        food_intolerances,
        chronic_conditions,
        medications,
        blood_type
      `)
      .eq('user_id', clientId)
      .maybeSingle();

    if (clientProfileError) {
       console.warn("Client profile not found or error:", clientProfileError);
    }

    const clientData = (userProfile ?? {}) as Partial<ClientBaseProfileRow>;
    const profile = (clientProfile ?? {}) as Partial<ClientDetailsProfileRow>;

    const bloodType = profile.blood_type || undefined;
    const chronicConditions = normalizeMultiValue(profile.chronic_conditions);
    const medications = normalizeMultiValue(profile.medications);
    const foodIntolerances = normalizeMultiValue(profile.food_intolerances);
    const waterGoalLiters = profile.daily_water_goal_ml ? profile.daily_water_goal_ml / 1000 : undefined;
    
    // Process sleep hours correctly
    const sleepHours = profile.sleep_hours !== null && profile.sleep_hours !== undefined 
      ? Number(profile.sleep_hours) 
      : undefined;

    return {
      id: clientId,
      name: clientData.full_name || 'İsimsiz Danışan',
      email: clientData.email || '',
      phone: clientData.phone || '',
      avatar: resolveProfilePhotoUrl(clientData.avatar_url) || USER_AVATAR,
      profilePhotoUrl: resolveProfilePhotoUrl(clientData.avatar_url),
      status: relation.status === 'active' ? 'Aktif' : relation.status === 'pending' ? 'Onay Bekliyor' : 'Pasif',
      goal: profile.goal || 'Sağlıklı Yaşam',
      startDate: profile.diet_start_date ? new Date(profile.diet_start_date).toLocaleDateString('tr-TR') : '-',
      duration: '1 Ay',
      currentWeight: profile.current_weight ? `${profile.current_weight}` : '-',
      startWeight: profile.start_weight ? `${profile.start_weight}` : undefined,
      targetWeight: profile.target_weight ? `${profile.target_weight}` : undefined,
      weeklyChange: 0,
      compliance: profile.compliance_score || 0,
      bloodType,
      chronicConditions,
      medications,
      foodIntolerances,
      waterGoalLiters,
      heightCm: profile.height_cm,
      lastLabDate: profile.last_lab_date ? new Date(profile.last_lab_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined,
      activityLevel: ACTIVITY_LABELS[profile.activity_level] || profile.activity_level || null,
      sleepHours,
      smokingStatus: SMOKING_LABELS[profile.smoking_status] || profile.smoking_status || null,
      alcoholUse: ALCOHOL_LABELS[profile.alcohol_use] || profile.alcohol_use || null,
    };
  } catch (err) {
    console.error('Error fetching client details:', err);
    throw err;
  }
};

export interface Measurement {
  id: string;
  weight: number;
  measured_at: string;
  notes?: string;
  created_at: string;
}

export interface DailyLog {
  id: string;
  date: string;
  water_intake: number;
}

export const fetchClientMeasurements = async (clientId: string): Promise<Measurement[]> => {
  try {
    const { data, error } = await supabase
      .from('measurements')
      .select('id, weight, measured_at, created_at, notes')
      .eq('client_id', clientId)
      .order('measured_at', { ascending: true });
    
    if (error) {
       console.error("Error fetching measurements", error);
       return [];
    }
    return data || [];
  } catch (err) {
    console.error("fetchClientMeasurements exception", err);
    return [];
  }
};

export const fetchClientDailyLogs = async (clientId: string): Promise<DailyLog[]> => {
  try {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('id, date, water_intake')
      .eq('client_id', clientId)
      .order('date', { ascending: true });
    
    if (error) {
       console.error("Error fetching daily_logs", error);
       return [];
    }
    return data || [];
  } catch (err) {
    console.error("fetchClientDailyLogs exception", err);
    return [];
  }
};

export type AddClientResult = 
  | { status: 'success' }
  | { status: 'not_found' }
  | { status: 'invalid_role' }
  | { status: 'already_linked' }
  | { status: 'error', message?: string };

/**
 * Links an existing client to the currently authenticated dietitian by email.
 */
export const addClientByEmail = async (email: string): Promise<AddClientResult> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: 'error', message: 'User not authenticated' };

    // 1. Search profiles for that email
    const { data: clientProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (profileError) {
      if (profileError.code === 'PGRST116') {
        // No rows returned
        return { status: 'not_found' };
      }
      console.error('Error fetching profile by email:', profileError);
      return { status: 'error', message: profileError.message };
    }

    if (!clientProfile) {
      return { status: 'not_found' };
    }

    // 2. Confirm role = 'client'
    if (clientProfile.role !== 'client') {
      return { status: 'invalid_role' };
    }

    // 3. Check whether a dietitian_clients relation already exists
    const { data: existingLink, error: linkError } = await supabase
      .from('dietitian_clients')
      .select('id, status')
      .eq('dietitian_id', user.id)
      .eq('client_id', clientProfile.id)
      .maybeSingle();

    if (linkError) {
      console.error('Error checking existing link:', linkError);
      return { status: 'error', message: 'İşlem sırasında bir hata oluştu. Lütfen tekrar deneyin.' };
    }

    if (existingLink) {
      if (existingLink.status === 'active' || existingLink.status === 'pending') {
        return { status: 'already_linked' };
      } else {
        // It's rejected or removed, try to update it back to pending
        const { error: updateError } = await supabase
          .from('dietitian_clients')
          .update({ status: 'pending', requested_at: new Date().toISOString() })
          .eq('id', existingLink.id);

        if (updateError) {
           if (updateError.code === '23505') {
              return { status: 'error', message: 'Bu danışana zaten başka bir diyetisyen tarafından bağlantı isteği gönderilmiş veya aktif bağlantısı bulunuyor.' };
           }
           console.error('Error updating existing link:', updateError);
           return { status: 'error', message: 'İşlem sırasında bir hata oluştu. Lütfen tekrar deneyin.' };
        }
        return { status: 'success' };
      }
    }

    // 4. Insert a new row into dietitian_clients
    const { error: insertError } = await supabase
      .from('dietitian_clients')
      .insert({
        dietitian_id: user.id,
        client_id: clientProfile.id,
        status: 'pending',
        requested_at: new Date().toISOString()
      });

    if (insertError) {
      if (insertError.code === '23505') {
          return { status: 'error', message: 'Bu danışana zaten başka bir diyetisyen tarafından bağlantı isteği gönderilmiş veya aktif bağlantısı bulunuyor.' };
      }
      console.error('Error inserting dietitian_clients:', insertError);
      return { status: 'error', message: 'İşlem sırasında bir hata oluştu. Lütfen tekrar deneyin.' };
    }

    return { status: 'success' };
  } catch (err: any) {
    console.error('Exception in addClientByEmail:', err);
    return { status: 'error', message: 'İşlem sırasında bir hata oluştu. Lütfen tekrar deneyin.' };
  }
};

/**
 * Sets a client's status to 'removed'
 */
export const removeClient = async (clientId: string): Promise<boolean> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase
      .from('dietitian_clients')
      .update({ status: 'removed', removed_at: new Date().toISOString() })
      .eq('client_id', clientId)
      .eq('dietitian_id', user.id);

    if (error) {
      console.error('Supabase removeClient error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error in removeClient:', err);
    return false;
  }
};
