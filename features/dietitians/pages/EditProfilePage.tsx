import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentDietitianProfile, updateDietitianProfile } from '../services/dietitianService';
import { DietitianProfile } from '../../../shared/types';
import { Button, Callout, Card, EmptyState, Input, LoadingState, PageContainer, PageHeader, Textarea } from '../../../shared/ui';

const MIN_GRADUATION_YEAR = 1950;
const MAX_EXPERIENCE_YEARS = 70;

const parseWholeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
};

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
    if (!profile || saving) return;
    setError(null);

    const normalizedFirstName = profile.first_name?.trim() || '';
    const normalizedLastName = profile.last_name?.trim() || '';

    if (!normalizedFirstName || !normalizedLastName) {
      setError("Lütfen adınızı ve soyadınızı eksiksiz girin.");
      return;
    }

    const currentYear = new Date().getFullYear();
    const graduationYear = parseWholeNumber(profile.graduation_year);
    if (graduationYear === null || graduationYear < MIN_GRADUATION_YEAR || graduationYear > currentYear) {
      setError(`Mezuniyet yılı ${MIN_GRADUATION_YEAR} ile ${currentYear} arasında olmalıdır.`);
      return;
    }

    const experienceYears = parseWholeNumber(profile.experience_years);
    if (experienceYears === null || experienceYears < 0 || experienceYears > MAX_EXPERIENCE_YEARS) {
      setError(`Deneyim 0 ile ${MAX_EXPERIENCE_YEARS} yıl arasında olmalıdır.`);
      return;
    }

    setSaving(true);
    const result = await updateDietitianProfile({
      first_name: normalizedFirstName,
      last_name: normalizedLastName,
      phone: profile.phone,
      university: profile.university,
      graduation_year: graduationYear,
      experience_years: experienceYears,
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

  if (loading) return <PageContainer><LoadingState label="Yükleniyor..." className="min-h-[60vh]" /></PageContainer>;
  if (!profile) {
    return (
      <PageContainer>
        <EmptyState icon="user" title="Profil bulunamadı." action={<Button variant="secondary" onClick={() => navigate('/profile')}>Profile Dön</Button>} />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="mx-auto max-w-[920px]">
      <PageHeader
        back={{ to: '/profile', label: 'Profilime dön' }}
        title="Profili Düzenle"
        description="Kişisel ve mesleki bilgilerinizi güncelleyin."
      />

      <Card as="form" padding="none" onSubmit={handleSave} className="mt-6 p-5 sm:p-7" noValidate>
        {error && (
          <Callout tone="bad" role="alert" className="mb-5">{error}</Callout>
        )}

        <h2 className="m-0 text-16 font-bold">Kişisel Bilgiler</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input id="profile-first-name" name="first_name" label="Ad" autoComplete="given-name" required value={profile.first_name ?? ''} onChange={handleChange} />
          <Input id="profile-last-name" name="last_name" label="Soyad" autoComplete="family-name" required value={profile.last_name ?? ''} onChange={handleChange} />
          <Input id="profile-phone" type="tel" name="phone" label="Telefon" leadingIcon="phone" autoComplete="tel" required value={profile.phone ?? ''} onChange={handleChange} />
          <Input id="profile-email" type="email" label="E-posta (Değiştirilemez)" leadingIcon="envelope" disabled value={profile.email ?? ''} />
        </div>

        <h2 className="m-0 mt-7 border-t border-line pt-6 text-16 font-bold">Mesleki Bilgiler</h2>
        <div className="mt-4 flex flex-col gap-4">
          <Input id="profile-university" name="university" label="Üniversite" required value={profile.university ?? ''} onChange={handleChange} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input id="profile-graduation-year" type="number" inputMode="numeric" name="graduation_year" label="Mezuniyet Yılı" min={MIN_GRADUATION_YEAR} max={new Date().getFullYear()} required value={profile.graduation_year ?? ''} onChange={handleChange} />
            <Input id="profile-experience-years" type="number" inputMode="numeric" name="experience_years" label="Deneyim (Yıl)" min={0} max={MAX_EXPERIENCE_YEARS} required value={profile.experience_years ?? ''} onChange={handleChange} />
          </div>
          <Input id="profile-specialization" name="specialization" label="Uzmanlık Alanı" hint="Birden fazla alanı virgülle ayırın." required value={profile.specialization ?? ''} onChange={handleChange} />
          <Textarea id="profile-bio" name="bio" label="Biyografi" rows={5} required value={profile.bio ?? ''} onChange={handleChange} />
        </div>

        <div className="mt-7 flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => navigate('/profile')} disabled={saving}>İptal</Button>
          <Button type="submit" variant="primary" leftIcon="check" loading={saving} disabled={saving}>
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </Button>
        </div>
      </Card>
    </PageContainer>
  );
};

export default EditProfilePage;
