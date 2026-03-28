import React, { useState } from 'react';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin, 
  Video, 
  Phone, 
  Plus, 
  Search, 
  X, 
  User, 
  Check,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Trash2
} from 'lucide-react';
import { useAppointments } from '../features/appointments/context/AppointmentContext';
import { CLIENTS, USER_AVATAR } from '../constants';
import { Appointment, Client } from '../types';

const Appointments = () => {
  const { appointments, addAppointment, deleteAppointment } = useAppointments();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Form State
  const [formData, setFormData] = useState({
    clientId: '',
    title: '',
    date: new Date().toISOString().split('T')[0],
    time: '09:00',
    duration: '30dk',
    type: 'Görüntülü Görüşme' as Appointment['type']
  });

  const selectedClientForForm = CLIENTS.find(c => c.id === formData.clientId);

  // Group appointments by date
  const appointmentsByDate = appointments.filter(a => a.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time));

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.clientId || !formData.title) return;

    const client = CLIENTS.find(c => c.id === formData.clientId);
    
    const newAppointment: Appointment = {
      id: Date.now().toString(), // Temporary ID, DB will assign real one but context handles it
      clientId: formData.clientId,
      clientName: client?.name || 'Bilinmeyen Danışan',
      clientAvatar: client?.avatar,
      title: formData.title,
      date: formData.date,
      time: formData.time,
      duration: formData.duration,
      type: formData.type,
      status: 'upcoming'
    };

    addAppointment(newAppointment);
    setIsModalOpen(false);
    // Reset form slightly but keep date
    setFormData({ ...formData, title: '', clientId: '' });
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
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + days);
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Randevular</h1>
          <p className="text-slate-500 mt-1">Takviminizi ve görüşmelerinizi yönetin.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl font-medium shadow-sm transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          <span>Yeni Randevu</span>
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left: Calendar & Mini Calendar (Simulated) */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
             <div className="flex items-center justify-between mb-6">
                <button onClick={() => changeDate(-1)} className="p-2 hover:bg-slate-50 rounded-full text-slate-500"><ChevronLeft className="w-5 h-5" /></button>
                <div className="text-center">
                   <h3 className="font-bold text-slate-800 text-lg">
                      {new Date(selectedDate).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric', day: 'numeric' })}
                   </h3>
                   <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">
                      {new Date(selectedDate).toLocaleDateString('tr-TR', { weekday: 'long' })}
                   </p>
                </div>
                <button onClick={() => changeDate(1)} className="p-2 hover:bg-slate-50 rounded-full text-slate-500"><ChevronRight className="w-5 h-5" /></button>
             </div>
             
             {/* Simple List View for the selected date */}
             <div className="space-y-3">
                {appointmentsByDate.length > 0 ? (
                  appointmentsByDate.map((apt) => (
                    <div key={apt.id} className="group flex gap-4 p-3 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all relative">
                       <div className="flex flex-col items-center min-w-[3rem]">
                          <span className="font-bold text-slate-800">{apt.time}</span>
                          <span className="text-[10px] text-slate-400">{apt.duration}</span>
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
                       
                       <button 
                         onClick={() => deleteAppointment(apt.id)}
                         className="absolute top-2 right-2 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                         title="İptal Et"
                       >
                         <Trash2 className="w-4 h-4" />
                       </button>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12">
                     <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-300">
                        <CalendarIcon className="w-8 h-8" />
                     </div>
                     <p className="text-slate-500 font-medium">Bu tarihte randevu yok.</p>
                     <button onClick={() => setIsModalOpen(true)} className="text-primary text-sm font-bold mt-2 hover:underline">Oluştur</button>
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
                    <span className="text-sm font-medium text-slate-500">Online</span>
                 </div>
                 <p className="text-2xl font-bold text-slate-800">
                    {appointments.filter(a => a.type === 'Görüntülü Görüşme' && new Date(a.date) >= new Date()).length}
                 </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                 <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><MapPin className="w-5 h-5" /></div>
                    <span className="text-sm font-medium text-slate-500">Yüzyüze</span>
                 </div>
                 <p className="text-2xl font-bold text-slate-800">
                    {appointments.filter(a => a.type === 'Yüzyüze' && new Date(a.date) >= new Date()).length}
                 </p>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
                 <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><Phone className="w-5 h-5" /></div>
                    <span className="text-sm font-medium text-slate-500">Telefon</span>
                 </div>
                 <p className="text-2xl font-bold text-slate-800">
                    {appointments.filter(a => a.type === 'Telefon Görüşmesi' && new Date(a.date) >= new Date()).length}
                 </p>
              </div>
           </div>

           {/* Next 3 Days Preview */}
           <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <h3 className="font-bold text-slate-800 mb-6">Yaklaşan Diğer Randevular</h3>
              <div className="space-y-4">
                 {appointments
                   .filter(a => new Date(a.date) > new Date(selectedDate)) // Future from selected
                   .sort((a,b) => new Date(a.date + 'T' + a.time).getTime() - new Date(b.date + 'T' + b.time).getTime())
                   .slice(0, 5)
                   .map(apt => (
                      <div key={apt.id} className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl border border-slate-100">
                         <div className="flex items-center gap-4">
                            <div className="bg-white p-3 rounded-lg border border-slate-200 text-center min-w-[4rem]">
                               <p className="text-xs text-slate-500 uppercase font-bold">{new Date(apt.date).toLocaleDateString('tr-TR', { month: 'short' })}</p>
                               <p className="text-xl font-bold text-slate-800">{new Date(apt.date).getDate()}</p>
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
                 {appointments.filter(a => new Date(a.date) > new Date(selectedDate)).length === 0 && (
                    <p className="text-slate-400 text-sm text-center py-4">Gelecek planlı randevu bulunmuyor.</p>
                 )}
              </div>
           </div>
        </div>
      </div>

      {/* CREATE MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
               <h2 className="text-xl font-bold text-slate-800">Yeni Randevu Oluştur</h2>
               <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
                  <X className="w-5 h-5" />
               </button>
            </div>
            
            <form onSubmit={handleCreate} className="p-6 space-y-5">
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
                        {CLIENTS.map(c => (
                           <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                     </select>
                     <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  </div>
                  {selectedClientForForm && (
                     <div className="flex items-center gap-2 mt-2 bg-emerald-50 p-2 rounded-lg border border-emerald-100">
                        <img src={selectedClientForForm.avatar} className="w-6 h-6 rounded-full" />
                        <span className="text-xs font-medium text-emerald-700">{selectedClientForForm.goal} Hedefi</span>
                     </div>
                  )}
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
                     {['Görüntülü Görüşme', 'Yüzyüze', 'Telefon Görüşmesi'].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setFormData({...formData, type: type as any})}
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
                     onChange={(e) => setFormData({...formData, duration: e.target.value})}
                     className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                     <option value="15dk">15 Dakika</option>
                     <option value="30dk">30 Dakika</option>
                     <option value="45dk">45 Dakika</option>
                     <option value="60dk">1 Saat</option>
                  </select>
               </div>

               <div className="pt-4 flex gap-3">
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl border border-slate-200 transition-colors"
                  >
                     İptal
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/30 hover:bg-primary-dark transition-colors"
                  >
                     Randevu Oluştur
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