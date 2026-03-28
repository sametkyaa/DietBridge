import React, { useState, useRef, useEffect } from 'react';
import { 
  CheckCircle2, 
  MoreHorizontal, 
  Bell, 
  Search, 
  TrendingUp, 
  Droplets, 
  Flame, 
  ChevronRight, 
  ArrowUpRight, 
  Calendar, 
  Sparkles,
  X,
  Plus,
  User
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TASKS, USER_AVATAR } from '../../../shared/constants';
import { useAppointments } from '../../appointments/context/AppointmentContext';
import { fetchDietitianClients } from '../../clients/services/clientService';
import { Client } from '../../../shared/types';

const DashboardPage = () => {
  const navigate = useNavigate();
  // Local state to handle task completion interaction
  const [dashboardTasks, setDashboardTasks] = useState(TASKS);
  
  // Clients State
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Task Management State
  const [isTaskMenuOpen, setIsTaskMenuOpen] = useState(false);
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);
  const [newTaskForm, setNewTaskForm] = useState({ title: '', clientName: '', timeInfo: '' });
  
  // Client Autocomplete State for Task Modal
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const taskClientInputRef = useRef<HTMLDivElement>(null);
  
  // Fetch appointments from context
  const { getAppointmentsByDate } = useAppointments();
  
  // Get today's appointments dynamically
  const today = new Date().toISOString().split('T')[0];
  const todaysAppointments = getAppointmentsByDate(today);

  // Fetch Clients
  useEffect(() => {
    const loadClients = async () => {
      try {
        const data = await fetchDietitianClients();
        setClients(data);
      } catch (error) {
        console.error('Failed to fetch clients:', error);
      } finally {
        setLoadingClients(false);
      }
    };
    loadClients();
  }, []);

  const handleCompleteTask = (id: string) => {
    setDashboardTasks(prev => {
      const updatedTasks = prev.map(task => 
        task.id === id ? { ...task, isCompleted: true } : task
      );
      // Sort tasks: Incomplete (false) first, Completed (true) last
      return [...updatedTasks].sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted));
    });
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskForm.title) return;

    // Find if the typed name matches a real client to get avatar
    const matchedClient = clients.find(c => c.name.toLowerCase() === newTaskForm.clientName.toLowerCase());

    const newTask = {
      id: `custom-${Date.now()}`,
      title: newTaskForm.title,
      clientName: newTaskForm.clientName || 'Genel Görev',
      // Use real avatar if matched, otherwise generate one
      clientAvatar: matchedClient?.avatar || `https://ui-avatars.com/api/?name=${newTaskForm.clientName || 'Diyetisyen'}&background=random&color=fff`,
      timeInfo: newTaskForm.timeInfo || 'Bugün',
      isCompleted: false,
    };

    setDashboardTasks(prev => [newTask, ...prev]);
    setIsAddTaskModalOpen(false);
    setNewTaskForm({ title: '', clientName: '', timeInfo: '' });
    setIsTaskMenuOpen(false);
  };

  // Filter clients for main search
  const filteredClients = searchQuery.length > 0 
    ? clients.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  // Filter clients for task modal (Active clients + search match)
  const taskClientMatches = clients.filter(c => 
    c.status === 'Aktif' && 
    c.name.toLowerCase().includes(newTaskForm.clientName.toLowerCase())
  );

  // Close search dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Main Search
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
      // Task Client Input
      if (taskClientInputRef.current && !taskClientInputRef.current.contains(event.target as Node)) {
        setShowClientSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Kontrol Paneli</h1>
          <p className="text-slate-500 mt-1">Tekrar hoş geldiniz, Diyetisyen!</p>
        </div>
        <div className="flex items-center gap-6">
          
          {/* Search Bar with Dropdown */}
          <div className="relative" ref={searchRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 pointer-events-none" />
            <input
              type="text"
              placeholder="Danışan ara..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              className="pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-64 text-sm transition-all shadow-sm"
            />
            {searchQuery && (
              <button 
                onClick={() => {
                  setSearchQuery('');
                  setIsSearchOpen(false);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Dropdown Results */}
            {isSearchOpen && searchQuery && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {filteredClients.length > 0 ? (
                  <div className="py-1">
                    <p className="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">Sonuçlar</p>
                    {filteredClients.map(client => (
                      <button
                        key={client.id}
                        onClick={() => {
                          navigate(`/clients/${client.id}`);
                          setSearchQuery('');
                          setIsSearchOpen(false);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3 transition-colors group border-b border-slate-50 last:border-0"
                      >
                        <img src={client.avatar} alt={client.name} className="w-8 h-8 rounded-full object-cover ring-2 ring-slate-100 group-hover:ring-primary/20" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-700 group-hover:text-primary transition-colors truncate">{client.name}</p>
                          <p className="text-xs text-slate-400 truncate">{client.goal}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-primary" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-center text-slate-500 text-sm">
                    Sonuç bulunamadı.
                  </div>
                )}
              </div>
            )}
          </div>

          <button className="relative p-2.5 rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
          </button>
          <img
            src={USER_AVATAR}
            alt="Profil"
            className="w-12 h-12 rounded-full border-2 border-white shadow-sm object-cover"
          />
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-8">
        {/* Left Column */}
        <div className="col-span-12 lg:col-span-8 space-y-8">
          
          {/* Today's Tasks */}
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-800">Bugünün Görevleri</h3>
              <div className="relative">
                <button 
                  onClick={() => setIsTaskMenuOpen(!isTaskMenuOpen)}
                  className="text-slate-400 hover:text-primary transition-colors p-1 rounded-full hover:bg-slate-50"
                >
                  <MoreHorizontal className="w-6 h-6" />
                </button>
                
                {/* Task Menu Dropdown */}
                {isTaskMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10 cursor-default" onClick={() => setIsTaskMenuOpen(false)}></div>
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-100 z-20 py-1 animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                      <button
                        onClick={() => {
                          setIsAddTaskModalOpen(true);
                          setIsTaskMenuOpen(false);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 text-slate-600 font-medium flex items-center gap-2 transition-colors"
                      >
                        <Plus className="w-4 h-4 text-primary" /> Yeni Görev Ekle
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            
            <div className="space-y-4">
              {dashboardTasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-xl transition-colors">
                  <div className="flex items-center gap-4">
                    <img src={task.clientAvatar} alt={task.clientName} className="w-12 h-12 rounded-full object-cover" />
                    <div>
                      <p className={`font-semibold ${task.isCompleted ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{task.title}</p>
                      <p className="text-sm text-slate-500">
                        {task.clientName} · <span className={!task.isCompleted && task.timeInfo.includes('kaldı') ? 'text-orange-500 font-medium' : ''}>{task.timeInfo}</span>
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleCompleteTask(task.id)}
                    disabled={task.isCompleted}
                    className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all shadow-sm ${
                      task.isCompleted 
                        ? 'bg-emerald-100 text-emerald-700 cursor-default flex items-center gap-2' 
                        : 'bg-orange-50 text-orange-600 hover:bg-orange-100 hover:scale-105 active:scale-95 border border-orange-100'
                    }`}
                  >
                    {task.isCompleted ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" /> Tamamlandı
                      </>
                    ) : 'Bekliyor'}
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Weekly Analysis Redesigned */}
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden">
            <div className="flex justify-between items-center mb-6 relative z-10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 rounded-lg">
                   <TrendingUp className="w-5 h-5 text-primary" />
                </div>
                <div>
                   <h3 className="text-lg font-bold text-slate-800">Haftalık Analiz</h3>
                   <p className="text-xs text-slate-500 font-medium">Genel performans özeti</p>
                </div>
              </div>
              <button 
                onClick={() => navigate('/analytics')}
                className="text-xs font-bold text-slate-400 hover:text-primary transition-colors flex items-center gap-1"
              >
                 Detaylar <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 relative z-10">
              {/* Left Column: Score & Trend */}
              <div className="flex-1 flex flex-col justify-between min-w-[200px]">
                 <div>
                   <div className="flex items-end gap-3 mb-1">
                      <span className="text-4xl font-bold text-slate-800 tracking-tight">%82</span>
                      <span className="mb-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 text-[10px] font-bold flex items-center gap-1">
                        <ArrowUpRight className="w-3 h-3" /> %4 Artış
                      </span>
                   </div>
                   <p className="text-xs text-slate-400 font-medium">Haftalık Uyum Skoru</p>
                 </div>

                 {/* Custom Sparkline Chart */}
                 <div className="h-16 w-full mt-4 relative group">
                    <svg viewBox="0 0 120 40" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                       {/* Gradient Def */}
                       <defs>
                         <linearGradient id="sparklineGradient" x1="0" x2="0" y1="0" y2="1">
                           <stop offset="0%" stopColor="#10B981" stopOpacity="0.2" />
                           <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                         </linearGradient>
                       </defs>
                       {/* Area */}
                       <path d="M0 30 Q 20 35, 40 20 T 80 15 T 120 5 L 120 40 L 0 40 Z" fill="url(#sparklineGradient)" stroke="none" />
                       {/* Line */}
                       <path d="M0 30 Q 20 35, 40 20 T 80 15 T 120 5" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                       {/* Points on hover (simulated) */}
                       <circle cx="120" cy="5" r="3" fill="#10B981" stroke="white" strokeWidth="2" />
                    </svg>
                    <div className="absolute top-0 right-0 -mt-6 bg-slate-800 text-white text-[10px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                       Bugün
                    </div>
                 </div>
              </div>

              {/* Vertical Divider (Desktop) */}
              <div className="hidden lg:block w-px bg-slate-100 mx-2"></div>

              {/* Right Column: Key Insights */}
              <div className="flex-[1.5] grid grid-cols-2 gap-3">
                  {/* Macro Insight */}
                  <div className="col-span-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
                     <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Makro Ortalaması</span>
                        <span className="text-[10px] font-bold text-emerald-600 bg-white px-1.5 py-0.5 rounded border border-emerald-100 shadow-sm">İdeal</span>
                     </div>
                     <div className="flex h-2 w-full rounded-full overflow-hidden gap-0.5 mb-2">
                        <div className="bg-blue-400 w-[35%]"></div>
                        <div className="bg-orange-400 w-[45%]"></div>
                        <div className="bg-yellow-400 w-[20%]"></div>
                     </div>
                     <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div> 75g Prot</span>
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-orange-400"></div> 180g Karb</span>
                        <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-yellow-400"></div> 55g Yağ</span>
                     </div>
                  </div>

                  {/* Water Insight */}
                  <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100 flex flex-col justify-between">
                     <div className="flex items-center gap-1.5 mb-1 text-blue-600/80">
                        <Droplets className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold uppercase">Su</span>
                     </div>
                     <p className="text-sm font-bold text-slate-700">2.1 Lt <span className="text-[10px] font-normal text-slate-400">/ 2.5</span></p>
                  </div>

                  {/* Calories Insight */}
                  <div className="bg-orange-50/50 p-3 rounded-xl border border-orange-100 flex flex-col justify-between">
                     <div className="flex items-center gap-1.5 mb-1 text-orange-600/80">
                        <Flame className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold uppercase">Kalori</span>
                     </div>
                     <p className="text-sm font-bold text-slate-700">1850 <span className="text-[10px] font-normal text-slate-400">kcal</span></p>
                  </div>
              </div>
            </div>

            {/* AI Summary Footer */}
            <div className="mt-5 pt-4 border-t border-slate-100">
               <div className="flex items-start gap-3">
                  <div className="mt-0.5 p-1 rounded-md bg-indigo-50 text-indigo-500 shrink-0">
                     <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                     <span className="font-bold text-slate-700">Haftalık Özet:</span> Protein alımı hedefin üzerinde ve istikrarlı. Cuma günü öğün atlama oranı yüksekti, hafta sonu su tüketimi artırılmalı.
                  </p>
               </div>
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="col-span-12 lg:col-span-4 space-y-8">
          
          {/* Appointments */}
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-800">Bugünkü Randevular</h3>
            </div>
            
            {todaysAppointments.length > 0 ? (
              <div className="space-y-6 relative">
                {/* Timeline Line */}
                <div className="absolute left-[3.25rem] top-2 bottom-2 w-0.5 bg-slate-100"></div>

                {todaysAppointments.map((apt) => (
                  <div key={apt.id} className="flex gap-4 relative">
                    <div className="flex flex-col items-end w-10 flex-shrink-0 pt-0.5">
                      <span className="font-bold text-slate-800 leading-none">{apt.time}</span>
                      <span className="text-xs text-slate-400 mt-1">{apt.duration}</span>
                    </div>
                    <div className={`relative pl-4 border-l-4 ${
                      apt.type === 'Görüntülü Görüşme' ? 'border-primary' : apt.type === 'Yüzyüze' ? 'border-orange-400' : 'border-blue-400'
                    }`}>
                      <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 bg-white rounded-full border-2 border-inherit"></div>
                      <p className="font-semibold text-slate-800 leading-tight mb-1">{apt.title}</p>
                      <p className="text-sm text-slate-500">{apt.clientName} · {apt.type}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-400">
                <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Bugün için randevu bulunmuyor.</p>
              </div>
            )}
            
            <button 
              onClick={() => navigate('/appointments')}
              className="w-full mt-6 py-3 rounded-xl border border-dashed border-slate-300 text-slate-500 font-medium hover:bg-slate-50 hover:border-primary hover:text-primary transition-all flex items-center justify-center gap-2"
            >
               Tüm Randevuları Gör
            </button>
          </section>

          {/* My Clients */}
          <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h3 className="text-xl font-bold text-slate-800 mb-6">Danışanlarım</h3>
            <div className="space-y-5">
              {loadingClients ? (
                <div className="text-center py-4 text-slate-400">Yükleniyor...</div>
              ) : clients.length > 0 ? (
                clients.slice(0, 5).map((client) => (
                  <div 
                    key={client.id} 
                    onClick={() => navigate(`/clients/${client.id}`)}
                    className="flex items-center justify-between group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <img src={client.avatar} alt={client.name} className="w-10 h-10 rounded-full object-cover ring-2 ring-white group-hover:ring-primary/20 transition-all" />
                      <div>
                        <p className="font-semibold text-slate-800 text-sm group-hover:text-primary transition-colors">{client.name}</p>
                        <p className="text-xs text-slate-500">{client.goal}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${client.compliance > 80 ? 'bg-primary' : client.compliance > 70 ? 'bg-yellow-400' : 'bg-red-500'}`} 
                          style={{ width: `${client.compliance}%` }}
                        ></div>
                      </div>
                      <span className={`text-sm font-bold ${client.compliance > 80 ? 'text-primary' : client.compliance > 70 ? 'text-yellow-500' : 'text-red-500'}`}>
                        %{client.compliance}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-slate-400">
                  <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Search className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 mb-1">Henüz danışanınız yok</p>
                  <p className="text-xs">İlk danışanınızı eklediğinizde burada görünecek.</p>
                </div>
              )}
            </div>
            <button 
              onClick={() => navigate('/clients')}
              className="w-full mt-6 py-3 rounded-xl border border-dashed border-slate-300 text-slate-500 font-medium hover:bg-slate-50 hover:border-primary hover:text-primary transition-all flex items-center justify-center gap-2"
            >
               Tüm Danışanları Gör
            </button>
          </section>
        </div>
      </div>

      {/* Add Task Modal */}
      {isAddTaskModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
               <h2 className="text-xl font-bold text-slate-800">Yeni Görev Ekle</h2>
               <button onClick={() => setIsAddTaskModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
                  <X className="w-5 h-5" />
               </button>
            </div>
            
            <form onSubmit={handleAddTask} className="p-6 space-y-5">
               <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Görev Başlığı</label>
                  <input 
                    type="text"
                    required
                    placeholder="Örn: Haftalık raporu hazırla..."
                    value={newTaskForm.title}
                    onChange={(e) => setNewTaskForm({...newTaskForm, title: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
                  />
               </div>

               {/* Client Selection Dropdown / Input Hybrid */}
               <div className="space-y-1.5 relative" ref={taskClientInputRef}>
                  <label className="text-sm font-bold text-slate-700">İlgili Danışan (Opsiyonel)</label>
                  <div className="relative">
                    <input 
                      type="text"
                      placeholder="Danışan adı yazın veya seçin..."
                      value={newTaskForm.clientName}
                      onChange={(e) => {
                        setNewTaskForm({...newTaskForm, clientName: e.target.value});
                        setShowClientSuggestions(true);
                      }}
                      onFocus={() => setShowClientSuggestions(true)}
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
                    />
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  </div>

                  {/* Autocomplete Dropdown */}
                  {showClientSuggestions && taskClientMatches.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                      {taskClientMatches.map(client => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => {
                            setNewTaskForm({...newTaskForm, clientName: client.name});
                            setShowClientSuggestions(false);
                          }}
                          className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                        >
                          <img src={client.avatar} alt={client.name} className="w-6 h-6 rounded-full object-cover" />
                          <div className="flex-1">
                             <p className="text-sm font-medium text-slate-700">{client.name}</p>
                             <p className="text-[10px] text-slate-400">{client.goal}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
               </div>

               <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Zaman / Bitiş</label>
                  <input 
                    type="text"
                    placeholder="Örn: Bugün 14:00"
                    value={newTaskForm.timeInfo}
                    onChange={(e) => setNewTaskForm({...newTaskForm, timeInfo: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
                  />
               </div>

               <div className="pt-2 flex gap-3">
                  <button 
                    type="button" 
                    onClick={() => setIsAddTaskModalOpen(false)}
                    className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl border border-slate-200 transition-colors text-sm"
                  >
                     İptal
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/30 hover:bg-primary-dark transition-colors text-sm"
                  >
                     Ekle
                  </button>
               </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;