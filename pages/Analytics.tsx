import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, 
  Filter, 
  Download, 
  Users, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Droplets, 
  ChevronDown, 
  MessageSquare, 
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Search,
  X,
  Target,
  Utensils,
  Smartphone,
  ChevronLeft,
  Sparkles
} from 'lucide-react';
import { USER_AVATAR, CLIENTS } from '../constants';
import { Client } from '../types';

// --- Types & Mock Data Extensions ---

interface FilterState {
  dateRange: string;
  client: Client | null;
  goal: string;
  plan: string;
  status: string;
}

const DATE_RANGES = ['Bu Hafta', 'Geçen Hafta', 'Bu Ay', 'Son 3 Ay', 'Özel Aralık'];
const GOAL_OPTIONS = ['Kilo Verme', 'Kilo Alma', 'Koruma', 'Kas Kazanımı'];
const PLAN_OPTIONS = ['Akdeniz', 'Ketojenik', 'Vejetaryen', 'Dengeli', 'Aralıklı Oruç'];
const STATUS_OPTIONS = ['Aktif', 'Pasif', 'Giriş Yapmayanlar (7+ Gün)'];

// --- Reusable Components ---

const FilterDropdown = ({ 
  label, 
  value, 
  options, 
  onSelect, 
  icon: Icon,
  isClientSelector = false 
}: { 
  label: string;
  value: string | Client | null;
  options?: string[];
  onSelect: (val: any) => void;
  icon?: any;
  isClientSelector?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getDisplayValue = (): string => {
    if (isClientSelector) {
      return (value as Client)?.name || 'Tüm Danışanlar';
    }
    return (typeof value === 'string' ? value : '') || label;
  };

  const filteredClients = isClientSelector 
    ? CLIENTS.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : [];

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
          isOpen
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-2 ring-emerald-500/10' 
            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
        }`}
      >
        {Icon && <Icon className={`w-4 h-4 ${isOpen ? 'text-emerald-600' : 'text-slate-400'}`} />}
        <span className="truncate max-w-[140px]">{getDisplayValue()}</span>
        <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${isOpen ? 'rotate-180 text-emerald-600' : 'text-slate-400'}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {isClientSelector && (
            <div className="p-3 border-b border-slate-50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input 
                  autoFocus
                  type="text" 
                  placeholder="Danışan ara..." 
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-primary"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          )}
          
          <div className="max-h-64 overflow-y-auto py-1">
            {isClientSelector ? (
              <>
                <button 
                  onClick={() => { onSelect(null); setIsOpen(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 text-slate-600 font-medium border-b border-slate-50"
                >
                  Tüm Danışanlar
                </button>
                {filteredClients.map(client => (
                  <button
                    key={client.id}
                    onClick={() => { onSelect(client); setIsOpen(false); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-3 group"
                  >
                    <img src={client.avatar} alt={client.name} className="w-8 h-8 rounded-full object-cover" />
                    <div>
                      <p className="font-medium text-slate-700 group-hover:text-primary">{client.name}</p>
                      <p className="text-[10px] text-slate-400">{client.goal}</p>
                    </div>
                  </button>
                ))}
              </>
            ) : (
              options?.map((opt) => (
                <button
                  key={opt}
                  onClick={() => { onSelect(opt); setIsOpen(false); }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors ${value === opt ? 'text-primary font-medium bg-emerald-50/50' : 'text-slate-600'}`}
                >
                  {opt}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Reusable Dynamic Line Chart
