import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, MessageSquare, Eye, MoreVertical, Calendar, TrendingUp, TrendingDown, Minus, RefreshCw, X, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DietitianAvatar from '../../../shared/components/DietitianAvatar';
import { Client } from '../../../shared/types';
import { fetchDietitianClientList, addClientByEmail, resolveClientIdByRelationId } from '../services/clientService';
import NotificationBell from '../../notifications/components/NotificationBell';

type ClientListViewState =
  | { status: 'loading' }
  | { status: 'success'; clients: Client[] }
  | { status: 'error'; message: string };

type ClientStatusFilter = 'all' | 'active' | 'pending';

const MODAL_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const normalizeClientSearchValue = (value: string | null | undefined) =>
  (value ?? '').trim().toLocaleLowerCase('tr-TR');

const compareClients = (left: Client, right: Client) => {
  const nameComparison = (left.name ?? '').localeCompare(right.name ?? '', 'tr-TR');
  if (nameComparison !== 0) return nameComparison;

  const emailComparison = (left.email ?? '').localeCompare(right.email ?? '', 'tr-TR');
  if (emailComparison !== 0) return emailComparison;

  return left.id.localeCompare(right.id);
};

const getClientInitials = (name: string) => {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('tr-TR'))
    .join('');

  return initials || '?';
};

const ClientAvatar: React.FC<{
  name: string;
  src: string | null | undefined;
  sizeClassName: string;
}> = ({ name, src, sizeClassName }) => {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  if (!src || imageFailed) {
    return (
      <div
        role="img"
        aria-label={`${name} profil fotoğrafı yok`}
        className={`${sizeClassName} flex shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700`}
      >
        {getClientInitials(name)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      onError={() => setImageFailed(true)}
      className={`${sizeClassName} shrink-0 rounded-full object-cover`}
    />
  );
};

// Desktop/Tablet Table Row Component
const ClientRow: React.FC<{ client: Client }> = ({ client }) => {
  const navigate = useNavigate();
  return (
    <tr 
      onClick={() => navigate(`/clients/${client.id}`)}
      className="hover:bg-slate-50 cursor-pointer transition-colors group bg-white"
    >
      <td className="px-6 py-4">
        <div className="flex items-center gap-4">
          <ClientAvatar
            name={client.name}
            src={client.profilePhotoUrl}
            sizeClassName="h-10 w-10 ring-2 ring-transparent transition-all group-hover:ring-primary/20"
          />
          <div>
            <p className="font-semibold text-slate-800">{client.name}</p>
            <p className="text-xs text-slate-500">{client.email}</p>
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
          client.status === 'Aktif' ? 'bg-emerald-100 text-emerald-700' : 
          client.status === 'Onay Bekliyor' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
        }`}>
          {client.status}
        </span>
      </td>
      <td className="px-6 py-4">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
          client.goal === 'Kilo Verme' ? 'bg-orange-100 text-orange-700' : 
          client.goal === 'Kas Kazanımı' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
        }`}>
          {client.goal}
        </span>
      </td>
      <td className="px-6 py-4 text-slate-600 font-medium">
        <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            {client.duration ?? 'Veri yok'}
        </div>
      </td>
      <td className="px-6 py-4 text-slate-800 font-semibold">{client.currentWeight}</td>
      <td className="px-6 py-4">
        {client.weeklyChange === null ? (
          <span className="inline-flex items-center gap-1 text-slate-400 bg-slate-50 px-2 py-1 rounded-md text-xs font-medium">
             Veri yok
          </span>
        ) : client.weeklyChange < 0 ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md text-xs font-bold">
            <TrendingDown className="w-3 h-3" />
            {Math.abs(client.weeklyChange)} kg
          </span>
        ) : client.weeklyChange > 0 ? (
          <span className="inline-flex items-center gap-1 text-orange-600 bg-orange-50 px-2 py-1 rounded-md text-xs font-bold">
            <TrendingUp className="w-3 h-3" />
            {client.weeklyChange} kg
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-slate-400 bg-slate-50 px-2 py-1 rounded-md text-xs font-bold">
             <Minus className="w-3 h-3" />
             0 kg
          </span>
        )}
      </td>
      <td className="px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${client.compliance > 80 ? 'bg-primary' : client.compliance > 70 ? 'bg-yellow-400' : 'bg-red-500'}`} 
                style={{ width: `${client.compliance}%` }}
              ></div>
            </div>
            <span className={`text-xs font-bold w-8 text-right ${client.compliance > 80 ? 'text-primary' : client.compliance > 70 ? 'text-yellow-500' : 'text-red-500'}`}>
              %{client.compliance}
            </span>
          </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button className="p-2 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded-full transition-colors">
              <MessageSquare className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate(`/clients/${client.id}`)}
              aria-label={`${client.name} danışan detayını görüntüle`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-400 hover:text-primary hover:bg-emerald-50 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
              <MoreVertical className="w-4 h-4" />
            </button>
        </div>
      </td>
    </tr>
  );
};

