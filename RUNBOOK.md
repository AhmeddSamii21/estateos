# EstateOS Local Runbook

This is the authoritative local setup and verification guide for the Vue 3 + Express + Prisma + PostgreSQL application. Reports in the project root are historical snapshots and may describe an older state. `real-estate-locator.html` is a legacy standalone prototype, not this application.

## Current state (verified 2026-11-24)

- PostgreSQL is reachable on port 5432; `node scripts/verify-db.cjs` reports `DB_CONNECT=OK`, `SELECT_1=OK`, `ROLE_estateos_app=PRESENT`, `DB_estateos_db=PRESENT`. Values are never printed here.
- `npm run prisma:validate` passes; `npm run prisma:generate` regenerates Prisma Client 6.4.1.
- `npm run verify` passes: schema validation, both TypeScript checks, API compilation, **186 tests**, and the production frontend build.
- `npx prisma migrate status` reports **12 migrations found** and **Database schema is up to date**.
- The API runs on `http://localhost:3000`; the Vite frontend runs on `http://localhost:5173`. `GET /api/health` returns `200` both directly and through the Vite proxy, with `database.status: up`.
- The repository is on `master`. Packages 11-24 are committed through `86886b3`; Package 22 webhooks are in `d1b0a8b`. Package 25 is the final consolidation commit. No `origin` remote is configured, so no push is performed.

## 1. PostgreSQL role and database (needed only on a fresh machine)

Run in PowerShell as a PostgreSQL administrator. The password prompt is interactive and hidden by PostgreSQL. Values used here are configuration, not secrets.

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U postgres -h 127.0.0.1 -p 5432 -d postgres
```

Check what already exists, then create only what is missing:

```sql
SELECT rolname FROM pg_roles WHERE rolname = 'estateos_app';
SELECT datname FROM pg_database WHERE datname = 'estateos_db';

CREATE ROLE estateos_app LOGIN;
\password estateos_app
CREATE DATABASE estateos_db OWNER estateos_app;
\q
```

`pg_hba.conf` uses `scram-sha-256`, so a password is required; there is deliberately no trust rule.

## 2. Configure `DATABASE_URL` securely

Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN` and `UPLOAD_PATH`. To update only the database URL without exposing the password:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\set-database-url.ps1
```

The helper uses a hidden prompt, URL-encodes the password, shows only a redacted preview, and requires typing `YES` before writing. `.env` is ignored by Git; do not paste secrets into chat or shell history.

## 3. Verify the connection

```powershell
node scripts\verify-db.cjs
```

Expected output:

```text
DB_CONNECT=OK
SELECT_1=OK
ROLE_estateos_app=PRESENT
DB_estateos_db=PRESENT
```

## 4. Migrations

Checked-in migrations, in order:

| Migration | Purpose | Status |
| --- | --- | --- |
| `20261120000000_init` | Base enums, tables and constraints | Applied |
| `20261120100000_business_modules` | Deals/finance/document/maintenance fields, two new tables, indexes and FKs | Applied |
| `20261121130000_phase3_4_5_notifications_owners_gallery` | Notification/Owner/PropertyImage columns, indexes and FKs | Applied |
| `20261122000000_registration_approval_account_status` | `AccountStatus` enum, backfill and enforcement on `User` | Applied |
| `20261123000000_lead_match_criteria` | Seven nullable `Lead` criteria columns; drops leftover DB defaults on four `updatedAt` columns so they match Prisma's `@updatedAt` | Applied |
| `20261123120000_package5_fx_share_reminders` | Managed FX rates, public share links and reminder fields | Applied |
| `20261123130000_package6_followups_commissions_leases` | Lead follow-up notes, commission statements and lease renewal tracking | Applied |
| `20261124000000_package8_9_imports_installments_expenses` | Import metadata, installment fields and maintenance-linked expenses | Applied |
| `20261124110000_package14_15_attachments_lead_priority` | Typed property attachments and lead priority score/tier columns | Applied |
| `20261124120000_package16_17_closing_checklist_aging` | Deal closing checklist/override fields and payment aging fields | Applied |
| `20261124130000_package18_20_payouts_recurring` | Owner payouts, recurring maintenance metadata and audit export fields | Applied |
| `20261124150000_package22_webhooks` | Webhook endpoint/delivery tables, event enum, indexes and FKs | Applied |

`20261123000000_lead_match_criteria` was generated from an authoritative `prisma migrate diff` because this role cannot create a shadow database (P3014). Its SQL is additive: `ALTER TABLE "Lead" ADD COLUMN` for `budgetMin`, `budgetMax`, `preferredType`, `preferredCity`, `preferredBedrooms`, `preferredAreaMin`, `preferredAreaMax`, plus `ALTER COLUMN "updatedAt" DROP DEFAULT` on four tables. Existing rows keep their data. All twelve checked-in migrations are now applied.

Apply any future migration with one of:

```powershell
# Production / shared databases (recommended here; applies checked-in migrations only)
npm run db:migrate
# equivalent: npx prisma migrate deploy --schema prisma/schema.prisma

# Local development only; also creates a new migration if the schema changed further
npx prisma migrate dev --schema prisma/schema.prisma
```

`prisma migrate dev` needs a shadow database and therefore a role with `CREATEDB`; `prisma migrate deploy` does not. Do **not** run `prisma migrate reset`: the project prohibits destructive database resets.

## 5. Create the first administrator

Self-registration creates only `AGENT` accounts. Create the first administrator with the hidden-prompt helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create-admin.ps1 -Email admin@example.com -FirstName Admin -OrganizationSlug estateos
```

