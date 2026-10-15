# API & integrations

## Internal REST API (`/api/v1`)

Authentication: session cookie (`mm_session`) **or** `Authorization: Bearer
<session token>` obtained from `POST /api/v1/auth/login`. All responses are
JSON: `{ "data": … }` on success, `{ "error": { code, message, details } }` on
failure (401, 403, 404, 409, 413, 422, 500). Brand-scoped routes resolve the
caller's role on the brand first; a brand the caller cannot access returns 403
(or 404 if it does not exist).

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/login` | — | `{ email, password }` → `{ token, expiresAt, user }` (+cookie) |
| POST | `/auth/logout` | any | Revoke current session |
| GET | `/auth/me` | any | Current user + accessible brands |
| GET | `/brands` | any | Accessible brands |
| POST | `/brands` | org OWNER/ADMIN | Create brand |
| GET | `/brands/:brandId` | VIEWER | Brand Kit (brand, settings, assets, products, competitors, knowledge counts, role) |
| PATCH | `/brands/:brandId` | BRAND_ADMIN | Update identity/status |
| PUT | `/brands/:brandId/settings` | BRAND_ADMIN | Partial Brand Kit settings update |
| GET/POST | `/brands/:brandId/products` | VIEWER / EDITOR | List / create product |
| PATCH/DELETE | `/brands/:brandId/products/:productId` | EDITOR | Update / delete |
| GET/POST | `/brands/:brandId/knowledge?status=` | VIEWER / EDITOR | List / create (PENDING; `approveNow` for admins) |
| PATCH/DELETE | `/brands/:brandId/knowledge/:knowledgeId` | EDITOR | Update (re-approval on material change) / delete |
| GET | `/brands/:brandId/media?kind=&search=&tag=&page=&pageSize=` | VIEWER | Paginated list with `url` |
| POST | `/brands/:brandId/media` | EDITOR | `multipart/form-data`: `file` (repeatable), `tags`, `title` |
| GET/PATCH/DELETE | `/brands/:brandId/media/:mediaId` | VIEWER / EDITOR | Metadata |
| GET | `/brands/:brandId/media/:mediaId/file` | VIEWER | Streams the file (access-controlled) |
| GET | `/brands/:brandId/approvals?status=&type=&page=` | VIEWER | List |
| POST | `/brands/:brandId/approvals/:approvalId/decision` | BRAND_ADMIN | `{ decision: APPROVED\|REJECTED\|CHANGES_REQUESTED, note? }` |
| GET | `/api/health` | — | `{ status, db, latencyMs }` (503 when DB unreachable) |

Validation schemas live in `packages/core/src/validation.ts` and are the same
ones the UI uses. An OpenAPI document will be generated from them in Phase 2.

## External integrations — status

Rule from the PRD: **nothing is declared working until verified against the
real API with real credentials.** Endpoints, permissions and model identifiers
are taken from official documentation at implementation time, never guessed.

| Provider | Kind | Phase | Status | Verified |
| --- | --- | --- | --- | --- |
| S3-compatible storage (Versity S3 Gateway; any S3 works) | Storage | 1 | **Implemented** (`S3Storage`: ensureBucket/put/get/delete/head/presign) | Pending — ticked in PROGRESS.md once an upload round-trips on the server |
| In-memory storage | Storage (tests only) | 1 | Implemented, clearly test-only (`STORAGE_DRIVER=memory`) | — |
| Anthropic Claude | AI text (strategy, QA, analysis) | 2 | Not started | — |
| OpenAI GPT | AI text (Hebrew copy) | 2 | Not started | — |
| Google Gemini | AI research / multimodal | 2 | Not started | — |
| Image generation | AI image | 2 | Provider to be selected | — |
| Video generation | AI video | 3 | Provider to be selected | — |
| Text-to-speech (Hebrew) | AI TTS | 3 | Provider to be selected | — |
| Meta Graph API — Pages & Instagram | Social publishing | 4 | Not started. Requires a Meta App, App Review for `pages_manage_posts`, `instagram_content_publish` etc. | — |
| Meta Marketing API | Ads (read-only first) | 5 | Not started. `META_ADS_WRITE_ENABLED=false` by default | — |
| Google Ads API | Ads (read-only first) | 5 | Not started. Needs developer token + OAuth; `GOOGLE_ADS_WRITE_ENABLED=false` by default | — |
| LinkedIn Pages, Google Business Profile | Social | 6 | Not started | — |
| WhatsApp Business Platform | CRM | 6 | Not started; official API only, consent tracked | — |

The Integrations page in the app reflects this table from `provider_accounts`:
everything is `DISCONNECTED` until a real, verified connection exists.

## Adapter contract (for upcoming phases)

Every external provider is implemented behind a typed interface in
`packages/core` (e.g. `TextModelProvider`, `ImageProvider`, `SocialPublisher`,
`AdsPlatform`) with:

- a real adapter that only activates when credentials exist and a connection
  test passed;
- an optional mock adapter that returns `{ isMock: true }` payloads and is
  labelled in the UI;
- cost accounting hooks (`ai_runs`, budgets) and audit entries for every
  mutating call;
- write operations gated by the approval service and the write switches.
