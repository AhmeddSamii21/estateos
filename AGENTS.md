# Agent Operating Rules

## Language & UX

- Every UI feature must support full bilingual English / Arabic (EN / AR) with proper RTL layout when Arabic is selected.
- Keep views responsive on mobile and desktop, and add print-ready styles where applicable.

## Database Safety

- Never run destructive database resets: no `prisma migrate reset`, `DROP`, or wiping/truncating tables.
- Use additive Prisma migrations and idempotent seeds with stable IDs and `upsert(..., update: {})`.

## Tenant & RBAC Security

- Enforce `organizationId` scoping on every new endpoint and query.
- Apply `ADMIN` / `TEAM_LEAD` / `AGENT` visibility rules server-side (branch/team resolution included); never trust client-supplied scope.

## Verification & Git Discipline

- Before finishing any task, run `npm run verify`.
- Commit changes with a clear conventional commit message, then push to `origin master` automatically without asking for manual confirmation.
