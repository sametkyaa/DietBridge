
import { useEffect, useState } from 'react';
import { useAuth } from '../../features/auth/context/AuthContext';
import { resolveProfilePhotoUrl } from '../utils/avatarUrl';

/**
 * Resolves the signed-in dietitian's stored avatar value
 * (`profiles.avatar_url`) into a displayable URL. Returns null when no
 * avatar is stored or the value cannot be resolved.
 */
export const useDietitianAvatarUrl = (): string | null => {
  const { dietitianProfile } = useAuth();
  const storedValue = dietitianProfile?.avatar_url ?? null;
  const subjectUserId = dietitianProfile?.user_id ?? null;
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!storedValue || !subjectUserId) {
      setResolvedUrl(null);
      return;
    }
    void resolveProfilePhotoUrl(storedValue, { subjectUserId, allowPrivatePath: true })
      .then((url) => {
        if (active) setResolvedUrl(url);
      });
    return () => {
      active = false;
    };
  }, [storedValue, subjectUserId]);

  return resolvedUrl;
};
