# EstateOS

EstateOS is a multi-user real-estate management application: a Vue 3 single-page frontend, an Express REST API, and a PostgreSQL database accessed through Prisma.

> The standalone `real-estate-locator.html` file in the project root is a **legacy browser prototype** (Leaflet + IndexedDB, no server, no accounts). It is kept for reference only and is **not** part of the EstateOS application described here. Older point-in-time reports in the root (`FINAL_COMPLETION_REPORT.md`, `IMPLEMENTATION_REPORT.md`, etc.) are historical notes, not the current source of truth. See [RUNBOOK.md](RUNBOOK.md) for setup and [ARCHITECTURE.md](ARCHITECTURE.md) for structure.

## Stack

| Layer | Technology | Location |
| --- | --- | --- |
| Frontend | Vue 3 (Composition API), TypeScript, Vite, Pinia, Vue Router 4, Axios | `frontend/src/` |
| Map | Leaflet with OpenStreetMap tiles (no paid API key) | `frontend/src/views/AdvancedSearchView.vue` |
| API | Express 5, TypeScript, JWT auth, bcrypt, Helmet, rate limiting, Multer | `backend/` → compiled to `dist-backend/` |
| Database | PostgreSQL, Prisma 6.4.1 ORM and migrations | `prisma/schema.prisma`, `prisma/migrations/` |
| Tests | Node's built-in `node:test` runner (no separate test framework) | `tests/` |

The UI supports English and Arabic with RTL layout switching. All monetary arithmetic uses decimal values, with historical exchange-rate snapshots stored alongside multi-currency records.

## Quick start

Prerequisites: Node.js, a reachable PostgreSQL server, and a database/role configured as described in [RUNBOOK.md](RUNBOOK.md).

```powershell
npm install
# Copy .env.example to .env and set DATABASE_URL, JWT_SECRET, CORS_ORIGIN, UPLOAD_PATH
npm run prisma:generate
npm run db:migrate          # apply checked-in migrations (prisma migrate deploy)

npm run dev:api             # API on http://localhost:3000
npm run dev                 # Vite UI on http://localhost:5173, proxies /api to :3000
```

Do not commit `.env`; it is excluded by `.gitignore`. `.env.example` is the safe template.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run all 186 automated tests (`node --test tests/**/*.test.js`) |
| `npm run verify` | Full gate: Prisma validate → typecheck (backend + frontend) → compile API → tests → production frontend build |
| `npm run typecheck` | Type-check both backend and frontend without emitting files |
| `npm run build:api` / `npm run build` | Compile Express API to `dist-backend/` / build Vue app to `dist/` |
| `npm run prisma:validate` / `npm run prisma:generate` | Validate schema / regenerate Prisma Client |
| `npm run db:verify` | Redacted connectivity and role/database check |
| `npm run db:migrate` | `prisma migrate deploy` — apply pending checked-in migrations |
| `npm run test:live` | Compile the API and run the live integration script in `scripts/` |

Current verification status: **186 tests pass**, both typechecks pass, API compilation passes, and the production frontend build succeeds via `npm run verify`.

## What the application does

- **Authentication and access control** — JWT login, bcrypt password hashing, `ADMIN` / `MANAGER` / `AGENT` / `ACCOUNTANT` roles, registration-approval states (`PENDING`, `ACTIVE`, `REJECTED`, `SUSPENDED`), token revocation via `tokenVersion`, and organization-scoped data access. Finance and reports are limited to `ADMIN`, `MANAGER`, and `ACCOUNTANT`.
- **Properties** — CRUD, reference numbers, classification (sale/rent), status transitions, agent assignment, image gallery, documents, activity history, advanced search/filtering, pagination, sorting, and a Leaflet map view with map-bounds filtering.
- **Lead matching** — Leads carry seven criteria: `budgetMin`, `budgetMax`, `preferredType`, `preferredCity`, `preferredBedrooms`, `preferredAreaMin`, `preferredAreaMax`. `GET /api/leads/:id/matches` searches available, active, organization-scoped properties (agents see only their assigned properties), then scores candidates by budget, type, location, bedroom count and area. Each result includes a numeric score and human-readable reasons (for example "Budget fit", "Location match"); with no criteria the fallback is "Available property". The Leads screen exposes a **Matches** dialog and can convert a matched property into a deal.
- **Deal workflow** — Deals move forward only: `DRAFT → PENDING → ACTIVE → COMPLETED`, with `CANCELLED` allowed from open stages and both terminal stages closed. New deals cannot be created in `COMPLETED` or `CANCELLED`; `COMPLETED` sets `closedAt`. Real stage changes notify managers once per transition and write audit entries. Deal detail shows payments, commissions, expenses, linked documents, historical FX data, and an organization-scoped audit trail.
- **Finance** — Payments, expenses, commissions, owner payouts and payment aging with decimal money handling, idempotency keys and approval/state rules.
- **CSV export** — Available on Properties, Reports and the generic resource lists. The shared `downloadCsv` helper writes UTF-8 with a BOM (Arabic headers stay readable in Excel), CRLF line endings, quoted/escaped cells, and neutralizes spreadsheet formula injection. Property export pages through all filtered results.
- **Share summary** — On Property Details, **Share Property** builds a plain-text, client-ready summary from listing fields only (title, reference, price, status, specifications, location, images and description). Owner/agent records, deals, finances, audit/activity, operational notes and other internal notes are deliberately excluded. It copies to the clipboard with a read-only preview fallback, and calls `POST /api/properties/:id/share-summary` to record an activity/audit entry. Both English and Arabic summaries are supported.
- **Other modules** — Owners, appointments with advisory conflict warnings, documents (stored under `UPLOAD_PATH`, served through authenticated downloads; delete means archive with restore), maintenance requests, notifications, activity feed, reports/analytics, users and settings.

