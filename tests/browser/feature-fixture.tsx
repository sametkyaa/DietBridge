// Dev-only fixture. This HTML is not a Vite build entry or application route.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import InviteCodePanel from '../../features/clients/components/InviteCodePanel';
import ClientsPage from '../../features/clients/pages/ClientsPage';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { NotificationCenterProvider } from '../../features/notifications/context/NotificationCenterContext';
import RecipeImportDialog from '../../features/recipes/components/RecipeImportDialog';
import '../../styles.css';
import DashboardPage from '../../features/dashboard/pages/DashboardPage';
import Sidebar from '../../shared/components/Sidebar';
import { AuthProvider } from '../../features/auth/context/AuthContext';
import { AppointmentProvider } from '../../features/appointments/context/AppointmentContext';
import MealPlans from '../../pages/MealPlans';
import Recipes from '../../pages/Recipes';
import DashboardLayout from '../../shared/components/DashboardLayout';
import { MealChangeRequestReviewDialog } from '../../features/meal-change-requests/components/MealChangeRequestReviewDialog';
function Fixture() {
  const [busy, setBusy] = useState(false);
  const [saved,setSaved]=useState(0);
  const nutritionView = new URLSearchParams(location.search).get('view');
  if (nutritionView === 'meal-request-review') return saved
    ? <p role="status">{saved > 0 ? 'Talep sonuçlandırıldı.' : 'İşlem iptal edildi.'}</p>
    : <MealChangeRequestReviewDialog
        request={{ id: '33333333-3333-4333-8333-333333333333', clientId: '22222222-2222-4222-8222-222222222222',
          clientName: 'Test Danışan', clientAvatarPath: null, planDate: '2026-10-11', mealSlot: 'breakfast',
          requestedSlots: ['breakfast', 'lunch'], notes: 'Kahvaltıyı değiştirebilir miyiz?', status: 'pending',
          createdAt: '2026-10-10T10:00:00Z', reviewedAt: null, responseNote: null }}
        onClose={() => setSaved(-1)} onReviewed={() => setSaved(1)}
      />;
  if (nutritionView === 'meal-plans' && new URLSearchParams(location.search).has('shell')) return (
    <MemoryRouter initialEntries={['/meal-plans']}><Routes><Route element={<DashboardLayout />}><Route path="/meal-plans" element={<MealPlans />} /></Route></Routes></MemoryRouter>
  );
  if (nutritionView === 'meal-plans' || nutritionView === 'recipes') return (
    <BrowserRouter><div className="flex w-full max-w-full bg-canvas md:pl-sidebar">
      <main className="min-w-0 w-full max-w-full">{nutritionView === 'meal-plans' ? <MealPlans /> : <Recipes />}</main>
    </div></BrowserRouter>
  );
  if (new URLSearchParams(location.search).get('view') === 'dashboard') return (
    <BrowserRouter><AuthProvider><AppointmentProvider><NotificationCenterProvider>
      <Sidebar /><main className="md:ml-[260px]"><DashboardPage /></main>
    </NotificationCenterProvider></AppointmentProvider></AuthProvider></BrowserRouter>
  );
  if(new URLSearchParams(location.search).get('view')==='import')return saved?<p role="status">{saved} tarif kaydedildi.</p>:<RecipeImportDialog onClose={()=>{}} onSaved={setSaved} />;
  return new URLSearchParams(location.search).get('view') === 'legacy' ? <BrowserRouter><NotificationCenterProvider><ClientsPage /></NotificationCenterProvider></BrowserRouter>
    : <main className="max-w-md mx-auto"><p>{busy ? 'İşlem sürüyor' : 'Hazır'}</p><InviteCodePanel onBusyChange={setBusy} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
