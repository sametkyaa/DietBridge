import type { SVGProps } from 'react';
import { ICON_PATHS, type IconName, type IconPath } from './iconPaths';

export type { IconName } from './iconPaths';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> {
  /** iconPaths.ts içindeki ikon adı (Phosphor adlandırması, ör. "calendar-blank"). */
  name: IconName;
  /** Piksel veya CSS uzunluğu. Varsayılan 19px (prototipteki svg.i). */
  size?: number | string;
  /**
   * Erişilebilir ad. Verilirse ikon role="img" ile okunur; verilmezse dekoratiftir
   * ve ekran okuyuculardan gizlenir.
   */
  title?: string;
}

/**
 * Prototipteki satır içi Phosphor SVG'lerini çizen yerel ikon bileşeni.
 * Renk currentColor'dan gelir; boyut için `size` veya `className` (ör. "h-4 w-4") kullanın.
 */
const Icon = ({ name, size = 19, title, className, style, ...rest }: IconProps) => {
  const paths: readonly IconPath[] = ICON_PATHS[name];
  const labelled = typeof title === 'string' && title.length > 0;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
      style={style}
      {...(labelled ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
      data-icon={name}
      {...rest}
    >
      {paths.map(([d, opacity], index) => (
        <path key={index} d={d} opacity={opacity} />
      ))}
    </svg>
  );
};

export default Icon;
