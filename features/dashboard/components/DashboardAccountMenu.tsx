import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DietitianAvatar from '../../../shared/components/DietitianAvatar';
import Icon from '../../../shared/ui/Icon';

const DashboardAccountMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-0 z-30 md:hidden"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label="Profil ve ayarlar menüsü"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-line bg-surface shadow-card transition-shadow hover:ring-2 hover:ring-brand-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <DietitianAvatar alt="" className="h-full w-full rounded-full object-cover" />
      </button>
      {isOpen && (
        <nav
          id={menuId}
          aria-label="Hesap menüsü"
          className="absolute right-0 top-full mt-2 w-44 rounded-card border border-line bg-surface p-1.5 shadow-pop"
        >
          <Link
            to="/profile"
            onClick={() => setIsOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-14 font-medium text-ink hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Icon name="user" size={19} className="text-brand" />
            Profilim
          </Link>
          <Link
            to="/settings"
            onClick={() => setIsOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-14 font-medium text-ink hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <Icon name="gear" size={19} className="text-brand" />
            Ayarlar
          </Link>
        </nav>
      )}
    </div>
  );
};

export default DashboardAccountMenu;
