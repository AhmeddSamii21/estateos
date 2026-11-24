# EstateOS Architecture

A concise map of the current application. For setup and commands see [RUNBOOK.md](RUNBOOK.md).

## Components

```
Browser
  │  Vue 3 SPA (TypeScript, Vite, Pinia, Vue Router 4, Axios, Leaflet)
  │  dev: http://localhost:5173, /api proxied to :3000
  ▼
Express 5 API (TypeScript in backend/, compiled to dist-backend/)
  │  JWT auth + bcrypt, Helmet, rate limiting, Multer uploads
  │  organization-scoped queries, role guards, audit/notifications
  ▼
Prisma Client 6.4.1 ──► PostgreSQL (schema.prisma + prisma/migrations/)
```

`npm run build` emits the SPA to `dist/`; `npm run build:api` emits the API to `dist-backend/`. Both outputs are generated artifacts and are Git-ignored.

## Frontend (`frontend/src/`)

- `views/` — dashboard, property list/form/detail, leads/appointments/deals (`ResourceView.vue`), deal detail, finance, maintenance, documents, owners, reports, notifications, activity, users, settings, advanced search/map, login and 404.
- `router/index.ts` — protected/guest routes and role-based `meta.roles` guards.
- `stores/index.ts` — Pinia state for auth, properties, language/RTL and shared request state.
- `api/client.ts` — one Axios instance; injects the bearer token and unwraps the API envelope.
- `utils/csv.ts` — shared CSV builder/downloader (BOM, CRLF, escaping, formula-injection protection).
- `utils/propertyShare.ts` — builds the client-facing plain-text property summary from listing fields only.
- English/Arabic UI strings are inline; the selected language drives LTR/RTL direction.

## Backend (`backend/`)

- `index.ts` — Express app assembly and `start()`/`shutdown()` used by tests.
- `middleware/` — authentication, errors and 404 handling.
- `routes/` — auth, users, properties, leads, appointments, deals, finance, documents, maintenance, owners, reports, search, settings, notifications and activity.
- `services/` — notification creation, activity logging and scheduled reminders (`reminders.ts`).
- `utils/` — validation, scope/authorization helpers, money and FX math, deal status transitions, property status transitions, lead matching, search query building, audit and safe file handling.
- `storage/local.ts` — filesystem document storage outside the public web root.

## Data model

`prisma/schema.prisma` defines organizations, users, owners, properties and their images/documents/activities, leads with matching criteria, appointments, deals, payments, expenses, commissions, documents, notifications, audit logs, settings, currencies/exchange rates and maintenance requests. Every business entity is scoped by `organizationId`; roles are `ADMIN`, `MANAGER`, `AGENT`, `ACCOUNTANT`. `migrate deploy` applies checked-in SQL migrations; never use `migrate reset`.

## Key flows

- **Lead matching** — `GET /api/leads/:id/matches` filters to available properties in the lead's organization (assigned-only for agents), then `utils/leadMatching.ts` scores budget, type, location, bedrooms and area and returns reasons. Criteria come from the seven nullable `Lead` columns added in `20261123000000_lead_match_criteria`.
- **Deals** — `utils/dealStatus.ts` enforces `DRAFT → PENDING → ACTIVE → COMPLETED`, `CANCELLED` from open stages, no creation in terminal states and `closedAt` on completion. Real transitions emit deduplicated manager notifications and audit rows.
- **CSV export** — triggered in the UI; property export pages through all filtered results, reports and generic resource lists export loaded rows.
- **Share summary** — built on the client from public listing fields, copied to clipboard (with a manual-copy preview fallback); `POST /api/properties/:id/share-summary` records an audit/activity entry. Internal, owner, deal and finance data are never included.

## Delivery packages 5–10

- **Package 5** — `frontend/src/utils/csv.ts` export path shared by Properties, Reports and resource lists.
- **Package 6** — follow-up/lease helpers in `backend/utils/`, reminder jobs in `backend/services/`, consolidated statements in `commissionStatements.ts`.
- **Package 7** — owner statement, price history and duplication helpers plus matching frontend utilities and detail-view panels.
- **Package 8** — `csvImport.ts`, `propertyImport.ts`, `leadImport.ts`, `installmentSchedule.ts` and `notificationTargets.ts` keep parsing, math and URL safety pure; routes compose them with tenant scope and transactions. Import modals and a notification resolver live under `frontend/src/`.
- **Package 9** — `maintenanceExpense.ts`, `reportMetrics.ts` and `propertyBoard.ts`; maintenance writes one linked expense via a unique relation, reports expose funnel/SLA, and PropertyList groups by status.
- **Package 10** — `inMemoryRateLimit.ts`, `health.ts`, `snapshot.ts` and `queryAudit.ts` back per-endpoint limits, deep health, ADMIN snapshot export and bounded list queries. Request IDs and explicit security headers are installed in `backend/index.ts` and echoed by `errorHandler.ts`.

## Packages 11–23 — verified status (2026-11-24)

- **11–13** — smoke suite (`5a3c029`) and upload suite (`5875bb8`) are committed; `tests/package13-dashboard-ux.test.js` covers the Dashboard date-range pills, summary API ranges and responsive/touch-target styling.
- **14–18** — only foundational pieces exist: image metadata/reordering (14), lead source and budget criteria (15), deal transition guardrails (16), payment due dates and balance math (17), owner statements and deduplicated reminders (18). The requested checklist, aging, payout and recurrence features were not implemented.
- **19** — advisory appointment overlap detection (`backend/utils/appointments.ts`) and a list/agenda toggle in `ResourceView.vue` are present, with `tests/appointments.test.js`.
- **20** — no brief, commit or code.
- **21–22** — no command palette/filter presets and no webhook configuration/delivery log.
- **23** — verification, UI hardening, service restart/health checks and documentation sync. No new domain feature was added.

See [README.md](README.md) and [RUNBOOK.md](RUNBOOK.md) for the per-package status table and verification commands.

## Tests

`tests/*.test.js` use Node's built-in `node:test`. `npm test` runs all 142 tests. Three suites (`auth-state`, `deal-workflow`, `user-authorization`) start the API and use Prisma against the configured PostgreSQL database; the rest run offline. Each database-backed suite creates tagged fixtures and removes them in `test.after`.

## Legacy prototype

`real-estate-locator.html` at the root is a single-file, pre-EstateOS prototype using Leaflet and browser IndexedDB. It has no server, authentication, Prisma or PostgreSQL and is not built by any npm script. Keep it only as a historical reference; it is not the application described here.
