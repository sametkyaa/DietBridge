import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../features/auth/context/AuthContext';
import VerificationStatusPage from '../../features/auth/pages/VerificationStatusPage';

const LoadingState = ({ message }: { message: string }) => (
  <div className="h-screen w-full flex items-center justify-center bg-background-light">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-500 text-sm font-medium">{message}</p>
    </div>
  </div>
);

const BlockedAccessState = ({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) => (
  <div className="min-h-screen w-full flex items-center justify-center bg-background-light p-4">
    <div className="bg-white rounded-3xl shadow-xl max-w-lg w-full p-8 text-center border border-slate-100">
      <h1 className="text-xl font-bold text-slate-800 mb-3">Hesap erişimi doğrulanamadı</h1>
      <p className="text-slate-600 text-sm leading-relaxed mb-6">{message}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={onRetry} className="flex-1 bg-primary hover:bg-primary-dark text-white font-bold py-3 rounded-xl transition-colors">
          Tekrar Dene
        </button>
        <button onClick={onSignOut} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition-colors">
          Oturumu Kapat
        </button>
      </div>
    </div>
  </div>
);

const ProtectedRoute = () => {
  const { accessState, refreshAccess, signOut } = useAuth();

  switch (accessState.status) {
    case 'initializing':
      return <LoadingState message="Oturum kontrol ediliyor..." />;
    case 'resolving_access':
      return <LoadingState message="Hesap erişimi doğrulanıyor..." />;
    case 'allowed':
      return <Outlet />;
    case 'pending':
    case 'rejected':
      return <VerificationStatusPage />;
    case 'blocked_client':
    case 'blocked_missing_role':
    case 'blocked_missing_dietitian_profile':
    case 'access_error':
      return <BlockedAccessState message={accessState.message} onRetry={refreshAccess} onSignOut={() => { void signOut(); }} />;
    case 'password_recovery':
      return <Navigate to="/reset-password" replace />;
    case 'unauthenticated':
    default:
      return <Navigate to="/login" replace state={accessState.message ? { error: accessState.message } : undefined} />;
  }
};

export default ProtectedRoute;
