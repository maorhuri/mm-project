'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Bell, Check, ChevronDown, LogOut, Menu, Moon, Palette, Settings, Sun, User } from 'lucide-react';
import type { BrandSummary, SessionUser } from '@mm/core';
import type { Notification } from '@mm/db';
import { logoutAction, markAllNotificationsReadAction, switchBrandAction } from '@/app/app/shell-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TopbarProps {
  onMenu: () => void;
  user: SessionUser;
  brands: BrandSummary[];
  currentBrand: BrandSummary | null;
  notifications: Notification[];
  unreadCount: number;
}

export function Topbar({ onMenu, user, brands, currentBrand, notifications, unreadCount }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="פתיחת תפריט">
        <Menu />
      </Button>
      <BrandSwitcher brands={brands} current={currentBrand} />
      <div className="flex-1" />
      <NotificationsMenu notifications={notifications} unreadCount={unreadCount} />
      <ThemeToggle />
      <UserMenu user={user} />
    </header>
  );
}

function BrandSwitcher({ brands, current }: { brands: BrandSummary[]; current: BrandSummary | null }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-[60vw] gap-2 sm:max-w-xs" disabled={pending}>
          <Palette className="text-primary" />
          <span className="truncate">{current ? current.name : 'בחירת מותג'}</span>
          {current?.isDemo ? <Badge variant="warning">דמו</Badge> : null}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>מותגים</DropdownMenuLabel>
        {brands.length === 0 ? (
          <DropdownMenuItem disabled>אין מותגים זמינים</DropdownMenuItem>
        ) : (
          brands.map((b) => (
            <DropdownMenuItem
              key={b.id}
              onSelect={() => startTransition(() => switchBrandAction(b.id))}
              className={cn(b.id === current?.id && 'bg-accent')}
            >
              <span className="flex-1 truncate">{b.name}</span>
              {b.isDemo ? <Badge variant="warning">דמו</Badge> : null}
              {b.status !== 'ACTIVE' ? <Badge variant="muted">{statusLabel(b.status)}</Badge> : null}
              {b.id === current?.id ? <Check className="text-primary" /> : null}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/brands">ניהול מותגים</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function statusLabel(status: BrandSummary['status']): string {
  return status === 'PAUSED' ? 'מושהה' : status === 'ARCHIVED' ? 'בארכיון' : 'פעיל';
}

function NotificationsMenu({ notifications, unreadCount }: { notifications: Notification[]; unreadCount: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="התראות">
          <Bell />
          {unreadCount > 0 ? (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">התראות</span>
          {unreadCount > 0 ? (
            <button
              type="button"
              className="text-xs text-primary hover:underline disabled:opacity-50"
              disabled={pending}
              onClick={() => startTransition(() => markAllNotificationsReadAction())}
            >
              סמן הכל כנקרא
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">אין התראות</div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {notifications.map((n) => (
              <DropdownMenuItem key={n.id} asChild>
                <Link href={n.link ?? '/app'} className={cn('flex flex-col items-start gap-0.5', !n.readAt && 'bg-accent/50')}>
                  <span className="text-sm font-medium">{n.title}</span>
                  {n.body ? <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span> : null}
                  <span className="text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="החלפת ערכת נושא"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2" aria-label="תפריט משתמש">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {initials || <User className="size-4" />}
          </span>
          <span className="hidden max-w-[10rem] truncate text-sm sm:inline">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium text-foreground">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground" dir="ltr">
            {user.email}
          </div>
          {user.isSuperAdmin ? <Badge variant="secondary" className="mt-1">Super admin</Badge> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Settings /> הגדרות
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut /> התנתקות
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
