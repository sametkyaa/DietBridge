
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentDietitianProfile, updateDietitianProfile } from '../services/dietitianService';
import { DietitianProfile } from '../../../shared/types';
import { Save, X, AlertCircle } from 'lucide-react';

const EditProfilePage = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<DietitianProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      const data = await getCurrentDietitianProfile();
      setProfile(data);
      setLoading(false);
    };
    loadProfile();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!profile) return;
    const { name, value } = e.target;
    setProfile({ ...profile, [name]: value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError(null);

    const normalizedFirstName = profile.first_name?.trim() || '';
    const normalizedLastName = profile.last_name?.trim() || '';

    if (!normalizedFirstName || !normalizedLastName) {
      setError("Lütfen adınızı ve soyadınızı eksiksiz girin.");
      setSaving(false);
      return;
    }

    const result = await updateDietitianProfile({
      first_name: normalizedFirstName,
      last_name: normalizedLastName,
      phone: profile.phone,
      university: profile.university,
      graduation_year: profile.graduation_year,
      experience_years: profile.experience_years,
      specialization: profile.specialization,
      bio: profile.bio,
    });

    if (result.success) {
      navigate('/profile');
    } else {
      setError(result.error || "Güncelleme başarısız.");
    }
    setSaving(false);
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Yükleniyor...</div>;
  if (!profile) return <div className="p-8 text-center text-red-500">Profil bulunamadı.</div>;

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
         <div className="p-6 md:p-8 border-b border-slate-100 flex justify-between items-center">
            <h1 className="text-2xl font-bold text-slate-800">Profili Düzenle</h1>
            <button onClick={() => navigate('/profile')} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full">
               <X className="w-6 h-6" />
            </button>
         </div>

         {error && (
            <div className="mx-8 mt-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-start gap-2 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

         <form onSubmit={handleSave} className="p-6 md:p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                   <label className="text-sm font-bold text-slate-700">Ad</label>
                   <input type="text" name="first_name" required value={profile.first_name} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
                <div className="space-y-1.5">
                   <label className="text-sm font-bold text-slate-700">Soyad</label>
                   <input type="text" name="last_name" required value={profile.last_name} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
                <div className="space-y-1.5">
                   <label className="text-sm font-bold text-slate-700">Telefon</label>
                   <input type="tel" name="phone" required value={profile.phone} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
                <div className="space-y-1.5">
                   <label className="text-sm font-bold text-slate-700">E-posta (Değiştirilemez)</label>
                   <input type="email" disabled value={profile.email} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed text-sm" />
                </div>
            </div>

            <div className="space-y-6 pt-4 border-t border-slate-100">
               <h3 className="font-bold text-slate-800">Mesleki Bilgiler</h3>
               <div className="space-y-1.5">
                   <label className="text-sm font-bold text-slate-700">Üniversite</label>
                   <input type="text" name="university" required value={profile.university} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   <div className="space-y-1.5">
                     <label className="text-sm font-bold text-slate-700">Mezuniyet Yılı</label>
                     <input type="number" name="graduation_year" required value={profile.graduation_year} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                   </div>
                   <div className="space-y-1.5">
                     <label className="text-sm font-bold text-slate-700">Deneyim (Yıl)</label>
                     <input type="number" name="experience_years" required value={profile.experience_years} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                   </div>
                </div>
                <div className="space-y-1.5">
                   <label className="text-sm font-bold text-slate-700">Uzmanlık Alanı</label>
                   <input type="text" name="specialization" required value={profile.specialization} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
                <div className="space-y-1.5">
                   <label className="text-sm font-bold text-slate-700">Biyografi</label>
                   <textarea rows={5} name="bio" required value={profile.bio} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm resize-none" />
                </div>
            </div>

            <div className="pt-6 flex gap-4">
               <button 
                  type="button" 
                  onClick={() => navigate('/profile')} 
                  className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl border border-slate-200 transition-colors"
               >
                  İptal
               </button>
               <button 
                  type="submit" 
                  disabled={saving}
                  className="flex-1 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/30 hover:bg-primary-dark transition-colors flex items-center justify-center gap-2"
               >
                  {saving ? 'Kaydediliyor...' : <><Save className="w-5 h-5" /> Kaydet</>}
               </button>
            </div>
         </form>
      </div>
    </div>
  );
};

export default EditProfilePage;
