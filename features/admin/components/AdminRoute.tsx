import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/context/AuthContext';
import { usePlatformAdminAccess } from '../hooks/usePlatformAdminAccess';

const AdminLoadingState = ({ message }: { message: string }) => (
  <div className="flex min-h-screen w-full items-center justify-center bg-background-light p-6">
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="text-sm font-medium text-slate-500">{message}</p>
    </div>
  </div>
);

const AdminDeniedState = ({ onRetry, onSignOut, message }: { message: string; onRetry: () => void; onSignOut: () => void }) => (
  <div className="flex min-h-screen w-full items-center justify-center bg-background-light p-4">
    <div className="w-full max-w-lg rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xl">
      <h1 className="text-xl font-bold text-slate-900">Yönetim erişimi doğrulanamadı</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Tekrar Dene
        </button>
        <button
          type="button"
          onClick={onSignOut}
          className="min-h-11 flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Oturumu Kapat
        </button>
      </div>
    </div>
  </div>
);

const AdminRoute = () => {
  const location = useLocation();
  const { accessState, signOut, refreshAccess } = useAuth();
  const adminAccess = usePlatformAdminAccess({ enabled: accessState.status === 'allowed' });

  if (accessState.status === 'initializing') {
    return <AdminLoadingState message="Oturum kontrol ediliyor..." />;
  }
  if (accessState.status === 'resolving_access') {
    return <AdminLoadingState message="Hesap erişimi doğrulanıyor..." />;
  }
  if (accessState.status === 'unauthenticated') {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  if (accessState.status === 'password_recovery') {
    return <Navigate to="/reset-password" replace />;
  }
  if (accessState.status !== 'allowed') {
    return (
      <AdminDeniedState
        message="Yönetim konsolu yalnızca onaylı diyetisyen hesabına bağlı, açık bir platform yöneticisi entitlement'ı için kullanılabilir."
        onRetry={() => { void refreshAccess(); }}
        onSignOut={() => { void signOut(); }}
      />
    );
  }
  if (adminAccess.status === 'disabled' || adminAccess.status === 'loading') {
    return <AdminLoadingState message="Yönetim yetkisi doğrulanıyor..." />;
  }
  if (adminAccess.status === 'denied') {
    return (
      <AdminDeniedState
        message="Bu hesaba platform yönetim yetkisi verilmemiş."
        onRetry={adminAccess.retry}
        onSignOut={() => { void signOut(); }}
      />
    );
  }
  if (adminAccess.status === 'error') {
    return (
      <AdminDeniedState
        message={adminAccess.message}
        onRetry={adminAccess.retry}
        onSignOut={() => { void signOut(); }}
      />
    );
  }
  return <Outlet />;
};

export default AdminRoute;
