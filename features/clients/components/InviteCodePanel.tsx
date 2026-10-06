import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { getMyInviteCode, rotateMyInviteCode, setMyInviteCodeOpen, type DietitianInviteCode } from '../services/inviteCodeService';
import { inviteUrl, inviteWhatsAppUrl } from '../utils/inviteCode';
import { useSubscriptionOverview } from '../../subscriptions/hooks/useSubscriptionOverview';
import { Badge, Button, Callout, Icon, LoadingState, ProgressBar, buttonClasses, cx } from '../../../shared/ui';

/**
 * Davet kodu paylaşımı (invite_code modu). Kod, link, QR ve WhatsApp paylaşımı;
 * yeni bağlantıları durdurma/açma ve kodu yenileme sunucu RPC'leriyle yapılır.
 */
export default function InviteCodePanel({ onBusyChange }: { onBusyChange: (value: boolean) => void }) {
  const [invite, setInvite] = useState<DietitianInviteCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const { state: capacity, reload: reloadCapacity } = useSubscriptionOverview();
  const mounted = useRef(true);
  const lock = useRef(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(null); setMessage(null);
    try { await action(); }
    catch { if (mounted.current) setError('İşlem tamamlanamadı. Lütfen tekrar deneyin.'); }
    finally { lock.current = false; onBusyChange(false); if (mounted.current) setBusy(false); }
  }, [onBusyChange]);
  const load = useCallback(() => run(async () => {
    const result = await getMyInviteCode();
    if (mounted.current) setInvite(result);
  }), [run]);
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; };
  }, [load]);
  const copy = (value: string, label: string) => run(async () => {
    await navigator.clipboard.writeText(value);
    if (mounted.current) setMessage(`${label} kopyalandı.`);
  });
  const rotate = () => run(async () => {
    const result = await rotateMyInviteCode();
    if (mounted.current) { setInvite(result); setQr(null); setConfirmRotate(false); setMessage('Davet kodunuz yenilendi.'); }
  });

  if (!invite) {
    return (
      <div className="flex flex-col gap-3" aria-busy={busy}>
        <p id="client-invitation-description" className="m-0 text-13.5 text-ink-2">Danışanınız kodu mobil uygulamada girip bağlantıyı onayladığında takibi başlayabilir.</p>
        {error && <Callout tone="bad" role="alert">{error}</Callout>}
        {busy ? <LoadingState label="Davet kodu yükleniyor…" className="py-6" /> : (
          <Button variant="secondary" leftIcon="arrows-left-right" onClick={() => void load()} className="self-start">Tekrar dene</Button>
        )}
      </div>
    );
  }

  const link = inviteUrl(invite.code);
  const segments = invite.code.split('-');

  if (confirmRotate) {
    return (
      <div className="flex flex-col gap-4" aria-busy={busy} role="group" aria-labelledby="invite-rotate-title">
        <h3 id="invite-rotate-title" className="m-0 text-16 font-semibold text-ink">Kodu yenile</h3>
        <p className="m-0 text-14 text-ink">Kod yenilendiğinde eski kod ve link geçersiz olacak. Kodu yenilemek istiyor musunuz?</p>
        <div className="flex items-center gap-3 rounded-db border border-line bg-sunk px-4 py-3">
          <Icon name="warning" size={18} className="text-ink-3" />
          <div className="min-w-0">
            <span className="block text-12.5 text-ink-3">Geçersiz olacak</span>
            <b className="block break-all font-semibold tabular-nums tracking-[0.04em]">{invite.code}</b>
          </div>
        </div>
        {error && <Callout tone="bad" role="alert">{error}</Callout>}
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="ghost" disabled={busy} onClick={() => setConfirmRotate(false)}>Vazgeç</Button>
          <Button variant="primary" leftIcon="arrows-left-right" loading={busy} onClick={() => void rotate()}>Evet, kodu yenile</Button>
        </div>
      </div>
    );
  }

  const overview = capacity.status === 'success' ? capacity.overview : null;
  const usedPercent = overview && overview.effectiveLimit > 0 ? (overview.used / overview.effectiveLimit) * 100 : 0;

  return (
    <div className="flex flex-col gap-4" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2.5">
        <Badge tone={invite.isOpen ? 'ok' : 'warn'} dot>{invite.isOpen ? 'Yeni bağlantılar açık' : 'Yeni bağlantılar durduruldu'}</Badge>
      </div>
      <p id="client-invitation-description" className="m-0 -mt-1 text-13.5 text-ink-2">Danışanınız kodu mobil uygulamada girip bağlantıyı onayladığında takibi başlayabilir.</p>
      <div
        aria-label="Davet kodunuz"
        className={cx(
          'flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-db border border-line bg-sunk px-4 py-[18px] text-22 font-bold leading-none tracking-[0.08em] tabular-nums sm:text-24',
          !invite.isOpen && 'text-ink-3',
        )}
      >
        {segments.map((segment, index) => (
          <Fragment key={`${segment}-${index}`}>
            {index > 0 && <span aria-hidden="true" className="font-medium tracking-normal text-line-strong">-</span>}
            <b className="font-bold">{segment}</b>
          </Fragment>
        ))}
      </div>
      <div className="-mt-1 flex h-10 min-w-0 items-center gap-2.5 rounded-control border border-line-strong bg-surface px-[13px]">
        <Icon name="link" size={16} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate text-13 text-ink-2">{link}</span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
        <Button variant="secondary" leftIcon="copy" disabled={busy} onClick={() => void copy(invite.code, 'Kod')} fullWidth>Kodu kopyala</Button>
        <Button variant="secondary" leftIcon="link" disabled={busy} onClick={() => void copy(link, 'Link')} fullWidth>Linki kopyala</Button>
        <Button
          variant="secondary"
          leftIcon="qr-code"
          disabled={busy}
          fullWidth
          onClick={() => void run(async () => {
            const QRCode = await import('qrcode');
            const png = await QRCode.toDataURL(link, { width: 512, margin: 4, errorCorrectionLevel: 'M' });
            if (mounted.current) setQr(png);
          })}
        >
          QR oluştur
        </Button>
        <a href={inviteWhatsAppUrl(invite.code)} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: 'primary', fullWidth: true })}>
          <Icon name="whatsapp-logo" size={17} />
          WhatsApp’ta paylaş
        </a>
      </div>
      {message && <Callout tone="ok" role="status">{message}</Callout>}
      {error && <Callout tone="bad" role="alert">{error}</Callout>}
      {qr && (
        <div className="flex flex-col items-center gap-2 rounded-db border border-line p-4">
          <img src={qr} alt="Diyetisyen davet bağlantısı QR kodu" className="h-48 w-48" />
          <a href={qr} download="dietbridge-davet.png" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            <Icon name="download-simple" size={16} />
            QR PNG indir
          </a>
        </div>
      )}
      {overview ? (
        <div>
          <div className="flex flex-wrap items-center gap-3.5 text-13">
            <span className="text-ink-2">Kontenjan</span>
            <b className="tabular-nums">{overview.used} / {overview.effectiveLimit}</b>
            <ProgressBar
              value={usedPercent}
              tone={overview.limitReached ? 'bad' : usedPercent >= 80 ? 'warn' : 'brand'}
              label="Danışan kontenjanı"
              valueText={`${overview.used} / ${overview.effectiveLimit}`}
              className="max-w-[180px]"
            />
            <span className="ml-auto text-ink-2">Kalan</span>
            <b className="tabular-nums">{overview.remaining}</b>
          </div>
          <p className="sr-only">Kontenjan: {overview.used} / {overview.effectiveLimit} · Kalan: {overview.remaining}</p>
          <p className="m-0 mt-1.5 text-12 text-ink-3">Bekleyen e-posta istekleri kontenjana dahildir.</p>
        </div>
      ) : (
        <p className="m-0 flex items-center gap-2 text-13 text-ink-2">
          {capacity.status === 'loading' ? 'Kontenjan yükleniyor…' : 'Kontenjan okunamadı.'}
          {capacity.status !== 'loading' && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void reloadCapacity()}>Yenile</Button>}
        </p>
      )}
      <div className="h-px bg-line" />
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          variant={invite.isOpen ? 'secondary' : 'primary'}
          size="sm"
          leftIcon={invite.isOpen ? 'minus' : 'check'}
          disabled={busy}
          onClick={() => void run(async () => {
            const result = await setMyInviteCodeOpen(!invite.isOpen);
            if (mounted.current) setInvite(result);
          })}
        >
          {invite.isOpen ? 'Yeni bağlantıları durdur' : 'Yeni bağlantıları aç'}
        </Button>
        <Button variant="ghost" size="sm" leftIcon="arrows-left-right" disabled={busy} onClick={() => { setError(null); setMessage(null); setConfirmRotate(true); }}>Kodu yenile</Button>
      </div>
      <p className="m-0 -mt-2 text-12 text-ink-3">Kodu yenilemek veya bağlantıları durdurmak mevcut danışanlarınızı etkilemez.</p>
    </div>
  );
}
