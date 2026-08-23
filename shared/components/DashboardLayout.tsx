import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import NotificationDrawer from '../../features/notifications/components/NotificationDrawer';
import { NotificationCenterProvider } from '../../features/notifications/context/NotificationCenterContext';

const DashboardLayout = () => {
  return (
    <NotificationCenterProvider>
      <div className="flex h-screen w-full max-w-full overflow-hidden bg-background-light md:pl-64">
        <Sidebar />
        <main className="h-screen min-h-0 min-w-0 w-full max-w-full overflow-x-hidden overflow-y-auto md:pb-0">
          <Outlet />
        </main>
        <NotificationDrawer />
      </div>
    </NotificationCenterProvider>
  );
};

export default DashboardLayout;
