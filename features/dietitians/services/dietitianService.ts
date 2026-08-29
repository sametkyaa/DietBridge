
import { supabase } from '../../../lib/supabaseClient';
import { DietitianProfile } from '../../../shared/types';
import {
  AVATAR_BUCKET,
  getOwnedAvatarObjectPath,
} from '../../../shared/utils/avatarUrl';
import {
  DIETITIAN_DIPLOMA_BUCKET,
  getCanonicalDiplomaPath,
  getRegistrationCompleteness,
  isCanonicalDiplomaPath,
} from '../../auth/utils/registrationCompleteness';

const AVATAR_MAX_FILE_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface RegistrationData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface DietitianCompletionData {
  phone: string;
  university: string;
  graduationYear: string;
  experienceYears: string;
  specialization: string;
  bio: string;
  diplomaFile?: File | null;
}

export type RegistrationStatus = 'complete' | 'email_confirmation_required' | 'incomplete_profile' | 'failed';

export interface RegistrationResult {
  success: boolean;
  status: RegistrationStatus;
  error?: string;
}

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

interface BaseProfileRow {
  id: string;
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  role?: string | null;
}

export interface DietitianOnboardingState {
  userId: string;
  email: string;
  fullName: string;
  phone: string;
  university: string;
  graduationYear: number | null;
  experienceYears: number | null;
  specialization: string;
  bio: string;
  profile: DietitianProfile | null;
  diplomaUrl: string | null;
}

export interface DietitianOnboardingResult {
  success: boolean;
  data?: DietitianOnboardingState;
  error?: string;
}

export type DiplomaFileValidation =
  | { status: 'valid' }
  | { status: 'invalid'; userMessage: string };

const DIPLOMA_MAX_FILE_BYTES = 5 * 1024 * 1024;
const REGISTRATION_INCOMPLETE_MESSAGE = 'Başvurunuz henüz tamamlanmamış.';
const REGISTRATION_GENERIC_MESSAGE = 'Profil kurulumu tamamlanamadı. Lütfen tekrar deneyin.';
const AUTH_SESSION_REQUIRED_MESSAGE = 'Hesabınız oluşturuldu. Başvurunuza devam etmek için e-posta adresinizi doğrulayın.';
const VERIFICATION_LOCKED_MESSAGE = 'Başvurunuzun doğrulama durumu değiştirilemez.';

const safeRegistrationError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Failed to fetch') {
    return 'Sunucuya bağlanılamadı. Lütfen bağlantınızı kontrol edip tekrar deneyin.';
  }
  return fallback;
};

const toNumber = (value: string): number => Number(value.trim());

const getMetadataText = (
  metadata: Record<string, unknown>,
  ...keys: string[]
): string => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const getMetadataNumber = (
  metadata: Record<string, unknown>,
  ...keys: string[]
): number | null => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const parsed = Number(String(value).trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

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

export const validateDiplomaFile = (file: File): DiplomaFileValidation => {
  if (file.type !== 'application/pdf') {
    return { status: 'invalid', userMessage: 'Lütfen geçerli bir PDF dosyası yükleyiniz.' };
  }
  if (file.size <= 0) {
    return { status: 'invalid', userMessage: 'Seçilen diploma dosyası boş görünüyor.' };
  }
  if (file.size > DIPLOMA_MAX_FILE_BYTES) {
    return { status: 'invalid', userMessage: "Dosya boyutu 5MB'dan büyük olamaz." };
  }
  return { status: 'valid' };
};

/**
 * Uploads only the authenticated user's canonical private diploma object.
 */
export const uploadDiplomaFile = async (authUserId: string, file: File): Promise<string> => {
  const validation = validateDiplomaFile(file);
  if (validation.status === 'invalid') {
    throw new Error('invalid_diploma_file');
  }
  const authenticatedUser = await getAuthenticatedUser();
  if (!authenticatedUser || authenticatedUser.id !== authUserId) {
    throw new Error('unauthorized_diploma_owner');
  }
  const filePath = getCanonicalDiplomaPath(authUserId);
  const { error: uploadError } = await supabase.storage
    .from(DIETITIAN_DIPLOMA_BUCKET)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true,
    });

  if (uploadError) throw uploadError;
  return filePath;
};

