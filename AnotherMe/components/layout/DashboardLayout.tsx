'use client';

import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileDrawer } from './MobileDrawer';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F3F2EE] dark:bg-slate-950 flex font-sans text-gray-900 dark:text-gray-100 transition-colors">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile Drawer */}
      <MobileDrawer />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop Header */}
        <div className="hidden md:block">
          <Header />
        </div>

        {/* Main Content */}
        <main className="min-h-0 flex-1 p-4 pt-[60px] pb-safe md:p-8">
          <div className="mx-auto min-h-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
