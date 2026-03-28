import { supabase } from '../lib/supabaseClient';
import { Client } from '../types';
import { USER_AVATAR } from '../constants';

/**
 * Fetches clients associated with the logged-in dietitian.
 * Assumes 'clients' table has a 'dietitian_id' column or RLS policies in place.
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
            compliance_score
          )
        )
      `)
      .eq('dietitian_id', user.id);

    if (error) {
      console.warn('Error fetching clients (using mock data):', error.message || error);
      return []; 
    }

    // Map Supabase DB shape to App UI shape
    return (data || []).map((item: any) => {
      const client = item.client;
      const profile = client.client_profiles?.[0] || {};
      
      return {
        id: client.id,
        name: client.full_name || 'İsimsiz Danışan',
        email: client.email || '',
        avatar: client.avatar_url || USER_AVATAR,
        status: item.status === 'active' ? 'Aktif' : 'Pasif',
        goal: profile.goal || 'Sağlıklı Yaşam',
        startDate: profile.diet_start_date ? new Date(profile.diet_start_date).toLocaleDateString('tr-TR') : '-',
        duration: '1 Ay',
        currentWeight: profile.current_weight ? `${profile.current_weight} kg` : '-',
        weeklyChange: 0,
        compliance: profile.compliance_score || 0,
      };
    });
  } catch (err) {
    console.warn('Unexpected error in fetchDietitianClients:', err);
    return [];
  }
};

/**
 * Fetch meal plans for a specific client
 */
export const fetchClientMealPlans = async (clientId: string) => {
  try {
    const { data, error } = await supabase
      .from('meal_plans')
      .select('*')
      .eq('client_id', clientId);

    if (error) {
      console.warn('Error fetching meal plans:', error.message || error);
      return [];
    }
    return data;
  } catch (err) {
    console.warn('Unexpected error fetching meal plans:', err);
    return [];
  }
};

/**
 * Fetch current Dietitian profile
 */
export const fetchDietitianProfile = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Fetch from dietitian_profiles and join with profiles
    const { data, error } = await supabase
      .from('dietitian_profiles')
      .select(`
        *,
        profiles:user_id (
          full_name,
          email,
          avatar_url
        )
      `)
      .eq('user_id', user.id)
      .single();
      
    if (error) return null;
    
    // Flatten structure
    return {
      ...data,
      ...data.profiles
    };
  } catch (err) {
    console.warn('Error fetching profile:', err);
    return null;
  }
};