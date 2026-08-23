import { useState } from 'react';
import { CreditCard, LogOut, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SubscriptionPanel from '../../subscriptions/components/SubscriptionPanel';
import { useAuth } from '../../auth/context/AuthContext';

type SettingsTab = 'billing';

const SettingsPage = () => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('billing');

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="mx-auto min-h-screen max-w-7xl p-4 md:p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800">Ayarlar</h1>
        <p className="mt-1 text-slate-500">Profil ve abonelik bilgilerinizi yönetin.</p>
      </header>

      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 md:col-span-3">
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
            <nav className="flex flex-col gap-1 p-2" aria-label="Ayarlar">
              <button type="button" onClick={() => navigate('/profile')} className="flex items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50">
                <User className="h-5 w-5 text-slate-400" /> Profil Bilgileri
              </button>
              <button type="button" onClick={() => setActiveTab('billing')} className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3.5 text-left text-sm font-medium text-emerald-700 shadow-sm">
                <CreditCard className="h-5 w-5 text-emerald-600" /> Plan ve Ödeme
              </button>
            </nav>
            <div className="mt-2 border-t border-slate-100 p-2">
              <button type="button" onClick={() => void handleSignOut()} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50">
                <LogOut className="h-5 w-5" /> Çıkış Yap
              </button>
            </div>
          </div>
        </aside>

        <main className="col-span-12 md:col-span-9">
          {activeTab === 'billing' && (
            <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm md:p-8">
              <h2 className="mb-6 border-b border-slate-100 pb-4 text-xl font-bold text-slate-800">Plan ve Ödeme</h2>
              <SubscriptionPanel />
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

export default SettingsPage;
