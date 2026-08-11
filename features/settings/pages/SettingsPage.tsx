import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  User, 
  Lock, 
  Bell, 
  Link as LinkIcon, 
  CreditCard, 
  Camera, 
  Save, 
  Shield, 
  Smartphone, 
  Mail,
  Check,
  ChevronRight,
  LogOut
} from 'lucide-react';
import { USER_AVATAR } from '../../../shared/constants';
import { useAuth } from '../../auth/context/AuthContext';
import SubscriptionPanel from '../../subscriptions/components/SubscriptionPanel';

const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState('security');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { signOut } = useAuth();

  // Mock toggle states
  const [toggles, setToggles] = useState({
    emailNotif: true,
    smsNotif: false,
    marketing: false,
    twoFactor: true,
  });

  const handleToggle = (key: keyof typeof toggles) => {
    setToggles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = () => {
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
    }, 1000);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const tabs = [
    { id: 'profile', label: 'Profil Bilgileri', icon: User, href: '/profile' },
    { id: 'security', label: 'Giriş ve Güvenlik', icon: Lock },
    { id: 'notifications', label: 'Bildirimler', icon: Bell },
    { id: 'integrations', label: 'Entegrasyonlar', icon: LinkIcon },
    { id: 'billing', label: 'Plan ve Ödeme', icon: CreditCard },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800">Ayarlar</h1>
        <p className="text-slate-500 mt-1">Hesap tercihlerinizi ve kişisel bilgilerinizi yönetin.</p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        
        {/* Sidebar Tabs */}
        <div className="col-span-12 md:col-span-3">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden sticky top-24">
            <nav className="flex flex-col p-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (tab.href) {
                      navigate(tab.href);
                    } else {
                      setActiveTab(tab.id);
                    }
                  }}
                  className={`flex items-center gap-3 px-4 py-3.5 text-sm font-medium rounded-xl transition-all ${
                    activeTab === tab.id && !tab.href
                      ? 'bg-emerald-50 text-emerald-700 shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <tab.icon className={`w-5 h-5 ${activeTab === tab.id && !tab.href ? 'text-emerald-600' : 'text-slate-400'}`} />
                  {tab.label}
                  {activeTab === tab.id && !tab.href && <ChevronRight className="w-4 h-4 ml-auto opacity-50" />}
                </button>
              ))}
            </nav>
            <div className="border-t border-slate-100 p-2 mt-2">
              <button 
                onClick={handleSignOut}
                className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl w-full transition-colors"
              >
                 <LogOut className="w-5 h-5" />
                 Çıkış Yap
              </button>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="col-span-12 md:col-span-9 space-y-6">
          
          {/* SECURITY SETTINGS */}
          {activeTab === 'security' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
               <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 md:p-8">
                  <h2 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100">Şifre Değiştir</h2>
                  <div className="space-y-4 max-w-lg">
                    <div className="space-y-1.5">
                      <label className="text-sm font-bold text-slate-700">Mevcut Şifre</label>
                      <input type="password" placeholder="••••••••" className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-bold text-slate-700">Yeni Şifre</label>
                      <input type="password" placeholder="••••••••" className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-bold text-slate-700">Yeni Şifre (Tekrar)</label>
                      <input type="password" placeholder="••••••••" className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                    </div>
                    <button className="px-6 py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-900 transition-colors">
                       Şifreyi Güncelle
                    </button>
                  </div>
               </div>

               <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 md:p-8">
                  <h2 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
                     <Shield className="w-5 h-5 text-emerald-600" /> İki Faktörlü Doğrulama (2FA)
                  </h2>
                  <div className="flex items-center justify-between">
                     <div>
                        <p className="font-bold text-slate-700">Hesabınızı güvende tutun</p>
                        <p className="text-sm text-slate-500 mt-1 max-w-md">Giriş yaparken şifrenizin yanı sıra telefonunuza gelen kodu da girmeniz gerekir.</p>
                     </div>
                     <button 
                       onClick={() => handleToggle('twoFactor')}
                       className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${toggles.twoFactor ? 'bg-emerald-500' : 'bg-slate-200'}`}
                     >
                       <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition shadow-sm ${toggles.twoFactor ? 'translate-x-6' : 'translate-x-1'}`} />
                     </button>
                  </div>
               </div>
            </div>
          )}

          {/* NOTIFICATIONS SETTINGS */}
          {activeTab === 'notifications' && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 md:p-8 animate-in fade-in slide-in-from-right-4 duration-300">
               <h2 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100">Bildirim Tercihleri</h2>
               
               <div className="space-y-6">
                  {/* Email Notifications */}
                  <div className="flex items-start gap-4">
                     <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                        <Mail className="w-5 h-5" />
                     </div>
                     <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                           <h3 className="font-bold text-slate-800">E-posta Bildirimleri</h3>
                           <button 
                             onClick={() => handleToggle('emailNotif')}
                             className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${toggles.emailNotif ? 'bg-emerald-500' : 'bg-slate-200'}`}
                           >
                             <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition shadow-sm ${toggles.emailNotif ? 'translate-x-6' : 'translate-x-1'}`} />
                           </button>
                        </div>
                        <p className="text-sm text-slate-500">Randevu hatırlatmaları, yeni mesajlar ve haftalık özet raporları e-posta olarak gönderilsin.</p>
                     </div>
                  </div>

                  <div className="w-full h-px bg-slate-50"></div>

                  {/* SMS Notifications */}
                  <div className="flex items-start gap-4">
                     <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                        <Smartphone className="w-5 h-5" />
                     </div>
                     <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                           <h3 className="font-bold text-slate-800">SMS Bildirimleri</h3>
                           <button 
                             onClick={() => handleToggle('smsNotif')}
                             className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${toggles.smsNotif ? 'bg-emerald-500' : 'bg-slate-200'}`}
                           >
                             <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition shadow-sm ${toggles.smsNotif ? 'translate-x-6' : 'translate-x-1'}`} />
                           </button>
                        </div>
                        <p className="text-sm text-slate-500">Acil durumlar ve son dakika iptalleri için SMS al.</p>
                     </div>
                  </div>

                  <div className="w-full h-px bg-slate-50"></div>

                  {/* Marketing */}
                  <div className="flex items-start gap-4">
                     <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                        <Bell className="w-5 h-5" />
                     </div>
                     <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                           <h3 className="font-bold text-slate-800">Pazarlama ve Güncellemeler</h3>
                           <button 
                             onClick={() => handleToggle('marketing')}
                             className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${toggles.marketing ? 'bg-emerald-500' : 'bg-slate-200'}`}
                           >
                             <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition shadow-sm ${toggles.marketing ? 'translate-x-6' : 'translate-x-1'}`} />
                           </button>
                        </div>
                        <p className="text-sm text-slate-500">Yeni özellikler, blog yazıları ve diyetisyen ipuçları hakkında bültenler.</p>
                     </div>
                  </div>
               </div>
            </div>
          )}

          {/* INTEGRATIONS SETTINGS */}
          {activeTab === 'integrations' && (
             <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 md:p-8 animate-in fade-in slide-in-from-right-4 duration-300">
               <h2 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100">Bağlı Uygulamalar</h2>
               
               <div className="space-y-4">
                  {/* Google Calendar */}
                  <div className="flex items-center justify-between p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                     <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-lg border border-slate-200 flex items-center justify-center p-2">
                           <img src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg" alt="Google Calendar" className="w-full h-full" />
                        </div>
                        <div>
                           <h3 className="font-bold text-slate-800">Google Takvim</h3>
                           <p className="text-xs text-slate-500">Randevularınızı otomatik senkronize edin.</p>
                        </div>
                     </div>
                     <button className="px-4 py-2 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-100 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Bağlandı
                     </button>
                  </div>

                  {/* Zoom */}
                  <div className="flex items-center justify-between p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                     <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-500 rounded-lg flex items-center justify-center p-2">
                           <img src="https://upload.wikimedia.org/wikipedia/commons/7/7b/Zoom_Communications_Logo.svg" alt="Zoom" className="w-full h-full object-contain filter brightness-0 invert" />
                        </div>
                        <div>
                           <h3 className="font-bold text-slate-800">Zoom</h3>
                           <p className="text-xs text-slate-500">Online görüşmeler için toplantı linki oluşturun.</p>
                        </div>
                     </div>
                     <button className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-50">
                        Bağla
                     </button>
                  </div>

                  {/* WhatsApp */}
                  <div className="flex items-center justify-between p-4 border border-slate-200 rounded-xl bg-slate-50/50">
                     <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-[#25D366] rounded-lg flex items-center justify-center p-2">
                           <svg viewBox="0 0 24 24" fill="white" className="w-8 h-8"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        </div>
                        <div>
                           <h3 className="font-bold text-slate-800">WhatsApp</h3>
                           <p className="text-xs text-slate-500">Hızlı mesajlaşma ve hatırlatmalar için.</p>
                        </div>
                     </div>
                     <button className="px-4 py-2 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-100 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Bağlandı
                     </button>
                  </div>
               </div>
            </div>
          )}

          {/* BILLING SETTINGS */}
          {activeTab === 'billing' && (
             <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 md:p-8 animate-in fade-in slide-in-from-right-4 duration-300">
                <h2 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100">Plan ve Ödeme</h2>
                <SubscriptionPanel />
             </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
