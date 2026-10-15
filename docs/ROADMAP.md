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

## Phase 2 — AI engine + Creative Studio

- Provider adapters: Anthropic, OpenAI, Google (text), one image provider.
  Model ids come from configuration, verified against provider docs at
  implementation time.
- AI router: task type → provider by capability, quality, price, availability,
  latency, budget. Per-run cost in ILS, per-brand monthly cap, hard stop.
- Brand knowledge ingestion from approved URLs/documents.
- Creative Studio: idea generation → background/image generation → **editable
  Hebrew typography layers** (never rendered by the image model) → brand
  templates → versions → PNG/JPG/WebP export → approval.
- Strategy agent v1: goals, audiences, competitor summary from permitted
  sources, campaign proposals with data basis + confidence.

## Phase 3 — Video Studio

Script generator, storyboard, scene list, provider clip generation behind a
budget gate (estimate before render, draft vs final, retry limits), Hebrew TTS,
subtitle rendering, Remotion/FFmpeg assembly on the worker, preview, versions,
MP4 export in multiple aspect ratios, disclosure for AI imagery.

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
