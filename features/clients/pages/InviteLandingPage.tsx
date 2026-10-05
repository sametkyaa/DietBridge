import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { normalizeInviteCode } from '../utils/inviteCode';

export default function InviteLandingPage() {
  const { code: input } = useParams();
  const code = normalizeInviteCode(input);
  const [message, setMessage] = useState<string | null>(null);
  return <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><section className="w-full max-w-md bg-white rounded-2xl p-6 space-y-5 shadow-sm">
    <h1 className="text-2xl font-bold">DietBridge daveti</h1>
    {!code ? <p role="alert">Davet bağlantısı geçerli değil. Diyetisyeninizden yeni bağlantı isteyin.</p> : <>
      <p>Diyetisyeninize bağlanmak için DietBridge mobil uygulamasını açın. Giriş yaptıktan sonra diyetisyen bilgilerini inceleyip bağlantıyı onaylayabilirsiniz.</p>
      <p className="font-mono text-lg break-all">{code}</p>
      <a href={`dietbridge://davet/${code}`} className="block rounded-xl bg-primary p-3 text-center text-white font-semibold">Mobil uygulamada aç</a>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setMessage('Kod kopyalandı.'); } catch { setMessage('Kod kopyalanamadı. Kodu mobil uygulamada elle girebilirsiniz.'); } }} className="w-full rounded-xl border p-3">Kodu kopyala</button>
      <p className="text-sm text-slate-500">Uygulama yüklü değilse mağazadan DietBridge’i yükleyip bu kodu girin.</p>
      {message && <p role="status">{message}</p>}
    </>}
  </section></main>;
}
