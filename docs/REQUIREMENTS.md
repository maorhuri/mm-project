# Requirements (condensed from the PRD)

Source of truth: the product requirements document provided by the owner
("MVN Marketing OS — Complete Product Requirements & Technical Specification",
v1.0). This file condenses it into checkable requirements and records which
phase delivers each one. Status legend: ✅ built & verified · 🟡 partial · ⬜ not started.

## Product goals

- Self-hosted, multi-brand AI marketing platform that behaves like an agency:
  strategy, content, creatives, video, organic publishing, paid campaigns,
  leads, analytics, reporting — under the owner's approval.
- Hebrew RTL first, ILS, Asia/Jerusalem. First brand MVN (cloud hosting);
  CONTINUO Pilates later.
- Must be a working product, never a dashboard mock-up. Demo data is labelled.

## Non-negotiable rules

| Rule | Enforcement |
| --- | --- |
| No integration declared working until verified against the real API | Integrations page shows DISCONNECTED until a real connection exists; docs list "verified" explicitly |
| Mock adapters only when credentials are missing, clearly labelled | `STORAGE_DRIVER=memory` is test-only; future AI/ads mocks must carry `isMock: true` |
| Never spend money or publish without approval | `approvals` model + role gate; `META_ADS_WRITE_ENABLED` / `GOOGLE_ADS_WRITE_ENABLED` default `false` |
| AI uses approved brand knowledge only | `brand_knowledge.status = APPROVED` filter; approval workflow in place |
| Never invent prices, features, reviews, SLAs | Product/knowledge records are the only allowed sources; seed marks prices as "verify" |
| Secrets never in code or Git | `.env` ignored; server `shared/.env` generated on the server; CI uses throwaway values |
| Demo data labelled | `brands.is_demo` → badge everywhere |

## Functional requirements by area

### Multi-brand / tenancy (PRD §2) — ✅ Phase 1
- Unlimited brands per organization; each brand stores name, logo, colors,
  fonts, tone, audiences, products, prices, competitors, social/ad accounts,
  API keys, creatives, media, leads, campaigns, budgets, analytics, history.
- Isolation at DB, API, queue and storage level — not just UI. ✅ (tenant client,
  storage key prefix, job brandId, isolation tests)
- RBAC: org roles + per-brand roles. ✅ (invitation UI ⬜)

### Brand Intelligence / Brand Kit (PRD §5) — ✅ Phase 1
- Logo upload & selection, colors, licensed fonts, graphic style, audiences,
  keywords, tone, products/services, offers, allowed/forbidden claims. ✅
- Knowledge base learned only from approved sources. ✅ (ingestion from
  website URLs / embeddings ⬜ Phase 2)

### Media Library (PRD §6/§18) — ✅ Phase 1
- Per-brand S3-compatible storage, upload/list/search/tag/delete, image
  dimension detection, access-controlled serving. ✅ (video metadata via
  ffprobe ⬜ Phase 3)

### Approval Center (PRD §19) — ✅ base, Phase 1
- Statuses PENDING / APPROVED / REJECTED / CHANGES_REQUESTED / SCHEDULED /
  EXECUTED / FAILED; bound to subject version; admins only decide. ✅
- Types for posts, videos, plans, campaigns, budgets, ad changes, activation,
  high-cost AI: enum exists ✅; producers arrive with their phases.

### Dashboard & UX (PRD §18) — ✅ Phase 1
- Brand selector, live counts, integrations status, pending approvals, recent
  activity, jobs; nav for all modules with honest "not built" pages. ✅
- Performance summary, budgets, active campaigns, scheduled posts, videos in
  production, leads, AI recommendations ⬜ (their phases).

### AI engine (PRD §4) — ⬜ Phase 2
Provider adapters (OpenAI, Anthropic, Gemini, image, video, TTS), AI router by
task/quality/cost/availability, per-run and per-brand cost tracking, monthly
budget caps that stop runs.

### Creative Studio (PRD §6) — ⬜ Phase 2
Idea generation, image generation, editable Hebrew typography layers (never
rendered by image models), brand templates, drag-and-drop editor, versions,
PNG/JPG/WebP export.

### Video Studio (PRD §7) — ⬜ Phase 3
Script → storyboard → scenes → provider clips → Hebrew voice-over + subtitles →
Remotion/FFmpeg assembly, draft vs final quality, cost estimate before render,
retry limits, queues, versions, disclosure for AI imagery.

### Content Planner (PRD §8) — ⬜ Phase 4
Monthly plan generation from last month's data, dedupe, per-channel variants,
hashtags/CTA management.

### Social Media Manager (PRD §9) — ⬜ Phase 4
Meta OAuth (Pages + Instagram professional), scheduling, publishing after
approval, status tracking, retries, idempotent publishing, insights. Modes:
Manual / Semi-Automatic (default) / Automatic with stop controls.

### Meta Ads & Google Ads (PRD §10–11) — ⬜ Phase 5
Read-only first; campaigns created paused; no budget increase, activation or
new spend without explicit approval; search terms/CPC/conversion analysis.

### Strategy Agent (PRD §12) — ⬜ Phase 2/6
Goals, audiences, competitor and keyword research from permitted sources,
content and campaign proposals, budget allocation, creative scoring; every
recommendation stores its data basis, confidence and date.

### Leads & CRM (PRD §13) — ⬜ Phase 6
Lead record with source/campaign/ad/UTM, statuses (+ CONTINUO trial statuses),
WhatsApp links/templates (official platform only, consent tracked).

### Analytics & reporting (PRD §14) — ⬜ Phase 5/6
Spend, impressions, reach, clicks, CTR, CPC, leads, CPL, qualified leads,
sales, CAC, revenue, ROAS, LTV estimate, engagement, video views, AI cost;
daily/weekly/monthly reports per brand/channel/product/campaign/creative; every
metric carries source, last sync, final/partial, computed/raw, attribution
reliability.

### Automation (PRD §15) — 🟡 Phase 1 skeleton, Phase 4 rules
BullMQ queues, job records, idempotency keys, controlled retries ✅; rule engine
and the listed automations ⬜.

### Budget management (PRD §16) — 🟡
`monthly_ad_budget_ils` per brand, AI budget env caps ✅; Budget Center with
channel budgets, actuals, reserves, forecasts, alerts ⬜ Phase 5.

### Security & reliability (PRD §20) — 🟡
See [SECURITY.md](SECURITY.md) for the implemented vs pending list.

## Acceptance criteria (PRD §23)

### Foundation — verified on production 2026-10-15
- [x] Can log in
- [x] Can create a brand
- [x] Can switch brand
- [x] No data leakage between brands (automated tests + live probe)
- [x] System runs via Docker (infra containers; app under systemd; app images untested)
- [x] PostgreSQL migrations pass

Details and evidence in [../PROGRESS.md](../PROGRESS.md).
