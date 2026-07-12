import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, Phone, Video, MoreVertical, Image as ImageIcon, FileText, Send, Smile } from 'lucide-react';
import { CONVERSATIONS, USER_AVATAR } from '../constants';

const Messages = () => {
  const navigate = useNavigate();
  const [activeConversationId, setActiveConversationId] = useState<string>(CONVERSATIONS[0].id);
  const activeConversation = CONVERSATIONS.find(c => c.id === activeConversationId) || CONVERSATIONS[0];
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeConversationId]);

  return (
    <div className="p-6 max-w-7xl mx-auto h-screen flex flex-col">
      {/* Header */}
      <header className="flex justify-between items-center mb-6 flex-shrink-0">
        <h1 className="text-3xl font-bold text-slate-800">Mesajlar</h1>
        <div className="flex items-center gap-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Danışan ara..."
              className="pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary w-64 text-sm transition-all"
            />
          </div>
          <button className="relative p-2.5 rounded-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
            <Bell className="w-5 h-5" />
            <span className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
          </button>
          <button onClick={() => navigate('/profile')} className="focus:outline-none hover:opacity-80 transition-opacity p-0 border-0 bg-transparent cursor-pointer rounded-full" aria-label="Profil sayfasına git" role="button">
            <img
            src={USER_AVATAR}
            alt="Profil"
            className="w-10 h-10 rounded-full border-2 border-white shadow-sm object-cover"
          />
          </button>
        </div>
      </header>

      {/* Chat Layout */}
      <div className="flex gap-6 flex-1 overflow-hidden">
        
        {/* Sidebar List */}
        <div className="w-1/3 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
             <h2 className="font-bold text-slate-700">Son Görüşmeler</h2>
          </div>
          <div className="overflow-y-auto flex-1">
             {CONVERSATIONS.map((conv) => (
               <div 
                 key={conv.id} 
                 onClick={() => setActiveConversationId(conv.id)}
                 className={`flex items-center gap-4 p-4 cursor-pointer transition-colors border-b border-slate-50 ${activeConversationId === conv.id ? 'bg-emerald-50/60' : 'hover:bg-slate-50'}`}
               >
                 <div className="relative">
                   <img src={conv.clientAvatar} alt={conv.clientName} className="w-12 h-12 rounded-full object-cover" />
                   {conv.isOnline && <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></span>}
                 </div>
                 <div className="flex-1 min-w-0">
                   <div className="flex justify-between items-baseline mb-1">
                     <h3 className={`font-semibold text-sm truncate ${activeConversationId === conv.id ? 'text-primary' : 'text-slate-800'}`}>{conv.clientName}</h3>
                     <span className="text-xs text-slate-400 flex-shrink-0">{conv.lastMessageTime}</span>
                   </div>
                   <p className="text-sm text-slate-500 truncate">{conv.lastMessage}</p>
                 </div>
               </div>
             ))}
          </div>
        </div>

        {/* Chat Window */}
        <div className="w-2/3 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
          
          {/* Chat Header */}
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white z-10">
            <div className="flex items-center gap-4">
               <img src={activeConversation.clientAvatar} alt={activeConversation.clientName} className="w-10 h-10 rounded-full object-cover" />
               <div>
                 <h3 className="font-bold text-slate-800">{activeConversation.clientName}</h3>
                 <p className="text-xs text-emerald-500 font-medium">Çevrimiçi</p>
               </div>
            </div>
            <div className="flex items-center gap-2">
               <button className="p-2 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded-full transition-colors"><Phone className="w-5 h-5" /></button>
               <button className="p-2 text-slate-400 hover:text-primary hover:bg-emerald-50 rounded-full transition-colors"><Video className="w-5 h-5" /></button>
               <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors"><MoreVertical className="w-5 h-5" /></button>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30">
             {activeConversation.messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] ${msg.sender === 'me' ? 'bg-primary text-white rounded-2xl rounded-tr-none' : 'bg-white border border-slate-100 text-slate-700 rounded-2xl rounded-tl-none shadow-sm'} p-4`}>
                    <p className="leading-relaxed text-sm">{msg.text}</p>
                    <p className={`text-[10px] mt-2 text-right ${msg.sender === 'me' ? 'text-emerald-100' : 'text-slate-400'}`}>{msg.time}</p>
                  </div>
                </div>
             ))}
             <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-white border-t border-slate-100">
             <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-2xl border border-slate-200">
                <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors hover:bg-white rounded-full"><ImageIcon className="w-5 h-5" /></button>
                <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors hover:bg-white rounded-full"><FileText className="w-5 h-5" /></button>
                <input 
                  type="text" 
                  placeholder="Bir mesaj yazın..." 
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-slate-700 placeholder-slate-400"
                />
                <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors hover:bg-white rounded-full"><Smile className="w-5 h-5" /></button>
                <button className="p-2 bg-primary text-white rounded-xl hover:bg-emerald-600 transition-colors shadow-sm">
                   <Send className="w-5 h-5" />
                </button>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Messages;
