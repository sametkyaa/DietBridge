
import { supabase } from '../../../lib/supabaseClient';
import { DietitianProfile } from '../../../shared/types';
import {
  AVATAR_BUCKET,
  getOwnedAvatarObjectPath,
} from '../../../shared/utils/avatarUrl';

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
  phone: string;
  university: string;
  graduationYear: string;
  experienceYears: string;
  specialization: string;
  bio: string;
  diplomaFile: File;
}

export type RegistrationStatus = 'complete' | 'email_confirmation_required' | 'incomplete_profile' | 'failed';

export interface RegistrationResult {
  success: boolean;
  status: RegistrationStatus;
  error?: string;
}

/**
 * Helper function to sanitize file names (remove Turkish chars, spaces)
 */
const sanitizeFileName = (fileName: string): string => {
  return fileName
    .replace(/[^a-zA-Z0-9.]/g, '-') // Replace non-alphanumeric chars with hyphen
    .toLowerCase();
};

/**
 * Helper function to upload the diploma document to Supabase Storage.
 * Path format: diplomas/{authUserId}/diploma.pdf
 */
export const uploadDiplomaFile = async (authUserId: string, file: File): Promise<string> => {
  try {
    // 1. Build the deterministic file path
    const filePath = `diplomas/${authUserId}/diploma.pdf`;

    // 2. Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('dietitian-diplomas')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true, // Overwrite if exists to prevent conflicts
      });

    if (uploadError) {
      console.error('Supabase Storage Upload Error Details:', uploadError);
      throw uploadError;
    }

    // 3. Return the file path reference
    return filePath;
  } catch (error: any) {
    console.error('Storage upload error:', error);
    throw error; 
  }
};

/**
 * Handles the full registration flow:
 * 1. Sign up User (Auth)
 * 2. Upload Diploma (Storage) via helper
 * 3. Create Profile (Database)
 */
export const registerDietitian = async (data: RegistrationData): Promise<RegistrationResult> => {
  let authUserCreated = false;
  try {
    const fullName = [data.firstName, data.lastName]
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .join(' ');

    if (!fullName) {
      throw new Error("Ad ve soyad boş bırakılamaz.");
    }

    // 1. Sign Up in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          first_name: data.firstName,
          last_name: data.lastName,
          full_name: fullName,
          role: 'dietitian'
        }
      }
    });

    if (authError) throw authError;
    if (!authData.user) {
      return { success: false, status: 'failed', error: 'Hesap oluşturulamadı. Lütfen tekrar deneyin.' };
    }

    const userId = authData.user.id;
    authUserCreated = true;

    if (!authData.session) {
      return {
        success: false,
        status: 'email_confirmation_required',
        error: 'Hesabınız oluşturuldu ancak e-posta doğrulaması gerekiyor. Profil kurulumu tamamlanana kadar web paneline erişemezsiniz.',
      };
    }

    // 2. Upload Diploma Image using helper
    let diplomaUrl: string;
    try {
      diplomaUrl = await uploadDiplomaFile(userId, data.diplomaFile);
    } catch (uploadError: unknown) {
      console.error('Diploma upload failed after auth signup:', uploadError);
      return {
        success: false,
        status: 'incomplete_profile',
        error: 'Hesabınız oluşturulmuş olabilir ancak diploma yüklenemedi. Profil kurulumu tamamlanmadı.',
      };
    }

    // 3. Insert into 'dietitian_profiles' table and update 'profiles'
    try {
      // Upsert base profile first
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          full_name: fullName,
          role: 'dietitian',
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (profileError) {
        console.error('Failed to upsert base profile:', profileError);
        throw profileError;
      }

      const profileData = {
        user_id: userId,
        phone: data.phone,
        university: data.university,
        graduation_year: parseInt(data.graduationYear),
        experience_years: parseInt(data.experienceYears),
        specialization: data.specialization,
        bio: data.bio,
        diploma_url: diplomaUrl,
        is_verified: false,
        verification_status: 'pending',
        verified_at: null,
        rejection_reason: null
      };

      const { error: dbError } = await supabase
        .from('dietitian_profiles')
        .upsert([profileData]);

      if (dbError) throw dbError;
    } catch (dbError: unknown) {
      console.error('Database profile insert error:', dbError);
      return {
        success: false,
        status: 'incomplete_profile',
        error: 'Hesabınız oluşturulmuş olabilir ancak diyetisyen profiliniz tamamlanamadı. Web paneline erişim verilmedi.',
      };
    }

    return { success: true, status: 'complete' };

  } catch (error: unknown) {
    console.error('Registration error:', error);
    const message = error instanceof Error ? error.message : '';
    if (message === 'Failed to fetch') {
      return { success: false, status: authUserCreated ? 'incomplete_profile' : 'failed', error: 'Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin veya daha sonra tekrar deneyin.' };
    }
    return { success: false, status: authUserCreated ? 'incomplete_profile' : 'failed', error: authUserCreated ? 'Hesabınız oluşturulmuş olabilir ancak profil kurulumu tamamlanamadı.' : 'Kayıt işlemi sırasında bir hata oluştu.' };
  }
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
