export type AvatarTone = 1 | 2 | 3 | 4 | 5 | 6;

/** "Dyt. Zeynep Aksoy" → "ZA", "Can Öztürk" → "CÖ". Unvan kısaltmaları (nokta ile bitenler) atlanır. */
export const getInitials = (name: string): string => {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0 && !word.endsWith('.'));
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return `${first}${last}`.toLocaleUpperCase('tr-TR');
};

/** Aynı ad her zaman aynı renk tonunu alır (prototipteki .av, .av.c2 … .av.c6). */
export const getAvatarTone = (seed: string): AvatarTone => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return ((hash % 6) + 1) as AvatarTone;
};
