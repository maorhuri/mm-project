import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck,
  BarChart3,
  Bot,
  CalendarDays,
  Clapperboard,
  Images,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  Palette,
  Plug,
  Send,
  Settings,
  Share2,
  Sparkles,
  Users,
  Wallet,
  Workflow,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roadmap phase; undefined = built in Phase 1. */
  phase?: number;
  /** Module key for the honest "not built yet" page. */
  module?: string;
}

/** Main navigation (PRD §18). Items with `phase` route to a status page until built. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/app', label: 'סקירה', icon: LayoutDashboard },
  { href: '/app/brands', label: 'מותגים', icon: Palette },
  { href: '/app/modules/strategy', label: 'אסטרטגיית AI', icon: Sparkles, phase: 2, module: 'strategy' },
  { href: '/app/modules/creative', label: 'סטודיו קריאייטיב', icon: Lightbulb, phase: 2, module: 'creative' },
  { href: '/app/modules/video', label: 'סטודיו וידאו', icon: Clapperboard, phase: 3, module: 'video' },
  { href: '/app/media', label: 'ספריית מדיה', icon: Images },
  { href: '/app/modules/calendar', label: 'לוח תוכן', icon: CalendarDays, phase: 4, module: 'calendar' },
  { href: '/app/modules/social-accounts', label: 'חשבונות סושיאל', icon: Share2, phase: 4, module: 'social-accounts' },
  { href: '/app/modules/publishing', label: 'פרסום אורגני', icon: Send, phase: 4, module: 'publishing' },
  { href: '/app/modules/ads', label: 'מנהל קמפיינים', icon: Megaphone, phase: 5, module: 'ads' },
  { href: '/app/modules/crm', label: 'לידים ו-CRM', icon: Users, phase: 6, module: 'crm' },
  { href: '/app/modules/analytics', label: 'אנליטיקה', icon: BarChart3, phase: 5, module: 'analytics' },
  { href: '/app/modules/insights', label: 'תובנות AI', icon: Bot, phase: 6, module: 'insights' },
  { href: '/app/modules/automations', label: 'אוטומציות', icon: Workflow, phase: 4, module: 'automations' },
  { href: '/app/approvals', label: 'מרכז אישורים', icon: BadgeCheck },
  { href: '/app/modules/budget', label: 'מרכז תקציב', icon: Wallet, phase: 5, module: 'budget' },
  { href: '/app/integrations', label: 'אינטגרציות', icon: Plug },
  { href: '/app/settings', label: 'הגדרות', icon: Settings },
];

export interface ModuleInfo {
  key: string;
  title: string;
  phase: number;
  summary: string;
  deliverables: string[];
}

/** Honest status for modules not yet built (no fake screens, no demo numbers). */
export const MODULES: Record<string, ModuleInfo> = {
  strategy: {
    key: 'strategy',
    title: 'אסטרטגיית AI',
    phase: 2,
    summary: 'סוכן שיווק מרכזי לכל מותג: יעדים, קהלים, מתחרים, מילות מפתח, תכנון תוכן וקמפיינים.',
    deliverables: ['AI Router רב-ספקי', 'ניהול עלויות AI', 'המלצות עם מקור נתונים ורמת ביטחון'],
  },
  creative: {
    key: 'creative',
    title: 'סטודיו קריאייטיב',
    phase: 2,
    summary: 'פוסטים, קרוסלות, באנרים ו-Stories ממותגים עם שכבות טיפוגרפיה עבריות הניתנות לעריכה.',
    deliverables: ['יצירת טקסטים ותמונות', 'תבניות מיתוג', 'עורך Drag & Drop', 'גרסאות וייצוא'],
  },
  video: {
    key: 'video',
    title: 'סטודיו וידאו',
    phase: 3,
    summary: 'תסריט → Storyboard → קליפים → קריינות וכתוביות בעברית → הרכבה עם Remotion/FFmpeg.',
    deliverables: ['תקציב ותמחור לפני רינדור', 'תורי רינדור', 'Preview ואישור', 'MP4 בכמה יחסי מסך'],
  },
  calendar: {
    key: 'calendar',
    title: 'לוח תוכן',
    phase: 4,
    summary: 'תוכנית תוכן חודשית אוטומטית לכל מותג, עם אישור מרוכז לפני תזמון.',
    deliverables: ['יצירת תוכנית חודשית', 'מניעת תוכן כפול', 'גרסאות לכל ערוץ'],
  },
  'social-accounts': {
    key: 'social-accounts',
    title: 'חשבונות סושיאל',
    phase: 4,
    summary: 'חיבור OAuth רשמי לעמודי Facebook ולחשבונות Instagram עסקיים.',
    deliverables: ['Meta OAuth', 'שמירת הרשאות מוצפנת', 'סטטוס חיבור'],
  },
  publishing: {
    key: 'publishing',
    title: 'פרסום אורגני',
    phase: 4,
    summary: 'תזמון ופרסום פוסטים, תמונות וסרטונים דרך ה-API הרשמי, רק אחרי אישור.',
    deliverables: ['Scheduler', 'Idempotency נגד פרסום כפול', 'סטטוס ושגיאות', 'נתוני ביצועים'],
  },
  ads: {
    key: 'ads',
    title: 'מנהל קמפיינים',
    phase: 5,
    summary: 'Meta Ads ו-Google Ads: קריאה תחילה, יצירת קמפיינים מושהים, שום הוצאה ללא אישור מפורש.',
    deliverables: ['חיבור חשבונות פרסום', 'טעינת קמפיינים ונתונים', 'טיוטות מושהות', 'אישורי תקציב'],
  },
  crm: {
    key: 'crm',
    title: 'לידים ו-CRM',
    phase: 6,
    summary: 'מעקב לידים ממקור עד מכירה, ייחוס לקמפיין, סטטוסים, WhatsApp.',
    deliverables: ['קליטת לידים', 'סטטוסים', 'ייחוס UTM', 'CPL / CAC אמיתיים'],
  },
  analytics: {
    key: 'analytics',
    title: 'אנליטיקה',
    phase: 5,
    summary: 'דוחות יומיים/שבועיים/חודשיים עם מקור נתונים וזמן סנכרון לכל מדד.',
    deliverables: ['Spend, CTR, CPC, CPL, CAC, ROAS', 'דוחות לפי מותג/ערוץ/מוצר', 'איכות נתונים'],
  },
  insights: {
    key: 'insights',
    title: 'תובנות AI',
    phase: 6,
    summary: 'המלצות שיפור מבוססות נתונים, עם ציון בסיס נתוני ורמת ביטחון.',
    deliverables: ['המלצות לקמפיינים', 'קריאייטיבים לעצור/לשכפל', 'קהלים לבחינה'],
  },
  automations: {
    key: 'automations',
    title: 'אוטומציות',
    phase: 4,
    summary: 'מנוע Background Jobs: תוכנית חודשית, תורי פרסום, סנכרון ביצועים, התראות.',
    deliverables: ['כללי אוטומציה', 'Retry מבוקר', 'Idempotency keys', 'התראות חריגה'],
  },
  budget: {
    key: 'budget',
    title: 'מרכז תקציב',
    phase: 5,
    summary: 'תקציב פרסום לפי מותג וערוץ, תקציב AI ווידאו, הוצאות בפועל והתראות חריגה.',
    deliverables: ['הפרדה בין הוצאות פרסום לעלויות מערכת', 'תחזיות', 'תקרות קשיחות'],
  },
};
