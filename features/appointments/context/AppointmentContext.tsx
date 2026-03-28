import React, { createContext, useContext, useState, useEffect, PropsWithChildren } from 'react';
import { Appointment } from '../../../shared/types';
import { fetchAppointments, createAppointment, deleteAppointmentService } from '../services/appointmentService';

interface AppointmentContextType {
  appointments: Appointment[];
  loading: boolean;
  addAppointment: (appointment: Appointment) => Promise<void>;
  deleteAppointment: (id: string) => Promise<void>;
  getAppointmentsByDate: (date: string) => Appointment[];
}

const AppointmentContext = createContext<AppointmentContextType>({
  appointments: [],
  loading: false,
  addAppointment: async () => {},
  deleteAppointment: async () => {},
  getAppointmentsByDate: () => [],
});

export const AppointmentProvider = ({ children }: PropsWithChildren) => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  // Load appointments from Supabase on mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const data = await fetchAppointments();
      setAppointments(data);
      setLoading(false);
    };
    loadData();
  }, []);

  const addAppointment = async (appointment: Appointment) => {
    // Optimistic update (optional) or wait for DB
    // Here we wait for DB to ensure data consistency
    const savedAppointment = await createAppointment(appointment);
    
    if (savedAppointment) {
      setAppointments((prev) => [...prev, savedAppointment]);
    } else {
      // Fallback for offline/demo mode if DB fails
      console.warn("Veritabanına kayıt başarısız, yerel gösterim yapılıyor.");
      setAppointments((prev) => [...prev, appointment]);
    }
  };

  const deleteAppointment = async (id: string) => {
    const success = await deleteAppointmentService(id);
    if (success) {
      setAppointments((prev) => prev.filter((a) => a.id !== id));
    } else {
      // If it's a mock ID or a temporary local ID (timestamp), still remove it from UI
      // UUIDs are 36 chars. Timestamps are usually 13 chars.
      // If deletion failed on DB (e.g. invalid UUID error), and ID is not a UUID, it's likely a local-only item.
      if (id.startsWith('mock-') || id.length !== 36) {
         setAppointments((prev) => prev.filter((a) => a.id !== id));
      }
    }
  };

  const getAppointmentsByDate = (date: string) => {
    return appointments.filter((a) => a.date === date).sort((a, b) => a.time.localeCompare(b.time));
  };

  return (
    <AppointmentContext.Provider value={{ appointments, loading, addAppointment, deleteAppointment, getAppointmentsByDate }}>
      {children}
    </AppointmentContext.Provider>
  );
};

export const useAppointments = () => useContext(AppointmentContext);