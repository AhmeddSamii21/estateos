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
| `npm test` | Run all 142 automated tests (`node --test tests/**/*.test.js`) |
| `npm run verify` | Full gate: Prisma validate → typecheck (backend + frontend) → compile API → tests → production frontend build |
| `npm run typecheck` | Type-check both backend and frontend without emitting files |
| `npm run build:api` / `npm run build` | Compile Express API to `dist-backend/` / build Vue app to `dist/` |
| `npm run prisma:validate` / `npm run prisma:generate` | Validate schema / regenerate Prisma Client |
| `npm run db:verify` | Redacted connectivity and role/database check |
| `npm run db:migrate` | `prisma migrate deploy` — apply pending checked-in migrations |
| `npm run test:live` | Compile the API and run the live integration script in `scripts/` |

Current verification status: **142 tests pass**, both typechecks pass, API compilation passes, and the production frontend build succeeds via `npm run verify`.

## What the application does

- **Authentication and access control** — JWT login, bcrypt password hashing, `ADMIN` / `MANAGER` / `AGENT` / `ACCOUNTANT` roles, registration-approval states (`PENDING`, `ACTIVE`, `REJECTED`, `SUSPENDED`), token revocation via `tokenVersion`, and organization-scoped data access. Finance and reports are limited to `ADMIN`, `MANAGER`, and `ACCOUNTANT`.
- **Properties** — CRUD, reference numbers, classification (sale/rent), status transitions, agent assignment, image gallery, documents, activity history, advanced search/filtering, pagination, sorting, and a Leaflet map view with map-bounds filtering.
- **Lead matching** — Leads carry seven criteria: `budgetMin`, `budgetMax`, `preferredType`, `preferredCity`, `preferredBedrooms`, `preferredAreaMin`, `preferredAreaMax`. `GET /api/leads/:id/matches` searches available, active, organization-scoped properties (agents see only their assigned properties), then scores candidates by budget, type, location, bedroom count and area. Each result includes a numeric score and human-readable reasons (for example "Budget fit", "Location match"); with no criteria the fallback is "Available property". The Leads screen exposes a **Matches** dialog and can convert a matched property into a deal.
- **Deal workflow** — Deals move forward only: `DRAFT → PENDING → ACTIVE → COMPLETED`, with `CANCELLED` allowed from open stages and both terminal stages closed. New deals cannot be created in `COMPLETED` or `CANCELLED`; `COMPLETED` sets `closedAt`. Real stage changes notify managers once per transition and write audit entries. Deal detail shows payments, commissions, expenses, linked documents, historical FX data, and an organization-scoped audit trail.
- **Finance** — Payments, expenses and commissions with decimal money handling, idempotency keys for payments, and approval/state rules.
- **CSV export** — Available on Properties, Reports and the generic resource lists. The shared `downloadCsv` helper writes UTF-8 with a BOM (Arabic headers stay readable in Excel), CRLF line endings, quoted/escaped cells, and neutralizes spreadsheet formula injection. Property export pages through all filtered results.
- **Share summary** — On Property Details, **Share Property** builds a plain-text, client-ready summary from listing fields only (title, reference, price, status, specifications, location, images and description). Owner/agent records, deals, finances, audit/activity, operational notes and other internal notes are deliberately excluded. It copies to the clipboard with a read-only preview fallback, and calls `POST /api/properties/:id/share-summary` to record an activity/audit entry. Both English and Arabic summaries are supported.
- **Other modules** — Owners, appointments, documents (stored under `UPLOAD_PATH`, served through authenticated downloads; delete means archive with restore), maintenance requests, notifications, activity feed, reports/analytics, users and settings.

## Delivery packages 5–10

- **Package 5** — CSV export with UTF-8 BOM, CRLF, escaping and formula-injection protection; property export pages through all filtered results.
- **Package 6** — lead follow-up buckets, lease renewal reminders and consolidated commission statements with historical FX snapshots.
- **Package 7** — owner statements, property price history, sanitized property duplication and client-ready share summaries.
- **Package 8** — CSV imports for properties/leads with dry-run validation, deal installment schedules with `Payment.dueAt`, and safe, category-filtered notification targets.
- **Package 9** — completed maintenance can create one linked expense idempotently; funnel/SLA metrics with CSV export and uncontacted-lead reminders; a property status board with guarded quick transitions.
- **Package 10** — per-endpoint in-memory rate limits with `429`/`Retry-After`, security headers and `X-Request-Id`, deep health checks, ADMIN-only snapshot export, a bounded-query audit and synced documentation.

## Packages 11–23 — verified status (2026-11-24)

These packages were requested in sequence, but only some were implemented. This table records the **actual repository state**, not the intended scope of each brief.

| Package | Status | What is actually present |
| --- | --- | --- |
| 11 | Committed as `5a3c029` | Smoke coverage over real tenant-scoped GET endpoints (`tests/package11-smoke.test.js`), plus RTL/print polish. |
| 12 | Committed as `5875bb8` | Authenticated upload/download/preview tests and storage-safety checks (`tests/package12-uploads.test.js`). |
| 13 | Delivered | Dashboard bilingual date-range pills (7d/30d/90d/all) scope the cards, the summary API accepts `range`/`from`/`to`, responsive 768px tables and 44px touch targets were added to the linked views, and `tests/package13-dashboard-ux.test.js` covers the behavior. |
| 14 | Partial | `PropertyImage` already carries `storageKey`, `caption`, `isPrimary`, `sortOrder` with a reorder endpoint and UI controls. No floorplan/brochure attachment model or UI exists. |
| 15 | Partial | `Lead.source`, `budgetMin` and `budgetMax` exist and feed lead matching. There is no priority score field, source/budget list filter or dedicated qualification UI. |
| 16 | Partial | Forward-only deal transitions, `closedAt` and audit/notification side effects exist. There is no closing checklist, override reason or stage guard based on checklist completion. |
| 17 | Partial | Payment `dueAt`, installment schedules and decimal outstanding-balance math exist. There are no aging buckets or record-partial-payment actions. |
| 18 | Partial | Owner statements and daily reminder deduplication exist. There is no owner payout/settlement marking or recurring maintenance interval/next-due tracking. |
| 19 | Present (no dedicated commit) | Advisory overlap detection for the same assigned user/property, warning payloads on create/reschedule, and a list/agenda toggle with English/Arabic labels. Covered by `tests/appointments.test.js`. |
| 20 | Not applicable | No Package 20 brief was issued in this session and no matching commit or code exists. |
| 21 | Absent | A global `SearchModal` exists, but there is no Ctrl/Cmd+K command palette, recent-item actions or saved property filter presets. |
| 22 | Absent | No webhook configuration, delivery log, URL allowlist or outbound delivery service exists. |
| 23 | Release readiness | Full verification pass, UI hardening fixes, service restart/health checks, and this documentation sync. No new domain feature was added. |

## Documentation

- [RUNBOOK.md](RUNBOOK.md) — local setup, database steps, migration procedure, verification and safety notes.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit together.
- `.env.example` — configuration template (no real secrets).
