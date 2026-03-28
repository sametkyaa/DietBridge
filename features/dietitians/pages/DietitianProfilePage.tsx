
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Mail, Phone, BookOpen, Award, Clock, FileText, Edit, LogOut, ArrowUpRight } from 'lucide-react';
import { getCurrentDietitianProfile } from '../services/dietitianService';
import { DietitianProfile } from '../../../shared/types';
import { USER_AVATAR } from '../../../shared/constants';
import { useAuth } from '../../auth/context/AuthContext';

const DietitianProfilePage = () => {
  const [profile, setProfile] = useState<DietitianProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { signOut } = useAuth();

  useEffect(() => {
    const loadProfile = async () => {
      const data = await getCurrentDietitianProfile();
      setProfile(data);
      setLoading(false);
    };
    loadProfile();
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-500 text-sm font-medium">Profil yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold text-slate-800">Profil bulunamadı.</h2>
        <p className="text-slate-500 mb-4">Lütfen tekrar giriş yapmayı deneyin.</p>
        <button onClick={handleSignOut} className="text-primary hover:underline">Çıkış Yap</button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto min-h-screen">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
           <h1 className="text-3xl font-bold text-slate-800">Profilim</h1>
           <p className="text-slate-500 mt-1">Kişisel bilgilerinizi ve uzmanlık detaylarınızı görüntüleyin.</p>
        </div>
        <div className="flex gap-3">
          <button 
             onClick={() => navigate('/profile/edit')}
             className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-colors shadow-sm"
          >
             <Edit className="w-4 h-4" /> Profili Düzenle
          </button>
          <button 
             onClick={handleSignOut}
             className="flex items-center gap-2 px-5 py-2.5 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-colors"
          >
             <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Left Column: Avatar & Quick Stats */}
        <div className="md:col-span-1 space-y-6">
           <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm text-center">
              <div className="relative inline-block mb-4">
                 <img src={profile.avatar_url || USER_AVATAR} alt="Profil" className="w-32 h-32 rounded-full object-cover border-4 border-slate-50 mx-auto" />
                 <span className="absolute bottom-1 right-1 w-6 h-6 bg-emerald-500 border-4 border-white rounded-full"></span>
              </div>
              <h2 className="text-xl font-bold text-slate-800">{profile.first_name} {profile.last_name}</h2>
              <p className="text-emerald-600 font-medium text-sm mt-1">{profile.specialization}</p>
              
              <div className="mt-6 flex flex-col gap-2">
                 <div className="flex items-center justify-center gap-2 text-slate-600 text-sm">
                    <Mail className="w-4 h-4 text-slate-400" /> {profile.email}
                 </div>
                 <div className="flex items-center justify-center gap-2 text-slate-600 text-sm">
                    <Phone className="w-4 h-4 text-slate-400" /> {profile.phone}
                 </div>
              </div>
           </div>

           {/* Stats Card */}
           <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-4">Deneyim</h3>
              <div className="flex items-center gap-4 mb-4">
                 <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                    <Clock className="w-6 h-6" />
                 </div>
                 <div>
                    <p className="text-2xl font-bold text-slate-800">{profile.experience_years} Yıl</p>
                    <p className="text-xs text-slate-500 font-medium uppercase">Tecrübe</p>
                 </div>
              </div>
              <div className="flex items-center gap-4">
                 <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
                    <Award className="w-6 h-6" />
                 </div>
                 <div>
                    <p className="text-2xl font-bold text-slate-800">{profile.graduation_year}</p>
                    <p className="text-xs text-slate-500 font-medium uppercase">Mezuniyet</p>
                 </div>
              </div>
           </div>
        </div>

        {/* Right Column: Details */}
        <div className="md:col-span-2 space-y-6">
           
           {/* Education */}
           <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                 <BookOpen className="w-5 h-5 text-emerald-600" /> Eğitim & Uzmanlık
              </h3>
              
              <div className="space-y-6">
                 <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Üniversite / Bölüm</p>
                    <p className="text-slate-800 font-medium text-lg">{profile.university}</p>
                 </div>
                 <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Uzmanlık Alanı</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                       {profile.specialization.split(',').map((spec, i) => (
                          <span key={i} className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600 font-medium">
                             {spec.trim()}
                          </span>
                       ))}
                    </div>
                 </div>
              </div>
           </div>

           {/* Bio */}
           <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                 <User className="w-5 h-5 text-emerald-600" /> Hakkında
              </h3>
              <p className="text-slate-600 leading-relaxed whitespace-pre-line">
                 {profile.bio || 'Henüz bir biyografi eklenmemiş.'}
              </p>
           </div>

           {/* Diploma */}
           <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                 <FileText className="w-5 h-5 text-emerald-600" /> Diploma
              </h3>
              <div className="relative group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 max-w-sm">
                 <img src={profile.diploma_url} alt="Diploma" className="w-full h-auto object-cover opacity-90 transition-opacity hover:opacity-100" />
                 <a 
                   href={profile.diploma_url} 
                   target="_blank" 
                   rel="noopener noreferrer"
                   className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                 >
                    <div className="px-4 py-2 bg-white rounded-lg text-sm font-bold text-slate-800 flex items-center gap-2">
                       Görüntüle <ArrowUpRight className="w-4 h-4" />
                    </div>
                 </a>
              </div>
           </div>

        </div>
      </div>
    </div>
  );
};

export default DietitianProfilePage;
