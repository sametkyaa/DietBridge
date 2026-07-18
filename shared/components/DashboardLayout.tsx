import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const DashboardLayout = () => {
  return (
    <div className="flex min-h-screen w-full max-w-full overflow-x-hidden bg-background-light md:pl-64">
      <Sidebar />
      <main className="min-w-0 w-full max-w-full overflow-x-hidden pb-24 md:pb-0">
        <Outlet />
      </main>
    </div>
  );
};

export default DashboardLayout;
