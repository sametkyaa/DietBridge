import React, { createContext, useContext, useState, useEffect } from 'react';
import { Appointment } from '../types';
import { APPOINTMENTS } from '../constants';

interface AppointmentContextType {
  appointments: Appointment[];
  addAppointment: (appointment: Appointment) => void;
  deleteAppointment: (id: string) => void;
  getAppointmentsByDate: (date: string) => Appointment[];
}

const AppointmentContext = createContext<AppointmentContextType>({
  appointments: [],
  addAppointment: () => {},
  deleteAppointment: () => {},
  getAppointmentsByDate: () => [],
});

export const AppointmentProvider = ({ children }: { children: React.ReactNode }) => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  // Initialize with mock data, but set the date to "Today" for the mock items 
  // so the dashboard looks populated initially.
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    
    // Map the constant appointments to use today's date for demo purposes
    // In a real app, you would fetch these from the database
    const initialData: Appointment[] = APPOINTMENTS.map((apt, index) => ({
      ...apt,
      date: today, // Set all mock appointments to today
      clientId: (index + 1).toString(), // Mock IDs
      status: 'upcoming',
      clientAvatar: `https://i.pravatar.cc/150?u=${index}` // Fallback avatar logic handled in UI mostly
    }));
    
    setAppointments(initialData);
  }, []);

  const addAppointment = (appointment: Appointment) => {
    setAppointments((prev) => [...prev, appointment]);
  };

  const deleteAppointment = (id: string) => {
    setAppointments((prev) => prev.filter((a) => a.id !== id));
  };

  const getAppointmentsByDate = (date: string) => {
    return appointments.filter((a) => a.date === date).sort((a, b) => a.time.localeCompare(b.time));
  };

  return (
    <AppointmentContext.Provider value={{ appointments, addAppointment, deleteAppointment, getAppointmentsByDate }}>
      {children}
    </AppointmentContext.Provider>
  );
};

export const useAppointments = () => useContext(AppointmentContext);