import { useEffect, useState } from 'react';
import { getAvatarTone, getInitials, type AvatarTone } from './avatarUtils';
import { cx } from './cx';

export type { AvatarTone } from './avatarUtils';
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeClasses: Record<AvatarSize, string> = {
  xs: 'h-[26px] w-[26px] text-10',
  sm: 'h-[30px] w-[30px] text-11',
  md: 'h-9 w-9 text-12.5',
  lg: 'h-12 w-12 text-16',
  xl: 'h-[84px] w-[84px] text-28 !font-medium',
};

const toneClasses: Record<AvatarTone, string> = {
  1: 'bg-[#E2EEE6] text-[#2D5E4C]',
  2: 'bg-[#E8E4F6] text-[#5B4C98]',
  3: 'bg-[#FBEBD8] text-[#9A5E16]',
  4: 'bg-[#E2EEF8] text-[#2F6290]',
  5: 'bg-[#FBE4E1] text-[#A8423A]',
  6: 'bg-[#EDEEEA] text-[#5E6762]',
};

export interface AvatarProps {
  /** Baş harfler ve renk tonu bu addan üretilir. */
  name: string;
  /** Profil fotoğrafı URL'si; yüklenemezse baş harflere düşer. */
  src?: string | null;
  size?: AvatarSize;
  /** Belirli bir ton; verilmezse addan türetilir. */
  tone?: AvatarTone;
  /**
   * Varsayılan true: avatar adın yanında gösterildiği için ekran okuyuculardan gizlenir.
   * Tek başına kullanılıyorsa false verin; ad, erişilebilir ad olur.
   */
  decorative?: boolean;
  className?: string;
}

/** Prototipteki .av: baş harfli renkli daire veya fotoğraf. */
export const Avatar = ({ name, src, size = 'md', tone, decorative = true, className }: AvatarProps) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  useEffect(() => {
    setFailedSrc(null);
  }, [src]);
  const showImage = Boolean(src) && failedSrc !== src;
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name };
  const classes = cx(
    'inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold leading-none',
    sizeClasses[size],
    toneClasses[tone ?? getAvatarTone(name)],
    className,
  );
  if (showImage && src) {
    return (
      <span className={classes} {...a11y}>
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailedSrc(src)} />
      </span>
    );
  }
  return (
    <span className={classes} {...a11y}>
      {getInitials(name)}
    </span>
  );
};
