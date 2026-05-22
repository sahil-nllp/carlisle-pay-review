# Carlisle Pay Review

Production rebuild of the Carlisle Health Group annual pay review platform.

Replaces the manual Excel-driven process with a web application that:
- Ingests the annual UKG wage model
- Distributes per-region review files to managers
- Validates rates against Fair Work Award **MA000027** + Carlisle internal bands
- Runs a regional → senior management approval workflow
- Generates per-employee pay letters (A / B / C)
- Produces the UKG payroll upload file

The original prototype (Flask + SQLite) lives in `../Pay Review Tools/` and remains
the reference implementation while this version is built out.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.13, FastAPI, SQLAlchemy 2 (async), Alembic |
| Database | PostgreSQL 18 (local for dev) |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Auth | Session cookies (SSO-ready abstraction) |
| Excel / Word | openpyxl, python-docx (reused from prototype) |
| Background jobs | APScheduler (MVP) |
| Package mgmt | pip + venv (backend), pnpm (frontend) |
| Deployment | Debian (UAT) → Ubuntu (Prod) — systemd + reverse proxy |

---

## Repo Layout

```
carlisle-payreview/
├── backend/             # FastAPI app
│   ├── app/
│   ├── alembic/
│   ├── tests/
│   ├── pyproject.toml
│   └── .env.example
├── frontend/            # Next.js app
│   ├── src/
│   ├── package.json
│   └── .env.example
├── docs/                # Architecture, deployment, migration notes
├── scripts/             # One-off utilities (seed, import prototype data)
└── README.md
```

---

## Local Development

### Prerequisites

- Python 3.12+ (3.13 verified)
- Node.js 20+
- pnpm 10+
- PostgreSQL 16+ running on `localhost:5432`
- A database named `carlisle_payreview` (create with
  `psql -U postgres -c "CREATE DATABASE carlisle_payreview;"`)

### First-time setup

```bash
# 1. Backend
cd backend
python -m venv .venv
source .venv/Scripts/activate          # Windows (Git Bash)
# or: .venv\Scripts\activate           # Windows (cmd / PowerShell)
# or: source .venv/bin/activate        # macOS / Linux
pip install -e ".[dev]"
cp .env.example .env                   # then edit DATABASE_URL credentials

# 2. Frontend
cd ../frontend
pnpm install
cp .env.example .env.local
```

### Running

Open two terminals:

**Terminal 1 — backend**
```bash
cd backend
source .venv/Scripts/activate
uvicorn app.main:app --reload --port 8000
```
- API: <http://localhost:8000>
- OpenAPI docs: <http://localhost:8000/docs>
- Health: <http://localhost:8000/health>
- DB health: <http://localhost:8000/health/db>

**Terminal 2 — frontend**
```bash
cd frontend
pnpm dev
```
- App: <http://localhost:3000>

### Database migrations

From the `backend/` folder with the venv active:

```bash
# Create a new migration after changing models
alembic revision --autogenerate -m "describe your change"

# Apply migrations
alembic upgrade head

# Roll back one step
alembic downgrade -1
```

---

## Build Phases

- [x] **Phase 0** — Bootstrap (this commit): scaffolding, DB connection, health checks
- [ ] **Phase 1** — Auth + data model
- [ ] **Phase 2** — Wage model upload + diff/merge
- [ ] **Phase 3** — Review workflow + compliance checks
- [ ] **Phase 4** — Approval workflow + audit log
- [ ] **Phase 5** — Letter / regional / payroll generation
- [ ] **Phase 6** — Admin (users, budgets, settings)
- [ ] **Phase 7** — Deploy to Debian UAT

See `docs/architecture.md` for the full design.

---

## Reference

- Prototype source: `../Pay Review Tools/` (Flask app, CLI tools, sample data)
- Award rates: Fair Work MA000027, updated annually after the FWC determination
- Sponsor: Tom Young (Carlisle Health Group)
- Delivery: NLLP Consulting
