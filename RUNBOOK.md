# EstateOS Local Runbook

This is the authoritative local setup and verification guide for the Vue 3 + Express + Prisma + PostgreSQL application. Reports in the project root are historical snapshots and may describe an older state. `real-estate-locator.html` is a legacy standalone prototype, not this application.

## Current state (verified 2026-11-23)

- PostgreSQL 18.7 is installed; service `postgresql-x64-18` is Running/Automatic and TCP port 5432 is listening.
- `node scripts/verify-db.cjs` reports `DB_CONNECT=OK`, `SELECT_1=OK`, `ROLE_estateos_app=PRESENT`, `DB_estateos_db=PRESENT`. The earlier `P1000` credential blocker is resolved; values are never printed here.
- `npm run prisma:validate` passes; `npm run prisma:generate` regenerates Prisma Client 6.4.1.
- `npm run verify` passes: schema validation, both TypeScript checks, API compilation, **77 tests**, and the production frontend build.
- `npx prisma migrate status` reports **5 migrations found; 1 not yet applied**: `20261123000000_lead_match_criteria`. The first four are applied. The new migration is present in the repository but was intentionally **not** applied as part of this documentation package.
- The repository has been initialized with Git. No commit or push has been made.

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
| `20261123000000_lead_match_criteria` | Seven nullable `Lead` criteria columns; drops leftover DB defaults on four `updatedAt` columns so they match Prisma's `@updatedAt` | **Pending** |

`20261123000000_lead_match_criteria` was generated from an authoritative `prisma migrate diff` between the live database and `prisma/schema.prisma`, because this database role cannot create the shadow database that `migrate dev --create-only` requires (P3014). Its SQL is additive: `ALTER TABLE "Lead" ADD COLUMN` for `budgetMin`, `budgetMax`, `preferredType`, `preferredCity`, `preferredBedrooms`, `preferredAreaMin`, `preferredAreaMax`, plus `ALTER COLUMN "updatedAt" DROP DEFAULT` on `Commission`, `Expense`, `Payment` and `PropertyImage`. Existing rows keep their data.

Apply the pending migration with one of:

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

This runs `prisma validate`, both TypeScript checks, `build:api`, `npm test` and `build`. Current result: **77 passed, 0 failed** from `node --test tests/**/*.test.js`.

Coverage includes API guard behavior, password hashing, validation helpers, money and historical FX math, decimal commission math, payment balance rules, property status transitions, lead matching, deal workflow, search query building, document filename/storage-key safety, file validation, authentication state, and user authorization. Note that `auth-state.test.js`, `deal-workflow.test.js` and `user-authorization.test.js` create organization/user fixtures through Prisma and therefore require a live, migrated database; the other suites are offline-safe. Every database-backed suite cleans up its own tagged fixtures.

## Implemented feature notes

- **Lead matching:** `GET /api/leads/:id/matches` scores available properties in the lead's organization by budget fit, property type, city/state/country/address substring, bedroom count (±1) and area range. Agents are limited to their assigned properties. Results carry a score plus reasons such as "Budget fit" and "Location match"; no criteria yields score 1 with "Available property". The Leads UI shows a Matches dialog and can convert a match into a deal. The seven criteria columns are exactly what the pending migration adds.
- **Deal workflow:** Forward-only transitions `DRAFT → PENDING → ACTIVE → COMPLETED`, `CANCELLED` from open stages, terminal stages closed, `closedAt` set on completion. Genuine stage changes produce one manager notification per transition and audit rows; detail views show payments, commissions, expenses, documents, FX snapshots and an audit trail scoped to the current organization.
- **Finance:** Visible to `ADMIN`, `MANAGER` and `ACCOUNTANT`; `AGENT` cannot open finance or report routes. Decimal arithmetic and 8-decimal commission rates keep stored amounts reproducible.
- **CSV export:** Client-side `downloadCsv` used by Properties, Reports and generic resource lists. UTF-8 BOM for Arabic headers, CRLF, escaped cells, and spreadsheet formula-injection protection. Property export pages through every filtered result; other exports use the currently loaded rows.
- **Share summary:** Property Details → **Share Property** composes a plain-text client summary from listing fields only. Internal notes, owner/agent data, deals, finance, audit and activity are excluded. Clipboard copy has a read-only preview fallback; the server endpoint records an activity/audit entry. English and Arabic variants are supported.
- **Documents:** Stored outside the public web root under `UPLOAD_PATH` (default `./storage/documents`) and served through authenticated downloads. Delete means archive; restore is supported. Create/mount that directory with write access before uploading.
- **Search and map:** Advanced search supports keyword, location, price, size, room counts, availability, sorting, pagination and map-bounds filtering using Leaflet with OpenStreetMap tiles. No paid map key is required.
- Maintenance requests, property status changes and document/archive actions write audit records where applicable.

## Safety notes

- No credentials, passwords, full connection strings or secret values are printed by helper scripts or in this document.
- No database data is deleted or reset by any script or migration here; `prisma migrate reset` is prohibited.
- Git is initialized with rules that exclude `node_modules`, build output, `.env`, local uploads and temp fixtures. `.env` was never staged. No commit, push or deployment was performed.
