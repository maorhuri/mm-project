# Roadmap

Phases follow the PRD (§22). A phase is "done" only when its acceptance
criteria (PRD §23) are exercised on the real server and recorded in
[../PROGRESS.md](../PROGRESS.md). The owner's stated priority after the
foundation is **paid advertising** — Phase 5 work (Meta Ads + Google Ads,
read-only first) is pulled forward right after the AI/creative basics needed to
produce ads.

## Phase 1 — Foundation (current)

Scope: monorepo, PostgreSQL schema + migrations, Redis/BullMQ worker, S3
storage, authentication (sessions, argon2id), organizations + brands + RBAC,
tenant-scoped data access, Brand Kit, Media Library, Hebrew RTL dashboard,
Approval Center base, audit log, notifications, auto-deploy pipeline, docs.

Exit criteria: login · create brand · switch brand · isolation tests green ·
migrations pass · production build served at https://mm-marketing.mymvn.app.

## Phase 2 — AI engine + Creative Studio — **v1 live (2026-10-16)**

Delivered (see [PROGRESS.md](../PROGRESS.md) for verification status):

- Provider adapters: OpenAI (text, images, TTS), Anthropic (text), Google
  (text, images) + clearly labelled mocks (never in production for non-demo
  brands). Model ids/prices only in `packages/core/src/ai/catalog.ts`.
- AI engine: task → candidates by tier/quality from the catalog, fallback
  across candidates, every call in `ai_runs` with its ILS cost, monthly cap per
  brand (`AI_MONTHLY_BUDGET_ILS`, soft limit at 80 % → economy tier), single-run
  cap (`AI_SINGLE_RUN_MAX_ILS`) → `AI_HIGH_COST` approval, JSON repair pass.
- Approved-facts packet (`buildFactsPacket`) as the only DB→prompt path;
  deterministic Hebrew copy QA (forbidden claims, unverified prices, numbers,
  superlatives) before storage and on every edit.
- Creative Studio: AI ideas with claim citations → editable layer document
  (3 brand templates × 5 aspect ratios, bundled OFL Hebrew fonts) → live
  preview → Chromium render in the worker (overflow / missing-asset / font
  warnings) → PNG/JPG/WebP → approval bound to the version.
- Strategy agent v1: goals / audiences / campaign proposals / 14-day content
  plan; each item cites fact ids with a confidence level; data gaps listed.

Deferred to a later iteration: knowledge ingestion from URLs/documents into
`brand_knowledge` chunks, routing policy editable from the UI, per-format
adaptations inside one document, drag-and-drop in the editor (numeric boxes
today), QA judge on a second provider, atomic (row-locked) budget reservation.

## Phase 3 — Video Studio — **v1 live (2026-10-16)**

Delivered: grounded AI script with QA → per-scene OpenAI TTS (voice per
project) → branded scene cards / library images / AI images through the
creative templates → FFmpeg assembly with burnt-in Hebrew subtitles (SRT kept)
→ progress, preview, MP4 download, approval. Cost estimate before rendering;
actual cost in the ledger.

Deferred: provider video-clip generation (no verified Hebrew-safe video model
yet), storyboard images per scene before render, draft-vs-final presets,
multi-aspect export from one project, AI-imagery disclosure overlay.

## Phase 4 — Social publishing & automation

Meta OAuth (Facebook Pages, Instagram professional), encrypted token storage,
content calendar + monthly planner, scheduler with idempotent publishing,
publication status + retries, insights sync, automation rules engine,
Manual / Semi-Automatic / Automatic modes with stop controls.

## Phase 5 — Advertising (owner priority)

Meta Marketing API + Google Ads API connections (read-only first): load
accounts, campaigns, ad sets, ads, metrics with source + sync time. Then
campaign/ad-set/ad drafts created **paused**, budget approvals, activation
approvals, write switches off by default, keyword research, negative
keywords, search terms, CPC/CPL/CAC analytics, Budget Center, reports.

## Phase 6 — CRM & growth

Lead capture (landing pages, forms, Meta lead ads, webhooks), lead statuses,
WhatsApp links/templates with consent, attribution events, sales + revenue,
CAC/ROAS from real data, AI insights with confidence, daily/weekly reports.

## Phase 7 — CONTINUO Pilates

Activate the second brand: own Brand Kit, social and ad accounts, budgets,
media, CRM statuses for trials and memberships. Proves multi-brand in
production.

## Cross-cutting hardening (scheduled alongside phases)

MFA (TOTP) for admins, user invitations, Postgres RLS, automated backups +
restore drill, monitoring/alerting, error tracking, secret rotation runbook,
containerized app images (Dockerfiles exist, untested), rate limiting on auth
and API.
