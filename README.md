# EstateOS

![Status](https://img.shields.io/badge/status-active-success?style=flat-square)
![Vue 3](https://img.shields.io/badge/Vue%203-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node / Express](https://img.shields.io/badge/Node%20%2F%20Express-339933?style=flat-square&logo=node.js&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat-square&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![EN / AR RTL](https://img.shields.io/badge/EN%20%2F%20AR%20RTL-0F766E?style=flat-square)
![Tests](https://img.shields.io/badge/tests-285%2B%20passing-brightgreen?style=flat-square)

**Multi-Tenant Bilingual Real Estate Agency & Property Management SaaS**

EstateOS is a full-stack, organization-scoped platform for agencies and property managers: CRM, property inventory, deals, finance, client and owner portals, and automation in one English/Arabic, RTL-ready application.

## Core Capabilities

- **CRM & Lead Scoring** — Lead records with seven matching criteria, scored property matches, priority tiers, follow-up buckets and automation rules, bilingual WhatsApp handoff links, and a validated CSV import wizard with preview and error reports.
- **Property Inventory & Stacking Grid** — Property CRUD, status board, gallery and document attachments, advanced search with Leaflet map filtering, side-by-side comparison, and a visual unit inventory grid grouped by project, building and floor.
- **Deals & Installment Simulator** — Forward-only deal workflow with closing checklists and guarded transitions, installment schedules, interactive installment/mortgage simulator with bilingual amortization, payments with aging buckets, and historical FX snapshots.
- **Owner & Client Portals** — Revocable read-only owner portfolio links and tenant-scoped client portal views backed by allow-listed fields for deals, payments and documents.
- **Commissions & Referrals** — Decimal commission math and statements, owner payouts, referral partners with snapshotted per-deal splits, and a role-aware sales quota leaderboard.
- **White-Label Branding & SaaS Quotas** — Organization branding (logo, colors, theme, bilingual footer), plan tiers with tenant overrides, and enforced user/property/deal quotas.
- **Automation & Audit Logs** — Signed, tenant-scoped webhooks with retries, in-app notifications and reminders, activity feed, bounded audit exports, deep health checks, and per-endpoint rate limits.

## Architecture & Tech Stack

| Layer | Stack | Location |
| --- | --- | --- |
| Frontend | Vue 3 (Composition API), TypeScript, Vite, Pinia, Vue Router 4, Axios, Leaflet | `frontend/src/` |
| API | Express 5, TypeScript, JWT auth, bcrypt, Helmet, rate limiting, Multer | `backend/` → `dist-backend/` |
| Database | PostgreSQL with Prisma 6.4.1 ORM and additive migrations | `prisma/schema.prisma`, `prisma/migrations/` |
| Tests | Node built-in `node:test` runner (285+ tests) | `tests/` |
| Internationalization | Inline EN/AR strings with LTR/RTL switching and responsive, print-ready styles | `frontend/src/` |

Every endpoint and query is scoped by `organizationId`; branch/team visibility is resolved server-side for `TEAM_LEAD` and `AGENT` roles.

## Quick Start (Local Setup)

Prerequisites: Node.js and a reachable PostgreSQL server (see [RUNBOOK.md](RUNBOOK.md) for database provisioning).

1. `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN` and `UPLOAD_PATH`. Then run `npm run prisma:generate` and `npm run db:migrate`, and create the first administrator with `scripts/create-admin.ps1` before seeding (details in [RUNBOOK.md](RUNBOOK.md)).
3. `npm run db:seed:demo`
4. `npm run dev` for the UI at `http://localhost:5173`; run `npm run dev:api` in a second terminal for the API at `http://localhost:3000`.

`.env` is git-ignored — `.env.example` is the safe template. The demo seeder is idempotent (a second run creates 0 rows) and never changes existing ADMIN accounts.

## Demo Accounts

| Role | Email | Password |
| --- | --- | --- |
| `ADMIN` | The email passed to `create-admin.ps1` (e.g. `admin@example.com`) | The password set during admin creation |
| `TEAM_LEAD` | `demo.teamlead@estateos.local` | `EstateDemo2026!` |
| `AGENT` | `demo.agent@estateos.local` | `EstateDemo2026!` |

Demo user passwords come from `DEMO_SEED_PASSWORD` (default shown above) and can be overridden with that environment variable.

## Live Demo (GitHub Pages)

**URL:** <https://ahmeddsamii21.github.io/estateos/>

The deployed site is a standalone, interactive demo: no API server or PostgreSQL database is required. It ships with deterministic sample data for leads, properties, the unit inventory grid, deals, payments, commissions, referrals, contracts, notifications, owner/client portals, leaderboards and settings. Every module is navigable and edits persist in the browser's `localStorage` until you choose **Reset demo data**.

On the sign-in screen, pick a role button for one-click access, or use the prefilled credentials:

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `demo.admin@estateos.local` | `EstateDemo2026!` |
| Manager | `demo.manager@estateos.local` | `EstateDemo2026!` |
| Team lead | `demo.teamlead@estateos.local` | `EstateDemo2026!` |
| Agent | `demo.agent@estateos.local` | `EstateDemo2026!` |
| Accountant | `demo.accountant@estateos.local` | `EstateDemo2026!` |

The language switcher works everywhere (including the login screen), switches between English and Arabic and applies full RTL layout. To force demo mode locally, start the UI and open <http://localhost:5173/?demo=1>, or set `localStorage.setItem('estateos.forceDemo', 'true')`. Without that flag the app prefers a reachable local API and falls back to demo mode automatically when `/api/health` is unavailable.

Deployment is automated by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to `master` (and via `workflow_dispatch`). One-time repository setting, if not already configured: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Verification

`npm run verify` runs Prisma validation, both TypeScript checks, API compilation, the full test suite and the production frontend build.

## Delivery History

Detailed package-by-package notes (Package 5, Package 10, and every release through Package 43) are maintained in [ARCHITECTURE.md](ARCHITECTURE.md) and [RUNBOOK.md](RUNBOOK.md).

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — structure, role visibility and package history.
- [RUNBOOK.md](RUNBOOK.md) — local setup, migrations, verification and delivery history.
- [AGENTS.md](AGENTS.md) — operating rules for coding agents.

> The root `real-estate-locator.html` is a legacy browser prototype kept for reference; it is not part of the EstateOS application.
