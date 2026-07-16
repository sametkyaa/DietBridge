
import { supabase } from '../../../lib/supabaseClient';
import { env } from '../../../lib/env';
import { Appointment } from '../../../shared/types';
import { APPOINTMENTS } from '../../../shared/constants';

/**
 * Fetch all appointments for the logged-in dietitian
 */
export const fetchAppointments = async (): Promise<Appointment[]> => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        client:client_id (
          full_name,
          avatar_url
        )
      `)
      .order('date', { ascending: true });

    if (error) {
      console.warn('Supabase fetch error:', error.message);
      if (env.enableMockData) {
        return getMockAppointments();
      }
      return [];
    }

    if (!data || data.length === 0) {
      if (env.enableMockData) {
        return getMockAppointments();
      }
      return [];
    }

    return data.map((item: any) => ({
      id: item.id,
      clientId: item.client_id,
      clientName: item.client?.full_name || 'Bilinmeyen Danışan',
      clientAvatar: item.client?.avatar_url,
      title: item.title,
      date: item.date,
      time: item.time,
      duration: item.duration,
      type: item.type,
      status: item.status,
    }));
  } catch (err: any) {
    console.warn('Network error in fetchAppointments:', err.message || err);
    if (env.enableMockData) {
      return getMockAppointments();
    }
    return [];
  }
};

/**
 * Helper to get initial mock data formatted correctly
 */
const getMockAppointments = (): Appointment[] => {
  const today = new Date().toISOString().split('T')[0];
  return APPOINTMENTS.map((apt, index) => ({
    ...apt,
    date: today,
    clientId: (index + 1).toString(),
    id: `mock-${index}`
  }));
};

/**
 * Create a new appointment
 */
export const createAppointment = async (appointment: Appointment): Promise<Appointment | null> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    // Parse duration string "45 dk" -> 45 if necessary, or ensure it's passed as number
    const durationInt = typeof appointment.duration === 'string' 
      ? parseInt(appointment.duration) 
      : appointment.duration;

    const payload = {
      client_id: appointment.clientId,
      title: appointment.title,
      date: appointment.date,
      time: appointment.time,
      duration: durationInt || 30, // Default to 30 min if parsing fails
      type: appointment.type,
      status: 'upcoming',
      dietitian_id: user?.id 
    };

    const { data, error } = await supabase
      .from('appointments')
      .insert([payload])
      .select(`
        *,
        client:client_id (
          full_name,
          avatar_url
        )
      `)
      .single();

    if (error) {
      console.error('Error creating appointment:', error);
      throw error;
    }

    return {
      id: data.id,
      clientId: data.client_id,
      clientName: data.client?.full_name || appointment.clientName,
      clientAvatar: data.client?.avatar_url || appointment.clientAvatar,
      title: data.title,
      date: data.date,
      time: data.time,
      duration: data.duration,
      type: data.type,
      status: data.status,
    };
  } catch (err) {
    console.error('Create appointment exception:', err);
    return null;
  }
};

/**
 * Delete an appointment
 */
export const deleteAppointmentService = async (id: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting appointment:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Delete appointment exception:', err);
    return false;
  }
};
