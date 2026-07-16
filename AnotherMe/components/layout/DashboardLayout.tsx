'use client';

import { useState, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileDrawer } from './MobileDrawer';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => !v);
  }, []);

  return (
    <div className="h-mobile-screen bg-background flex overflow-hidden font-sans text-foreground transition-colors">
      {/* Desktop Sidebar */}
      <div className="hidden md:block shrink-0">
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      </div>

      {/* Mobile Drawer */}
      <MobileDrawer />

      {/* Main Content Area - this is the only scrollable region */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Desktop Header - sticky within the scrollable area */}
        <div className="hidden md:block sticky top-0 z-10 bg-background/90 backdrop-blur-sm">
          <Header />
        </div>

        {/* Main Content - pt-14 on mobile to offset the fixed MobileDrawer top bar (h-14 = 56px) */}
        <main className="flex-1 pt-14 p-4 pb-safe md:pt-0 md:p-8">
          <div className="mx-auto min-h-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
