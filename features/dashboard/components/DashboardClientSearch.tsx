import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, SearchInput } from '../../../shared/ui';
import type { Client } from '../../../shared/types';

const normalize = (value: string) => value.toLocaleLowerCase('tr-TR').trim();

/** Header search over the dietitian's real client list (no extra query). */
export const DashboardClientSearch = ({ clients }: { clients: readonly Client[] }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const term = normalize(query);
  const results = term ? clients.filter((client) => normalize(client.name).includes(term)).slice(0, 8) : [];

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const go = (client: Client) => {
    setQuery('');
    setOpen(false);
    navigate(`/clients/${client.id}`);
  };

  return (
    <div ref={containerRef} className="relative w-full sm:w-auto">
      <SearchInput
        label="Danışan ara"
        placeholder="Danışan ara…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter' && results[0]) go(results[0]);
        }}
        aria-controls={listId}
        aria-expanded={open && term.length > 0}
        autoComplete="off"
      />
      {open && term && (
        <div
          id={listId}
          className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-db border border-line bg-surface shadow-pop"
        >
          {results.length === 0 ? (
            <p className="m-0 px-4 py-3 text-13 text-ink-2">Sonuç bulunamadı.</p>
          ) : (
            <ul className="m-0 list-none p-1">
              {results.map((client) => (
                <Fragment key={client.id}>
                  <li>
                    <button
                      type="button"
                      onClick={() => go(client)}
                      className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      <Avatar name={client.name} src={client.profilePhotoUrl} size="sm" />
                      <span className="min-w-0 flex-1">
                        <b className="block truncate text-13.5 font-semibold">{client.name}</b>
                        <span className="block truncate text-12 text-ink-3">
                          {client.status === 'Aktif' ? client.goal : 'Onay bekliyor'}
                        </span>
                      </span>
                    </button>
                  </li>
                </Fragment>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