const getAuthenticatedUser = async () => {
  const { data: authUserData, error: authUserError } = await supabase.auth.getUser();
  if (authUserError || !authUserData.user) return null;

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) return null;
  if (sessionData.session.user.id !== authUserData.user.id) return null;

  return authUserData.user;
};

export const getCurrentDietitianOnboarding = async (): Promise<DietitianOnboardingResult> => {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: false, error: 'Oturum bulunamadı. Lütfen tekrar giriş yapın.' };
  }

  const { data: baseProfile, error: baseProfileError } = await supabase
    .from('profiles')
    .select('id,email,full_name,phone,role')
    .eq('id', user.id)
    .maybeSingle();
  if (baseProfileError) {
    return { success: false, error: REGISTRATION_GENERIC_MESSAGE };
  }

  const profileData = baseProfile as BaseProfileRow | null;
  if (!profileData || profileData.role !== 'dietitian') {
    return { success: false, error: 'Hesabınızın diyetisyen rolü doğrulanamadı.' };
  }

  const { data: dietitianProfileRow, error: dietitianProfileError } = await supabase
    .from('dietitian_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (dietitianProfileError) {
    return { success: false, error: REGISTRATION_GENERIC_MESSAGE };
  }

  const row = dietitianProfileRow as DietitianProfileRow | null;
  const metadata = user.user_metadata as Record<string, unknown>;
  const metadataFullName = getMetadataText(metadata, 'full_name', 'name')
    || [
      getMetadataText(metadata, 'first_name', 'firstName'),
      getMetadataText(metadata, 'last_name', 'lastName'),
    ].filter(Boolean).join(' ');
  const fullName = profileData.full_name?.trim() || metadataFullName;
  const email = user.email?.trim() || '';
  const profile = row
    ? toDietitianProfile({
      ...row,
      profiles: {
        full_name: fullName,
        email,
      },
    }, email)
    : null;

  return {
    success: true,
    data: {
      userId: user.id,
      email,
      fullName,
      phone: row?.phone || profileData.phone || getMetadataText(metadata, 'phone'),
      university: row?.university || getMetadataText(metadata, 'university'),
      graduationYear: row?.graduation_year
        ?? getMetadataNumber(metadata, 'graduation_year', 'graduationYear'),
      experienceYears: row?.experience_years
        ?? getMetadataNumber(metadata, 'experience_years', 'experienceYears'),
      specialization: row?.specialization || getMetadataText(metadata, 'specialization'),
      bio: row?.bio || getMetadataText(metadata, 'bio'),
      profile,
      diplomaUrl: row?.diploma_url || null,
    },
  };
};

interface CoreOnboardingInput {
  fullName: string;
  phone: string;
  university: string;
  graduationYear: string;
  experienceYears: string;
  specialization: string;
  bio: string;
}

