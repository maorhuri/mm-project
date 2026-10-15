const TZ = 'Asia/Jerusalem';

const dateTime = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ });
const dateOnly = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeZone: TZ });
const number = new Intl.NumberFormat('he-IL');
const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  return dateTime.format(new Date(value));
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  return dateOnly.format(new Date(value));
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return number.format(value);
}

export function formatIls(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return ils.format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function relativeTime(value: Date | string): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60_000);
  const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}
