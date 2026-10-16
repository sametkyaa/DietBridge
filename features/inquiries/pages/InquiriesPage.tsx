import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/context/AuthContext';
import { closeInquiry } from '../services/inquiryService';
import { useInquiries, useInquiryConversation } from '../hooks/useInquiries';
import type { ConnectionRequest, InquirySummary, RespondResult } from '../types';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  CountPill,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  SegmentedControl,
  Textarea,
} from '../../../shared/ui';

type InquiryFilter = 'open' | 'all';

const formatTime = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  const sameDay = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat('tr-TR', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(date);
};

const RESPOND_MESSAGES: Record<RespondResult, { tone: 'ok' | 'warn' | 'bad'; text: string }> = {
  accepted: { tone: 'ok', text: 'Bağlantı kuruldu. Danışan artık Danışanlar ve Mesajlar sayfalarında.' },
  declined: { tone: 'ok', text: 'İstek reddedildi.' },
  not_found: { tone: 'warn', text: 'Bu istek artık geçerli değil.' },
  client_has_dietitian: { tone: 'warn', text: 'Danışan bu arada başka bir diyetisyene bağlandı.' },
  limit_reached: { tone: 'bad', text: 'Danışan limitiniz dolu. Yeni danışan kabul etmek için paketinizi Ayarlar sayfasından yükseltebilirsiniz.' },
};

const CLOSED_COPY: Record<string, string> = {
  client: 'Danışan bu ön görüşmeyi kapattı.',
  dietitian: 'Bu ön görüşmeyi kapattınız.',
  connected_elsewhere: 'Danışan başka bir diyetisyene bağlandı.',
};

type RequestCardProps = {
  request: ConnectionRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onOpenInquiry?: () => void;
};

const RequestCard: React.FC<RequestCardProps> = ({ request, busy, onAccept, onDecline, onOpenInquiry }) => (
  <li className="flex flex-col gap-3 rounded-db border border-line bg-surface p-4 sm:flex-row sm:items-center">
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Avatar name={request.clientName} size="md" />
      <div className="min-w-0">
        <p className="m-0 truncate text-14.5 font-semibold text-ink">{request.clientName}</p>
        <p className="m-0 text-12.5 text-ink-3">{formatTime(request.createdAt)} tarihinde bağlanma isteği gönderdi</p>
        {request.note && <p className="m-0 mt-1.5 whitespace-pre-line text-13.5 text-ink-2">“{request.note}”</p>}
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap gap-2">
      {onOpenInquiry && <Button variant="ghost" size="sm" leftIcon="chat-circle" onClick={onOpenInquiry} disabled={busy}>Görüşmeyi aç</Button>}
      <Button variant="secondary" size="sm" onClick={onDecline} disabled={busy}>Reddet</Button>
      <Button variant="primary" size="sm" leftIcon="check" onClick={onAccept} loading={busy} disabled={busy}>Kabul et</Button>
    </div>
  </li>
);

type InquiryListItemProps = { inquiry: InquirySummary; active: boolean; onSelect: () => void };