const persistCoreOnboardingFields = async (
  user: { id: string; email?: string },
  input: CoreOnboardingInput,
): Promise<{ diplomaUrl: string | null }> => {
  const { data: baseProfile, error: baseProfileError } = await supabase
    .from('profiles')
    .update({
      email: user.email?.trim() || null,
      full_name: input.fullName.trim(),
      phone: input.phone.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('id')
    .maybeSingle();
  if (baseProfileError || !baseProfile) throw new Error('base_profile_persistence_failed');

  const { data: dietitianProfile, error: dietitianProfileError } = await supabase
    .from('dietitian_profiles')
    .upsert({
      user_id: user.id,
      phone: input.phone.trim(),
      university: input.university.trim(),
      graduation_year: toNumber(input.graduationYear),
      experience_years: toNumber(input.experienceYears),
      specialization: input.specialization.trim(),
      bio: input.bio.trim(),
    }, { onConflict: 'user_id' })
    .select('user_id,diploma_url')
    .maybeSingle();
  if (dietitianProfileError || !dietitianProfile) throw new Error('dietitian_profile_persistence_failed');

  return { diplomaUrl: (dietitianProfile as { diploma_url?: string | null }).diploma_url || null };
};

const persistDiplomaLink = async (userId: string, diplomaPath: string): Promise<void> => {
  const { data, error } = await supabase
    .from('dietitian_profiles')
    .update({ diploma_url: diplomaPath })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle();
  if (error || !data) throw new Error('diploma_link_persistence_failed');
};

const removeCanonicalDiplomaFile = async (userId: string): Promise<void> => {
  const authenticatedUser = await getAuthenticatedUser();
  if (!authenticatedUser || authenticatedUser.id !== userId) return;
  const { error } = await supabase.storage
    .from(DIETITIAN_DIPLOMA_BUCKET)
    .remove([getCanonicalDiplomaPath(authenticatedUser.id)]);
  if (error) {
    console.warn('Diploma cleanup failed; the deterministic object will be retried on the next completion attempt.');
  }
};

const incompleteResult = (error = REGISTRATION_INCOMPLETE_MESSAGE): RegistrationResult => ({
  success: false,
  status: 'incomplete_profile',
  error,
});

const getCoreCompleteness = (
  userId: string,
  email: string,
  input: CoreOnboardingInput,
  diplomaUrl: string,
) => getRegistrationCompleteness({
  userId,
  fullName: input.fullName,
  email,
  phone: input.phone,
  university: input.university,
  graduationYear: input.graduationYear,
  experienceYears: input.experienceYears,
  specialization: input.specialization,
  bio: input.bio,
  diplomaUrl,
});

/**
 * Creates only the Auth account and trigger metadata. Professional application
 * persistence and diploma upload require a confirmed authenticated session and
 * are handled exclusively by completeDietitianRegistration.
 */
export const registerDietitian = async (data: RegistrationData): Promise<RegistrationResult> => {
  const fullName = [data.firstName, data.lastName]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');

  if (!fullName) return { success: false, status: 'failed', error: 'Ad ve soyad boş bırakılamaz.' };

  try {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email.trim(),
      password: data.password,
      options: {
        data: {
          first_name: data.firstName.trim(),
          last_name: data.lastName.trim(),
          full_name: fullName,
          account_type: 'dietitian',
          role: 'dietitian',
        },
      },
    });

    if (authError) throw authError;
    if (!authData.user) {
      return { success: false, status: 'failed', error: 'Hesap oluşturulamadı. Lütfen tekrar deneyin.' };
    }

    const userId = authData.user.id;

    if (!authData.session) {
      return { success: true, status: 'email_confirmation_required', error: AUTH_SESSION_REQUIRED_MESSAGE };
    }

    if (authData.session.user.id !== userId) {
      return { success: false, status: 'failed', error: 'Oturum doğrulanamadı. Lütfen tekrar giriş yapın.' };
    }

    return {
      success: true,
      status: 'incomplete_profile',
      error: 'Hesabınız oluşturuldu. Mesleki başvurunuzu tamamlayabilirsiniz.',
    };
  } catch (error: unknown) {
    const errorMessage = safeRegistrationError(error, 'Kayıt işlemi sırasında bir hata oluştu.');
    return { success: false, status: 'failed', error: errorMessage };
  }
};

/**
 * Completes an already authenticated dietitian account. This function never
 * calls signUp and never changes verification authority fields.
 */
export const completeDietitianRegistration = async (
  data: DietitianCompletionData,
): Promise<RegistrationResult> => {
  const authenticatedUser = await getAuthenticatedUser();
  if (!authenticatedUser) {
    return { success: false, status: 'failed', error: 'Oturum bulunamadı. Lütfen tekrar giriş yapın.' };
  }
  if (!authenticatedUser.email?.trim()) return incompleteResult();

  const onboarding = await getCurrentDietitianOnboarding();
  if (!onboarding.success || !onboarding.data) {
    return incompleteResult(onboarding.error);
  }

  const currentProfile = onboarding.data.profile;
  if (
    currentProfile
    && (currentProfile.verification_status !== 'pending' || currentProfile.is_verified !== false)
  ) {
    return { success: false, status: 'failed', error: VERIFICATION_LOCKED_MESSAGE };
  }

  const coreInput: CoreOnboardingInput = {
    fullName: onboarding.data.fullName,
    phone: data.phone,
    university: data.university,
    graduationYear: data.graduationYear,
    experienceYears: data.experienceYears,
    specialization: data.specialization,
    bio: data.bio,
  };
  const diplomaPath = data.diplomaFile
    ? getCanonicalDiplomaPath(authenticatedUser.id)
    : onboarding.data.diplomaUrl || '';
  const completeness = getCoreCompleteness(
    authenticatedUser.id,
    authenticatedUser.email,
    coreInput,
    diplomaPath,
  );
  if (!completeness.isComplete) return incompleteResult();

  if (data.diplomaFile) {
    const validation = validateDiplomaFile(data.diplomaFile);
    if (validation.status === 'invalid') return incompleteResult(validation.userMessage);
  }

  let coreResult: { diplomaUrl: string | null };
  try {
    coreResult = await persistCoreOnboardingFields(authenticatedUser, coreInput);
  } catch {
    return incompleteResult();
  }

  if (!data.diplomaFile) return { success: true, status: 'complete' };

  let uploadedPath: string;
  try {
    uploadedPath = await uploadDiplomaFile(authenticatedUser.id, data.diplomaFile);
  } catch {
    return incompleteResult();
  }

  try {
    await persistDiplomaLink(authenticatedUser.id, uploadedPath);
  } catch {
    if (!isCanonicalDiplomaPath(coreResult.diplomaUrl, authenticatedUser.id)) {
      await removeCanonicalDiplomaFile(authenticatedUser.id);
    }
    return incompleteResult();
  }

  return { success: true, status: 'complete' };
};

