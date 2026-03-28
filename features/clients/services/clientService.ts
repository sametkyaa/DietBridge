
import { supabase } from '../../../lib/supabaseClient';
import { Client } from '../../../shared/types';
import { USER_AVATAR } from '../../../shared/constants';

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
      .eq('dietitian_id', user.id);

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
        avatar: client.avatar_url || USER_AVATAR,
        status: item.status === 'active' ? 'Aktif' : 'Pasif',
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
        activityLevel: profile.activity_level,
        sleepHours: profile.sleep_hours,
        smokingStatus: profile.smoking_status,
        alcoholUse: profile.alcohol_use,
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
export const fetchClientDetails = async (clientId: string): Promise<Client | null> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

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
      .eq('client_id', clientId)
      .eq('dietitian_id', user.id)
      .single();

    if (error) throw error;
    if (!data) return null;

    const client = data.client;
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
      avatar: client.avatar_url || USER_AVATAR,
      status: data.status === 'active' ? 'Aktif' : 'Pasif',
      goal: profile.goal || 'Sağlıklı Yaşam',
      startDate: profile.diet_start_date ? new Date(profile.diet_start_date).toLocaleDateString('tr-TR') : '-',
      duration: '1 Ay',
      currentWeight: profile.current_weight ? `${profile.current_weight} kg` : '-',
      startWeight: profile.start_weight ? `${profile.start_weight} kg` : undefined,
      targetWeight: profile.target_weight ? `${profile.target_weight} kg` : undefined,
      weeklyChange: 0,
      compliance: profile.compliance_score || 0,
      bloodType,
      chronicConditions,
      medications,
      heightCm: profile.height_cm,
      lastLabDate: profile.last_lab_date ? new Date(profile.last_lab_date).toLocaleDateString('tr-TR') : undefined,
      activityLevel: profile.activity_level,
      sleepHours: profile.sleep_hours,
      smokingStatus: profile.smoking_status,
      alcoholUse: profile.alcohol_use,
    };
    } catch (err) {
    console.error('Error fetching client details:', err);
    throw err;
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
      .select('id')
      .eq('dietitian_id', user.id)
      .eq('client_id', clientProfile.id)
      .maybeSingle();

    if (linkError) {
      console.error('Error checking existing link:', linkError);
      return { status: 'error', message: linkError.message };
    }

    if (existingLink) {
      return { status: 'already_linked' };
    }

    // 4. Insert a new row into dietitian_clients
    const { error: insertError } = await supabase
      .from('dietitian_clients')
      .insert({
        dietitian_id: user.id,
        client_id: clientProfile.id,
        status: 'active'
      });

    if (insertError) {
      console.error('Error inserting dietitian_clients:', insertError);
      return { status: 'error', message: insertError.message };
    }

    return { status: 'success' };
  } catch (err: any) {
    console.error('Exception in addClientByEmail:', err);
    return { status: 'error', message: err.message || 'Bilinmeyen bir hata oluştu.' };
  }
};
