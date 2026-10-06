// Dev-only fixture. This HTML is not a Vite build entry or application route.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import InviteCodePanel from '../../features/clients/components/InviteCodePanel';
import ClientsPage from '../../features/clients/pages/ClientsPage';
import { BrowserRouter } from 'react-router-dom';
import { NotificationCenterProvider } from '../../features/notifications/context/NotificationCenterContext';
import RecipeImportDialog from '../../features/recipes/components/RecipeImportDialog';
import '../../styles.css';
import DashboardPage from '../../features/dashboard/pages/DashboardPage';
import Sidebar from '../../shared/components/Sidebar';
import { AuthProvider } from '../../features/auth/context/AuthContext';
import { AppointmentProvider } from '../../features/appointments/context/AppointmentContext';
import MealPlans from '../../pages/MealPlans';
import Recipes from '../../pages/Recipes';
function Fixture() {
  const [busy, setBusy] = useState(false);
  const [saved,setSaved]=useState(0);
  const nutritionView = new URLSearchParams(location.search).get('view');
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