/**
 * Fetch the profile of the currently logged-in dietitian
 */
export const getCurrentDietitianProfile = async (): Promise<DietitianProfile | null> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // Fetch from dietitian_profiles and join with profiles
    const { data, error } = await supabase
      .from('dietitian_profiles')
      .select(`
        *,
        profiles:user_id (
          full_name,
          email,
          avatar_url
        )
      `)
      .eq('user_id', user.id)
      .single();

    if (error) throw error;

    // Transform to flat structure expected by UI
    const fullName = data.profiles?.full_name || '';
    const [firstName, ...lastNameParts] = fullName.split(' ');
    
    return {
      user_id: data.user_id,
      first_name: firstName || '',
      last_name: lastNameParts.join(' ') || '',
      email: data.profiles?.email || user.email || '',
      phone: data.phone,
      university: data.university,
      graduation_year: data.graduation_year,
      experience_years: data.experience_years,
      specialization: data.specialization,
      bio: data.bio,
      diploma_url: data.diploma_url,
      avatar_url: data.profiles?.avatar_url || undefined,
      is_verified: data.is_verified,
      verification_status: data.verification_status,
      verified_at: data.verified_at,
      rejection_reason: data.rejection_reason
    };
  } catch (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
};

/**
 * Update Dietitian Profile
 */
export const updateDietitianProfile = async (updates: Partial<DietitianProfile>): Promise<{ success: boolean; error?: string }> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    // Split updates between profiles and dietitian_profiles
    const profileUpdates: any = {};
    const dietitianUpdates: any = {};

    if ('first_name' in updates || 'last_name' in updates) {
      const currentProfileResult = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();
      
      const currentFullName = currentProfileResult.data?.full_name || '';
      const [currentFirst, ...currentLastArr] = currentFullName.split(' ');
      const currentLast = currentLastArr.join(' ');

      const newFirst = updates.first_name !== undefined ? updates.first_name : currentFirst;
      const newLast = updates.last_name !== undefined ? updates.last_name : currentLast;

      const newFullName = [newFirst, newLast]
        .map(v => String(v || '').trim())
        .filter(Boolean)
        .join(' ');
      
      if (!newFullName) {
        throw new Error("Diyetisyen adı boş bırakılamaz.");
      }

      profileUpdates.full_name = newFullName;
      profileUpdates.updated_at = new Date().toISOString();
    }

    if (updates.phone !== undefined) dietitianUpdates.phone = updates.phone;
    if (updates.university !== undefined) dietitianUpdates.university = updates.university;
    if (updates.graduation_year !== undefined) dietitianUpdates.graduation_year = updates.graduation_year;
    if (updates.experience_years !== undefined) dietitianUpdates.experience_years = updates.experience_years;
    if (updates.specialization !== undefined) dietitianUpdates.specialization = updates.specialization;
    if (updates.bio !== undefined) dietitianUpdates.bio = updates.bio;

    // Update dietitian_profiles
    if (Object.keys(dietitianUpdates).length > 0) {
      const { error } = await supabase
        .from('dietitian_profiles')
        .update(dietitianUpdates)
        .eq('user_id', user.id);
      if (error) throw error;
    }

    // Update profiles
    if (Object.keys(profileUpdates).length > 0) {
      const { error } = await supabase
        .from('profiles')
        .update(profileUpdates)
        .eq('id', user.id);
      if (error) throw error;
    }

    return { success: true };
  } catch (error: any) {
    console.error('Update error:', error);
    return { success: false, error: error.message };
  }
};

