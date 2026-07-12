const fs = require('fs');
const file = 'features/clients/services/clientService.ts';
let code = fs.readFileSync(file, 'utf8');

// Add resolveProfilePhotoUrl helper
const helperCode = `
export function resolveProfilePhotoUrl(
  storedValue: string | null | undefined
): string | null {
  if (!storedValue) return null;

  if (/^https?:\\/\\//i.test(storedValue)) {
    return storedValue;
  }

  try {
    const { data } = supabase.storage.from('avatars').getPublicUrl(storedValue);
    if (data?.publicUrl) {
      return data.publicUrl;
    }
  } catch (e) {
    console.error("Error resolving profile photo:", e);
  }
  return null;
}

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: 'Hareketsiz',
  lightly_active: 'Az Aktif',
  moderately_active: 'Orta Aktif',
  very_active: 'Çok Aktif',
  extra_active: 'Ekstra Aktif',
};

const SMOKING_LABELS: Record<string, string> = {
  smoker: 'Kullanıyor',
  non_smoker: 'Kullanmıyor',
  occasionally: 'Ara Sıra',
};

const ALCOHOL_LABELS: Record<string, string> = {
  uses: 'Kullanıyor',
  does_not_use: 'Kullanmıyor',
  occasionally: 'Ara Sıra',
};
`;

code = code.replace(/import { USER_AVATAR } from '\.\.\/\.\.\/\.\.\/shared\/constants';\n/, "import { USER_AVATAR } from '../../../shared/constants';\n" + helperCode);

code = code.replace(/avatar: client\.avatar_url \|\| USER_AVATAR,/g, "avatar: resolveProfilePhotoUrl(client.avatar_url) || USER_AVATAR,");
code = code.replace(/avatar: clientData\.avatar_url \|\| USER_AVATAR,/g, "avatar: resolveProfilePhotoUrl(clientData.avatar_url) || USER_AVATAR,");

// Also apply the labels
code = code.replace(/activityLevel: profile\.activity_level,/g, "activityLevel: ACTIVITY_LABELS[profile.activity_level] || profile.activity_level,");
code = code.replace(/smokingStatus: profile\.smoking_status,/g, "smokingStatus: SMOKING_LABELS[profile.smoking_status] || profile.smoking_status,");
code = code.replace(/alcoholUse: profile\.alcohol_use,/g, "alcoholUse: ALCOHOL_LABELS[profile.alcohol_use] || profile.alcohol_use,");

fs.writeFileSync(file, code);
