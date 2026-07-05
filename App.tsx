
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './features/auth/context/AuthContext';
import { AppointmentProvider } from './features/appointments/context/AppointmentContext';
import ProtectedRoute from './shared/components/ProtectedRoute';
import DashboardLayout from './shared/components/DashboardLayout';
import LoginPage from './features/auth/pages/LoginPage';
import RegisterPage from './features/auth/pages/RegisterPage';
import ForgotPasswordPage from './features/auth/pages/ForgotPasswordPage';
import ResetPasswordPage from './features/auth/pages/ResetPasswordPage';

// Feature Pages
import DashboardPage from './features/dashboard/pages/DashboardPage';
import ClientsPage from './features/clients/pages/ClientsPage';
import SettingsPage from './features/settings/pages/SettingsPage';
import ClientDetails from './pages/ClientDetails'; 
import Appointments from './pages/Appointments'; 
import Messages from './pages/Messages'; 
import Recipes from './pages/Recipes'; 
import RecipeDetails from './pages/RecipeDetails'; 
import Analytics from './pages/Analytics'; 
import MealPlans from './pages/MealPlans'; 
import Notes from './pages/Notes'; 
import DietitianProfilePage from './features/dietitians/pages/DietitianProfilePage';
import EditProfilePage from './features/dietitians/pages/EditProfilePage';

const App = () => {
  return (
    <AuthProvider>
      <AppointmentProvider>
        <Router>
          <Routes>
            {/* Public Route */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* Protected Dashboard Routes */}
            <Route element={<ProtectedRoute />}>
               <Route element={<DashboardLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/appointments" element={<Appointments />} />
                <Route path="/clients" element={<ClientsPage />} />
                <Route path="/clients/:id" element={<ClientDetails />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/meal-plans" element={<MealPlans />} />
                <Route path="/messages" element={<Messages />} />
                <Route path="/recipes" element={<Recipes />} />
                <Route path="/recipes/:id" element={<RecipeDetails />} />
                <Route path="/notes" element={<Notes />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/profile" element={<DietitianProfilePage />} />
                <Route path="/profile/edit" element={<EditProfilePage />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </AppointmentProvider>
    </AuthProvider>
  );
};

export default App;
