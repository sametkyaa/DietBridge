
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail, MapPin, Phone, Calendar, Weight, Activity, TrendingUp, TrendingDown, Droplets, Utensils, FileText, HeartPulse, Pill, Moon, Coffee, Stethoscope } from 'lucide-react';
import { fetchClientDetails } from '../features/clients/services/clientService';
import { Client } from '../shared/types';

const ClientDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadClient = async () => {
      if (!id) return;
      try {
        const data = await fetchClientDetails(id);
        setClient(data);
      } catch (err) {
        console.error("Failed to load client details:", err);
      } finally {
        setLoading(false);
      }
    };
    loadClient();
  }, [id]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full min-h-screen">
        <div className="text-center text-slate-500">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            Yükleniyor...
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-8 flex items-center justify-center h-full min-h-screen">
        <div className="text-center">
            <h2 className="text-2xl font-bold text-slate-800">Danışan Bulunamadı</h2>
            <button onClick={() => navigate('/clients')} className="mt-4 text-primary font-medium hover:underline">Listeye Dön</button>
        </div>
      </div>
    );
  }

  // Mock data for calculation visualization (using real current weight if available)
  const currentWeightNum = parseFloat(client.currentWeight) || 0;
  const startWeight = client.startWeight 
    ? parseFloat(client.startWeight) 
    : currentWeightNum + 5; // Fallback mock logic
  
  const heightM = client.heightCm ? client.heightCm / 100 : 0;
  const bmi = heightM > 0 ? (currentWeightNum / (heightM * heightM)).toFixed(1) : '-';
  
  // Mock Weight History based on current weight
  const currentW = currentWeightNum;
  const weightHistory = [
      { date: '15 May', weight: currentW + 4.2 },
      { date: '22 May', weight: currentW + 3.5 },
      { date: '29 May', weight: currentW + 2.8 },
      { date: '05 Haz', weight: currentW + 2.1 },
      { date: '12 Haz', weight: currentW + 1.5 },
      { date: '19 Haz', weight: currentW + 0.9 },
      { date: '26 Haz', weight: currentW + 0.4 },
      { date: '03 Tem', weight: currentW }, 
  ];

  const previousWeight = weightHistory[weightHistory.length - 2].weight;
  const currentWeightVal = weightHistory[weightHistory.length - 1].weight;
  const weeklyChange = (currentWeightVal - previousWeight).toFixed(1);
  const isWeightLoss = parseFloat(weeklyChange) <= 0;

  // Mock Daily Data for Charts
  const days = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  
  // Water Data (Liters)
  const waterData = [1.8, 2.2, 2.0, 2.6, 1.9, 2.4, 2.1];
  const waterAvg = (waterData.reduce((a, b) => a + b, 0) / waterData.length).toFixed(1);
  const waterTarget = 2.5;

  // Calorie Data (kcal)
  const calorieData = [1850, 1920, 1750, 2100, 1800, 2250, 1900];
  const calorieAvg = Math.round(calorieData.reduce((a, b) => a + b, 0) / calorieData.length);
  const calorieTarget = 1900;

  const handleEditPlan = () => {
    navigate('/meal-plans', { state: { clientId: client.id } });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto min-h-screen">
      <button 
        onClick={() => navigate('/clients')}
        className="flex items-center gap-2 text-slate-500 hover:text-primary transition-colors mb-6 font-medium"
      >
        <ArrowLeft className="w-5 h-5" />
        Listeye Dön
      </button>

      {/* Header Profile Card */}
      <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100 mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-bl-full -mr-16 -mt-16 opacity-50"></div>
        
        <div className="flex flex-col md:flex-row gap-8 relative z-10">
            <div className="flex-shrink-0">
                <img src={client.avatar} alt={client.name} className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-md" />
            </div>
            
            <div className="flex-1">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-800">{client.name}</h1>
                        <p className="text-slate-500 flex items-center gap-2 mt-1">
                            <span className={`inline-block w-2.5 h-2.5 rounded-full ${client.status === 'Aktif' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                            {client.status} Danışan
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <button className="px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary-dark transition-all shadow-sm shadow-primary/30">
                            Mesaj Gönder
                        </button>
                        <button 
                          onClick={handleEditPlan}
                          className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-all"
                        >
                            Planı Düzenle
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap gap-6 text-sm text-slate-600">
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Mail className="w-4 h-4 text-slate-400" />
                        {client.email}
                    </div>
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Phone className="w-4 h-4 text-slate-400" />
                        +90 555 123 45 67
                    </div>
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        Başlangıç: {client.startDate}
                    </div>
                    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg">
                        <Activity className="w-4 h-4 text-primary" />
                        Hedef: {client.goal}
                    </div>
                </div>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Left Column - Stats */}
        <div className="space-y-6">
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
                        <div className="font-medium text-slate-800">{client.bloodType || '-'}</div>
                    </div>
                    <div className="border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500 mb-2">Kronik Rahatsızlıklar</div>
                        <div className="flex flex-wrap gap-2">
                            {client.chronicConditions && client.chronicConditions.length > 0 ? (
                                client.chronicConditions.map((condition, idx) => (
                                    <span key={idx} className="px-2 py-1 bg-red-50 text-red-600 rounded-md text-xs font-medium">
                                        {condition}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-400">-</span>
                            )}
                        </div>
                    </div>
                    <div className="border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500 mb-2">Kullanılan İlaçlar</div>
                        <div className="flex flex-wrap gap-2">
                            {client.medications && client.medications.length > 0 ? (
                                client.medications.map((med, idx) => (
                                    <span key={idx} className="px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-xs font-medium">
                                        {med}
                                    </span>
                                ))
                            ) : (
                                <span className="text-sm text-slate-400">-</span>
                            )}
                        </div>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="text-sm text-slate-500">Son Tahlil Tarihi</div>
                        <div className="font-medium text-slate-800">{client.lastLabDate || '-'}</div>
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
                        <div className="font-medium text-slate-800">{client.activityLevel || '-'}</div>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Uyku Düzeni</div>
                        <div className="font-medium text-slate-800">{client.sleepHours ? `${client.sleepHours} Saat` : '-'}</div>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                        <div className="text-sm text-slate-500">Sigara Kullanımı</div>
                        <div className="font-medium text-slate-800">{client.smokingStatus || '-'}</div>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="text-sm text-slate-500">Alkol Kullanımı</div>
                        <div className="font-medium text-slate-800">{client.alcoholUse || '-'}</div>
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
                    {client.name.split(' ')[0]} programına %{client.compliance} oranında uyum sağlıyor. Bu tempoyla devam ederse hedefine 2 hafta erken ulaşabilir.
                </p>
                <div className="w-full bg-black/20 rounded-full h-2">
                    <div className="bg-white h-full rounded-full" style={{ width: `${client.compliance}%` }}></div>
                </div>
            </div>
        </div>

        {/* Middle Column - Activity/Charts */}
        <div className="md:col-span-2 space-y-6">
            {/* Weekly Weight Chart */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-slate-800">Kilo Değişimi Grafiği (Haftalık)</h3>
                    <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${isWeightLoss ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                        {isWeightLoss ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                        {Math.abs(parseFloat(weeklyChange))} kg
                        <span className="text-slate-400 font-normal ml-1">bu hafta</span>
                    </div>
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
                                    style={{ height: `${(data.weight - (currentW - 5)) * 12}px` }}
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
                    <div className="flex items-baseline gap-2 mb-6">
                        <span className="text-3xl font-bold text-slate-800">{waterAvg} <span className="text-sm font-normal text-slate-400">Lt (Ort.)</span></span>
                        <span className="text-xs font-medium text-slate-400">Hedef: {waterTarget} Lt</span>
                    </div>
                    
                    <div className="h-48 flex items-stretch justify-between gap-3">
                        {waterData.map((val, i) => (
                             <div key={i} className="flex flex-col items-center flex-1 group relative">
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full mb-2 text-xs font-bold bg-slate-800 text-white px-2 py-1 rounded shadow-lg z-10">
                                    {val} Lt
                                </span>
                                <div className="w-full bg-blue-50/50 rounded-2xl relative flex-1 flex items-end overflow-hidden">
                                    <div 
                                        className={`w-full rounded-2xl transition-all duration-500 ${val >= waterTarget ? 'bg-blue-500' : 'bg-blue-300'}`}
                                        style={{ height: `${Math.min((val / 3) * 100, 100)}%` }}
                                    ></div>
                                </div>
                                <span className="text-xs text-slate-400 mt-3 font-medium">{days[i]}</span>
                             </div>
                        ))}
                    </div>
                </div>

                {/* Calorie Chart */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Utensils className="w-5 h-5 text-orange-500" /> Kalori Alımı
                    </h3>
                    <div className="flex items-baseline gap-2 mb-6">
                        <span className="text-3xl font-bold text-slate-800">{calorieAvg} <span className="text-sm font-normal text-slate-400">kcal (Ort.)</span></span>
                        <span className="text-xs font-medium text-slate-400">Hedef: {calorieTarget}</span>
                    </div>

                    <div className="h-48 flex items-stretch justify-between gap-3">
                        {calorieData.map((val, i) => (
                             <div key={i} className="flex flex-col items-center flex-1 group relative">
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full mb-2 text-xs font-bold bg-slate-800 text-white px-2 py-1 rounded shadow-lg z-10">
                                    {val}
                                </span>
                                <div className="w-full bg-orange-50/50 rounded-2xl relative flex-1 flex items-end overflow-hidden">
                                    <div 
                                        className={`w-full rounded-2xl transition-all duration-500 ${val > calorieTarget + 200 ? 'bg-red-500' : val < calorieTarget - 200 ? 'bg-yellow-400' : 'bg-orange-500'}`}
                                        style={{ height: `${Math.min((val / 2500) * 100, 100)}%` }}
                                    ></div>
                                </div>
                                <span className="text-xs text-slate-400 mt-3 font-medium">{days[i]}</span>
                             </div>
                        ))}
                    </div>
                </div>
            </div>

             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-slate-400" /> Diyetisyen Notları
                    </h3>
                    <button className="text-sm text-primary font-medium hover:underline">Düzenle</button>
                </div>
                <div className="bg-yellow-50/50 border border-yellow-100 p-4 rounded-xl text-slate-600 text-sm leading-relaxed">
                    Danışan bu hafta akşam öğünlerinde karbonhidratı azaltmakta zorlandığını belirtti. Alternatif olarak kabak spagetti veya karnabahar pilavı tarifleri gönderildi. Önümüzdeki hafta su tüketimine odaklanılacak.
                </div>
            </div>
        </div>

      </div>
    </div>
  );
};

export default ClientDetails;
