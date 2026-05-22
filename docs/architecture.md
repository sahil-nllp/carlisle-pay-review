# Architecture

## Overview

```
┌────────────────────┐         HTTPS         ┌──────────────────────┐
│   Next.js 16       │ ────────────────────▶ │   FastAPI            │
│   (App Router)     │  REST + session cookie │   (Python 3.13)     │
│   React 19 + TS    │ ◀──────────────────── │   SQLAlchemy async   │
└────────────────────┘         JSON           └──────────┬───────────┘
                                                         │
                                                         ▼
                                              ┌──────────────────────┐
                                              │  PostgreSQL 18       │
                                              └──────────────────────┘
                                                         │
                                                         ▼
                                              ┌──────────────────────┐
                                              │  Local filesystem    │
                                              │  uploads/ + generated/
                                              └──────────────────────┘
```

## Module boundaries (backend)

| Module | Responsibility |
|---|---|
| `app/api/` | HTTP route handlers — request parsing, response shaping, status codes |
| `app/schemas/` | Pydantic models for request bodies and response payloads |
| `app/models/` | SQLAlchemy ORM tables |
| `app/services/` | Business logic — Excel parsing, letter generation, compliance checks |
| `app/core/` | Cross-cutting: auth, security, dependencies |
| `app/workers/` | Background job scheduler and job functions |

Rule: **API never imports services that touch the DB without a session dependency**.
Rule: **Services never import from `api/`** — only the other way round.

## Auth

Session-cookie based for MVP. The login endpoint sets an `itsdangerous`-signed
cookie containing the user ID. A FastAPI dependency reads the cookie on each
request and loads the `User` row, attaching it to the request state.

Designed for SSO drop-in later: `app/core/auth_provider.py` will be an interface
(`AuthProvider`) implemented today by `PasswordAuthProvider`. Adding Entra ID
SSO means writing a `MicrosoftSsoProvider` and swapping it in via config.

## Data Model (Phase 1 target)

```
users           — login accounts, role (hr_admin / regional_manager /
                  senior_management / payroll), assigned site
review_cycles   — one per FY (FY2026-27, etc.), with letter/effective dates
employees       — roster snapshot for a cycle (current + proposed rates,
                  award levels, letter type)
approvals       — site-level approval records (pending/approved/changes_requested)
audit_log       — every mutation captured here
budgets         — optional per-site cost caps
```

All FKs cascade or restrict explicitly; no implicit cascades.

## Background jobs

Letter generation for 400+ employees can take 30–60 seconds. Jobs:

1. Frontend hits `POST /api/v1/generation/letters` → returns `{ job_id }`.
2. APScheduler runs the job in-process (single-worker, MVP scale).
3. Frontend polls `GET /api/v1/generation/jobs/{job_id}` for status + progress.
4. On completion, response includes a download URL.

When scale demands it, swap APScheduler for Celery + Redis without changing the
API contract.

## File storage

For MVP: local disk under `backend/storage/`:
- `uploads/{cycle_id}/` — original wage model Excel
- `generated/{cycle_id}/letters/` — generated docx files
- `generated/{cycle_id}/regional/` — regional Excel files
- `generated/{cycle_id}/payroll/` — UKG upload files

Production deployment will mount this on a persistent volume; later we can
switch to S3-compatible blob storage by implementing a `FileStorage` interface.

## Frontend structure

Next.js App Router with two route groups:

- `(auth)` — login pages, no nav chrome
- `(app)` — authenticated pages with sidebar layout

Data fetching: server components for initial page loads, TanStack Query for
client-side mutations and refetches. API client (`src/lib/api.ts`) is the
single point of contact with the backend.

## Deployment topology (target)

```
   Internet
       │
       ▼
   Caddy (auto-HTTPS, Let's Encrypt)
       │
       ├──▶  Next.js (pnpm start)         :3000
       └──▶  FastAPI (uvicorn + gunicorn) :8000
                       │
                       ▼
              PostgreSQL (local)          :5432
```

UAT on Debian, Prod on Ubuntu, both behind Caddy. Systemd manages both
processes. Nightly cron backs up the database to a separate disk + offsite.
