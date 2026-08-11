import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin, 
  Video, 
  Phone, 
  Plus, 
  X, 
  User, 
  ChevronLeft,
  ChevronRight,
  Trash2,
  Edit2,
  RefreshCw,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useAppointments } from '../features/appointments/context/AppointmentContext';
import { fetchActiveDietitianClientList } from '../features/clients/services/clientService';
import {
  APPOINTMENT_DURATIONS,
  APPOINTMENT_TYPES,
  AppointmentDraft,
  getLocalDateKey,
  parseLocalDate,
} from '../features/appointments/utils/appointmentContract';
import { Appointment, Client } from '../shared/types';

type ClientState =
  | { status: 'loading'; clients: Client[] }
  | { status: 'success'; clients: Client[] }
  | { status: 'error'; clients: Client[]; message: string };

const createEmptyForm = (date = getLocalDateKey()): AppointmentDraft => ({
  clientId: '',
  title: '',
  date,
  time: '09:00',
  duration: 30,
  type: 'Görüntülü Görüşme',
});

const Appointments = () => {
  const {
    appointments,
    loading,
    error,
    mutationError,
    pendingAction,
    refreshAppointments,
    addAppointment,
    updateAppointment,
    deleteAppointment,
    clearMutationError,
  } = useAppointments();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(getLocalDateKey());
  const [clientState, setClientState] = useState<ClientState>({ status: 'loading', clients: [] });

  const [formData, setFormData] = useState<AppointmentDraft>(() => createEmptyForm());

  const loadClients = useCallback(async () => {
    setClientState((current) => ({ status: 'loading', clients: current.clients }));
    const result = await fetchActiveDietitianClientList();
    if (result.status === 'error') {
      setClientState({ status: 'error', clients: [], message: result.userMessage });
      return;
    }
    setClientState({ status: 'success', clients: result.clients });
  }, []);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const activeClients = clientState.clients;

  const selectedClientForForm = activeClients.find((client) => client.id === formData.clientId);

  // Group appointments by date
  const appointmentsByDate = appointments.filter(a => a.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time));

  const openCreateModal = () => {
    clearMutationError();
    setEditingAppointment(null);
    setFormData(createEmptyForm(selectedDate));
    setIsModalOpen(true);
  };

  const openEditModal = (appointment: Appointment) => {
    clearMutationError();
    setEditingAppointment(appointment);
    setFormData({
      clientId: appointment.clientId,
      title: appointment.title,
      date: appointment.date,
      time: appointment.time,
      duration: appointment.duration,
      type: appointment.type,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = editingAppointment
      ? await updateAppointment(editingAppointment.id, formData)
      : await addAppointment(formData);
    if (!result.success) return;

    setSelectedDate(formData.date);
    setIsModalOpen(false);
    setEditingAppointment(null);
    setFormData(createEmptyForm(formData.date));
  };

  const handleDelete = async (appointment: Appointment) => {
    if (!window.confirm(`"${appointment.title}" randevusunu silmek istediğinize emin misiniz?`)) return;
    await deleteAppointment(appointment.id);
  };

  const getStatusColor = (type: string) => {
    switch (type) {
      case 'Görüntülü Görüşme': return 'bg-blue-50 text-blue-600 border-blue-100';
      case 'Yüzyüze': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'Telefon Görüşmesi': return 'bg-purple-50 text-purple-600 border-purple-100';
      default: return 'bg-slate-50 text-slate-600 border-slate-100';
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'Görüntülü Görüşme': return <Video className="w-4 h-4" />;
      case 'Yüzyüze': return <MapPin className="w-4 h-4" />;
      case 'Telefon Görüşmesi': return <Phone className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  // Simple date navigator
  const changeDate = (days: number) => {
    const [year, month, day] = selectedDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    setSelectedDate(getLocalDateKey(date));
  };

  const selectedDateValue = useMemo(() => {
    const [year, month, day] = selectedDate.split('-').map(Number);
    return new Date(year, month - 1, day);
  }, [selectedDate]);

  const upcomingAppointments = useMemo(() => appointments
    .filter((appointment) => {
      const appointmentDate = parseLocalDate(appointment.date);
      return appointmentDate ? appointmentDate > selectedDateValue : false;
    })
    .sort((left, right) => `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`)), [appointments, selectedDateValue]);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Randevular</h1>
          <p className="text-slate-500 mt-1">Takviminizi ve görüşmelerinizi yönetin.</p>
        </div>
        <button 
          onClick={openCreateModal}
          disabled={clientState.status === 'loading' || clientState.status === 'error'}
          className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl font-medium shadow-sm transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          <span>Yeni Randevu</span>
        </button>
      </header>

      {(error || mutationError || clientState.status === 'error') && (
        <div role="alert" className="mb-6 flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {mutationError || error || (clientState.status === 'error' ? clientState.message : '')}
          </span>
          <div className="flex gap-2">
            {error && (
              <button type="button" onClick={() => void refreshAppointments()} className="rounded-lg border border-rose-200 px-3 py-2 font-semibold hover:bg-rose-100">
                Randevuları tekrar dene
              </button>
            )}
            {clientState.status === 'error' && (
              <button type="button" onClick={() => void loadClients()} className="rounded-lg border border-rose-200 px-3 py-2 font-semibold hover:bg-rose-100">
                Danışanları tekrar dene
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left: Calendar & Mini Calendar (Simulated) */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
             <div className="flex items-center justify-between mb-6">
                <button onClick={() => changeDate(-1)} className="p-2 hover:bg-slate-50 rounded-full text-slate-500"><ChevronLeft className="w-5 h-5" /></button>
                <div className="text-center">
                   <h3 className="font-bold text-slate-800 text-lg">
                      {selectedDateValue.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric', day: 'numeric' })}
                   </h3>
                   <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">
                      {selectedDateValue.toLocaleDateString('tr-TR', { weekday: 'long' })}
                   </p>
                </div>
                <button onClick={() => changeDate(1)} className="p-2 hover:bg-slate-50 rounded-full text-slate-500"><ChevronRight className="w-5 h-5" /></button>
             </div>
             
             {/* Simple List View for the selected date */}
             <div className="space-y-3">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm font-medium text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin" /> Randevular yükleniyor...
                  </div>
                ) : error ? (
                  <div className="py-12 text-center">
                    <p className="text-sm font-medium text-rose-600">Randevular gösterilemiyor.</p>
                    <button type="button" onClick={() => void refreshAppointments()} className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-primary">
                      <RefreshCw className="h-4 w-4" /> Tekrar dene
                    </button>
                  </div>
                ) : appointmentsByDate.length > 0 ? (
                  appointmentsByDate.map((apt) => (
                    <div key={apt.id} className="group flex gap-4 p-3 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all relative">
                       <div className="flex flex-col items-center min-w-[3rem]">
                          <span className="font-bold text-slate-800">{apt.time}</span>
                          <span className="text-[10px] text-slate-400">{apt.duration} dk</span>
                       </div>
                       <div className="w-1 rounded-full bg-slate-200 group-hover:bg-primary transition-colors"></div>
                       <div className="flex-1">
                          <h4 className="font-bold text-slate-800 text-sm">{apt.title}</h4>
                          <p className="text-xs text-slate-500">{apt.clientName}</p>
                          <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium mt-1.5 border ${getStatusColor(apt.type)}`}>
                             {getIcon(apt.type)}
                             {apt.type}
                          </div>
                       </div>
                       
                       <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-all group-hover:opacity-100 group-focus-within:opacity-100">
                         <button
                           type="button"
                           onClick={() => openEditModal(apt)}
                           disabled={pendingAction !== null}
                           className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-primary disabled:opacity-50"
                           aria-label={`${apt.title} randevusunu düzenle`}
                         >
                           <Edit2 className="h-4 w-4" />
                         </button>
                         <button
                           type="button"
                           onClick={() => void handleDelete(apt)}
                           disabled={pendingAction !== null}
                           className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                           aria-label={`${apt.title} randevusunu sil`}
                         >
                           {pendingAction === `delete:${apt.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                         </button>
                       </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12">
                     <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-300">
                        <CalendarIcon className="w-8 h-8" />
                     </div>
                     <p className="text-slate-500 font-medium">Bu tarihte randevu yok.</p>
                     <button onClick={openCreateModal} disabled={clientState.status !== 'success'} className="text-primary text-sm font-bold mt-2 hover:underline disabled:opacity-50">Oluştur</button>
                  </div>
                )}
             </div>
          </div>
        </div>

        {/* Right: All Upcoming (Preview) or specific stats */}
        <div className="lg:col-span-2 space-y-6">
           {/* Quick Stats */}
           <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                 <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Video className="w-5 h-5" /></div>
                    <span className="text-sm font-medium text-slate-500">Görüntülü Görüşme</span>
                 </div>
                 <p className="text-2xl font-bold text-slate-800">
                    {appointmentsByDate.filter(a => a.type === 'Görüntülü Görüşme').length}
                 </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                 <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><MapPin className="w-5 h-5" /></div>
                    <span className="text-sm font-medium text-slate-500">Yüzyüze</span>
                 </div>
                 <p className="text-2xl font-bold text-slate-800">
                    {appointmentsByDate.filter(a => a.type === 'Yüzyüze').length}
                 </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                 <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><Phone className="w-5 h-5" /></div>
                    <span className="text-sm font-medium text-slate-500">Telefon</span>
                 </div>
                 <p className="text-2xl font-bold text-slate-800">
                    {appointmentsByDate.filter(a => a.type === 'Telefon Görüşmesi').length}
                 </p>
              </div>
           </div>

           {/* Next 3 Days Preview */}
           <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <h3 className="font-bold text-slate-800 mb-6">Yaklaşan Diğer Randevular</h3>
              <div className="space-y-4">
                 {upcomingAppointments
                   .slice(0, 5)
                   .map(apt => (
                      <div key={apt.id} className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl border border-slate-100">
                         <div className="flex items-center gap-4">
                            <div className="bg-white p-3 rounded-lg border border-slate-200 text-center min-w-[4rem]">
                               <p className="text-xs text-slate-500 uppercase font-bold">{parseLocalDate(apt.date)?.toLocaleDateString('tr-TR', { month: 'short' })}</p>
                               <p className="text-xl font-bold text-slate-800">{parseLocalDate(apt.date)?.getDate()}</p>
                            </div>
                            <div>
                               <h4 className="font-bold text-slate-800">{apt.title}</h4>
                               <p className="text-sm text-slate-500">{apt.clientName} • {apt.time}</p>
                            </div>
                         </div>
                         <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${getStatusColor(apt.type)}`}>
                            {apt.type}
                         </div>
                      </div>
                   ))
                 }
                 {upcomingAppointments.length === 0 && (
                    <p className="text-slate-400 text-sm text-center py-4">Gelecek planlı randevu bulunmuyor.</p>
                 )}
              </div>
           </div>
        </div>
      </div>

      {/* CREATE / EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
               <h2 className="text-xl font-bold text-slate-800">{editingAppointment ? 'Randevuyu Düzenle' : 'Yeni Randevu Oluştur'}</h2>
               <button type="button" onClick={() => setIsModalOpen(false)} disabled={pendingAction !== null} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 disabled:opacity-50">
                  <X className="w-5 h-5" />
               </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
               {mutationError && (
                 <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                   <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {mutationError}
                 </div>
               )}
               {/* Client Selection */}
               <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Danışan Seçimi</label>
                  <div className="relative">
                     <select 
                       required
                       value={formData.clientId}
                       onChange={(e) => setFormData({...formData, clientId: e.target.value})}
                       className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary appearance-none"
                     >
                        <option value="">Seçiniz...</option>
                        {activeClients.map(client => (
                           <option key={client.id} value={client.id}>{client.name}</option>
                        ))}
                     </select>
                     <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  </div>
                  {selectedClientForForm && (
                     <div className="flex items-center gap-2 mt-2 bg-emerald-50 p-2 rounded-lg border border-emerald-100">
                        <img src={selectedClientForForm.profilePhotoUrl || selectedClientForForm.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
                        <span className="text-xs font-medium text-emerald-700">{selectedClientForForm.goal} Hedefi</span>
                     </div>
                  )}
                  {clientState.status === 'loading' && <p className="mt-2 text-xs text-slate-500">Aktif danışanlar yükleniyor...</p>}
                  {clientState.status === 'success' && activeClients.length === 0 && <p className="mt-2 text-xs text-amber-700">Randevu oluşturulabilecek aktif danışan yok.</p>}
               </div>

               {/* Title */}
               <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Randevu Başlığı / Açıklama</label>
                  <input 
                    type="text"
                    required
                    placeholder="Örn: Haftalık Kontrol, Plan Değişikliği..."
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
               </div>

               {/* Type */}
               <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Görüşme Türü</label>
                  <div className="grid grid-cols-3 gap-2">
                     {APPOINTMENT_TYPES.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setFormData({...formData, type})}
                          className={`px-2 py-3 rounded-xl text-xs font-bold border transition-all ${
                             formData.type === type 
                             ? 'bg-primary text-white border-primary shadow-sm' 
                             : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                           {type.replace(' Görüşmesi', '')}
                        </button>
                     ))}
                  </div>
               </div>

               {/* Date & Time */}
               <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                     <label className="text-sm font-bold text-slate-700">Tarih</label>
                     <input 
                        type="date"
                        required
                        value={formData.date}
                        onChange={(e) => setFormData({...formData, date: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                     />
                  </div>
                  <div className="space-y-1.5">
                     <label className="text-sm font-bold text-slate-700">Saat</label>
                     <input 
                        type="time"
                        required
                        value={formData.time}
                        onChange={(e) => setFormData({...formData, time: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                     />
                  </div>
               </div>

               {/* Duration */}
               <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Süre</label>
                  <select
                     value={formData.duration}
                     onChange={(e) => setFormData({...formData, duration: Number(e.target.value)})}
                     className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                     {APPOINTMENT_DURATIONS.map((duration) => (
                       <option key={duration} value={duration}>{duration === 60 ? '1 Saat' : `${duration} Dakika`}</option>
                     ))}
                  </select>
               </div>

               <div className="pt-4 flex gap-3">
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)}
                    disabled={pendingAction !== null}
                    className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl border border-slate-200 transition-colors"
                  >
                     İptal
                  </button>
                  <button 
                    type="submit"
                    disabled={pendingAction !== null || clientState.status !== 'success' || activeClients.length === 0}
                    className="flex-1 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/30 hover:bg-primary-dark transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  >
                     {pendingAction === 'create' || pendingAction?.startsWith('update:') ? (
                       <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Kaydediliyor</span>
                     ) : editingAppointment ? 'Randevuyu Güncelle' : 'Randevu Oluştur'}
                  </button>
               </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Appointments;
