import React, { useState, useEffect } from 'react';
import { Search, Bell, Plus, MessageSquare, Eye, MoreVertical, Calendar, TrendingUp, TrendingDown, Minus, RefreshCw, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { USER_AVATAR } from '../../../shared/constants';
import { Client } from '../../../shared/types';
import { fetchDietitianClients, addClientByEmail } from '../services/clientService';

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
          <img src={client.avatar} alt={client.name} className="w-10 h-10 rounded-full object-cover ring-2 ring-transparent group-hover:ring-primary/20 transition-all" />
          <div>
            <p className="font-semibold text-slate-800">{client.name}</p>
            <p className="text-xs text-slate-500">{client.email}</p>
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
          client.status === 'Aktif' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
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
            {client.duration}
        </div>
      </td>
      <td className="px-6 py-4 text-slate-800 font-semibold">{client.currentWeight}</td>
      <td className="px-6 py-4">
        {client.weeklyChange < 0 ? (
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
            <button className="p-2 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded-full transition-colors">
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
          <img src={client.avatar} alt={client.name} className="w-12 h-12 rounded-full object-cover ring-2 ring-white shadow-sm" />
          <div>
            <h3 className="font-bold text-slate-800">{client.name}</h3>
            <p className="text-xs text-slate-500">{client.email}</p>
          </div>
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
          client.status === 'Aktif' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
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
             {client.duration}
           </div>
        </div>
        <div className="bg-slate-50 p-3 rounded-lg">
           <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Güncel Kilo</p>
           <p className="text-sm font-bold text-slate-800">{client.currentWeight}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-lg">
           <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold mb-1">Haftalık Değişim</p>
           {client.weeklyChange < 0 ? (
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
            <button className="p-2 bg-slate-50 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded-lg transition-colors">
              <Eye className="w-4 h-4" />
            </button>
         </div>
      </div>
    </div>
  );
};

const ClientsPage = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Client Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newClientEmail, setNewClientEmail] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addFeedback, setAddFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const loadClients = async () => {
    try {
      setLoading(true);
      const data = await fetchDietitianClients();
      if (data && data.length > 0) {
        setClients(data);
      } else {
        setClients([]);
      }
    } catch (err) {
      console.error("Failed to fetch clients:", err);
      setClients([]);
    } finally {
      setLoading(false);
    }
  };

  // Load clients from Supabase on mount
  useEffect(() => {
    loadClients();
  }, []);

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientEmail.trim()) {
      setAddFeedback({ type: 'error', message: 'Lütfen geçerli bir e-posta adresi giriniz.' });
      return;
    }

    setIsAdding(true);
    setAddFeedback(null);

    try {
      const result = await addClientByEmail(newClientEmail);
      
      switch (result.status) {
        case 'success':
          setAddFeedback({ type: 'success', message: 'Danışan başarıyla eklendi.' });
          setNewClientEmail('');
          // Refresh the client list
          await loadClients();
          // Close modal after a short delay
          setTimeout(() => {
            setIsAddModalOpen(false);
            setAddFeedback(null);
          }, 2000);
          break;
        case 'not_found':
          setAddFeedback({ type: 'error', message: 'Bu e-posta ile kayıtlı bir danışan bulunamadı. Lütfen danışanınızın önce mobil uygulamadan kayıt olmasını isteyin.' });
          break;
        case 'invalid_role':
          setAddFeedback({ type: 'error', message: 'Bu e-posta bir danışan hesabına ait değil.' });
          break;
        case 'already_linked':
          setAddFeedback({ type: 'error', message: 'Bu danışan zaten hesabınıza bağlı.' });
          break;
        case 'error':
          setAddFeedback({ type: 'error', message: result.message || 'Bir hata oluştu. Lütfen tekrar deneyin.' });
          break;
      }
    } catch (err) {
      setAddFeedback({ type: 'error', message: 'Beklenmeyen bir hata oluştu.' });
    } finally {
      setIsAdding(false);
    }
  };

  // Filter and split clients
  const filteredClients = clients.filter(client => 
    client.name.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const activeClients = filteredClients.filter(c => c.status === 'Aktif');
  const passiveClients = filteredClients.filter(c => c.status === 'Pasif');

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen md:h-screen flex flex-col">
       {/* Responsive Header */}
       <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-4 flex-shrink-0">
        <div className="w-full md:w-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Danışan Listesi</h1>
            <p className="text-slate-500 mt-1 text-sm md:text-base">Danışan ilerlemesini yönetin.</p>
          </div>
          {/* Mobile Profile Pic (visible only on small screens) */}
          <div className="md:hidden">
             <img src={USER_AVATAR} alt="Profil" className="w-10 h-10 rounded-full border border-slate-200 object-cover" />
          </div>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button 
            onClick={() => {
              setIsAddModalOpen(true);
              setAddFeedback(null);
              setNewClientEmail('');
            }}
            className="flex-1 md:flex-none justify-center items-center gap-2 bg-primary hover:bg-primary-dark text-white px-5 py-2.5 rounded-xl font-medium shadow-sm transition-all active:scale-95 text-sm md:text-base flex"
          >
             <Plus className="w-5 h-5" />
             <span className="md:inline">Yeni Danışan</span>
          </button>
          
          <div className="hidden md:block w-px h-8 bg-slate-200 mx-2"></div>
          
          <button className="hidden md:block p-2.5 rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
            <Bell className="w-5 h-5" />
          </button>
          
          <img
            src={USER_AVATAR}
            alt="Profil"
            className="hidden md:block w-10 h-10 rounded-full border border-slate-200 object-cover"
          />
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
                  placeholder="İsme göre filtrele..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full md:w-64 pl-9 pr-4 py-3 md:py-2 rounded-xl md:rounded-lg border border-slate-200 bg-white md:bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm transition-all shadow-sm md:shadow-none"
                />
             </div>
             <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0 hide-scrollbar">
                <button className="flex-1 md:flex-none whitespace-nowrap px-4 py-2.5 md:py-2 text-sm font-medium text-slate-600 bg-white md:bg-slate-50 rounded-xl md:rounded-lg border border-slate-200 hover:bg-slate-50 shadow-sm md:shadow-none">Dışa Aktar</button>
                <button className="flex-1 md:flex-none whitespace-nowrap px-4 py-2.5 md:py-2 text-sm font-medium text-slate-600 bg-white md:bg-slate-50 rounded-xl md:rounded-lg border border-slate-200 hover:bg-slate-50 shadow-sm md:shadow-none">Filtrele</button>
             </div>
        </div>
        
        {/* Scrollable Content Area */}
        <div className="overflow-visible md:overflow-auto flex-1">
          {loading ? (
             <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
                <RefreshCw className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm font-medium">Danışanlar yükleniyor...</p>
             </div>
          ) : clients.length === 0 && !searchTerm ? (
             <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <div className="bg-slate-50 p-4 rounded-full mb-4">
                  <Search className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 mb-1">Henüz danışanınız yok</h3>
                <p className="text-sm text-slate-500">İlk danışanınızı eklediğinizde burada görünecek.</p>
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
                  {activeClients.length === 0 && searchTerm && passiveClients.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                        Arama kriterlerine uygun aktif danışan bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>

                {passiveClients.length > 0 && (
                  <tbody className="divide-y divide-slate-100 bg-slate-50/50 border-t-2 border-slate-200">
                    <tr>
                      <td colSpan={8} className="px-6 py-3 bg-slate-100 border-b border-slate-200">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                          Pasif Danışanlar
                        </p>
                      </td>
                    </tr>
                    {passiveClients.map((client) => (
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
                
                {activeClients.length === 0 && searchTerm && passiveClients.length === 0 && (
                    <div className="text-center py-10 text-slate-500">
                      Arama kriterlerine uygun danışan bulunamadı.
                    </div>
                )}

                {passiveClients.length > 0 && (
                    <div className="pt-4">
                      <div className="flex items-center gap-2 mb-3 px-1">
                          <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pasif Danışanlar</p>
                      </div>
                      <div className="space-y-4">
                          {passiveClients.map((client) => (
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
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
               <h2 className="text-xl font-bold text-slate-800">Yeni Danışan Ekle</h2>
               <button 
                 onClick={() => setIsAddModalOpen(false)} 
                 className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500"
                 disabled={isAdding}
               >
                  <X className="w-5 h-5" />
               </button>
            </div>
            
            <form onSubmit={handleAddClient} className="p-6 space-y-5">
               <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Danışan E-posta Adresi</label>
                  <p className="text-xs text-slate-500 mb-2">Danışanınızın mobil uygulamaya kayıt olurken kullandığı e-posta adresini girin.</p>
                  <input 
                    type="email"
                    required
                    placeholder="ornek@email.com"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                    disabled={isAdding}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
                  />
               </div>

               {addFeedback && (
                 <div className={`p-4 rounded-xl flex items-start gap-3 text-sm ${
                   addFeedback.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
                 }`}>
                   {addFeedback.type === 'success' ? (
                     <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                   ) : (
                     <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                   )}
                   <p className="font-medium leading-relaxed">{addFeedback.message}</p>
                 </div>
               )}

               <div className="pt-2 flex gap-3">
                  <button 
                    type="button" 
                    onClick={() => setIsAddModalOpen(false)}
                    disabled={isAdding}
                    className="flex-1 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl border border-slate-200 transition-colors text-sm disabled:opacity-50"
                  >
                     İptal
                  </button>
                  <button 
                    type="submit"
                    disabled={isAdding || !newClientEmail.trim()}
                    className="flex-1 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/30 hover:bg-primary-dark transition-colors text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                     {isAdding ? (
                       <>
                         <RefreshCw className="w-4 h-4 animate-spin" />
                         Ekleniyor...
                       </>
                     ) : (
                       'Danışanı Ekle'
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
