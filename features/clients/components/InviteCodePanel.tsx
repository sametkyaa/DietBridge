import { useCallback, useEffect, useRef, useState } from 'react';
import { getMyInviteCode, rotateMyInviteCode, setMyInviteCodeOpen, type DietitianInviteCode } from '../services/inviteCodeService';
import { inviteUrl, inviteWhatsAppUrl } from '../utils/inviteCode';
import { useSubscriptionOverview } from '../../subscriptions/hooks/useSubscriptionOverview';

export default function InviteCodePanel({ onBusyChange }: { onBusyChange: (value: boolean) => void }) {
  const [invite, setInvite] = useState<DietitianInviteCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
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
  const copy = (value: string) => run(async () => {
    await navigator.clipboard.writeText(value);
    if (mounted.current) setMessage('Kopyalandı.');
  });
  const rotate = () => {
    if (!window.confirm('Kod yenilendiğinde eski kod ve link geçersiz olacak. Kodu yenilemek istiyor musunuz?')) return;
    void run(async () => {
      const result = await rotateMyInviteCode();
      if (mounted.current) { setInvite(result); setQr(null); setMessage('Davet kodunuz yenilendi.'); }
    });
  };
  return (
    <div className="p-6 space-y-4" aria-busy={busy}>
      <p id="client-invitation-description" className="text-sm text-slate-500">Danışanınız kodu mobil uygulamada girip bağlantıyı onayladığında takibi başlayabilir.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      {!invite ? <button type="button" disabled={busy} onClick={() => void load()} className="text-primary font-semibold">{busy ? 'Davet kodu yükleniyor…' : 'Tekrar dene'}</button> : <>
        <p className="rounded-xl bg-slate-50 p-4 text-center font-mono text-xl font-bold tracking-wide break-all" aria-label="Davet kodunuz">{invite.code}</p>
        <p className="text-sm text-slate-600">{invite.isOpen ? 'Yeni bağlantılar açık.' : 'Yeni bağlantılar durduruldu.'}</p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={() => void copy(invite.code)} className="rounded-xl border p-2 text-sm font-semibold">Kodu kopyala</button>
          <button type="button" disabled={busy} onClick={() => void copy(inviteUrl(invite.code))} className="rounded-xl border p-2 text-sm font-semibold">Linki kopyala</button>
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            const QRCode = await import('qrcode');
            const png = await QRCode.toDataURL(inviteUrl(invite.code), { width: 512, margin: 4, errorCorrectionLevel: 'M' });
            if (mounted.current) setQr(png);
          })} className="rounded-xl border p-2 text-sm font-semibold">QR oluştur</button>
          <a href={inviteWhatsAppUrl(invite.code)} target="_blank" rel="noopener noreferrer" className="rounded-xl border p-2 text-center text-sm font-semibold">WhatsApp’ta paylaş</a>
        </div>
        {qr && <div className="text-center"><img src={qr} alt="Diyetisyen davet bağlantısı QR kodu" className="mx-auto w-48 h-48" /><a href={qr} download="dietbridge-davet.png" className="text-primary text-sm font-semibold">QR PNG indir</a></div>}
        {capacity.status === 'success' ? <p className="text-sm text-slate-600">Kontenjan: {capacity.overview.used} / {capacity.overview.effectiveLimit} · Kalan: {capacity.overview.remaining} <span className="block text-xs">Bekleyen e-posta istekleri kontenjana dahildir.</span></p> : <p className="text-sm text-slate-500">{capacity.status === 'loading' ? 'Kontenjan yükleniyor…' : 'Kontenjan okunamadı.'} <button type="button" disabled={busy} onClick={() => void reloadCapacity()}>Yenile</button></p>}
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          const result = await setMyInviteCodeOpen(!invite.isOpen);
          if (mounted.current) setInvite(result);
        })} className="w-full rounded-xl border p-3 text-sm font-semibold">{invite.isOpen ? 'Yeni bağlantıları durdur' : 'Yeni bağlantıları aç'}</button>
        <button type="button" disabled={busy} onClick={rotate} className="w-full text-sm text-slate-600">Kodu yenile</button>
        <p className="text-xs text-slate-500">Kodu yenilemek veya bağlantıları durdurmak mevcut danışanlarınızı etkilemez.</p>
      </>}
    </div>
  );
}
