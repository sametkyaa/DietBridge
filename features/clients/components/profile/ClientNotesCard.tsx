import { Fragment, useCallback } from 'react';
import { Card, CardHeader, CountPill, EmptyState, ErrorState, Icon, LoadingState } from '../../../../shared/ui';
import { fetchClientNotes } from '../../services/clientProfileService';
import { useProfileSection } from '../../hooks/useProfileSection';

const formatUpdated = (value: string): string => new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul',
}).format(new Date(value));

/** Latest dietitian notes attached to this client (plain text, never rendered as HTML). */
export const ClientNotesCard = ({ clientId, refreshToken }: { clientId: string; refreshToken: number }) => {
  const loader = useCallback(() => fetchClientNotes(clientId, 3), [clientId]);
  const { state, reload } = useProfileSection(loader, refreshToken);
  return (
    <Card as="section" aria-labelledby="client-notes-title">
      <CardHeader
        id="client-notes-title"
        title="Notlar"
        addon={state.status === 'success' && state.data.total > 0 ? <CountPill count={state.data.total} label={`${state.data.total} not`} /> : undefined}
        link={{ to: '/notes', label: 'Tümü' }}
      />
      {state.status === 'loading' ? (
        <LoadingState label="Notlar yükleniyor…" className="py-4" />
      ) : state.status === 'error' ? (
        <ErrorState compact description="Notlar yüklenemedi." onRetry={() => void reload()} />
      ) : state.data.notes.length === 0 ? (
        <EmptyState compact icon="note-pencil" title="Bu danışana ait not yok." />
      ) : (
        <ul className="m-0 list-none p-0">
          {state.data.notes.map((note) => (
            <Fragment key={note.id}>
              <li className="flex items-start gap-3 border-t border-line py-2.5 first:border-t-0">
                <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-db bg-sunk text-ink-3">
                  <Icon name="note-pencil" size={16} />
                </span>
                <div className="min-w-0">
                  <b className="block truncate font-semibold">{note.title}</b>
                  <span className="line-clamp-2 block whitespace-pre-wrap break-words text-13 text-ink-2">{formatUpdated(note.updatedAt)} · {note.content}</span>
                </div>
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </Card>
  );
};
