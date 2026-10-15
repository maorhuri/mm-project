/**
 * Seed: initial admin user, the MVN organization, and the first brands.
 * Idempotent — re-running never overwrites edited data or resets passwords.
 *
 *   npm run db:seed        (from the repo root)
 */
import { db } from '@mm/db';
import type { BrandStatus, Prisma } from '@mm/db';
import { getConfig } from './config';
import { logger } from './logger';
import { createUser } from './services/users';

interface SeedProduct {
  slug: string;
  name: string;
  category: string;
  description: string;
  features: string[];
  audiences: string[];
  sortOrder: number;
}

interface SeedBrand {
  slug: string;
  name: string;
  status: BrandStatus;
  isDemo: boolean;
  industry: string;
  websiteUrl: string | null;
  description: string;
  settings: Prisma.BrandSettingsUncheckedCreateInput;
  products: SeedProduct[];
}

const MVN: SeedBrand = {
  slug: 'mvn',
  name: 'MVN',
  status: 'ACTIVE',
  isDemo: false,
  industry: 'Cloud Hosting & Managed Infrastructure',
  websiteUrl: 'https://mvn.co.il',
  description:
    'אחסון אתרים, אחסון WordPress מנוהל, שרתי VPS ושרתים מנוהלים, גיבוי בענן, אבטחת אתרים ופתרונות תשתית לעסקים.',
  settings: {
    brandId: '', // filled at runtime
    tone: {
      voice: 'מקצועי, אמין וברור. עברית תקנית. מדברים אל בעלי עסקים ואנשי טכנולוגיה בגובה העיניים.',
      style: 'משפטים קצרים, תועלת לפני תכונה, קריאה לפעולה אחת בכל פוסט.',
      language: 'he-IL',
      doNots: [
        'אין להבטיח SLA, זמינות או ביצועים שלא אושרו בכתב',
        'אין להמציא מחירים, מבצעים או תכונות',
        'אין להשתמש בביקורות, לקוחות או מספרים פיקטיביים',
      ],
    },
    audiences: [
      { name: 'בעלי עסקים', description: 'עסקים קטנים ובינוניים עם אתר או חנות אונליין' },
      { name: 'בעלי אתרי WordPress', description: 'אתרים קיימים שמחפשים אחסון מהיר, מאובטח ומנוהל' },
      { name: 'חנויות WooCommerce', description: 'חנויות שצריכות ביצועים, גיבויים ותמיכה' },
      { name: 'סוכנויות דיגיטל ובוני אתרים', description: 'מנהלים אתרים רבים עבור לקוחות' },
      { name: 'מפתחים וחברות', description: 'צרכי VPS, שרתים מנוהלים ותשתית מורכבת' },
    ],
    keywords: ['אחסון אתרים', 'אחסון וורדפרס', 'אחסון WordPress מנוהל', 'שרת VPS', 'שרת מנוהל', 'גיבוי בענן', 'אבטחת אתרים'],
    hashtags: ['#MVN', '#אחסון_אתרים', '#וורדפרס', '#VPS'],
    ctaPresets: ['דברו איתנו', 'קבלו הצעת מחיר', 'התחילו עכשיו', 'לפרטים נוספים'],
    forbiddenClaims: ['100% זמינות', 'הזול ביותר בישראל', 'הטוב ביותר בישראל', 'אבטחה מוחלטת'],
    publishingMode: 'SEMI_AUTO',
    contentTargets: { marketingPosts: 6, professionalPosts: 4, securityPosts: 2, reels: 4 },
    monthlyAdBudgetIls: 3000,
  },
  products: [
    {
      slug: 'managed-wordpress-hosting',
      name: 'אחסון WordPress מנוהל',
      category: 'WordPress Hosting',
      description: 'אחסון מנוהל לאתרי WordPress ו-WooCommerce. נושאי פרסום: מהירות, אבטחה, תמיכה, גיבויים, העברת אתרים.',
      features: ['אחסון מנוהל ל-WordPress', 'גיבויים', 'אבטחת אתרים', 'העברת אתרים', 'תמיכה'],
      audiences: ['בעלי עסקים', 'בעלי אתרי WordPress', 'חנויות WooCommerce', 'סוכנויות דיגיטל'],
      sortOrder: 1,
    },
    {
      slug: 'web-hosting',
      name: 'אחסון אתרים',
      category: 'WordPress Hosting',
      description: 'אחסון אתרים לעסקים.',
      features: [],
      audiences: ['בעלי עסקים', 'בוני אתרים'],
      sortOrder: 2,
    },
    {
      slug: 'vps',
      name: 'שרתי VPS',
      category: 'VPS & Managed Servers',
      description: 'שרתים וירטואליים פרטיים. נושאי פרסום: משאבי מחשוב, ביצועים, אבטחת שרתים, גיבויים.',
      features: ['משאבי מחשוב ייעודיים', 'אבטחת שרתים', 'גיבויים'],
      audiences: ['מפתחים', 'חברות', 'סוכנויות'],
      sortOrder: 3,
    },
    {
      slug: 'managed-servers',
      name: 'שרתים מנוהלים',
      category: 'VPS & Managed Servers',
      description: 'שרתים מנוהלים עם ניהול תשתיות. נושאי פרסום: ניהול תשתיות, ביצועים, אבטחה.',
      features: ['ניהול תשתיות', 'אבטחת שרתים', 'גיבויים', 'ניטור'],
      audiences: ['חברות', 'עסקים עם צרכים טכנולוגיים מורכבים'],
      sortOrder: 4,
    },
    {
      slug: 'cloud-backup',
      name: 'גיבוי בענן',
      category: 'Services',
      description: 'שירותי גיבוי בענן לאתרים ושרתים.',
      features: [],
      audiences: ['בעלי עסקים', 'חברות'],
      sortOrder: 5,
    },
    {
      slug: 'website-security',
      name: 'אבטחת אתרים',
      category: 'Services',
      description: 'שירותי אבטחה לאתרים.',
      features: [],
      audiences: ['בעלי אתרים', 'חנויות WooCommerce'],
      sortOrder: 6,
    },
    {
      slug: 'business-infrastructure',
      name: 'פתרונות תשתית לעסקים',
      category: 'Services',
      description: 'פתרונות תשתית מותאמים לעסקים.',
      features: [],
      audiences: ['חברות', 'סוכנויות'],
      sortOrder: 7,
    },
  ],
};

