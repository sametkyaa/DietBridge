import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  Plus, 
  MoreVertical, 
  Trash2, 
  Copy, 
  Save, 
  Tag, 
  Paperclip, 
  Bold, 
  Italic, 
  List, 
  AlignLeft, 
  Type, 
  Clock, 
  Calendar, 
  ChevronDown, 
  Pin, 
  Filter,
  FileText,
  User
} from 'lucide-react';
import { CLIENTS, USER_AVATAR } from '../constants';
import { Client } from '../types';

// --- Types ---
interface Note {
  id: string;
  title: string;
  content: string;
  date: string;
  lastUpdated: string;
  category?: string;
  clientId?: string | null;
  tags: string[];
  isPinned: boolean;
}

// --- Mock Data ---
const INITIAL_NOTES: Note[] = [
  { 
    id: '1', 
    title: 'Haftalık Toplantı Notları', 
    content: 'Bu hafta ekip toplantısında konuşulacaklar:\n\n- Yeni diyet listesi şablonlarının gözden geçirilmesi.\n- Kış dönemi blog yazıları için konu önerileri.\n- Danışan takip sistemindeki güncellemeler.', 
    date: '10 Eki 2023', 
    lastUpdated: '14:30', 
    category: 'İş', 
    clientId: null, 
    tags: ['Toplantı', 'Planlama'],
    isPinned: true 
  },
  { 
    id: '2', 
    title: 'Market Alışveriş Listesi Fikirleri', 
    content: 'Danışanlara gönderilecek pratik alışveriş listesi taslağı:\n\n1. Yulaf ezmesi (İnce öğütülmüş)\n2. Badem sütü (Şekersiz)\n3. Chia tohumu\n4. Yeşil elma\n5. Probiyotik yoğurt', 
    date: '08 Eki 2023', 
    lastUpdated: '09:15', 
    category: 'Beslenme', 
    clientId: null, 
    tags: ['Liste', 'İçerik'],
    isPinned: false
  },
  { 
    id: '3', 
    title: 'Ayşe - Kaçamak Analizi', 
    content: 'Hafta sonu tatlı krizleri artmış. Magnezyum takviyesi düşünülebilir. Kan tahlili sonuçlarını istedim, ferritin seviyelerine bakılacak.', 
    date: '12 Eki 2023', 
    lastUpdated: '16:45', 
    category: 'Gözlem', 
    clientId: '1', 
    tags: ['Beslenme', 'Uyarı'],
    isPinned: true
  },
  { 
    id: '4', 
    title: 'Mehmet - Supplement Planı', 
    content: 'Kreatin kullanımına 1 hafta ara verecek. Protein tozu markasını değiştirmek istiyor, izole protein önerildi. Antrenman sonrası BCAA ekleyebiliriz.', 
    date: '11 Eki 2023', 
    lastUpdated: '11:20', 
    category: 'Supplement', 
    clientId: '2', 
    tags: ['Spor'],
    isPinned: false
  },
];

const CATEGORIES = ['Tümü', 'İş', 'Beslenme', 'Gözlem', 'Supplement', 'Hatırlatma'];