const DynamicLineChart = ({ dataPoints, color = "#10B981" }: { dataPoints: number[], color?: string }) => {
  const height = 100;
  const width = 300;
  
  // Dynamic scaling logic
  const maxVal = Math.max(...dataPoints);
  const minVal = Math.min(...dataPoints);
  let range = maxVal - minVal;
  
  // Fallback for flat data to prevent division by zero and center the line
  if (range === 0) range = 1;

  const points = dataPoints.map((p, i) => {
    const x = (i / (dataPoints.length - 1)) * width;
    
    // Scale data to occupy 70% of the height, centered vertically
    // 15% padding top, 15% padding bottom
    const normalizedValue = (p - minVal) / range;
    const y = height - (normalizedValue * (height * 0.7) + (height * 0.15));
    
    return `${x},${y}`;
  }).join(' ');

  const gradientId = `gradient-${color.replace('#', '')}-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="w-full h-48 relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
        {/* Grid Lines - decorative */}
        <line x1="0" y1="20" x2={width} y2="20" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="0" y1="50" x2={width} y2="50" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="0" y1="80" x2={width} y2="80" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
        
        {/* Line */}
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="3"
          points={points}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="drop-shadow-sm transition-all duration-500 ease-in-out"
        />
        
        {/* Gradient Area */}
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon 
          fill={`url(#${gradientId})`} 
          points={`0,${height} ${points} ${width},${height}`} 
          className="transition-all duration-500 ease-in-out"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-slate-400 mt-4 font-medium px-1">
        <span>Pzt</span>
        <span>Çar</span>
        <span>Cum</span>
        <span>Paz</span>
      </div>
    </div>
  );
};

// Reusable Bar Chart
const DynamicBarChart = ({ data }: { data: { label: string, value: number, color: string }[] }) => {
  return (
    <div className="h-48 flex items-end justify-between gap-4 pt-4">
      {data.map((item, idx) => (
        <div key={idx} className="flex flex-col items-center gap-3 flex-1 group cursor-default h-full">
          <div className="relative w-full bg-slate-50 rounded-t-xl h-full flex items-end overflow-hidden border-b border-slate-100">
             <div 
               className={`w-full ${item.color} rounded-t-xl transition-all duration-700 ease-out relative group-hover:opacity-90`}
               style={{ height: `${item.value}%` }}
             >
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] font-bold px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-md">
                   %{item.value}
                </div>
             </div>
          </div>
          <span className="text-xs font-semibold text-slate-500">{item.label}</span>
        </div>
      ))}
    </div>
  );
};

