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
- `routes/` — auth, users, properties, leads, appointments, deals, finance, documents, maintenance, owners, reports, search, settings, notifications, activity and webhooks.
- `services/` — notification creation, activity logging, scheduled reminders (`reminders.ts`) and signed webhook dispatch (`webhookDispatcher.ts`).
- `utils/` — validation, scope/authorization helpers, money and FX math, deal status transitions, property status transitions, lead priority/matching, payment aging, webhook event/payload/signing/URL guards, search query building, audit and safe file handling.
- `storage/local.ts` — filesystem document storage outside the public web root.

## Data model

`prisma/schema.prisma` defines organizations, users, owners and payouts, properties with images/documents/typed attachments/activities, leads with matching and priority fields, appointments, deals with closing checklists, payments with aging/due dates, expenses, commissions, documents, notifications, audit logs, settings, currencies/exchange rates, recurring maintenance and webhook endpoints/deliveries. Every business entity is scoped by `organizationId`; roles are `ADMIN`, `MANAGER`, `AGENT`, `ACCOUNTANT`. `migrate deploy` applies checked-in SQL migrations; never use `migrate reset`.

## Key flows

- **Lead matching** — `GET /api/leads/:id/matches` filters to available properties in the lead's organization (assigned-only for agents), then `utils/leadMatching.ts` scores budget, type, location, bedrooms and area and returns reasons. Criteria come from the seven nullable `Lead` columns added in `20261123000000_lead_match_criteria`.
- **Deals** — `utils/dealStatus.ts` enforces `DRAFT → PENDING → ACTIVE → COMPLETED`, `CANCELLED` from open stages, no creation in terminal states and `closedAt` on completion. Real transitions emit deduplicated manager notifications and audit rows.
- **CSV export** — triggered in the UI; property export pages through all filtered results, reports and generic resource lists export loaded rows.
- **Share summary** — built on the client from public listing fields, copied to clipboard (with a manual-copy preview fallback); `POST /api/properties/:id/share-summary` records an audit/activity entry. Internal, owner, deal and finance data are never included.
- **Command palette and local presets** — `CommandPalette.vue` opens with Ctrl/Cmd+K and offers bilingual quick actions plus global search; `PropertyFilters.vue` and `SearchModal.vue` persist filter presets and recent items in localStorage.
- **Webhooks** — post-transaction dispatchers emit the four supported event codes; payloads are allowlisted, HMAC-signed, delivered with bounded timeout/no redirects, recorded as tenant-scoped delivery rows, and retryable from the admin settings panel.

## Delivery packages 5–10

- **Package 5** — `frontend/src/utils/csv.ts` export path shared by Properties, Reports and resource lists.
- **Package 6** — follow-up/lease helpers in `backend/utils/`, reminder jobs in `backend/services/`, consolidated statements in `commissionStatements.ts`.
- **Package 7** — owner statement, price history and duplication helpers plus matching frontend utilities and detail-view panels.
- **Package 8** — `csvImport.ts`, `propertyImport.ts`, `leadImport.ts`, `installmentSchedule.ts` and `notificationTargets.ts` keep parsing, math and URL safety pure; routes compose them with tenant scope and transactions. Import modals and a notification resolver live under `frontend/src/`.
- **Package 9** — `maintenanceExpense.ts`, `reportMetrics.ts` and `propertyBoard.ts`; maintenance writes one linked expense via a unique relation, reports expose funnel/SLA, and PropertyList groups by status.
- **Package 10** — `inMemoryRateLimit.ts`, `health.ts`, `snapshot.ts` and `queryAudit.ts` back per-endpoint limits, deep health, ADMIN snapshot export and bounded list queries. Request IDs and explicit security headers are installed in `backend/index.ts` and echoed by `errorHandler.ts`.

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

## Tests

`tests/*.test.js` use Node's built-in `node:test`. `npm test` runs all 186 tests. Database-backed suites (including `auth-state`, `deal-workflow`, `user-authorization`, Packages 11/13-18/20/22/24 and the Package 25 lifecycle suite) start the API and use Prisma against the configured PostgreSQL database; pure helper suites run offline. Each database-backed suite creates tagged fixtures and removes them in FK-safe order in `test.after`.

## Legacy prototype

`real-estate-locator.html` at the root is a single-file, pre-EstateOS prototype using Leaflet and browser IndexedDB. It has no server, authentication, Prisma or PostgreSQL and is not built by any npm script. Keep it only as a historical reference; it is not the application described here.
