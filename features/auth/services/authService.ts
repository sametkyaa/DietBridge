import { supabase } from '../../../lib/supabaseClient';
import { DietitianProfile } from '../../../shared/types';
import { ResolvedAuthAccess } from '../types';

interface DietitianProfileRow {
  user_id: string;
  phone?: string | null;
  university?: string | null;
  graduation_year?: number | null;
  experience_years?: number | null;
  specialization?: string | null;
  bio?: string | null;
  diploma_url?: string | null;
  is_verified?: boolean | null;
  verification_status?: string | null;
  verified_at?: string | null;
  rejection_reason?: string | null;
  profiles?: {
    full_name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  } | null;
}

const safeAuthError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Failed to fetch') {
    return 'Sunucuya bağlanılamadı. Lütfen bağlantınızı kontrol edip tekrar deneyin.';
  }
  if (/email logins are disabled/i.test(message)) {
    return 'E-posta ile giriş şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'E-posta adresiniz henüz doğrulanmamış. Gelen kutunuzu kontrol edin.';
  }
  if (/invalid login credentials/i.test(message)) {
    return 'E-posta veya şifre hatalı.';
  }
  return fallback;
};

export const getSafeAuthErrorMessage = (error: unknown): string =>
  safeAuthError(error, 'Kimlik doğrulama sırasında bir hata oluştu. Lütfen tekrar deneyin.');

const toDietitianProfile = (row: DietitianProfileRow, fallbackEmail: string): DietitianProfile => {
  const fullName = row.profiles?.full_name?.trim() || '';
  const [firstName, ...lastNameParts] = fullName.split(' ');

  return {
    user_id: row.user_id,
    first_name: firstName || '',
    last_name: lastNameParts.join(' ') || '',
    email: row.profiles?.email || fallbackEmail,
    phone: row.phone || '',
    university: row.university || '',
    graduation_year: Number(row.graduation_year || 0),
    experience_years: Number(row.experience_years || 0),
    specialization: row.specialization || '',
    bio: row.bio || '',
    diploma_url: row.diploma_url || '',
    avatar_url: row.profiles?.avatar_url || undefined,
    is_verified: row.is_verified ?? undefined,
    verification_status: row.verification_status as DietitianProfile['verification_status'],
    verified_at: row.verified_at ?? null,
    rejection_reason: row.rejection_reason ?? null,
  };
};

type VerificationResult = 'approved' | 'pending' | 'rejected' | 'missing' | 'error';

export const resolveVerificationStatus = (
  profile: Pick<DietitianProfile, 'is_verified' | 'verification_status'>,
): VerificationResult => {
  const status = profile.verification_status;
  const isVerified = profile.is_verified;

  if (status === 'rejected') {
    return isVerified === true ? 'error' : 'rejected';
  }
  if (status === 'pending') {
    return isVerified === true ? 'error' : 'pending';
  }
  if (status === 'approved') {
    return isVerified === false ? 'error' : 'approved';
  }
  if (!status && isVerified === true) {
    return 'approved';
  }
  return 'missing';
};

export const resolveAuthAccess = async (userId: string): Promise<ResolvedAuthAccess> => {
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    console.error('Auth role resolution error:', profileError);
    return {
      status: 'access_error',
      message: 'Hesap rolü doğrulanırken bir hata oluştu. Lütfen tekrar deneyin.',
    };
  }

  const role = (profileData as { role?: string | null } | null)?.role;
  if (!role) {
    return {
      status: 'blocked_missing_role',
      message: 'Hesap rolünüz bulunamadı. Yönetici desteğiyle iletişime geçin.',
    };
  }
  if (role === 'client') {
    return {
      status: 'blocked_client',
      userRole: 'client',
      message: 'Bu panel yalnızca diyetisyenler içindir. Danışan hesabınızla mobil uygulamadan giriş yapabilirsiniz.',
    };
  }
  if (role !== 'dietitian') {
    return {
      status: 'blocked_missing_role',
      message: 'Hesap rolünüz bu panel için geçerli değil. Yönetici desteğiyle iletişime geçin.',
    };
  }

  const { data: profileRow, error: dietitianProfileError } = await supabase
    .from('dietitian_profiles')
    .select(`
      *,
      profiles:user_id (
        full_name,
        email,
        avatar_url
      )
    `)
    .eq('user_id', userId)
    .maybeSingle();

  if (dietitianProfileError) {
    console.error('Dietitian profile resolution error:', dietitianProfileError);
    return {
      status: 'access_error',
      message: 'Diyetisyen profili doğrulanırken bir hata oluştu. Lütfen tekrar deneyin.',
    };
  }
  if (!profileRow) {
    return {
      status: 'blocked_missing_dietitian_profile',
      message: 'Diyetisyen profiliniz bulunamadı. Profil kurulumunun tamamlanması gerekiyor.',
    };
  }

  const { data: authUserData } = await supabase.auth.getUser();
  const profile = toDietitianProfile(profileRow as unknown as DietitianProfileRow, authUserData.user?.email || '');
  const verification = resolveVerificationStatus(profile);

  if (verification === 'pending') {
    return { status: 'pending', userRole: 'dietitian', dietitianProfile: profile };
  }
  if (verification === 'rejected') {
    return { status: 'rejected', userRole: 'dietitian', dietitianProfile: profile };
  }
  if (verification !== 'approved') {
    return {
      status: 'access_error',
      message: 'Diyetisyen hesabınızın doğrulama durumu geçersiz veya eksik.',
    };
  }

  return { status: 'allowed', userRole: 'dietitian', dietitianProfile: profile };
};
