import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Clock, XCircle, LogOut } from 'lucide-react';
import { APP_LOGO } from '../../../shared/constants';

const VerificationStatusPage = () => {
  const { dietitianProfile, signOut } = useAuth();

  const isRejected = dietitianProfile?.verification_status === 'rejected';

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 md:p-12 rounded-3xl shadow-xl max-w-lg w-full text-center border border-slate-100 animate-in fade-in zoom-in duration-300">
        <div className="flex justify-center mb-8">
          <img src={APP_LOGO} alt="Logo" className="w-16 h-16 object-contain" />
        </div>

        {isRejected ? (
          <>
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
              <XCircle className="w-10 h-10 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Hesabınız Onaylanmadı</h2>
            <p className="text-slate-600 mb-6 leading-relaxed text-lg">
              Başvurunuz incelendi ancak şu an için onaylanamadı.
            </p>
            {dietitianProfile?.rejection_reason && (
              <div className="bg-red-50 border border-red-100 p-4 rounded-xl text-red-700 text-sm mb-8 text-left">
                <p className="font-bold mb-1">Red Nedeni:</p>
                <p>{dietitianProfile.rejection_reason}</p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
              <Clock className="w-10 h-10 text-amber-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-4">Başvurunuz İncelemede</h2>
            <p className="text-slate-600 mb-8 leading-relaxed text-lg">
              Başvurunuz alınmıştır. Diploma belgeniz inceleniyor. Onay sonrası sisteme erişebileceksiniz.
            </p>
          </>
        )}

        <button
          onClick={signOut}
          className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2"
        >
          <LogOut className="w-5 h-5" /> Çıkış Yap
        </button>
      </div>
    </div>
  );
};

export default VerificationStatusPage;