Additional users and privileged roles can then be managed on the Users page or through `POST/PATCH /api/users` with an admin token.

## 6. Run the application

Terminal 1 — API (port 3000 by default):

```powershell
npm run dev:api
```

Terminal 2 — frontend (port 5173):

```powershell
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://localhost:3000`; `CORS_ORIGIN` is set to `http://localhost:5173`.

## 7. Full verification

```powershell
npm run verify
```

This runs `prisma validate`, both TypeScript checks, `build:api`, `npm test` and `build`. Current result: **186 passed, 0 failed** from `node --test tests/**/*.test.js`, including the Package 25 owner-to-webhook lifecycle suite.

Coverage includes API guard behavior, password hashing, validation helpers, money and historical FX math, decimal commission math, payment balance rules, property status transitions, lead matching, deal workflow, checklist/aging/payout/recurrence rules, webhook signing and SSRF guards, search query building, document filename/storage-key safety, file validation, authentication state, and user authorization. Database-backed suites (`auth-state`, `deal-workflow`, `user-authorization`, Packages 11/13-18/20/22/24 and Package 25) start the API and require a live, migrated database; pure helper suites are offline-safe. Every database-backed suite cleans up its own tagged fixtures in FK-safe order.

## Implemented feature notes

- **Lead matching:** `GET /api/leads/:id/matches` scores available properties in the lead's organization by budget fit, property type, city/state/country/address substring, bedroom count (±1) and area range. Agents are limited to their assigned properties. Results carry a score plus reasons such as "Budget fit" and "Location match"; no criteria yields score 1 with "Available property". The Leads UI shows a Matches dialog and can convert a match into a deal. The seven criteria columns are applied by `20261123000000_lead_match_criteria`.
- **Deal workflow:** Forward-only transitions `DRAFT → PENDING → ACTIVE → COMPLETED`, `CANCELLED` from open stages, terminal stages closed, `closedAt` set on completion. Genuine stage changes produce one manager notification per transition and audit rows; detail views show payments, commissions, expenses, documents, FX snapshots and an audit trail scoped to the current organization.
- **Finance:** Visible to `ADMIN`, `MANAGER` and `ACCOUNTANT`; `AGENT` cannot open finance or report routes. Decimal arithmetic and 8-decimal commission rates keep stored amounts reproducible.
- **CSV export:** Client-side `downloadCsv` used by Properties, Reports and generic resource lists. UTF-8 BOM for Arabic headers, CRLF, escaped cells, and spreadsheet formula-injection protection. Property export pages through every filtered result; other exports use the currently loaded rows.
- **Share summary:** Property Details → **Share Property** composes a plain-text client summary from listing fields only. Internal notes, owner/agent data, deals, finance, audit and activity are excluded. Clipboard copy has a read-only preview fallback; the server endpoint records an activity/audit entry. English and Arabic variants are supported.
- **Documents:** Stored outside the public web root under `UPLOAD_PATH` (default `./storage/documents`) and served through authenticated downloads. Delete means archive; restore is supported. Create/mount that directory with write access before uploading.
- **Search and map:** Advanced search supports keyword, location, price, size, room counts, availability, sorting, pagination and map-bounds filtering using Leaflet with OpenStreetMap tiles. No paid map key is required.
- Maintenance requests, property status changes and document/archive actions write audit records where applicable.

## Delivery packages 5–10

- **Package 5:** CSV export (BOM, CRLF, escaping, formula-injection protection), including paginated property exports.
- **Package 6:** lead follow-up buckets, lease renewal reminders and consolidated commission statements with FX history.
- **Package 7:** owner statements, property price history, duplication sanitizer and share summaries.
- **Package 8:** `POST /api/properties/import` and `POST /api/leads/import` validate up to 500 CSV rows (dry-run by default) before a single transaction; `POST /api/deals/:id/installments` builds paged `Payment` rows with `dueAt`; notification lists and the header dropdown accept `?category=` and only navigate through an explicit frontend target allowlist.
- **Package 9:** completing maintenance with a positive cost creates a single linked expense (`maintenanceRequestId` is unique). Reports expose funnel conversion and a 24-hour uncontacted-`NEW`-lead SLA with CSV export; reminders deduplicate by lead/day. Property list offers a Status Board with five columns and canonical transitions.
- **Package 10:** login/register/public routes have dedicated in-memory limits returning `429` + `Retry-After`; all responses carry `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and `X-Request-Id`, which is also logged on errors. `GET /api/health` probes PostgreSQL (`503` when down), reports uptime without secrets, and `GET /api/admin/export-snapshot` is ADMIN-only, tenant-scoped, paged and secret-free. List queries are audited for finite `take`. The only permitted exceptions are tenant-scoped ID lookups capped at 200 IDs and the ADMIN snapshot export, where `take`/`skip` are injected by the shared `paged()` helper.

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

Operational note: in-memory rate limits are per API process. Use shared storage or a gateway limit when running multiple instances. Snapshot export streams JSON only; never commit downloaded backups.

## Safety notes

- No credentials, passwords, full connection strings or secret values are printed by helper scripts or in this document.
- No database data is deleted or reset by any script or migration here; `prisma migrate reset` is prohibited.
- Git is initialized with rules that exclude `node_modules`, build output, `.env`, local uploads, SQL backups under `backups/`, and temp fixtures. `.env` was never staged. The final Package 25 commit is local only; no `origin` remote is configured and no push or deploy is performed.