const InquiryListItem: React.FC<InquiryListItemProps> = ({ inquiry, active, onSelect }) => (
  <li>
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={`flex w-full cursor-pointer items-center gap-3 border-0 border-b border-line px-4 py-3 text-left transition-colors hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${active ? 'bg-brand-soft' : 'bg-transparent'}`}
    >
      <Avatar name={inquiry.clientName} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-14 font-semibold text-ink">{inquiry.clientName}</span>
          <span className="shrink-0 text-12 text-ink-3">{formatTime(inquiry.lastMessageAt ?? inquiry.createdAt)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-13 text-ink-3">
            {inquiry.lastMessageFromMe ? 'Siz: ' : ''}{inquiry.lastMessageBody ?? ''}
          </span>
          {inquiry.unreadCount > 0
            ? <CountPill count={inquiry.unreadCount} tone="brand" label={`${inquiry.unreadCount} okunmamış mesaj`} />
            : inquiry.status !== 'open' && <Badge tone="neutral" size="sm">{inquiry.status === 'connected' ? 'Bağlandı' : 'Kapalı'}</Badge>}
        </div>
      </div>
    </button>
  </li>
);

const InquiriesPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { inquiries, requests, status, refresh, respond } = useInquiries(user?.id);
  const [filter, setFilter] = useState<InquiryFilter>('open');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<ConnectionRequest | null>(null);
  const [respondMessage, setRespondMessage] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const [closeTarget, setCloseTarget] = useState<InquirySummary | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [draft, setDraft] = useState('');
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const refreshSilently = useCallback(() => { void refresh(true); }, [refresh]);
  const conversation = useInquiryConversation(activeId, refreshSilently);
  const activeInquiry = inquiries.find((inquiry) => inquiry.id === activeId) ?? null;

  const visibleInquiries = useMemo(
    () => (filter === 'open' ? inquiries.filter((inquiry) => inquiry.status === 'open') : inquiries),
    [filter, inquiries],
  );
  const openCount = useMemo(() => inquiries.filter((inquiry) => inquiry.status === 'open').length, [inquiries]);

  useEffect(() => {
    if (status !== 'ready') return;
    if (activeId && inquiries.some((inquiry) => inquiry.id === activeId)) return;
    setActiveId(visibleInquiries[0]?.id ?? null);
  }, [activeId, inquiries, status, visibleInquiries]);

  useEffect(() => { setDraft(''); }, [activeId]);
  useEffect(() => { messageEndRef.current?.scrollIntoView({ block: 'end' }); }, [conversation.messages.length, activeId]);

  const handleRespond = async (request: ConnectionRequest, accept: boolean) => {
    if (busyRequestId) return;
    setBusyRequestId(request.id);
    setRespondMessage(null);
    try {
      const result = await respond(request.id, accept);
      setRespondMessage(RESPOND_MESSAGES[result]);
    } catch {
      setRespondMessage({ tone: 'bad', text: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.' });
    } finally {
      setBusyRequestId(null);
      setDeclineTarget(null);
    }
  };

  const handleSend = async () => {
    if (await conversation.send(draft)) setDraft('');
  };

  const handleClose = async () => {
    if (!closeTarget || isClosing) return;
    setIsClosing(true);
    try {
      await closeInquiry(closeTarget.id);
      await refresh(true);
    } catch {
      setRespondMessage({ tone: 'bad', text: 'Ön görüşme kapatılamadı. Lütfen tekrar deneyin.' });
    } finally {
      setIsClosing(false);
      setCloseTarget(null);
    }
  };

  const selectInquiry = (inquiryId: string) => {
    setActiveId(inquiryId);
    setIsPanelVisible(true);
  };

  return (
    <div className="mx-auto flex h-dvh max-h-dvh w-full max-w-[1500px] flex-col px-4 pb-4 pt-5 sm:px-6 lg:px-8 lg:pt-7">
      <header className="mb-4 shrink-0">
        <h1 className="m-0 text-26 font-bold tracking-[-0.3px] text-ink">Ön görüşmeler</h1>
        <p className="m-0 mt-1 text-14 text-ink-3">Size henüz bağlı olmayan danışanların mesajları ve bağlanma istekleri.</p>
      </header>

      {respondMessage && (
        <Callout tone={respondMessage.tone} role={respondMessage.tone === 'bad' ? 'alert' : 'status'} className="mb-4 shrink-0">
          {respondMessage.text}
        </Callout>
      )}

      {status === 'ready' && requests.length > 0 && (
        <Card className="mb-4 shrink-0">
          <CardHeader title="Bağlanma istekleri" />
          <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
            {requests.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                busy={busyRequestId === request.id}
                onAccept={() => void handleRespond(request, true)}
                onDecline={() => setDeclineTarget(request)}
                onOpenInquiry={request.inquiryId ? () => selectInquiry(request.inquiryId as string) : undefined}
              />
            ))}
          </ul>
        </Card>
      )}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        <section
          className={`${isPanelVisible ? 'hidden' : 'flex'} min-h-0 w-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card md:flex md:w-[320px] md:shrink-0`}
          aria-label="Ön görüşme listesi"
        >
          <div className="border-b border-line px-4 py-3">
            <SegmentedControl<InquiryFilter>
              ariaLabel="Ön görüşme filtresi"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: 'Açık', count: openCount },
                { value: 'all', label: 'Tümü' },
              ]}
            />
          </div>
          {status === 'idle' || status === 'loading' ? (
            <LoadingState label="Ön görüşmeler yükleniyor..." className="py-10" />
          ) : status === 'error' ? (
            <ErrorState compact title="Ön görüşmeler yüklenemedi." description="Lütfen tekrar deneyin." onRetry={() => void refresh()} retryLabel="Tekrar dene" />
          ) : visibleInquiries.length === 0 ? (
            <div role="status">
              <EmptyState
                compact
                icon="chat-circle"
                title={filter === 'open' ? 'Açık ön görüşme yok.' : 'Henüz ön görüşme yok.'}
                description="Profilinizde listelenmeyi açarsanız danışanlar size uygulamadan yazabilir."
                action={<Button variant="secondary" size="sm" onClick={() => navigate('/profile/edit')}>Profil ayarlarına git</Button>}
              />
            </div>
          ) : (
            <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
              {visibleInquiries.map((inquiry) => (
                <InquiryListItem key={inquiry.id} inquiry={inquiry} active={inquiry.id === activeId} onSelect={() => selectInquiry(inquiry.id)} />
              ))}
            </ul>
          )}
        </section>

        <section
          className={`${isPanelVisible ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card md:flex`}
          aria-label="Ön görüşme mesajları"
        >
          {!activeInquiry ? (
            <EmptyState icon="chat-circle" title="Bir ön görüşme seçin." className="m-auto" />
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <IconButton icon="arrow-left" label="Listeye dön" variant="ghost" className="md:hidden" onClick={() => setIsPanelVisible(false)} />
                <Avatar name={activeInquiry.clientName} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-15 font-semibold text-ink">{activeInquiry.clientName}</p>
                  <p className="m-0 text-12.5 text-ink-3">Henüz size bağlı değil</p>
                </div>
                {activeInquiry.status === 'open' && (
                  <Button variant="ghost" size="sm" leftIcon="x" onClick={() => setCloseTarget(activeInquiry)}>Görüşmeyi kapat</Button>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4 py-4">
                {conversation.status === 'loading' || conversation.status === 'idle' ? (
                  <LoadingState label="Mesajlar yükleniyor..." className="py-10" />
                ) : conversation.status === 'error' ? (
                  <ErrorState compact title="Mesajlar yüklenemedi." onRetry={() => void conversation.reload()} retryLabel="Tekrar dene" />
                ) : (
                  <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    {conversation.messages.map((message) => {
                      const mine = message.senderId === user?.id;
                      return (
                        <li key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] rounded-db px-3.5 py-2 text-14 shadow-card ${mine ? 'bg-brand text-white' : 'bg-surface text-ink'}`}>
                            <p className="m-0 whitespace-pre-line break-words">{message.body}</p>
                            <p className={`m-0 mt-1 text-right text-11 ${mine ? 'text-white/80' : 'text-ink-3'}`}>{formatTime(message.createdAt)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
                <div ref={messageEndRef} />
              </div>

              <div className="border-t border-line px-4 py-3">
                {activeInquiry.status !== 'open' ? (
                  <Callout tone="info" role="status">
                    {activeInquiry.status === 'connected'
                      ? 'Bu danışan size bağlandı. Sohbete Mesajlar sayfasından devam edebilirsiniz.'
                      : CLOSED_COPY[activeInquiry.closedReason ?? ''] ?? 'Bu ön görüşme kapandı.'}
                  </Callout>
                ) : (
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(event) => { event.preventDefault(); void handleSend(); }}
                  >
                    <Textarea
                      id="inquiry-composer"
                      label="Mesaj"
                      hideLabel
                      rows={2}
                      maxLength={1000}
                      placeholder="Mesajınızı yazın..."
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); }
                      }}
                      error={conversation.sendError ?? undefined}
                      containerClassName="min-w-0 flex-1"
                    />
                    <Button type="submit" variant="primary" leftIcon="paper-plane-tilt" loading={conversation.isSending} disabled={conversation.isSending || !draft.trim()}>
                      Gönder
                    </Button>
                  </form>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={declineTarget !== null}
        title="Bağlanma isteği reddedilsin mi?"
        description={declineTarget ? `${declineTarget.clientName} adlı danışanın isteği reddedilir. Danışan size yeniden istek gönderebilir.` : ''}
        confirmLabel="Reddet"
        tone="danger"
        busy={busyRequestId !== null}
        onConfirm={() => { if (declineTarget) void handleRespond(declineTarget, false); }}
        onCancel={() => setDeclineTarget(null)}
      />
      <ConfirmDialog
        open={closeTarget !== null}
        title="Ön görüşme kapatılsın mı?"
        description="Danışan bu görüşmeye yeni mesaj gönderemez ve yeniden açamaz."
        confirmLabel="Görüşmeyi kapat"
        tone="danger"
        busy={isClosing}
        onConfirm={() => void handleClose()}
        onCancel={() => setCloseTarget(null)}
      />
    </div>
  );
};

export default InquiriesPage;