export type AvatarFileValidation =
  | { status: 'valid'; extension: string }
  | { status: 'invalid'; userMessage: string };

/**
 * Validates an avatar file against the `avatars` bucket contract
 * (JPEG/PNG/WebP, max 5 MiB).
 */
export const validateDietitianAvatarFile = (file: File): AvatarFileValidation => {
  const extension = AVATAR_MIME_EXTENSION_MAP[file.type];
  if (!extension) {
    return {
      status: 'invalid',
      userMessage: 'Yalnızca JPEG, PNG veya WebP formatında görsel yükleyebilirsiniz.',
    };
  }
  if (file.size <= 0) {
    return { status: 'invalid', userMessage: 'Seçilen dosya boş görünüyor. Lütfen farklı bir görsel seçin.' };
  }
  if (file.size > AVATAR_MAX_FILE_BYTES) {
    return {
      status: 'invalid',
      userMessage: 'Görsel boyutu 5 MB sınırını aşıyor. Lütfen daha küçük bir görsel seçin.',
    };
  }
  return { status: 'valid', extension };
};

export type DietitianAvatarResult = {
  success: boolean;
  avatarPath?: string | null;
  error?: string;
};

const AVATAR_GENERIC_ERROR = 'Profil fotoğrafı güncellenemedi. Lütfen tekrar deneyin.';

const removeAvatarObjectBestEffort = async (objectPath: string, context: string): Promise<void> => {
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([objectPath]);
  if (error) {
    console.warn(`Avatar storage cleanup failed (${context}); orphan file may remain:`, error);
  }
};

/**
 * Uploads a new avatar for the current dietitian and persists the canonical
 * object path (`<user-id>/avatar.<ext>`) to `profiles.avatar_url`.
 * Cleans up the replaced object after a successful profile update.
 */
export const uploadDietitianAvatar = async (file: File): Promise<DietitianAvatarResult> => {
  const validation = validateDietitianAvatarFile(file);
  if (validation.status === 'invalid') {
    return { success: false, error: validation.userMessage };
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Oturum bulunamadı. Lütfen tekrar giriş yapın.' };

    const { data: currentProfile, error: currentProfileError } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    if (currentProfileError) throw currentProfileError;

    const previousOwnedPath = getOwnedAvatarObjectPath(currentProfile?.avatar_url, user.id);
    const objectPath = `${user.id}/avatar.${validation.extension}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(objectPath, file, { cacheControl: '3600', upsert: true });
    if (uploadError) throw uploadError;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: objectPath, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (updateError) {
      await removeAvatarObjectBestEffort(objectPath, 'profile update failed');
      throw updateError;
    }

    if (previousOwnedPath && previousOwnedPath !== objectPath) {
      await removeAvatarObjectBestEffort(previousOwnedPath, 'avatar replaced');
    }

    return { success: true, avatarPath: objectPath };
  } catch (error) {
    console.error('Dietitian avatar upload error:', error);
    return { success: false, error: AVATAR_GENERIC_ERROR };
  }
};

/**
 * Clears `profiles.avatar_url` for the current dietitian and removes the
 * owned storage object afterwards on a best-effort basis.
 */
export const removeDietitianAvatar = async (): Promise<DietitianAvatarResult> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Oturum bulunamadı. Lütfen tekrar giriş yapın.' };

    const { data: currentProfile, error: currentProfileError } = await supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    if (currentProfileError) throw currentProfileError;

    const previousOwnedPath = getOwnedAvatarObjectPath(currentProfile?.avatar_url, user.id);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (updateError) throw updateError;

    if (previousOwnedPath) {
      await removeAvatarObjectBestEffort(previousOwnedPath, 'avatar removed');
    }

    return { success: true, avatarPath: null };
  } catch (error) {
    console.error('Dietitian avatar remove error:', error);
    return { success: false, error: 'Profil fotoğrafı kaldırılamadı. Lütfen tekrar deneyin.' };
  }
};
