
import React, { useEffect, useState } from 'react';
import { useDietitianAvatarUrl } from '../hooks/useDietitianAvatarUrl';
import { USER_AVATAR } from '../constants';

/**
 * Renders the signed-in dietitian's avatar with the shared fallback image.
 */
const DietitianAvatar: React.FC<{ className: string; alt?: string }> = ({
  className,
  alt = 'Profil',
}) => {
  const resolvedUrl = useDietitianAvatarUrl();
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedUrl]);

  return (
    <img
      src={resolvedUrl && !imageFailed ? resolvedUrl : USER_AVATAR}
      alt={alt}
      onError={() => setImageFailed(true)}
      className={className}
    />
  );
};

export default DietitianAvatar;
