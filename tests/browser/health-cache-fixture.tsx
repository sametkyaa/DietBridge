// Dev-only harness of the actual hooks/pages and protected-route session boundary.
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../features/auth/context/AuthContext';
import ProtectedRoute from '../../shared/components/ProtectedRoute';
import NotesPage from '../../features/notes/pages/NotesPage';
import { useAnalytics } from '../../features/analytics/hooks/useAnalytics';
import { UnreadCountsProvider, useUnreadCounts } from '../../features/chat/context/UnreadCountsContext';
import { supabase } from '../../lib/supabaseClient';
import '../../styles.css';

function HealthProjection() {
  const analytics = useAnalytics();
  const { state } = useUnreadCounts();
  return <>
    <button onClick={() => analytics.selectClient('22222222-2222-4222-8222-222222222222')}>Analizi yükle</button>
    <output data-testid="weight">{analytics.report?.kpis.currentWeight ?? 'empty'}</output>
    <output data-testid="unread">{state.status === 'success' ? state.total : state.status}</output>
    <button onClick={() => {
      const token = ['eyJhbGciOiJIUzI1NiJ9', btoa(JSON.stringify({ sub: '44444444-4444-4444-8444-444444444444', exp: Math.floor(Date.now()/1000)+3600 })), 'fixture'].join('.');
      void supabase.auth.setSession({ access_token: token, refresh_token: 'test-refresh' });
    }}>Test hesabını değiştir</button>
    <NotesPage />
  </>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthProvider><UnreadCountsProvider>
  <Routes><Route element={<ProtectedRoute />}><Route path="*" element={<HealthProjection />} /></Route></Routes>
</UnreadCountsProvider></AuthProvider></BrowserRouter>);
