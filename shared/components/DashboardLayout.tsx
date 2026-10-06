import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import NotificationDrawer from '../../features/notifications/components/NotificationDrawer';
import { NotificationCenterProvider } from '../../features/notifications/context/NotificationCenterContext';

const DashboardLayout = () => {
  return (
    <NotificationCenterProvider>
      <div className="flex h-screen w-full max-w-full overflow-hidden bg-canvas md:pl-sidebar">
        <a
          href="#ana-icerik"
          className="sr-only z-[70] rounded-control bg-surface px-4 py-2 text-14 font-semibold text-brand shadow-pop focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          İçeriğe geç
        </a>
        <Sidebar />
        <main
          id="ana-icerik"
          tabIndex={-1}
          className="h-screen min-h-0 min-w-0 w-full max-w-full overflow-x-hidden overflow-y-auto pb-20 focus:outline-none md:pb-0"
        >
          <Outlet />
        </main>
        <NotificationDrawer />
      </div>
    </NotificationCenterProvider>
  );
};

export default DashboardLayout;
