'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { NAV_ITEMS } from '@/lib/nav';
import type { NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  pendingApprovals: number;
}

export function Sidebar({ open, onClose, pendingApprovals }: SidebarProps) {
  const pathname = usePathname();
  const built = NAV_ITEMS.filter((i) => !i.phase);
  const planned = NAV_ITEMS.filter((i) => i.phase);

  const isActive = (item: NavItem) =>
    item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        className={cn(
          'group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-sidebar-accent font-medium text-foreground'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground',
          item.phase && 'text-sidebar-foreground/60',
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        {item.href === '/app/approvals' && pendingApprovals > 0 ? (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
            {pendingApprovals}
          </span>
        ) : null}
        {item.phase ? (
          <span className="rounded border px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
            שלב {item.phase}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} aria-hidden="true" />
      ) : null}
      <aside
        className={cn(
          'fixed inset-y-0 start-0 z-50 flex w-72 flex-col border-e bg-sidebar transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-64 lg:translate-x-0',
          open ? 'translate-x-0' : 'translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link href="/app" className="flex items-center gap-2 font-semibold" onClick={onClose}>
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              MM
            </span>
            <span>Marketing OS</span>
          </Link>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose} aria-label="סגירת תפריט">
            <X />
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">פעיל</p>
          <div className="flex flex-col gap-0.5">{built.map(renderItem)}</div>
          <p className="mb-1 mt-5 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            בפיתוח — לפי מפת הדרכים
          </p>
          <div className="flex flex-col gap-0.5">{planned.map(renderItem)}</div>
        </nav>
        <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">
          MM Marketing OS · שלבים 1–3 באוויר · Meta (קריאה)
        </div>
      </aside>
    </>
  );
}
