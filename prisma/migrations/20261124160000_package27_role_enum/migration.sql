-- Package 27: add the TEAM_LEAD role without modifying any existing role.
-- Kept in its own migration because PostgreSQL cannot always use a newly
-- added enum value in the same transaction that creates it.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TEAM_LEAD';
