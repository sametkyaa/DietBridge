import React, { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../features/auth/context/AuthContext';
import VerificationStatusPage from '../../features/auth/pages/VerificationStatusPage';

const ProtectedRoute = () => {
  const { user, userRole, dietitianProfile, loading, signOut } = useAuth();

  useEffect(() => {
    if (!loading && user && userRole && userRole !== 'dietitian') {
      signOut();
    }
  }, [user, userRole, loading, signOut]);

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background-light">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-500 text-sm font-medium">Yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (userRole && userRole !== 'dietitian') {
    return <Navigate to="/login" replace state={{ error: 'Bu panel yalnızca diyetisyenler içindir. Danışan hesabınızla mobil uygulamadan giriş yapabilirsiniz.' }} />;
  }

  // Only block access if the user is a dietitian and not verified
  const isDietitian = userRole === 'dietitian' || dietitianProfile !== null;
  if (isDietitian && (!dietitianProfile || !dietitianProfile.is_verified)) {
    return <VerificationStatusPage />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
