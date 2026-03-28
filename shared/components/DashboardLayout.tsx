import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const DashboardLayout = () => {
  return (
    <div className="flex bg-background-light min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-64 ml-0 pb-24 md:pb-0 transition-all duration-300">
        <Outlet />
      </main>
    </div>
  );
};

export default DashboardLayout;
