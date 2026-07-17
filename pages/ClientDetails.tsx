import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, MapPin, Phone, Calendar, Weight, Activity, TrendingUp, TrendingDown, Droplets, Utensils, FileText, HeartPulse, Pill, Moon, Coffee, Stethoscope, Clock, Trash2 } from 'lucide-react';
import { fetchClientDetails, removeClient, fetchClientMeasurements, fetchClientDailyLogs, Measurement, DailyLog, PendingClientSummary, ActiveClientDetails } from '../features/clients/services/clientService';
import { supabase } from '../lib/supabaseClient';
import { isValidUuid } from '../shared/utils/uuid';


const ProfileAvatarFallback = ({ name, className }: { name: string, className?: string }) => {
  const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  return (
    <div className={`flex items-center justify-center bg-slate-200 text-slate-500 font-bold ${className}`}>
      {initials}
    </div>
  );
};

type ClientDetailsViewState =
  | { status: 'loading' }
  | { status: 'active'; client: ActiveClientDetails }
  | { status: 'pending'; client: PendingClientSummary }
  | { status: 'invalid_id' }
  | { status: 'unavailable' }
  | { status: 'error'; userMessage: string };

const CLIENT_DETAIL_LOAD_ERROR =
  'Danışan bilgileri şu anda yüklenemiyor. Lütfen tekrar deneyin.';

const ClientDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const routeClientId = isValidUuid(id) ? id : null;
  const [viewState, setViewState] = useState<ClientDetailsViewState>({ status: 'loading' });
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [isRemoving, setIsRemoving] = useState(false);
  const [profileImageError, setProfileImageError] = useState(false);
  const requestSequence = useRef(0);
  const isMounted = useRef(true);

  const loadData = useCallback(async (showLoading: boolean) => {
    const requestId = ++requestSequence.current;

    if (showLoading) {
      setViewState({ status: 'loading' });
      setMeasurements([]);
      setDailyLogs([]);
    }

    if (!routeClientId) {
      if (requestId === requestSequence.current) {
        setMeasurements([]);
        setDailyLogs([]);
        setViewState({ status: 'invalid_id' });
      }
      return;
    }

    try {
      const accessResult = await fetchClientDetails(routeClientId);
      if (requestId !== requestSequence.current) return;

      switch (accessResult.status) {
        case 'invalid_id':
          setMeasurements([]);
          setDailyLogs([]);
          setViewState({ status: 'invalid_id' });
          return;
        case 'unavailable':
          setMeasurements([]);
          setDailyLogs([]);
          setViewState({ status: 'unavailable' });
          return;
        case 'error':
          setMeasurements([]);
          setDailyLogs([]);
          setViewState({ status: 'error', userMessage: accessResult.userMessage });
          return;
        case 'pending':
          setMeasurements([]);
          setDailyLogs([]);
          setViewState({ status: 'pending', client: accessResult.client });
          return;
        case 'active': {
          const [measurementsData, logsData] = await Promise.all([
            fetchClientMeasurements(routeClientId),
            fetchClientDailyLogs(routeClientId),
          ]);

          if (requestId !== requestSequence.current) return;
          setMeasurements(measurementsData);
          setDailyLogs(logsData);
          setViewState({ status: 'active', client: accessResult.client });
          return;
        }
      }
    } catch {
      if (requestId !== requestSequence.current) return;
      setMeasurements([]);
      setDailyLogs([]);
      setViewState({ status: 'error', userMessage: CLIENT_DETAIL_LOAD_ERROR });
    }
  }, [routeClientId]);

  const displayedClient =
    viewState.status === 'active' || viewState.status === 'pending'
      ? viewState.client
      : null;

  useEffect(() => {
    setProfileImageError(false);
  }, [displayedClient?.id, displayedClient?.profilePhotoUrl]);

  useEffect(() => {
    isMounted.current = true;
    void loadData(true);

    return () => {
      isMounted.current = false;
      requestSequence.current += 1;
    };
  }, [loadData]);

  const activeClientId = viewState.status === 'active' ? viewState.client.id : null;

  useEffect(() => {
    if (!routeClientId || activeClientId !== routeClientId) return;

    let mounted = true;
    const refreshActiveClient = () => {
      if (mounted) void loadData(false);
    };

    window.addEventListener('focus', refreshActiveClient);

    const profilesSub = supabase
      .channel(`client_detail_changes_${activeClientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_profiles', filter: `user_id=eq.${routeClientId}` }, () => {
        refreshActiveClient();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${routeClientId}` }, () => {
        refreshActiveClient();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'measurements', filter: `client_id=eq.${routeClientId}` }, () => {
        refreshActiveClient();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_logs', filter: `client_id=eq.${routeClientId}` }, () => {
        refreshActiveClient();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dietitian_clients', filter: `client_id=eq.${routeClientId}` }, () => {
        refreshActiveClient();
      })
      .subscribe();

    return () => {
      mounted = false;
      window.removeEventListener('focus', refreshActiveClient);
      void supabase.removeChannel(profilesSub);
    };
  }, [activeClientId, loadData, routeClientId]);

  const loadingView = (
    <div className="p-8 flex items-center justify-center h-full min-h-screen">
      <div className="text-center text-slate-500">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          Yükleniyor...
      </div>
    </div>
  );

  if (
    viewState.status === 'loading' ||
    ((viewState.status === 'active' || viewState.status === 'pending') &&
      viewState.client.id !== routeClientId)
  ) {
    return loadingView;
  }

  if (!routeClientId || viewState.status === 'invalid_id') {
    return (
      <div className="p-8 flex items-center justify-center h-full min-h-screen">
        <div className="text-center max-w-md">
            <h2 className="text-2xl font-bold text-slate-800">Geçersiz Danışan Bağlantısı</h2>
            <p className="mt-2 text-slate-500">Danışanı görüntülemek için lütfen danışan listesinden tekrar seçim yapın.</p>
            <button onClick={() => navigate('/clients')} className="mt-4 text-primary font-medium hover:underline">Listeye Dön</button>
        </div>
      </div>
    );
  }

  if (viewState.status === 'unavailable') {
    return (
      <div className="p-8 flex items-center justify-center h-full min-h-screen">
        <div className="text-center max-w-md">
            <h2 className="text-2xl font-bold text-slate-800">Danışana Erişilemiyor</h2>
            <p className="mt-2 text-slate-500">Bu danışana erişilemiyor veya danışan bulunamadı.</p>
            <button onClick={() => navigate('/clients')} className="mt-4 text-primary font-medium hover:underline">Listeye Dön</button>
        </div>
      </div>
    );
  }

  if (viewState.status === 'error') {
    return (
      <div className="p-8 flex items-center justify-center h-full min-h-screen">
        <div className="text-center max-w-md">
            <h2 className="text-2xl font-bold text-slate-800">Danışan Bilgileri Yüklenemedi</h2>
            <p className="mt-2 text-slate-500">{viewState.userMessage}</p>
            <div className="mt-4 flex items-center justify-center gap-4">
              <button onClick={() => void loadData(true)} className="text-primary font-medium hover:underline">Tekrar Dene</button>
              <button onClick={() => navigate('/clients')} className="text-slate-500 font-medium hover:underline">Listeye Dön</button>
            </div>
        </div>
      </div>
    );
  }

  const handleRemoveClient = async (relationId: string) => {
    if (window.confirm('Bu danışanı listenizden kaldırmak istediğinize emin misiniz?')) {
      setIsRemoving(true);
      const result = await removeClient(relationId);
      if (!isMounted.current) return;

      setIsRemoving(false);
      if (result.status === 'removed') {
        alert('Danışan bağlantısı kaldırıldı.');
        navigate('/clients');
      } else {
        alert('Bağlantı kaldırılamadı. İlişki artık mevcut olmayabilir veya bu işlem için yetkiniz bulunmuyor.');
      }
    }
  };

  if (viewState.status === 'pending') {
    const client = viewState.client;
    return (
      <div className="w-full min-w-0 max-w-7xl mx-auto min-h-screen p-4 sm:p-6 lg:p-8">
        <button 
          onClick={() => navigate('/clients')}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 text-slate-500 hover:text-primary transition-colors mb-6 rounded-lg font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <ArrowLeft className="w-5 h-5" />
          Listeye Dön
        </button>
        <div className="w-full min-w-0 bg-white rounded-3xl p-4 sm:p-8 shadow-sm border border-slate-100 relative overflow-hidden">
           <div className="min-w-0 flex flex-col md:flex-row gap-8 relative z-10 items-center md:items-start">
              <div className="flex-shrink-0">
                  {client.profilePhotoUrl && !profileImageError ? (
                  <img 
                    src={client.profilePhotoUrl} 
                    alt="" 
                      className="w-32 h-32 rounded-full object-cover border-4 border-slate-100 shadow-sm opacity-60 grayscale" 
                      onError={() => setProfileImageError(true)}
                    />
                  ) : (
                    <ProfileAvatarFallback name={client.name} className="w-32 h-32 rounded-full border-4 border-slate-100 shadow-sm opacity-60 grayscale text-3xl" />
                  )}
              </div>
              <div className="min-w-0 flex-1 text-center md:text-left">
                 <h1 className="text-3xl font-bold text-slate-800 mb-2 break-words [overflow-wrap:anywhere]">{client.name}</h1>
                 <p className="text-slate-500 flex items-center justify-center md:justify-start gap-2 mb-6">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    Onay Bekleyen Danışan
                 </p>
                 <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-8 justify-center md:justify-start">
                     <div className="flex min-w-0 max-w-full items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl">
                         <Mail className="w-4 h-4 shrink-0 text-slate-400" />
                         <span className="min-w-0 break-words [overflow-wrap:anywhere]">{client.email}</span>
                     </div>
                 </div>
                 <div className="p-5 bg-amber-50 text-amber-800 rounded-2xl border border-amber-200/50 flex flex-col md:flex-row items-center md:items-start gap-4">
                    <div className="p-3 bg-amber-100 rounded-full shrink-0">
                      <Clock className="w-6 h-6 text-amber-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold mb-1">Bağlantı İsteği Bekleniyor</h4>
                      <p className="text-sm opacity-90 break-words [overflow-wrap:anywhere]">Bu danışan henüz bağlantı isteğinizi onaylamadı. Danışanınız mobil uygulama üzerinden isteği onayladığında yemek planı oluşturma, ölçüm takibi ve mesajlaşma gibi özellikler aktif olacaktır.</p>
                    </div>
                 </div>
                 <div className="mt-8 flex justify-center md:justify-start">
                    <button 
                      onClick={() => handleRemoveClient(client.relationId)}
                      disabled={isRemoving}
                      className="min-h-11 min-w-11 px-4 py-2 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                        <Trash2 className="w-4 h-4" />
                        İsteği İptal Et
                    </button>
                 </div>
              </div>
           </div>
        </div>
      </div>
    );
  }

  const client = viewState.client;
  const smokingStatusLabel = client.smokingStatus === null
    ? 'Yok'
    : client.smokingStatus
      ? 'Kullanıyor'
      : 'Kullanmıyor';
  const alcoholStatusLabel = client.alcoholStatus
    || (client.alcoholUse === null
      ? 'Yok'
      : client.alcoholUse
        ? 'Tüketiyor'
        : 'Tüketmiyor');

  const handleEditPlan = () => {
    navigate('/meal-plans', { state: { clientId: client.id } });
  };

  // Calculate Data
  const currentWeightNum = parseFloat(client.currentWeight) || 0;
  const startWeight = client.startWeight ? parseFloat(client.startWeight) : currentWeightNum;
  const heightM = client.heightCm ? client.heightCm / 100 : 0;
  const bmi = heightM > 0 ? (currentWeightNum / (heightM * heightM)).toFixed(1) : '-';

  // Format Weight History
  const weightHistory = measurements.length > 0 
    ? measurements.slice(-8).map(m => {
        const d = new Date(m.measured_at || m.created_at);
        return {
          date: `${d.getDate()} ${d.toLocaleString('tr-TR', { month: 'short' })}`,
          weight: m.weight
        };
      })
    : [{ date: 'Veri Yok', weight: currentWeightNum }];
  
  const currentW = weightHistory[weightHistory.length - 1].weight;
  const previousWeight = weightHistory.length > 1 ? weightHistory[weightHistory.length - 2].weight : currentW;
  const weeklyChange = (currentW - previousWeight).toFixed(1);
  const isWeightLoss = parseFloat(weeklyChange) <= 0;

  // Format Water Data
  const recentLogs = dailyLogs.slice(-7);
  const waterTarget = client.waterGoalLiters ?? null;
  const recordedWaterValues = recentLogs
    .map(log => log.water_intake)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const hasDailyLogs = recentLogs.length > 0;
  const hasWaterData = recordedWaterValues.length > 0;
  const waterAvg = hasWaterData
    ? (recordedWaterValues.reduce((sum, value) => sum + value, 0) / recordedWaterValues.length / 1000).toFixed(1)
    : null;
  const waterAverageLabel = recordedWaterValues.length === 1
    ? 'Son Kayıt'
    : `Son ${recordedWaterValues.length} Kayıt Ort.`;
  
  const dayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const waterData = recentLogs.map(log => {
      const d = new Date(log.date);
      return {
          val: typeof log.water_intake === 'number'
            ? parseFloat((log.water_intake / 1000).toFixed(1))
            : null,
          day: dayNames[d.getDay()] || '-'
      };
  });
  
  // Pad if we don't have 7 days
  while (waterData.length < 7) {
      waterData.unshift({ val: null, day: '-' });
  }

  return (
    <div className="w-full min-w-0 max-w-7xl mx-auto min-h-screen p-4 sm:p-6 lg:p-8">
      <button 
        onClick={() => navigate('/clients')}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 text-slate-500 hover:text-primary transition-colors mb-6 rounded-lg font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <ArrowLeft className="w-5 h-5" />
        Listeye Dön
      </button>

      {/* Header Profile Card */}
      <div className="w-full min-w-0 bg-white rounded-3xl p-4 sm:p-8 shadow-sm border border-slate-100 mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-bl-full -mr-16 -mt-16 opacity-50"></div>
        
        <div className="min-w-0 flex flex-col md:flex-row gap-8 relative z-10">
            <div className="flex-shrink-0">
                {client.profilePhotoUrl && !profileImageError ? (
                  <img 
                    src={client.profilePhotoUrl} 
                    alt="" 
                    className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-md" 
                    onError={() => setProfileImageError(true)}
                  />
                ) : (
                  <ProfileAvatarFallback name={client.name} className="w-32 h-32 rounded-full border-4 border-white shadow-md text-3xl" />
                )}
            </div>
            
            <div className="min-w-0 flex-1">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                    <div className="min-w-0">
                        <h1 className="text-3xl font-bold text-slate-800 break-words [overflow-wrap:anywhere]">{client.name}</h1>
                        <p className="text-slate-500 flex items-center gap-2 mt-1">
                            <span className={`inline-block w-2.5 h-2.5 rounded-full ${client.status === 'Aktif' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                            {client.status} Danışan
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button className="px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-dark transition-all shadow-sm shadow-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                            Mesaj Gönder
                        </button>
                        <button 
                          onClick={handleEditPlan}
                          className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                            Planı Düzenle
                        </button>
                        <button 
                          onClick={() => handleRemoveClient(client.relationId)}
                          disabled={isRemoving}
                          className="px-3 py-2.5 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-all disabled:opacity-50 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          title="Danışanı Kaldır"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="min-w-0 flex flex-wrap gap-6 text-sm text-slate-600">
                    <div className="flex min-w-0 max-w-full items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Mail className="w-4 h-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{client.email}</span>
                    </div>
                    {client.phone && (<div className="flex min-w-0 max-w-full items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Phone className="w-4 h-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{client.phone}</span>
                    </div>)}
                    <div className="flex min-w-0 max-w-full items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Calendar className="w-4 h-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">Başlangıç: {client.startDate}</span>
                    </div>
                    <div className="flex min-w-0 max-w-full items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Activity className="w-4 h-4 shrink-0 text-primary" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">Hedef: {client.goal || 'Yok'}</span>
                    </div>
                </div>
            </div>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Left Column - Stats */}
        <div className="min-w-0 space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <Weight className="w-5 h-5 text-primary" />
                    Vücut Kompozisyonu
                </h3>
                
                <div className="space-y-6">
                    <div className="flex justify-between items-end border-b border-slate-50 pb-4">
                        <div className="text-sm text-slate-500">Güncel Kilo</div>
                        <div className="text-2xl font-bold text-slate-800">{client.currentWeight}</div>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-50 pb-4">
                        <div className="text-sm text-slate-500">Başlangıç Kilosu</div>
                        <div className="text-2xl font-bold text-slate-400">{startWeight} kg</div>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-50 pb-4">
                        <div className="text-sm text-slate-500">Hedef Kilo</div>
                        <div className="text-2xl font-bold text-slate-400">{client.targetWeight || '-'}</div>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-50 pb-4">
                        <div className="text-sm text-slate-500">Boy</div>
                        <div className="text-2xl font-bold text-slate-800">{client.heightCm ? `${client.heightCm} cm` : '-'}</div>
                    </div>
                    <div className="flex justify-between items-end">
                        <div className="text-sm text-slate-500">Vücut Kitle İndeksi (BMI)</div>
                        <div className="text-2xl font-bold text-slate-800">{bmi}</div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <Stethoscope className="w-5 h-5 text-red-500" />
                    Tıbbi Profil
                </h3>
                
                <div className="space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Kan Grubu</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{client.bloodType || 'Yok'}</div>
                    </div>
                    <div className="border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500 mb-2">Kronik Rahatsızlıklar</div>
                        <div className="flex flex-wrap gap-2">
                            {client.chronicConditions && client.chronicConditions.length > 0 ? (
                                client.chronicConditions.map((condition, idx) => (
                                    <span key={idx} className="max-w-full break-words px-2 py-1 bg-red-50 text-red-600 rounded-md text-xs font-medium [overflow-wrap:anywhere]">
                                        {condition}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-400">Yok</span>
                            )}
                        </div>
                    </div>
                    <div className="border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500 mb-2">Kullanılan İlaçlar</div>
                        <div className="flex flex-wrap gap-2">
                            {client.medications && client.medications.length > 0 ? (
                                client.medications.map((med, idx) => (
                                    <span key={idx} className="max-w-full break-words px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-xs font-medium [overflow-wrap:anywhere]">
                                        {med}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-400">Yok</span>
                            )}
                        </div>
                    </div>
                    <div className="border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500 mb-2">Besin İntoleransları</div>
                        <div className="flex flex-wrap gap-2">
                            {client.foodIntolerances && client.foodIntolerances.length > 0 ? (
                                client.foodIntolerances.map((intol, idx) => (
                                    <span key={idx} className="max-w-full break-words px-2 py-1 bg-yellow-50 text-yellow-700 rounded-md text-xs font-medium [overflow-wrap:anywhere]">
                                        {intol}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-400">Yok</span>
                            )}
                        </div>
                    </div>
                    <div className="border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500 mb-2">Sevilmeyen Besinler</div>
                        <div className="flex flex-wrap gap-2">
                            {client.dislikedFoods.length > 0 ? (
                                client.dislikedFoods.map((food) => (
                                    <span key={food} className="max-w-full break-words px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-medium [overflow-wrap:anywhere]">
                                        {food}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-400">Yok</span>
                            )}
                        </div>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="text-sm text-slate-500">Son Tahlil Tarihi</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{client.lastLabDate || 'Yok'}</div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-orange-500" />
                    Yaşam Tarzı
                </h3>
                
                <div className="space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Aktivite Seviyesi</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{client.activityLevel || 'Yok'}</div>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Uyku Düzeni</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{client.sleepHoursLabel || 'Yok'}</div>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Sigara Kullanımı</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{smokingStatusLabel}</div>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Alkol Kullanımı</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{alcoholStatusLabel}</div>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="text-sm text-slate-500">Beslenme Tipi</div>
                        <div className="min-w-0 break-words text-right font-medium text-slate-800 [overflow-wrap:anywhere]">{client.nutritionType || 'Yok'}</div>
                    </div>
                </div>
            </div>

            <div className="bg-gradient-to-br from-primary to-primary-dark p-6 rounded-2xl text-white shadow-lg shadow-primary/20">
                <div className="flex justify-between items-start mb-8">
                   <div>
                       <p className="text-emerald-100 font-medium mb-1">Genel Başarı</p>
                       <h3 className="text-3xl font-bold">Harika İş!</h3>
                   </div>
                   <div className="p-2 bg-white/20 rounded-lg">
                       <TrendingUp className="w-6 h-6 text-white" />
                   </div>
                </div>
                <p className="text-emerald-100 text-sm leading-relaxed mb-6">
                    {client.name.split(' ')[0]} programına %{client.compliance || 0} oranında uyum sağlıyor.
                </p>
                <div className="w-full bg-black/20 rounded-full h-2">
                    <div className="bg-white h-full rounded-full" style={{ width: `${client.compliance || 0}%` }}></div>
                </div>
            </div>
        </div>

        {/* Middle Column - Activity/Charts */}
        <div className="min-w-0 md:col-span-2 space-y-6">
            {/* Weekly Weight Chart */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">Kilo Değişimi Geçmişi</h3>
                    {weightHistory.length > 1 && (
                        <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${isWeightLoss ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                            {isWeightLoss ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                            {Math.abs(parseFloat(weeklyChange))} kg
                            <span className="text-slate-400 font-normal ml-1">son değişim</span>
                        </div>
                    )}
                </div>
                
                <div className="h-64 flex items-end justify-between gap-3 px-2">
                    {weightHistory.map((data, i) => (
                        <div key={i} className="flex flex-col items-center gap-2 group flex-1">
                            <span className="text-xs text-slate-800 font-bold mb-1 opacity-0 group-hover:opacity-100 transition-opacity absolute -mt-6 bg-white shadow-sm px-2 py-0.5 rounded-md border border-slate-100 z-10">
                                {data.weight} kg
                            </span>
                            <div className="relative w-full flex justify-center items-end h-48 bg-slate-50 rounded-t-lg overflow-hidden">
                                <div 
                                    className="w-full mx-1 bg-emerald-200/60 rounded-t-md group-hover:bg-primary transition-colors duration-300 relative" 
                                    style={{ height: `${Math.max(10, (data.weight - (currentW - 5)) * 12)}px` }}
                                >
                                </div>
                            </div>
                            <span className="text-[10px] text-slate-400 font-medium">{data.date}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Daily Charts Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Water Chart */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Droplets className="w-5 h-5 text-blue-500" /> Su Tüketimi
                    </h3>
                    {!hasDailyLogs ? (
                      <p className="text-sm text-slate-500 py-8" role="status">
                        Henüz günlük takip kaydı bulunmuyor.
                      </p>
                    ) : !hasWaterData ? (
                      <p className="text-sm text-slate-500 py-8" role="status">
                        Günlük kayıtlar mevcut ancak su tüketimi bilgisi bulunmuyor.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2 mb-6">
                            <span className="text-3xl font-bold text-slate-800">{waterAvg} <span className="text-sm font-normal text-slate-400">Lt ({waterAverageLabel})</span></span>
                            {waterTarget !== null && <span className="text-xs font-medium text-slate-400">Hedef: {waterTarget} Lt</span>}
                        </div>

                        <div className="h-48 flex items-stretch justify-between gap-3">
                            {waterData.map((data, i) => (
                                 <div key={i} className="flex flex-col items-center flex-1 group relative">
                                    <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full mb-2 text-xs font-bold bg-slate-800 text-white px-2 py-1 rounded shadow-lg z-10">
                                        {data.val === null ? 'Su bilgisi yok' : `${data.val} Lt`}
                                    </span>
                                    <div className="w-full bg-blue-50/50 rounded-2xl relative flex-1 flex items-end overflow-hidden">
                                        <div
                                            className={`w-full rounded-2xl transition-all duration-500 ${data.val !== null && waterTarget !== null && data.val >= waterTarget ? 'bg-blue-500' : 'bg-blue-300'}`}
                                            style={{ height: `${data.val === null ? 0 : Math.min((data.val / (waterTarget || 3)) * 100, 100)}%` }}
                                        ></div>
                                    </div>
                                    <span className="text-xs text-slate-400 mt-3 font-medium">{data.day}</span>
                                 </div>
                            ))}
                        </div>
                      </>
                    )}
                </div>

                {/* Calorie Chart - Kept as mock since no direct calorie logs are found */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Utensils className="w-5 h-5 text-orange-500" /> Kalori Alımı
                    </h3>
                    <div className="flex items-baseline gap-2 mb-6">
                        <span className="text-3xl font-bold text-slate-800">- <span className="text-sm font-normal text-slate-400">kcal (Ort.)</span></span>
                        <span className="text-xs font-medium text-slate-400">Hedef: Belirlenmedi</span>
                    </div>

                    <div className="h-48 flex items-stretch justify-center items-center gap-3">
                        <div className="text-slate-400 text-sm text-center">
                            Henüz kalori/öğün tüketim kaydı bulunmuyor.
                        </div>
                    </div>
                </div>
            </div>

            {/* Dietitian Notes */}
            {measurements.filter(m => m.notes).length > 0 && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-slate-400" /> Son Ölçüm Notları
                        </h3>
                    </div>
                    <div className="space-y-3">
                        {measurements.filter(m => m.notes).slice(-3).map((m, idx) => (
                            <div key={idx} className="bg-yellow-50/50 border border-yellow-100 p-4 rounded-xl text-slate-600 text-sm leading-relaxed">
                                <div className="font-medium text-slate-400 text-xs mb-1">
                                    {new Date(m.measured_at || m.created_at).toLocaleDateString('tr-TR')}
                                </div>
                                {m.notes}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>

      </div>
    </div>
  );
};

export default ClientDetails;
