import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Card } from './card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  href?: string;
  tone?: 'default' | 'warning';
}

/** Single live number with its meaning — never a projection or demo value. */
export function StatCard({ label, value, hint, icon: Icon, href, tone = 'default' }: StatCardProps) {
  const body = (
    <Card className={cn('flex items-center gap-4 p-4 transition-colors', href && 'hover:bg-accent/40')}>
      {Icon ? (
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            tone === 'warning' ? 'bg-warning/20 text-foreground' : 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="size-5" />
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums leading-tight">{value}</p>
        {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