const Analytics = () => {
  // --- State ---
  const [filters, setFilters] = useState<FilterState>({
    dateRange: 'Bu Hafta',
    client: null, // If null, show Global View. If set, show Individual View.
    goal: '',
    plan: '',
    status: ''
  });

  const [isLoading, setIsLoading] = useState(false);

  // Mock Loading effect when filters change
  const handleFilterChange = (key: keyof FilterState, value: any) => {
    setIsLoading(true);
    setFilters(prev => ({ ...prev, [key]: value }));
    setTimeout(() => setIsLoading(false), 600);
  };

  // --- Views ---

  const GlobalDashboard = () => (
    <div className="flex flex-col gap-10">
      {/* KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {[
          { label: 'Aktif Danışanlar', value: '42', change: '+3', trend: 'up', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Ort. Kilo Değişimi', value: '-1.4 kg', change: '-0.2', trend: 'down', icon: TrendingDown, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Genel Plan Uyumu', value: '%78', change: '+5%', trend: 'up', icon: Activity, color: 'text-primary', bg: 'bg-emerald-50' },
          { label: 'Randevu Katılımı', value: '%92', change: '-2%', trend: 'down', icon: Calendar, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Ort. Su Tüketimi', value: '2.1 Lt', change: '0', trend: 'neutral', icon: Droplets, color: 'text-cyan-600', bg: 'bg-cyan-50' },
        ].map((kpi, idx) => (
          <div key={idx} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-default flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-xl ${kpi.bg}`}>
                <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
              </div>
              {kpi.change !== '0' && (
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  kpi.trend === 'up' && kpi.label !== 'Ort. Kilo Değişimi' ? 'bg-emerald-50 text-emerald-600' : 
                  kpi.trend === 'down' && kpi.label === 'Ort. Kilo Değişimi' ? 'bg-emerald-50 text-emerald-600' :
                  'bg-red-50 text-red-600'
                }`}>
                  {kpi.change}
                </span>
              )}
            </div>
            <div>
              <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">{kpi.label}</p>
              <h3 className="text-2xl font-bold text-slate-800 mt-1">{kpi.value}</h3>
            </div>
          </div>
        ))}
      </section>

      {/* Main Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm lg:col-span-2">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-8">
             <div>
               <h3 className="font-bold text-slate-800 text-lg">Kilo Değişim Trendi</h3>
               <p className="text-sm text-slate-500 mt-1">Tüm danışanların ortalama kilo değişimi</p>
             </div>
             <div className="px-4 py-2 rounded-xl bg-orange-50 text-orange-600 text-xs font-bold border border-orange-100 flex items-center gap-2 w-fit">
                <AlertCircle className="w-3.5 h-3.5" />
                Son 4 haftada yavaşlama var
             </div>
          </div>
          <DynamicLineChart dataPoints={[75, 74.8, 74.2, 73.9, 73.5, 73.1, 72.8]} color="#10B981" />
        </div>

        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
             <div className="mb-8">
               <h3 className="font-bold text-slate-800 text-lg">Öğün Bazlı Uyum</h3>
               <p className="text-sm text-slate-500 mt-1">Öğün tipine göre başarı</p>
             </div>
             <DynamicBarChart data={[
               { label: 'Kahvaltı', value: 85, color: 'bg-emerald-400' },
               { label: 'Öğle', value: 72, color: 'bg-blue-400' },
               { label: 'Akşam', value: 52, color: 'bg-orange-400' },
               { label: 'Ara', value: 65, color: 'bg-purple-400' },
             ]} />
        </div>
      </section>

      {/* Risky Clients & Summary */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-1000">
         <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-50 flex justify-between items-center bg-white">
               <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                  <div className="p-1.5 bg-red-50 rounded-lg">
                     <AlertCircle className="w-5 h-5 text-red-500" />
                  </div>
                  Riskli Danışanlar
               </h3>
               <button className="text-sm text-primary font-medium hover:underline">Tümünü Gör</button>
            </div>
            <div className="overflow-x-auto flex-1">
               <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs tracking-wider">
                     <tr>
                        <th className="px-6 py-4">Danışan</th>
                        <th className="px-6 py-4">Sapma</th>
                        <th className="px-6 py-4 text-center">İşlem</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                     {[
                        { name: 'Canan Demir', deviation: '+1.2 kg' },
                        { name: 'Burak Yılmaz', deviation: '+0.5 kg' },
                        { name: 'Selin Kaya', deviation: '0 kg' }
                     ].map((c, i) => (
                        <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                           <td className="px-6 py-5 font-semibold text-slate-800">{c.name}</td>
                           <td className="px-6 py-5 text-red-500 font-bold bg-red-50/30">{c.deviation}</td>
                           <td className="px-6 py-5 text-center">
                              <button className="text-slate-400 hover:text-primary p-2 hover:bg-slate-100 rounded-full transition-colors">
                                 <MessageSquare className="w-4 h-4" />
                              </button>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         </div>

         {/* UPDATED AI SUMMARY CARD */}
         <div className="bg-emerald-50/50 rounded-2xl p-8 border border-emerald-100 shadow-sm relative overflow-hidden flex flex-col justify-center min-h-[300px]">
            {/* Subtle Decoration */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-100/40 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
            
            <div className="relative z-10">
               <div className="flex items-center gap-3 mb-6">
                  <div className="p-2.5 bg-white border border-emerald-100 rounded-xl shadow-sm text-emerald-600">
                     <Sparkles className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-bold text-slate-800">Haftalık Yapay Zeka Özeti</h2>
               </div>

               <ul className="space-y-5">
                  <li className="flex items-start gap-4">
                     <div className="mt-0.5 bg-white p-1 rounded-full shadow-sm border border-emerald-100 flex-shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                     </div>
                     <span className="text-sm text-slate-600 leading-relaxed">
                        Genel uyum oranı geçen haftaya göre <span className="font-bold text-emerald-700">%5 artış</span> göstererek pozitif bir trend yakaladı.
                     </span>
                  </li>
                  <li className="flex items-start gap-4">
                     <div className="mt-0.5 bg-white p-1 rounded-full shadow-sm border border-orange-100 flex-shrink-0">
                        <AlertCircle className="w-4 h-4 text-orange-500" />
                     </div>
                     <span className="text-sm text-slate-600 leading-relaxed">
                        <span className="font-bold text-slate-800">5 danışan</span> uygulamaya son 7 gündür giriş yapmadı. Hatırlatma gönderilmesi önerilir.
                     </span>
                  </li>
               </ul>

               <div className="mt-8 pt-6 border-t border-emerald-100/50">
                  <button className="flex items-center gap-2 text-emerald-700 bg-white border border-emerald-200 px-5 py-3 rounded-xl font-bold hover:bg-emerald-50 hover:border-emerald-300 transition-all text-sm w-fit shadow-sm hover:shadow-md">
                     Tam Raporu İndir <ArrowRight className="w-4 h-4" />
                  </button>
               </div>
            </div>
         </div>
      </section>
    </div>
  );

  const ClientDashboard = ({ client }: { client: Client }) => (
    <div className="animate-in fade-in slide-in-from-right-8 duration-500 flex flex-col gap-8">
      
      {/* 1. Client Header */}
      <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-6">
           <div className="relative">
              <img src={client.avatar} alt={client.name} className="w-20 h-20 rounded-full object-cover ring-4 ring-slate-50 shadow-sm" />
              <span className="absolute bottom-0 right-0 w-5 h-5 bg-emerald-500 border-4 border-white rounded-full"></span>
           </div>
           <div>
              <h2 className="text-2xl font-bold text-slate-800">{client.name}</h2>
              <div className="flex items-center gap-3 mt-2">
                 <span className="px-3 py-1 bg-slate-50 text-slate-600 rounded-lg text-xs font-bold border border-slate-100">{client.goal}</span>
                 <span className="px-3 py-1 bg-slate-50 text-slate-600 rounded-lg text-xs font-bold border border-slate-100">Akdeniz Diyeti</span>
              </div>
              <p className="text-xs text-slate-400 mt-2 font-medium">Son aktivite: 2 saat önce</p>
           </div>
        </div>
        <div className="flex gap-4 w-full md:w-auto">
           <button className="flex-1 md:flex-none py-3 px-6 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors text-sm">
             Planı Düzenle
           </button>
           <button className="flex-1 md:flex-none py-3 px-6 rounded-xl bg-primary text-white font-bold hover:bg-primary-dark transition-colors shadow-sm text-sm flex items-center justify-center gap-2">
             <MessageSquare className="w-4 h-4" />
             Mesaj Gönder
           </button>
        </div>
      </div>

      {/* 2. Personal KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-xs text-slate-500 font-bold uppercase mb-2">Güncel Kilo</p>
            <div className="flex justify-between items-end">
               <h3 className="text-3xl font-bold text-slate-800">{client.currentWeight}</h3>
               <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg mb-1">{client.weeklyChange} kg</span>
            </div>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-xs text-slate-500 font-bold uppercase mb-2">Toplam Kayıp</p>
            <div className="flex justify-between items-end">
               <h3 className="text-3xl font-bold text-slate-800">-4.2 kg</h3>
               <span className="text-xs text-slate-400 mb-1">4 hafta</span>
            </div>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-xs text-slate-500 font-bold uppercase mb-2">Uyum Skoru</p>
            <div className="flex justify-between items-end">
               <h3 className="text-3xl font-bold text-slate-800">%{client.compliance}</h3>
               <div className="w-16 h-2 bg-slate-100 rounded-full mb-2 overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${client.compliance}%` }}></div>
               </div>
            </div>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-xs text-slate-500 font-bold uppercase mb-2">Su Tüketimi</p>
            <div className="flex justify-between items-end">
               <h3 className="text-3xl font-bold text-slate-800">1.8 Lt</h3>
               <span className="text-xs font-bold text-orange-500 bg-orange-50 px-2 py-1 rounded-lg mb-1">Hedefin Altında</span>
            </div>
         </div>
      </div>

      {/* 3. Personal Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         {/* Line Chart */}
         <div className="lg:col-span-2 bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex justify-between items-center mb-8">
               <h3 className="font-bold text-slate-800">Kilo Değişim Grafiği</h3>
               <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="w-2.5 h-2.5 rounded-full bg-primary"></div>
                  <span className="text-xs font-semibold text-slate-600">Hedef Çizgisi</span>
               </div>
            </div>
            {/* Mocking personalized data based on current weight */}
            <DynamicLineChart 
              dataPoints={[
                parseFloat(client.currentWeight) + 2.5, 
                parseFloat(client.currentWeight) + 1.8, 
                parseFloat(client.currentWeight) + 1.2, 
                parseFloat(client.currentWeight) + 0.5, 
                parseFloat(client.currentWeight)
              ]} 
              color="#3B82F6" 
            />
         </div>

         {/* Bar Chart */}
         <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
             <h3 className="font-bold text-slate-800 mb-8">Öğün Uyumu</h3>
             <DynamicBarChart data={[
               { label: 'Kahvaltı', value: 90, color: 'bg-emerald-400' },
               { label: 'Öğle', value: 85, color: 'bg-blue-400' },
               { label: 'Akşam', value: 48, color: 'bg-red-400' },
               { label: 'Ara', value: 70, color: 'bg-purple-400' },
             ]} />
         </div>
      </div>

      {/* 4. Detail Activity & Risk */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         {/* Activity Log */}
         <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
            <h3 className="font-bold text-slate-800 mb-6">Son Aktiviteler</h3>
            <div className="space-y-4">
               {[
                 { icon: Utensils, title: 'Öğle Yemeği Girildi', time: '2 saat önce', desc: 'Izgara Tavuk Salata (450 kcal)', color: 'text-orange-500', bg: 'bg-orange-50' },
                 { icon: Droplets, title: 'Su Takibi', time: '4 saat önce', desc: '500ml su eklendi', color: 'text-blue-500', bg: 'bg-blue-50' },
                 { icon: Smartphone, title: 'Uygulama Açıldı', time: 'Sabah 09:15', desc: 'Günlük plan kontrol edildi', color: 'text-slate-500', bg: 'bg-slate-50' },
                 { icon: Target, title: 'Kilo Girişi', time: 'Dün', desc: `${client.currentWeight} olarak güncellendi`, color: 'text-emerald-500', bg: 'bg-emerald-50' },
               ].map((item, i) => (
                 <div key={i} className="flex items-center gap-5 p-4 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100">
                    <div className={`p-3.5 rounded-full flex-shrink-0 ${item.bg}`}>
                       <item.icon className={`w-6 h-6 ${item.color}`} />
                    </div>
                    <div className="flex-1">
                       <h4 className="font-bold text-slate-800 text-sm mb-1">{item.title}</h4>
                       <p className="text-xs text-slate-500 font-medium">{item.desc}</p>
                    </div>
                    <span className="text-xs text-slate-400 font-bold bg-slate-50 px-3 py-1 rounded-full">{item.time}</span>
                 </div>
               ))}
            </div>
         </div>

         {/* AI Risk Analysis */}
         <div className="bg-red-50/50 rounded-2xl border border-red-100 p-8">
            <h3 className="font-bold text-red-700 flex items-center gap-2 mb-6">
               <AlertCircle className="w-5 h-5" />
               Risk Analizi & Öneriler
            </h3>
            <div className="space-y-5">
               <div className="bg-white p-5 rounded-xl shadow-sm border border-red-100">
                  <p className="text-xs font-bold text-red-600 mb-1 uppercase tracking-wide">Düşük Akşam Uyumu</p>
                  <p className="text-sm text-slate-600 leading-relaxed">Akşam yemeği uyumu bu hafta %48'e düştü. Danışan öğün atlıyor olabilir.</p>
               </div>
               <div className="bg-white p-5 rounded-xl shadow-sm border border-orange-100">
                  <p className="text-xs font-bold text-orange-600 mb-1 uppercase tracking-wide">Su Tüketimi Yetersiz</p>
                  <p className="text-sm text-slate-600 leading-relaxed">Son 3 gündür günlük su hedefinin 1 litre altında.</p>
               </div>
               <div className="mt-6 pt-6 border-t border-red-100">
                  <p className="text-xs font-bold text-slate-500 uppercase mb-3">Önerilen Aksiyon</p>
                  <button className="w-full py-3 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors shadow-sm shadow-red-200">
                     Motivasyon Mesajı Gönder
                  </button>
               </div>
            </div>
         </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      
      {/* Sticky Header & Filters */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              {filters.client && (
                <button 
                  onClick={() => handleFilterChange('client', null)}
                  className="p-2 -ml-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
                  title="Genel Görünüme Dön"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              )}
              <div>
                <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
                  {filters.client ? 'Danışan Analizi' : 'Analizler & Raporlar'}
                </h1>
                <p className="text-sm text-slate-500 font-medium">
                  {filters.client ? `${filters.client.name} için detaylı performans verileri` : 'Klinik genel durumu ve performans verileri.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                <Download className="w-4 h-4" />
                Dışa Aktar
              </button>
              <img src={USER_AVATAR} className="w-10 h-10 rounded-full border border-slate-200 ml-2 shadow-sm" alt="Profil" />
            </div>
          </div>

          {/* Interactive Filter Bar */}
          <div className="flex flex-wrap items-center gap-3 overflow-visible pb-1">
            <FilterDropdown 
              label="Tarih" 
              value={filters.dateRange} 
              options={DATE_RANGES}
              onSelect={(val) => handleFilterChange('dateRange', val)}
              icon={Calendar} 
            />
            
            <FilterDropdown 
              label="Tüm Danışanlar" 
              value={filters.client} 
              onSelect={(val) => handleFilterChange('client', val)}
              icon={Users}
              isClientSelector
            />

            <FilterDropdown 
              label="Hedef" 
              value={filters.goal || 'Hedef'} 
              options={GOAL_OPTIONS}
              onSelect={(val) => handleFilterChange('goal', val)}
              icon={Target}
            />
            <FilterDropdown 
              label="Plan Tipi" 
              value={filters.plan || 'Plan Tipi'} 
              options={PLAN_OPTIONS}
              onSelect={(val) => handleFilterChange('plan', val)}
              icon={Utensils}
            />
             <FilterDropdown 
              label="Durum" 
              value={filters.status || 'Durum'} 
              options={STATUS_OPTIONS}
              onSelect={(val) => handleFilterChange('status', val)}
              icon={Activity}
            />

            {(filters.goal || filters.plan || filters.status) && (
               <button 
                onClick={() => setFilters(prev => ({ ...prev, goal: '', plan: '', status: '' }))}
                className="text-xs text-red-500 hover:text-red-700 font-bold flex items-center gap-1 ml-auto"
               >
                 <X className="w-3 h-3" /> Filtreleri Temizle
               </button>
            )}
          </div>
        </div>
      </header>

      {/* Content Area */}
      <div className="max-w-7xl mx-auto p-8 min-h-[600px]">
        {isLoading ? (
          <div className="flex justify-center items-center h-96">
             <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-slate-500 font-medium text-sm animate-pulse">Veriler güncelleniyor...</p>
             </div>
          </div>
        ) : (
          filters.client ? (
            <ClientDashboard client={filters.client} />
          ) : (
            <GlobalDashboard />
          )
        )}
      </div>
    </div>
  );
};

export default Analytics;