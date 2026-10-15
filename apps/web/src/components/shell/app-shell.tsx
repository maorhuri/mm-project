'use client';

import { useState } from 'react';
import type { BrandSummary, SessionUser } from '@mm/core';
import type { Notification } from '@mm/db';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export interface AppShellProps {
  user: SessionUser;
  brands: BrandSummary[];
  currentBrand: BrandSummary | null;
  pendingApprovals: number;
  notifications: Notification[];
  unreadCount: number;
  children: React.ReactNode;
}

export function AppShell({
  user,
  brands,
  currentBrand,
  pendingApprovals,
  notifications,
  unreadCount,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <Sidebar open={open} onClose={() => setOpen(false)} pendingApprovals={pendingApprovals} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onMenu={() => setOpen(true)}
          user={user}
          brands={brands}
          currentBrand={currentBrand}
          notifications={notifications}
          unreadCount={unreadCount}
        />
        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