const CONTINUO: SeedBrand = {
  slug: 'continuo-pilates',
  name: 'CONTINUO PILATES',
  status: 'PAUSED',
  isDemo: true,
  industry: 'Pilates Studio',
  websiteUrl: null,
  description: 'סטודיו פילאטיס בראשון לציון: פילאטיס מכשירים, מזרן ובר, שיעורי ניסיון ומנויים. מותג הדגמה — יופעל לאחר אימות מערכת MVN.',
  settings: {
    brandId: '',
    tone: { voice: 'חם, מזמין ואישי. פנייה ללקוחות פרטיים.', language: 'he-IL', doNots: ['אין להבטיח תוצאות בריאותיות'] },
    audiences: [{ name: 'לקוחות פרטיים', description: 'תושבי ראשון לציון והסביבה' }],
    keywords: ['פילאטיס ראשון לציון', 'פילאטיס מכשירים', 'שיעור ניסיון פילאטיס'],
    ctaPresets: ['קבעו שיעור ניסיון', 'דברו איתנו בוואטסאפ'],
    publishingMode: 'MANUAL',
    contentTargets: {},
  },
  products: [
    { slug: 'reformer-pilates', name: 'פילאטיס מכשירים', category: 'Classes', description: '', features: [], audiences: ['לקוחות פרטיים'], sortOrder: 1 },
    { slug: 'mat-pilates', name: 'פילאטיס מזרן', category: 'Classes', description: '', features: [], audiences: ['לקוחות פרטיים'], sortOrder: 2 },
    { slug: 'pilates-bar', name: 'פילאטיס בר', category: 'Classes', description: '', features: [], audiences: ['לקוחות פרטיים'], sortOrder: 3 },
    { slug: 'trial-class', name: 'שיעור ניסיון', category: 'Offers', description: '', features: [], audiences: ['לקוחות פרטיים'], sortOrder: 4 },
    { slug: 'studio-membership', name: 'מנוי לסטודיו', category: 'Offers', description: '', features: [], audiences: ['לקוחות פרטיים'], sortOrder: 5 },
  ],
};

async function upsertBrand(orgId: string, seed: SeedBrand): Promise<string> {
  const brand = await db.brand.upsert({
    where: { orgId_slug: { orgId, slug: seed.slug } },
    update: {},
    create: {
      orgId,
      slug: seed.slug,
      name: seed.name,
      status: seed.status,
      isDemo: seed.isDemo,
      industry: seed.industry,
      websiteUrl: seed.websiteUrl,
      description: seed.description,
    },
  });
  const { brandId: _ignored, ...settings } = seed.settings;
  await db.brandSettings.upsert({
    where: { brandId: brand.id },
    update: {},
    create: { ...settings, brandId: brand.id },
  });
  for (const p of seed.products) {
    await db.brandProduct.upsert({
      where: { brandId_slug: { brandId: brand.id, slug: p.slug } },
      update: {},
      create: {
        brandId: brand.id,
        slug: p.slug,
        name: p.name,
        category: p.category,
        description: p.description,
        features: p.features,
        audiences: p.audiences,
        pricingNote: 'יש לאמת מחירים ותכונות מול האתר לפני שימוש בפרסום',
        sortOrder: p.sortOrder,
      },
    });
  }
  return brand.id;
}

async function main(): Promise<void> {
  getConfig();
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Admin';
  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set');
  }

  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    const created = await createUser({ email, name, password, isSuperAdmin: true });
    user = await db.user.findUniqueOrThrow({ where: { id: created.id } });
    logger.info({ email }, 'seed: admin user created');
  } else {
    logger.info({ email }, 'seed: admin user exists (password unchanged)');
  }

  const org = await db.organization.upsert({
    where: { slug: 'mvn' },
    update: {},
    create: { name: 'MVN', slug: 'mvn' },
  });
  await db.membership.upsert({
    where: { userId_orgId: { userId: user.id, orgId: org.id } },
    update: { role: 'OWNER' },
    create: { userId: user.id, orgId: org.id, role: 'OWNER' },
  });

  const mvnId = await upsertBrand(org.id, MVN);
  const continuoId = await upsertBrand(org.id, CONTINUO);
  logger.info({ org: org.slug, brands: { mvn: mvnId, continuo: continuoId } }, 'seed: complete');
}

main()
  .catch((err) => {
    logger.error({ err }, 'seed failed');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