const Notes = () => {
  const navigate = useNavigate();
  // --- State ---
  const [activeTab, setActiveTab] = useState<'general' | 'client'>('general');
  const [notes, setNotes] = useState<Note[]>(INITIAL_NOTES);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(CLIENTS[0]);
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('Tümü');

  // --- Derived Data ---
  const activeNote = notes.find(n => n.id === selectedNoteId);

  const filteredNotes = notes.filter(note => {
    // 1. Tab Filter
    const isGeneralTab = activeTab === 'general';
    if (isGeneralTab && note.clientId) return false;
    if (!isGeneralTab && note.clientId !== selectedClient?.id) return false;

    // 2. Search Filter
    const matchesSearch = 
      note.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      note.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    // 3. Category Filter
    const matchesCategory = selectedCategoryFilter === 'Tümü' || note.category === selectedCategoryFilter || note.tags.includes(selectedCategoryFilter);

    return matchesSearch && matchesCategory;
  }).sort((a, b) => (Number(b.isPinned) - Number(a.isPinned))); // Pinned first

  // --- Handlers ---
  const handleCreateNote = () => {
    const newNote: Note = {
      id: Date.now().toString(),
      title: '',
      content: '',
      date: new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }),
      lastUpdated: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      clientId: activeTab === 'client' ? selectedClient?.id : null,
      tags: [],
      isPinned: false,
      category: 'Genel'
    };
    setNotes([newNote, ...notes]);
    setSelectedNoteId(newNote.id);
  };

  const handleUpdateNote = (field: keyof Note, value: any) => {
    if (!selectedNoteId) return;
    setNotes(notes.map(n => n.id === selectedNoteId ? { ...n, [field]: value, lastUpdated: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) } : n));
  };

  const handleDeleteNote = (id: string) => {
    if (window.confirm('Bu notu silmek istediğinize emin misiniz?')) {
      setNotes(notes.filter(n => n.id !== id));
      if (selectedNoteId === id) setSelectedNoteId(null);
    }
  };

  const handleTogglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotes(notes.map(n => n.id === id ? { ...n, isPinned: !n.isPinned } : n));
  };

  return (
    <div className="flex h-screen bg-[#F7F8F8] font-inter overflow-hidden">
      
      {/* --- LEFT SIDEBAR: Notes List --- */}
      <aside className="w-[380px] bg-white border-r border-slate-200 flex flex-col h-full z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        
        {/* Header & Tabs */}
        <div className="p-6 pb-2">
           <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Notlar</h1>
              <div className="flex gap-2">
                 <button className="p-2 text-slate-400 hover:text-diet-green hover:bg-emerald-50 rounded-lg transition-colors">
                    <Filter className="w-5 h-5" />
                 </button>
                 <button 
                    onClick={handleCreateNote}
                    className="flex items-center gap-2 bg-diet-green hover:bg-[#438736] text-white px-3 py-2 rounded-lg text-sm font-semibold shadow-sm transition-all active:scale-95"
                 >
                    <Plus className="w-4 h-4" /> Yeni Not
                 </button>
              </div>
           </div>

           {/* Tabs */}
           <div className="flex bg-slate-100/80 p-1 rounded-xl mb-6 relative">
              <button 
                 onClick={() => { setActiveTab('general'); setSelectedNoteId(null); }}
                 className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all z-10 ${
                    activeTab === 'general' ? 'bg-white text-diet-green shadow-sm' : 'text-slate-500 hover:text-slate-700'
                 }`}
              >
                 <FileText className="w-4 h-4" /> Genel
              </button>
              <button 
                 onClick={() => { setActiveTab('client'); setSelectedNoteId(null); }}
                 className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all z-10 ${
                    activeTab === 'client' ? 'bg-white text-diet-green shadow-sm' : 'text-slate-500 hover:text-slate-700'
                 }`}
              >
                 <User className="w-4 h-4" /> Danışan
              </button>
           </div>

           {/* Client Selector (Only in Client Tab) */}
           {activeTab === 'client' && (
             <div className="relative mb-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <button 
                  onClick={() => setIsClientDropdownOpen(!isClientDropdownOpen)}
                  className="w-full flex items-center justify-between bg-white border border-slate-200 hover:border-diet-green px-4 py-3 rounded-xl transition-all shadow-sm group"
                >
                   <div className="flex items-center gap-3">
                      <img src={selectedClient?.avatar} alt={selectedClient?.name} className="w-8 h-8 rounded-full object-cover ring-2 ring-slate-100 group-hover:ring-diet-green/30 transition-all" />
                      <div className="text-left">
                         <p className="text-xs text-slate-400 font-medium">Seçili Danışan</p>
                         <p className="text-sm font-bold text-slate-800">{selectedClient?.name}</p>
                      </div>
                   </div>
                   <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isClientDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isClientDropdownOpen && (
                   <>
                     <div className="fixed inset-0 z-20" onClick={() => setIsClientDropdownOpen(false)} />
                     <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 z-30 max-h-64 overflow-y-auto p-2">
                        {CLIENTS.map(client => (
                           <button
                             key={client.id}
                             onClick={() => { setSelectedClient(client); setIsClientDropdownOpen(false); setSelectedNoteId(null); }}
                             className="w-full flex items-center gap-3 p-2 hover:bg-emerald-50 rounded-lg transition-colors"
                           >
                              <img src={client.avatar} alt={client.name} className="w-8 h-8 rounded-full object-cover" />
                              <span className="text-sm font-medium text-slate-700">{client.name}</span>
                           </button>
                        ))}
                     </div>
                   </>
                )}
             </div>
           )}

           {/* Search Bar */}
           <div className="relative mb-2">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input 
                 type="text" 
                 placeholder="Notlarda ara..." 
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-diet-green focus:ring-1 focus:ring-diet-green transition-all placeholder:text-slate-400"
              />
           </div>
           
           {/* Tags / Quick Filters */}
           <div className="flex gap-2 overflow-x-auto pb-4 pt-2 hide-scrollbar">
              {CATEGORIES.map(cat => (
                 <button 
                   key={cat} 
                   onClick={() => setSelectedCategoryFilter(cat)}
                   className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${
                     selectedCategoryFilter === cat 
                        ? 'bg-diet-green text-white border-diet-green' 
                        : 'bg-white text-slate-600 border-slate-200 hover:border-diet-green/50 hover:text-diet-green'
                   }`}
                 >
                    {cat}
                 </button>
              ))}
           </div>
        </div>

        {/* Notes List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
           {filteredNotes.length > 0 ? (
             filteredNotes.map(note => (
                <div 
                   key={note.id}
                   onClick={() => setSelectedNoteId(note.id)}
                   className={`p-4 rounded-xl border transition-all cursor-pointer relative group ${
                      selectedNoteId === note.id 
                         ? 'bg-emerald-50/40 border-diet-green shadow-sm' 
                         : 'bg-white border-slate-100 hover:border-diet-green/30 hover:shadow-sm'
                   }`}
                >  
                   <div className="flex justify-between items-start mb-2">
                      <h3 className={`font-bold text-sm line-clamp-1 ${selectedNoteId === note.id ? 'text-diet-green' : 'text-slate-800'}`}>
                         {note.title || 'Başlıksız Not'}
                      </h3>
                      {note.isPinned && <Pin className="w-3.5 h-3.5 text-diet-green fill-diet-green rotate-45" />}
                   </div>
                   <p className="text-xs text-slate-500 line-clamp-2 mb-3 leading-relaxed">
                      {note.content || 'İçerik yok...'}
                   </p>
                   <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                         <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-1 rounded-md font-medium border border-slate-100">
                            {note.lastUpdated}
                         </span>
                         {note.category && (
                           <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Tag className="w-3 h-3 text-slate-300" /> {note.category}
                           </span>
                         )}
                      </div>
                      
                      {/* Hover Actions */}
                      <div className="hidden group-hover:flex gap-1 bg-white/80 backdrop-blur-sm rounded-lg pl-2">
                         <button 
                           onClick={(e) => handleTogglePin(note.id, e)}
                           className="p-1.5 text-slate-400 hover:text-diet-green hover:bg-emerald-50 rounded-md"
                         >
                            <Pin className="w-3.5 h-3.5" />
                         </button>
                         <button 
                           onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }}
                           className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md"
                         >
                            <Trash2 className="w-3.5 h-3.5" />
                         </button>
                      </div>
                   </div>
                </div>
             ))
           ) : (
             <div className="flex flex-col items-center justify-center h-48 text-center text-slate-400">
                <FileText className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm font-medium">Not bulunamadı</p>
                <p className="text-xs mt-1">Yeni bir not oluşturarak başlayın.</p>
             </div>
           )}
        </div>
      </aside>

      {/* --- RIGHT SIDE: Editor --- */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#F7F8F8]">
         {selectedNoteId && activeNote ? (
            <div className="h-full flex flex-col">
               {/* Editor Toolbar */}
               <div className="px-8 py-4 bg-white border-b border-slate-200 flex justify-between items-center shadow-sm z-10">
                  <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
                     <button className="p-2 text-slate-500 hover:text-diet-green hover:bg-white rounded-md transition-all" title="Kalın"><Bold className="w-4 h-4" /></button>
                     <button className="p-2 text-slate-500 hover:text-diet-green hover:bg-white rounded-md transition-all" title="İtalik"><Italic className="w-4 h-4" /></button>
                     <div className="w-px h-4 bg-slate-300 mx-1"></div>
                     <button className="p-2 text-slate-500 hover:text-diet-green hover:bg-white rounded-md transition-all" title="Liste"><List className="w-4 h-4" /></button>
                     <button className="p-2 text-slate-500 hover:text-diet-green hover:bg-white rounded-md transition-all" title="Başlık"><Type className="w-4 h-4" /></button>
                     <div className="w-px h-4 bg-slate-300 mx-1"></div>
                     <button className="p-2 text-slate-500 hover:text-diet-green hover:bg-white rounded-md transition-all" title="Dosya Ekle"><Paperclip className="w-4 h-4" /></button>
                  </div>

                  <div className="flex items-center gap-3">
                     <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" /> Son düzenleme: {activeNote.lastUpdated}
                     </span>
                     <div className="h-4 w-px bg-slate-200"></div>
                     <button 
                        onClick={() => handleDeleteNote(activeNote.id)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                     >
                        <Trash2 className="w-5 h-5" />
                     </button>
                     <button className="flex items-center gap-2 px-4 py-2 bg-diet-green text-white rounded-lg hover:bg-[#438736] transition-colors shadow-sm font-semibold text-sm">
                        <Save className="w-4 h-4" /> Kaydet
                     </button>
                  </div>
               </div>

               {/* Editor Content */}
               <div className="flex-1 overflow-y-auto p-8 md:p-12">
                  <div className="max-w-3xl mx-auto bg-white min-h-full rounded-2xl shadow-sm border border-slate-200/60 p-8 md:p-12 relative">
                     {/* Title Input */}
                     <input
                        type="text"
                        value={activeNote.title}
                        onChange={(e) => handleUpdateNote('title', e.target.value)}
                        placeholder="Not Başlığı..."
                        className="w-full text-3xl font-bold text-slate-800 placeholder-slate-300 border-none focus:ring-0 focus:outline-none bg-transparent mb-6"
                     />
                     
                     {/* Meta Tags Input Area */}
                     <div className="flex flex-wrap items-center gap-2 mb-8">
                        {activeNote.tags.map((tag, idx) => (
                           <span key={idx} className="px-2.5 py-1 rounded-md bg-emerald-50 text-diet-green text-xs font-semibold border border-emerald-100 flex items-center gap-1">
                              {tag}
                              <button 
                                 onClick={() => {
                                    const newTags = activeNote.tags.filter((_, i) => i !== idx);
                                    handleUpdateNote('tags', newTags);
                                 }}
                                 className="hover:text-emerald-800"
                              >
                                 &times;
                              </button>
                           </span>
                        ))}
                        <button 
                           onClick={() => {
                              const tag = prompt('Yeni etiket:');
                              if (tag) handleUpdateNote('tags', [...activeNote.tags, tag]);
                           }}
                           className="px-2.5 py-1 rounded-md bg-slate-50 text-slate-500 text-xs font-medium border border-slate-200 hover:bg-slate-100 flex items-center gap-1 transition-colors"
                        >
                           <Plus className="w-3 h-3" /> Etiket Ekle
                        </button>
                     </div>

                     {/* Main Content Area */}
                     <textarea
                        value={activeNote.content}
                        onChange={(e) => handleUpdateNote('content', e.target.value)}
                        placeholder="Düşüncelerinizi yazın..."
                        className="w-full h-[calc(100%-150px)] resize-none text-slate-600 leading-relaxed text-base border-none focus:ring-0 focus:outline-none bg-transparent placeholder-slate-300"
                     />
                  </div>
               </div>
            </div>
         ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
               <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-200 mb-6">
                  <FileText className="w-10 h-10 text-diet-green/50" />
               </div>
               <h2 className="text-xl font-bold text-slate-700">Not Seçilmedi</h2>
               <p className="text-slate-500 mt-2 max-w-sm">
                  Görüntülemek veya düzenlemek için soldaki listeden bir not seçin ya da yeni bir not oluşturun.
               </p>
               <button 
                  onClick={handleCreateNote}
                  className="mt-6 px-6 py-2.5 bg-diet-green text-white rounded-xl hover:bg-[#438736] transition-all font-semibold shadow-sm"
               >
                  Yeni Not Oluştur
               </button>
            </div>
         )}
      </main>
    </div>
  );
};

export default Notes;