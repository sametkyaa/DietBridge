import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  BarChart2,
  UtensilsCrossed,
  BookOpen,
  MessageSquare,
  FileEdit,
  Settings,
  LogOut,
  Calendar
} from 'lucide-react';
import { APP_LOGO } from '../constants';

const Sidebar = () => {
  const navItems = [
    { icon: LayoutDashboard, label: 'Kontrol Paneli', path: '/' },
    { icon: Calendar, label: 'Randevular', path: '/appointments' },
    { icon: Users, label: 'Danışanlar', path: '/clients' },
    { icon: BarChart2, label: 'Analizler', path: '/analytics' },
    { icon: UtensilsCrossed, label: 'Beslenme Planları', path: '/meal-plans' },
    { icon: BookOpen, label: 'Tarifler', path: '/recipes' },
    { icon: MessageSquare, label: 'Mesajlar', path: '/messages' },
    { icon: FileEdit, label: 'Notlar', path: '/notes' },
    { icon: Settings, label: 'Ayarlar', path: '/settings' },
  ];

  // Subset for mobile bottom nav to avoid overcrowding
  const mobileNavItems = [
    navItems[0], // Dashboard
    navItems[1], // Appointments
    navItems[2], // Clients
    navItems[4], // Meal Plans
    navItems[6], // Messages
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 bg-white border-r border-slate-200 h-screen fixed left-0 top-0 flex-col justify-between z-20">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-10">
            <img src={APP_LOGO} alt="DietBridge Logo" className="w-10 h-10 object-contain" />
            <span className="text-2xl font-bold text-slate-800 tracking-tight">DietBridge</span>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
                    isActive
                      ? 'bg-emerald-50 text-primary font-semibold shadow-sm'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      className={`w-5 h-5 ${isActive ? 'text-primary' : 'text-slate-400 group-hover:text-slate-600'}`}
                    />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="p-6 border-t border-slate-100">
          <button className="flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-red-500 transition-colors w-full rounded-xl hover:bg-red-50">
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Çıkış Yap</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 px-2 py-2 flex justify-around items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        {mobileNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${
                isActive ? 'text-primary' : 'text-slate-400 hover:text-slate-600'
              }`
            }
          >
            <item.icon className="w-6 h-6" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
};

export default Sidebar;