## Delivery packages 5–10

- **Package 5** — CSV export with UTF-8 BOM, CRLF, escaping and formula-injection protection; property export pages through all filtered results.
- **Package 6** — lead follow-up buckets, lease renewal reminders and consolidated commission statements with historical FX snapshots.
- **Package 7** — owner statements, property price history, sanitized property duplication and client-ready share summaries.
- **Package 8** — CSV imports for properties/leads with dry-run validation, deal installment schedules with `Payment.dueAt`, and safe, category-filtered notification targets.
- **Package 9** — completed maintenance can create one linked expense idempotently; funnel/SLA metrics with CSV export and uncontacted-lead reminders; a property status board with guarded quick transitions.
- **Package 10** — per-endpoint in-memory rate limits with `429`/`Retry-After`, security headers and `X-Request-Id`, deep health checks, ADMIN-only snapshot export, a bounded-query audit and synced documentation.

## Delivery package status (2026-11-24)

Packages 11-13 were earlier committed; Packages 14-25 are now consolidated in this release. The table records the actual repository state.

| Package | Commit | Delivered capability |
| --- | --- | --- |
| 11 | `5a3c029` | Authenticated smoke coverage over tenant-scoped GET endpoints, RTL/print polish. |
| 12 | `5875bb8` | Direct document/image upload, download, preview and storage-safety tests. |
| 13 | `0aff7e4` | Dashboard date-range pills (`7d`/`30d`/`90d`/all), summary ranges and 768px/touch-target polish. |
| 14 | `7fca507` | Property floorplans/brochures as typed attachments, public share display, reorder/cover controls. |
| 15 | `7fca507` | Lead priority score/tier, recalculation endpoint, source/budget filters and priority sorting. |
| 16 | `1d1b39c` | Deal closing checklist, documented override reason, forward-only stage guard and completion audit. |
| 17 | `1d1b39c` | Payment aging buckets (`CURRENT`, `1_30_DAYS`, `31_60_DAYS`, `60_PLUS_DAYS`, `PAID`) and aging reports. |
| 18 | `c1bb5ef` | Owner payout records/settlement and recurring maintenance intervals with next-due tracking. |
| 19 | Present in baseline | Advisory appointment overlap warnings (`APPOINTMENT_CONFLICT`) plus list/agenda toggle. |
| 20 | `c1bb5ef` | Frontend/backend permission matrix, bounded resource actions and UTF-8 BOM audit CSV export. |
| 21 | `8d111ec` | Global Ctrl/Cmd+K command palette, recent-item actions and saved property filter presets. |
| 22 | `d1b0a8b` | Tenant-scoped outbound webhooks, four event codes, signed deliveries, SSRF guard, retry/log UI. |
| 23 | `e94e8fe` | Release-readiness documentation and service/health verification; no domain feature in that commit. |
| 24 | `86886b3` | Idempotent bilingual demo seeder; a second run creates 0 rows. |
| 25 | Final consolidation commit | Full owner-to-webhook lifecycle E2E test, final EN/AR/RTL/print/responsive sweep, docs and handover. |

### Package 22 webhook contract

Admin-only and organization-scoped: `GET/POST /api/webhooks/endpoints`, `PATCH/DELETE /api/webhooks/endpoints/:id`, `GET /api/webhooks/deliveries`, `GET /api/webhooks/deliveries/:id`, `POST /api/webhooks/deliveries/:id/retry`. Events are exactly `property.created`, `lead.created`, `deal.stage_changed` and `payment.recorded`. The raw `whsec_...` secret is returned only on creation; only its hash is stored. Signatures use `X-Webhook-Signature` and a server-side pepper. Private/local receiver URLs are allowed only when `NODE_ENV != production` and `WEBHOOK_ALLOW_PRIVATE_URLS=true`.

### Package 25 lifecycle coverage

`tests/package25-e2e-lifecycle.test.js` runs against the compiled API and a local mocked receiver. It covers owner/property/share link, public property read, lead scoring/recompute/filtering, appointment conflict warnings, deal checklist/override/`COMPLETED` ("WON" equivalent), installments/payments/aging, commissions/statements, maintenance/expense/recurrence, owner statement/payout settlement, activity CSV and signed webhook delivery verification. All fixtures are tagged and removed in FK-safe order.

## Documentation

- [RUNBOOK.md](RUNBOOK.md) — local setup, database steps, migration procedure, verification and safety notes.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit together.
- `.env.example` — configuration template (no real secrets).