// Mobile Card Component
const ClientCard: React.FC<{ client: Client }> = ({ client }) => {
  const navigate = useNavigate();
  return (
    <div 
      onClick={() => navigate(`/clients/${client.id}`)}
      className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.99] group"
    >
      {/* Card Header */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <ClientAvatar
            name={client.name}
            src={client.profilePhotoUrl}
            sizeClassName="h-12 w-12 ring-2 ring-white shadow-sm"
          />
          <div>
            <h3 className="font-bold text-slate-800">{client.name}</h3>
            <p className="text-xs text-slate-500">{client.email}</p>
          </div>
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
          client.status === 'Aktif' ? 'bg-emerald-100 text-emerald-700' : 
          client.status === 'Onay Bekliyor' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
        }`}>
          {client.status}
        </span>
      </div>

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-50 p-3 rounded-lg">
           <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Hedef</p>
           <span className={`text-xs font-bold ${
             client.goal === 'Kilo Verme' ? 'text-orange-600' : 
             client.goal === 'Kas Kazanımı' ? 'text-blue-600' : 'text-purple-600'
           }`}>
             {client.goal}
           </span>
        </div>
        <div className="bg-slate-50 p-3 rounded-lg">
           <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Diyet Süresi</p>
           <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
             <Calendar className="w-3 h-3 text-slate-400" />
             {client.duration ?? 'Veri yok'}
           </div>
        </div>
        <div className="bg-slate-50 p-3 rounded-lg">
           <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Güncel Kilo</p>
           <p className="text-sm font-bold text-slate-800">{client.currentWeight}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-lg">
           <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Haftalık Değişim</p>
           {client.weeklyChange === null ? (
            <span className="text-xs font-medium text-slate-400">
                Veri yok
            </span>
            ) : client.weeklyChange < 0 ? (
            <span className="flex items-center gap-1 text-emerald-600 text-xs font-bold">
                <TrendingDown className="w-3 h-3" />
                {Math.abs(client.weeklyChange)} kg
            </span>
            ) : client.weeklyChange > 0 ? (
            <span className="flex items-center gap-1 text-orange-600 text-xs font-bold">
                <TrendingUp className="w-3 h-3" />
                {client.weeklyChange} kg
            </span>
            ) : (
            <span className="flex items-center gap-1 text-slate-400 text-xs font-bold">
                <Minus className="w-3 h-3" />
                0 kg
            </span>
            )}
        </div>
      </div>

      {/* Compliance */}
      <div className="flex items-center gap-3 mb-4">
        <p className="text-xs font-medium text-slate-400 w-10">Uyum</p>
        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${client.compliance > 80 ? 'bg-primary' : client.compliance > 70 ? 'bg-yellow-400' : 'bg-red-500'}`} 
            style={{ width: `${client.compliance}%` }}
          ></div>
        </div>
        <span className={`text-xs font-bold w-8 text-right ${client.compliance > 80 ? 'text-primary' : client.compliance > 70 ? 'text-yellow-500' : 'text-red-500'}`}>
          %{client.compliance}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-3">
         <p className="text-xs text-slate-400 font-medium">Hızlı İşlemler</p>
         <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button className="p-2 bg-slate-50 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded-lg transition-colors">
              <MessageSquare className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate(`/clients/${client.id}`)}
              aria-label={`${client.name} danışan detayını görüntüle`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center bg-slate-50 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Eye className="w-4 h-4" />
            </button>
         </div>
      </div>
    </div>
  );
};

const ClientsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const notificationRelationshipId = searchParams.get('notificationRelationshipId');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ClientStatusFilter>('all');
  const [viewState, setViewState] = useState<ClientListViewState>({ status: 'loading' });
  const requestSequence = useRef(0);
  const requestInFlight = useRef(false);
  const addRequestInFlight = useRef(false);
  const isMounted = useRef(true);
  const inviteButtonRef = useRef<HTMLButtonElement>(null);
  const inviteDialogRef = useRef<HTMLDivElement>(null);
  const inviteEmailInputRef = useRef<HTMLInputElement>(null);
  const wasAddModalOpen = useRef(false);
  const handledNotificationRelationshipRef = useRef<string | null>(null);

  // Add Client Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newClientEmail, setNewClientEmail] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addFeedback, setAddFeedback] = useState<{ type: 'success' | 'info' | 'error', message: string } | null>(null);

  const loadClients = useCallback(async (
    options: { showLoading?: boolean; preserveOnError?: boolean } = {}
  ): Promise<boolean> => {
    const { showLoading = true, preserveOnError = false } = options;
    if (requestInFlight.current) return false;

    requestInFlight.current = true;
    const requestId = ++requestSequence.current;
    if (showLoading) setViewState({ status: 'loading' });

    try {
      const result = await fetchDietitianClientList();
      if (!isMounted.current || requestId !== requestSequence.current) return false;

      if (result.status === 'error') {
        if (!preserveOnError) {
          setViewState({ status: 'error', message: result.userMessage });
        }
        return false;
      }

      setViewState({ status: 'success', clients: result.clients });
      return true;
    } finally {
      if (requestId === requestSequence.current) {
        requestInFlight.current = false;
      }
    }
  }, []);

  // Load clients from Supabase on mount
  useEffect(() => {
    isMounted.current = true;
    void loadClients();

    return () => {
      isMounted.current = false;
      requestSequence.current += 1;
      requestInFlight.current = false;
    };
  }, [loadClients]);

  useEffect(() => {
    if (
      !notificationRelationshipId
      || viewState.status !== 'success'
      || handledNotificationRelationshipRef.current === notificationRelationshipId
    ) {
      return undefined;
    }

    handledNotificationRelationshipRef.current = notificationRelationshipId;
    let active = true;
    void resolveClientIdByRelationId(notificationRelationshipId)
      .then((clientId) => {
        if (!active) return;
        if (clientId) {
          navigate(`/clients/${clientId}`, { replace: true });
          return;
        }
        setSearchParams({}, { replace: true });
      })
      .catch(() => {
        if (active) setSearchParams({}, { replace: true });
      });

    return () => {
      active = false;
    };
  }, [navigate, notificationRelationshipId, setSearchParams, viewState.status]);

  const openAddModal = () => {
    setIsAddModalOpen(true);
    setAddFeedback(null);
    setNewClientEmail('');
  };

  const closeAddModal = useCallback(() => {
    if (isAdding || addRequestInFlight.current) return;

    addRequestInFlight.current = false;
    setIsAdding(false);
    setIsAddModalOpen(false);
    setNewClientEmail('');
    setAddFeedback(null);
  }, [isAdding]);

  useEffect(() => {
    if (isAddModalOpen) {
      wasAddModalOpen.current = true;
      const focusFrame = window.requestAnimationFrame(() => {
        const focusTarget = inviteEmailInputRef.current?.disabled
          ? inviteDialogRef.current
          : inviteEmailInputRef.current;

        if (focusTarget && document.activeElement !== focusTarget) {
          focusTarget.focus();
        }
      });

      return () => window.cancelAnimationFrame(focusFrame);
    }

    if (!wasAddModalOpen.current) return;
    wasAddModalOpen.current = false;

    const returnFocusFrame = window.requestAnimationFrame(() => {
      if (isMounted.current) inviteButtonRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(returnFocusFrame);
  }, [isAddModalOpen]);

  useEffect(() => {
    if (!isAddModalOpen) return;

    const handleModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeAddModal();
        return;
      }

      if (event.key !== 'Tab') return;

      const dialog = inviteDialogRef.current;
      if (!dialog) return;

      const focusableElements = [
        ...dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR),
      ].filter((element) => (
        element.getAttribute('aria-hidden') !== 'true'
        && element.getClientRects().length > 0
      ));

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const activeElement = document.activeElement;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeIndex = activeElement instanceof HTMLElement
        ? focusableElements.indexOf(activeElement)
        : -1;

      if (!dialog.contains(activeElement) || activeIndex === -1) {
        event.preventDefault();
        firstElement.focus();
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleModalKeyDown);
    return () => document.removeEventListener('keydown', handleModalKeyDown);
  }, [closeAddModal, isAddModalOpen]);

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addRequestInFlight.current) return;

    if (!newClientEmail.trim()) {
      setAddFeedback({ type: 'error', message: 'Lütfen geçerli bir e-posta adresi giriniz.' });
      return;
    }

    addRequestInFlight.current = true;
    setIsAdding(true);
    setAddFeedback(null);

    try {
      const result = await addClientByEmail(newClientEmail.trim());
      if (!isMounted.current) return;
      
      switch (result.status) {
        case 'requested': {
          setNewClientEmail('');
          const refreshed = await loadClients({ showLoading: false, preserveOnError: true });
          if (!isMounted.current) return;
          setAddFeedback({
            type: 'success',
            message: refreshed
              ? 'Bağlantı isteği gönderildi. Danışan isteği mobil uygulamadan kabul ettiğinde aktif danışanlarınız arasında görünecektir.'
              : 'Bağlantı isteği gönderildi. Liste şu anda yenilenemedi; mevcut arama ve filtrelerinizi koruyarak daha sonra tekrar deneyebilirsiniz.',
          });
          break;
        }
        case 'already_pending':
          setAddFeedback({ type: 'info', message: 'Bu danışana daha önce bağlantı isteği gönderilmiş. Danışanın mobil uygulamadan yanıt vermesi bekleniyor.' });
          break;
        case 'already_active':
          setAddFeedback({ type: 'info', message: 'Bu danışan zaten aktif danışanlarınız arasında.' });
          break;
        case 'limit_reached':
          setAddFeedback({ type: 'error', message: 'Danışan limitinize ulaştınız. Yeni danışan eklemek için planınızı yükseltin veya mevcut bir danışan bağlantısını kaldırın.' });
          break;
        case 'unavailable':
          setAddFeedback({ type: 'error', message: 'Bu e-posta ile bağlantı isteği gönderilemedi. Danışanın DietBridge mobil uygulamasında kayıtlı olduğundan ve bağlantı için uygun olduğundan emin olun.' });
          break;
        case 'error':
          setAddFeedback({ type: 'error', message: 'Bağlantı isteği gönderilemedi. Lütfen e-posta adresini kontrol edip tekrar deneyin.' });
          break;
      }
    } catch {
      if (isMounted.current) {
        setAddFeedback({ type: 'error', message: 'Bağlantı isteği gönderilemedi. Lütfen tekrar deneyin.' });
      }
    } finally {
      addRequestInFlight.current = false;
      if (isMounted.current) setIsAdding(false);
    }
  };

  const clientSource = viewState.status === 'success' ? viewState.clients : null;
  const normalizedSearchTerm = normalizeClientSearchValue(searchTerm);
  const { supportedClients, statusFilteredClients, filteredClients } = useMemo(() => {
    const supported = (clientSource ?? []).filter(
      client => client.status === 'Aktif' || client.status === 'Onay Bekliyor'
    );
    const statusFiltered = supported.filter(client => {
      if (statusFilter === 'active') return client.status === 'Aktif';
      if (statusFilter === 'pending') return client.status === 'Onay Bekliyor';
      return true;
    });
    const searched = statusFiltered.filter(client => {
      if (!normalizedSearchTerm) return true;

      return (
        normalizeClientSearchValue(client.name).includes(normalizedSearchTerm) ||
        normalizeClientSearchValue(client.email).includes(normalizedSearchTerm)
      );
    });

    return {
      supportedClients: supported,
      statusFilteredClients: statusFiltered,
      filteredClients: [...searched].sort(compareClients),
    };
  }, [clientSource, normalizedSearchTerm, statusFilter]);

  const activeClients = filteredClients.filter(c => c.status === 'Aktif');
  const pendingClients = filteredClients.filter(c => c.status === 'Onay Bekliyor');

  return (
    <div className="min-h-screen w-full min-w-0 max-w-full overflow-x-hidden p-4 md:h-screen md:max-w-7xl md:p-8 mx-auto flex flex-col">
       {/* Responsive Header */}
       <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-4 flex-shrink-0">
        <div className="w-full md:w-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Danışan Listesi</h1>
            <p className="text-slate-500 mt-1 text-sm md:text-base">Danışan ilerlemesini yönetin.</p>
          </div>
          {/* Mobile Profile Pic (visible only on small screens) */}
          <div className="md:hidden">
             <button onClick={() => navigate('/profile')} className="focus:outline-none hover:opacity-80 transition-opacity p-0 border-0 bg-transparent cursor-pointer rounded-full" aria-label="Profil sayfasına git" role="button">
             <DietitianAvatar alt="Profil" className="w-10 h-10 rounded-full border border-slate-200 object-cover" />
          </button>
          </div>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button 
            ref={inviteButtonRef}
            onClick={openAddModal}
            className="flex-1 md:flex-none justify-center items-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl font-medium shadow-sm transition-all active:scale-95 text-sm md:text-base flex"
          >
             <Plus className="w-5 h-5" />
             <span className="md:inline">Danışan Davet Et</span>
          </button>
          
          <div className="hidden md:block w-px h-8 bg-slate-200 mx-2"></div>
          
          <NotificationBell className="hidden md:inline-flex" />
          
          <button onClick={() => navigate('/profile')} className="focus:outline-none hover:opacity-80 transition-opacity p-0 border-0 bg-transparent cursor-pointer rounded-full" aria-label="Profil sayfasına git" role="button">
            <DietitianAvatar
              alt="Profil"
              className="hidden md:block w-10 h-10 rounded-full border border-slate-200 object-cover"
            />
          </button>
        </div>
      </header>

      {/* Table/Card Container */}
      <div className="bg-transparent md:bg-white rounded-none md:rounded-2xl shadow-none md:shadow-sm border-0 md:border border-slate-200 overflow-hidden flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="p-0 md:p-4 mb-4 md:mb-0 md:border-b border-slate-200 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 bg-transparent md:bg-white rounded-xl md:rounded-none">
             <div className="relative w-full md:w-auto">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                 <input
                   type="text"
                   placeholder="İsim veya e-postaya göre ara..."
                   aria-label="Danışan adı veya e-postasıyla ara"
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                   className="w-full md:w-64 pl-9 pr-4 py-3 md:py-2 rounded-xl md:rounded-lg border border-slate-200 bg-white md:bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm transition-all shadow-sm md:shadow-none"
                 />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                 <button className="flex-1 md:flex-none whitespace-nowrap px-4 py-2.5 md:py-2 text-sm font-medium text-slate-600 bg-white md:bg-slate-50 rounded-xl md:rounded-lg border border-slate-200 hover:bg-slate-50 shadow-sm md:shadow-none">Dışa Aktar</button>
                 <div
                   className="flex w-full sm:w-auto gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white md:bg-slate-50 p-1 shadow-sm md:shadow-none"
                   role="group"
                   aria-label="Danışan durum filtresi"
                 >
                   {([
                     ['all', 'Tümü'],
                     ['active', 'Aktif'],
                     ['pending', 'Bekleyen'],
                   ] as const).map(([value, label]) => (
                     <button
                       key={value}
                       type="button"
                       aria-pressed={statusFilter === value}
                       onClick={() => setStatusFilter(value)}
                       className={`flex-1 sm:flex-none whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                         statusFilter === value
                           ? 'bg-primary text-white shadow-sm'
                           : 'text-slate-600 hover:bg-slate-100'
                       }`}
                     >
                       {label}
                     </button>
                   ))}
                 </div>
              </div>
        </div>
        
        {/* Scrollable Content Area */}
        <div className="overflow-visible md:overflow-auto flex-1">
          {viewState.status === 'loading' ? (
             <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
                <RefreshCw className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm font-medium">Danışanlar yükleniyor...</p>
             </div>
          ) : viewState.status === 'error' ? (
             <div className="flex flex-col items-center justify-center py-16 px-4 text-center" role="alert">
                <div className="bg-red-50 p-4 rounded-full mb-4">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">Danışanlar yüklenemedi</h3>
                <p className="text-sm text-slate-500 max-w-md">{viewState.message}</p>
                <button
                  type="button"
                  onClick={() => void loadClients()}
                  className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Tekrar Dene
                </button>
             </div>
          ) : supportedClients.length === 0 ? (
             <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <div className="bg-slate-50 p-4 rounded-full mb-4">
                  <Search className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">Henüz danışanınız bulunmuyor.</h3>
                 <p className="text-sm text-slate-500">İlk bağlantı isteğinizi gönderdiğinizde burada görünecek.</p>
             </div>
          ) : statusFilteredClients.length === 0 ? (
             <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-slate-500">
                <div className="bg-slate-50 p-4 rounded-full mb-4">
                  <Search className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">
                  {statusFilter === 'active'
                    ? 'Aktif danışan bulunmuyor.'
                    : 'Bekleyen danışan bulunmuyor.'}
                </h3>
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className="mt-4 text-primary font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                >
                  Tümünü Göster
                </button>
             </div>
          ) : filteredClients.length === 0 ? (
             <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-slate-500">
                <div className="bg-slate-50 p-4 rounded-full mb-4">
                  <Search className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">Uygun danışan bulunamadı</h3>
                <p className="text-sm text-slate-500">Aramanızla eşleşen danışan bulunamadı.</p>
                {normalizedSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="mt-4 text-primary font-medium hover:underline"
                  >
                    Aramayı Temizle
                  </button>
                )}
             </div>
          ) : (
            <>
              {/* Desktop Table */}
              <table className="w-full text-left text-sm hidden md:table">
                <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">İsim</th>
                    <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Durum</th>
                    <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Hedef</th>
                    <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Diyet Süresi</th>
                    <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Güncel Kilo</th>
                    <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs">Haftalık Değişim</th>
                    <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs w-48">Uyum</th>
                    <th className="px-6 py-4 font-semibold text-slate-500 uppercase tracking-wider text-xs text-center">İşlemler</th>
                  </tr>
                </thead>
                
                <tbody className="divide-y divide-slate-100 bg-white">
                  {activeClients.map((client) => (
                    <ClientRow key={client.id} client={client} />
                  ))}
                </tbody>

                {pendingClients.length > 0 && (
                  <tbody className="divide-y divide-slate-100 bg-amber-50/30 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={8} className="px-6 py-3 bg-amber-50/50 border-b border-slate-200">
                        <p className="text-xs font-bold text-amber-600 uppercase tracking-wider flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          Onay Bekleyenler
                        </p>
                      </td>
                    </tr>
                    {pendingClients.map((client) => (
                      <ClientRow key={client.id} client={client} />
                    ))}
                  </tbody>
                )}

              </table>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-4 pb-4">
                {activeClients.map((client) => (
                  <ClientCard key={client.id} client={client} />
                ))}
                
                {pendingClients.length > 0 && (
                    <div className="pt-4">
                      <div className="flex items-center gap-2 mb-3 px-1">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          <p className="text-xs font-bold text-amber-600 uppercase tracking-wider">Onay Bekleyenler</p>
                      </div>
                      <div className="space-y-4">
                          {pendingClients.map((client) => (
                            <ClientCard key={client.id} client={client} />
                          ))}
                      </div>
                    </div>
                )}

              </div>
            </>
          )}
        </div>
      </div>

      {/* Add Client Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            ref={inviteDialogRef}
            className="bg-white rounded-2xl w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto shadow-2xl animate-in fade-in zoom-in duration-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-invitation-title"
            aria-describedby="client-invitation-description"
            tabIndex={-1}
          >
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
               <h2 id="client-invitation-title" className="text-xl font-bold text-slate-800">Danışana Bağlantı İsteği Gönder</h2>
               <button 
                 type="button"
                 onClick={closeAddModal}
                 aria-label="Bağlantı isteği penceresini kapat"
                 className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                 disabled={isAdding}
               >
                  <X className="w-5 h-5" />
               </button>
            </div>
            
            <form onSubmit={handleAddClient} className="p-6 space-y-5">
               <div className="space-y-1.5">
                  <label htmlFor="client-invitation-email" className="text-sm font-bold text-slate-700">Danışanın kayıtlı e-posta adresi</label>
                  <p id="client-invitation-description" className="text-xs text-slate-500 mb-2">Yalnız DietBridge mobil uygulamasında kayıtlı danışanlara bağlantı isteği gönderebilirsiniz. Danışan isteği mobil uygulamadan kabul ettiğinde bağlantı aktif olur.</p>
                  <input 
                    ref={inviteEmailInputRef}
                    id="client-invitation-email"
                    type="email"
                    required
                    placeholder="ornek@email.com"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                    disabled={isAdding}
                    autoFocus
                    aria-describedby="client-invitation-description"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
                  />
               </div>

               {addFeedback && (
                 <div
                   role={addFeedback.type === 'error' ? 'alert' : 'status'}
                   className={`p-4 rounded-xl flex items-start gap-3 text-sm ${
                     addFeedback.type === 'success'
                       ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                       : addFeedback.type === 'info'
                         ? 'bg-blue-50 text-blue-700 border border-blue-100'
                         : 'bg-red-50 text-red-700 border border-red-100'
                   }`}
                 >
                   {addFeedback.type === 'success' ? (
                     <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                   ) : addFeedback.type === 'info' ? (
                     <Info className="w-5 h-5 shrink-0 mt-0.5" />
                   ) : (
                     <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                   )}
                   <p className="min-w-0 break-words font-medium leading-relaxed">{addFeedback.message}</p>
                 </div>
               )}

               <div className="pt-2 flex flex-col sm:flex-row gap-3">
                  <button 
                    type="button" 
                    onClick={closeAddModal}
                    disabled={isAdding}
                    className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl border border-slate-200 transition-colors text-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                     İptal
                  </button>
                  <button 
                    type="submit"
                    disabled={isAdding || !newClientEmail.trim()}
                    className="flex-1 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/30 hover:bg-primary-dark transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
                  >
                     {isAdding ? (
                       <>
                         <RefreshCw className="w-4 h-4 animate-spin" />
                         Gönderiliyor...
                       </>
                     ) : (
                       'Bağlantı İsteği Gönder'
                     )}
                  </button>
               </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientsPage;
