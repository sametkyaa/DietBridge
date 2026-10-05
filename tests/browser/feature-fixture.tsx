// Dev-only fixture. This HTML is not a Vite build entry or application route.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import InviteCodePanel from '../../features/clients/components/InviteCodePanel';
import ClientsPage from '../../features/clients/pages/ClientsPage';
import { BrowserRouter } from 'react-router-dom';
import { NotificationCenterProvider } from '../../features/notifications/context/NotificationCenterContext';
import RecipeImportDialog from '../../features/recipes/components/RecipeImportDialog';
import '../../styles.css';
function Fixture() {
  const [busy, setBusy] = useState(false);
  const [saved,setSaved]=useState(0);
  if(new URLSearchParams(location.search).get('view')==='import')return saved?<p role="status">{saved} tarif kaydedildi.</p>:<RecipeImportDialog onClose={()=>{}} onSaved={setSaved} />;
  return new URLSearchParams(location.search).get('view') === 'legacy' ? <BrowserRouter><NotificationCenterProvider><ClientsPage /></NotificationCenterProvider></BrowserRouter>
    : <main className="max-w-md mx-auto"><p>{busy ? 'İşlem sürüyor' : 'Hazır'}</p><InviteCodePanel onBusyChange={setBusy} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
