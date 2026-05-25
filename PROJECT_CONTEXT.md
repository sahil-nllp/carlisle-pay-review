# Carlisle Pay Review — Full Project Context

> This document is written for a Claude agent picking up this codebase cold.
> It covers the business domain, every major technical decision, all models,
> all API endpoints, all frontend pages, and the known quirks.

---

## What This App Does

Carlisle Health runs an **annual pay review** for all employees each financial year. Previously this was a spreadsheet-heavy, email-based process. This app replaces that with a structured workflow:

1. **HR Admin uploads** the approved Wage Model Excel file (provided by Finance/payroll team)
2. **Regional Managers** log in, review proposed pay rates for their site, and submit for approval
3. **Senior Management** approves or requests changes per site
4. **On approval**, three files are auto-generated: a ZIP of PDF pay letters, a UKG payroll upload sheet, and a regional Excel summary
5. **HR Admin / Payroll** downloads the generated files from the Downloads page

The app is used once per year during the pay review cycle (typically June/July).

---

## Business Domain Knowledge

### Award
All Carlisle Health employees are covered by **MA000027 — Health Professionals & Support Services Award 2020**. The compliance engine in `backend/app/services/compliance.py` hard-codes the rates effective 01 July 2025 (FY2025-26).

### Streams
- **HP stream** (Health Professionals): L1 PP1 → L4 PP4 (19 pay points)
- **SS stream** (Support Services): L1 → L9 PP3 (13 levels/pay points)

### Letter Types
Pay letters come in three types:
- **Letter A** — rate increase only (no award level change)
- **Letter B** — rate increase AND award level change
- **Letter C** — award level change only (no rate change)

### Compliance Checks (6 total)
1. **Classification** — Is the FY26 award level a known MA000027 level?
2. **Award floor** — Is proposed rate ≥ the MA000027 minimum for that level?
3. **Level ceiling** — Is proposed rate < the NEXT level's floor? (else reclassification needed)
4. **Junior rate** — Is employee under 21 at the effective date? SS stream junior % applies
5. **Rate change** — Is the rate decreasing? (warn, not fail)
6. **Pay progression** — Valid FY25→FY26 pay point advancement?

Checks 1, 2, 4 are hard fails (block approval). Checks 3, 5, 6 are warnings (suppressible).

### Roles
| Role | Key Permissions |
|---|---|
| `hr_admin` | Everything — upload model, manage users, view all sites, approve or override anything |
| `regional_manager` | View and edit their assigned site only, submit for approval |
| `senior_management` | View all pending approvals, approve or request changes |
| `payroll` | Read-only access to downloads |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, SQLAlchemy 2.x (async), Alembic, Pydantic v2, pydantic-settings |
| Database | PostgreSQL 15 |
| Auth | `itsdangerous` session signing, `bcrypt` password hashing, `httponly` cookie |
| Document gen | `fpdf2` (PDF letters), `python-docx` (DOCX fallback), `openpyxl` (Excel output) |
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS |
| Charts | Recharts 3.x |
| Package manager | `pnpm` (frontend), `pip` with `pyproject.toml` (backend) |
| Deployment | Debian 12, Nginx, systemd, GCP Compute Engine |

---

## Repository Structure

```
carlisle-payreview/
├── backend/
│   ├── app/
│   │   ├── main.py              ← FastAPI app factory, CORS, router mounts
│   │   ├── config.py            ← pydantic-settings Settings class
│   │   ├── database.py          ← async engine, SessionLocal, Base
│   │   ├── api/
│   │   │   ├── auth.py          ← login, logout, me
│   │   │   ├── cycles.py        ← cycle CRUD + employee listing
│   │   │   ├── review.py        ← site summaries, employee patch, submit/decide, regenerate
│   │   │   ├── admin.py         ← user management, audit log, budget CRUD
│   │   │   └── downloads.py     ← serve generated files
│   │   ├── models/
│   │   │   ├── user.py          ← User, UserRole
│   │   │   ├── cycle.py         ← ReviewCycle, CycleStatus
│   │   │   ├── employee.py      ← Employee, ChangeType, LetterType
│   │   │   ├── approval.py      ← Approval, ApprovalStatus
│   │   │   ├── generated_file.py← GeneratedFile
│   │   │   ├── budget.py        ← Budget (per-site budget targets)
│   │   │   ├── compliance_suppression.py ← ComplianceSuppression
│   │   │   └── audit_log.py     ← AuditLog
│   │   ├── schemas/
│   │   │   ├── auth.py          ← LoginRequest, LoginResponse, UserResponse
│   │   │   └── review.py        ← SiteSummary, EmployeeWithCompliance, etc.
│   │   ├── services/
│   │   │   ├── compliance.py    ← 6-check compliance engine + bulk suggest
│   │   │   ├── cycles.py        ← business logic for cycle/employee operations
│   │   │   ├── documents.py     ← PDF/DOCX letter gen, UKG xlsx, regional xlsx
│   │   │   ├── excel_parser.py  ← parse uploaded wage model Excel → Employee rows
│   │   │   └── storage.py       ← local filesystem helpers (uploads, outputs, staging)
│   │   └── core/
│   │       ├── security.py      ← sign_session, verify_session, hash_password, verify_password
│   │       └── dependencies.py  ← get_current_user, require_roles
│   ├── alembic/                 ← migrations
│   ├── pyproject.toml
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx       ← root layout, fonts, CSS vars
│   │   │   ├── page.tsx         ← root redirect → /dashboard
│   │   │   ├── (auth)/login/    ← login page (public)
│   │   │   └── (app)/           ← protected layout (checks auth server-side)
│   │   │       ├── layout.tsx   ← sidebar + topbar, redirects to /login if no session
│   │   │       ├── dashboard/   ← KPI cards, site table, analytics charts
│   │   │       ├── review/      ← site list page + per-site employee editor
│   │   │       ├── approvals/   ← approval queue (senior_management view)
│   │   │       ├── downloads/   ← generated file download + regenerate
│   │   │       └── admin/
│   │   │           ├── upload-model/  ← Excel upload wizard
│   │   │           ├── users/         ← user CRUD
│   │   │           ├── audit/         ← audit log viewer
│   │   │           ├── budgets/       ← per-site budget targets
│   │   │           └── cycle-settings/← signatory, dates, CPI rate
│   │   ├── components/
│   │   │   ├── sidebar.tsx
│   │   │   ├── topbar.tsx
│   │   │   ├── dashboard-charts.tsx   ← "use client" Recharts charts
│   │   │   ├── approvals-client.tsx   ← "use client" approval workflow
│   │   │   └── downloads-client.tsx   ← "use client" download + regenerate
│   │   └── lib/
│   │       ├── api.ts           ← fetch wrapper (credentials: include)
│   │       ├── auth.ts          ← login(), logout(), fetchMe()
│   │       ├── auth.server.ts   ← getCurrentUser() server-only
│   │       ├── review.ts        ← client API helpers for review workflow
│   │       ├── review.server.ts ← server-only review fetchers
│   │       ├── approvals.ts     ← decideSite(), regenerateSiteFiles()
│   │       ├── approvals.server.ts
│   │       ├── cycles.server.ts ← getCurrentCycleServer(), getCycleEmployeesServer()
│   │       ├── downloads.server.ts ← getDownloadsServer()
│   │       └── types.ts         ← shared TypeScript types
│   ├── .env.example
│   └── package.json
├── scripts/
│   └── seed_admin.py
├── DEPLOYMENT.md
└── PROJECT_CONTEXT.md
```

---

## Database Models

### `users`
```
id, email (unique), name, password_hash, role, site (nullable, for regional_manager),
is_active, last_login_at
```
- `role` is one of: `hr_admin`, `regional_manager`, `senior_management`, `payroll`
- `site` only meaningful when `role = regional_manager` — restricts which site they can edit

### `review_cycles`
```
id, fy_label (unique, e.g. "FY2025-26"), effective_date, letter_date,
consultation_deadline, cpi_rate, super_old, super_new,
signatory_name, signatory_title, signatory_company, hr_email,
status, wage_model_filename, wage_model_path, created_by_id
```
- `status` flow: `draft` → `active` → `locked` → `completed` → `archived`
- Only one cycle is "current" — the API `GET /cycles/current` returns the latest non-archived one

### `employees`
```
id, cycle_id, emp_num (unique within cycle), first_name, last_name, email, dob, age,
site, department, category, hours_per_week,
fy25_award, current_rate,                          ← imported from Excel
fy26_award, proposed_award, pp_level, change_type, change_input, proposed_rate,
letter_type, notes,                                ← editable in review
hist_award_level_changed, hist_rate_changed,       ← from Excel compliance cols
hist_above_award_rate, hist_above_pp_rate, hist_above_pp_max,
is_departed
```
- `change_type`: `percent_increase`, `cpi_increase`, `per_admin_pp`, `fixed_rate`, `no_change`
- `letter_type`: `A`, `B`, `C`, `none`

### `approvals`
```
id, cycle_id, site (unique within cycle),
status,                                            ← not_submitted / pending / approved / changes_requested
submitted_by_id, submitted_at, submission_notes,
decided_by_id, decided_at, decision_notes
```

### `generated_files`
```
id, cycle_id, site, file_type, filename, file_path, file_size, generated_by_id
```
- `file_type`: `letters_zip`, `ukg_upload`, `regional_excel`
- Files stored at: `backend/storage/outputs/<cycle_id>/<safe_site>/<filename>`

### `budgets`
```
id, cycle_id, site, budget_amount, notes, created_by_id
```

### `compliance_suppressions`
```
id, cycle_id, employee_id, check_label, suppressed_by_id, suppressed_at, reason
```
- Allows warn-level checks to be acknowledged. Hard fails (Award floor, Junior rate) cannot be suppressed.

### `audit_logs`
```
id, user_id, action, detail, ip_address, created_at
```

---

## API Endpoints

### Auth (`/api/v1/auth`)
| Method | Path | Description |
|---|---|---|
| POST | `/login` | Set session cookie. Cookie: `httponly`, `samesite=lax`, `secure=COOKIE_SECURE` |
| POST | `/logout` | Clear session cookie |
| GET | `/me` | Return current user |

### Cycles (`/api/v1`)
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/cycles/current` | All | Get active cycle |
| POST | `/cycles/upload-model` | hr_admin | Upload wage model Excel, create/update cycle |
| GET | `/cycles/{id}/employees` | All | List all employees in cycle |
| GET | `/cycles/{id}/downloads` | All | List generated files |

### Review (`/api/v1`)
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/cycles/{id}/sites` | All | Site summaries with approval status + issues |
| GET | `/cycles/{id}/sites/{site}/employees` | All | Employees with compliance results |
| PATCH | `/employees/{id}` | regional_manager, hr_admin | Update proposed_rate, letter_type, notes etc. |
| POST | `/cycles/{id}/bulk-suggest` | regional_manager, hr_admin | Auto-fill proposed rates (CPI/award floor) |
| POST | `/cycles/{id}/bulk-assign-letters` | regional_manager, hr_admin | Auto-assign letter types |
| POST | `/cycles/{id}/sites/{site}/submit` | regional_manager, hr_admin | Submit site for approval |
| POST | `/cycles/{id}/sites/{site}/decide` | senior_management, hr_admin | Approve or request changes |
| POST | `/cycles/{id}/sites/{site}/regenerate-files` | hr_admin | Re-generate output files (e.g. after code update) |
| POST | `/employees/{id}/suppress-check` | All | Acknowledge a warn-level compliance check |
| POST | `/employees/{id}/unsuppress-check` | All | Remove suppression |

### Admin (`/api/v1/admin`)
| Method | Path | Access | Description |
|---|---|---|---|
| GET/POST | `/users` | hr_admin | List / create users |
| GET/PATCH/DELETE | `/users/{id}` | hr_admin | Get / update / deactivate user |
| GET | `/audit-log` | hr_admin | Paginated audit log |
| GET/POST | `/cycles/{id}/budgets` | hr_admin | List / create site budgets |
| PATCH/DELETE | `/budgets/{id}` | hr_admin | Update / delete budget |
| GET/PATCH | `/cycles/{id}/settings` | hr_admin | Read / update cycle config (signatory, dates, CPI) |

### Downloads (`/api/v1/downloads`)
| Method | Path | Description |
|---|---|---|
| GET | `/{file_id}` | Stream file download (authenticated) |

---

## Key Services

### `compliance.py`
- Hard-codes MA000027 rates (FY2025-26) and the ordered level sequence
- `check_employee(emp, cycle, suppressions)` → returns `EmployeeCompliance` with `overall = "ok" | "warn" | "fail"`
- `suggest_proposed_rate(emp, cycle)` → returns a suggested rate based on `change_type`
- `bulk_suggest(employees, cycle)` → patches employees in-place

### `documents.py`
Three generators, all called on site approval and also via the regenerate endpoint:
1. **`generate_letters_zip(site_emps, cycle, path)`** — Builds Letter A/B/C PDFs using `fpdf2`, zips them
2. **`generate_ukg_upload(site_emps, cycle, path)`** — Builds a `.xlsx` with the UKG payroll import format
3. **`generate_regional_excel(site_emps, cycle, site, path)`** — Builds a `.xlsx` summary for the regional manager

Letters are built with `_build_letter_pdf(letter_type, emp, cycle, draft=False)`. Pass `draft=True` for the preview PDF (adds "DRAFT" watermark, same layout).

### `excel_parser.py`
Parses the uploaded wage model Excel (`.xlsx`). The Excel has a specific column layout matching UKG exports. Employees are upserted by `(cycle_id, emp_num)`.

### `storage.py`
```python
STORAGE_ROOT = backend/storage/   # relative to the service file location
uploads_dir(cycle_id)             # → storage/uploads/<cycle_id>/
outputs_dir(cycle_id, site)       # → storage/outputs/<cycle_id>/<safe_site>/
staging_dir()                     # → storage/staging/
```
Storage is local filesystem only. Designed so the interface can be swapped for S3/Azure Blob later without changing callers.

---

## Frontend Architecture

### Auth Pattern
- Login form calls `POST /api/v1/auth/login` which sets an httponly cookie
- `(app)/layout.tsx` is a **Server Component** that calls `getCurrentUser()` (server-only) on every request
- If no valid session → `redirect("/login")`
- `getCurrentUser()` reads `SESSION_COOKIE_NAME` cookie and forwards it to `API_URL/api/v1/auth/me`
- Two env vars: `NEXT_PUBLIC_API_URL` (baked into client JS at build time), `API_URL` (server-side only, direct to uvicorn)

### Data Flow
- **Server Components** fetch data directly using `*Server.ts` lib files that forward the session cookie
- **Client Components** (marked `"use client"`) call the API via `lib/api.ts` which uses `credentials: "include"`
- Mutations (PATCH employee, submit, decide) are client-side only

### Key Client Components
- **`dashboard-charts.tsx`** — Recharts bar charts + custom breakdown components (no donut charts — skewed data makes them ugly). Charts: Cost of Increases by Site, Annual Payroll by Site, Letter Type Distribution (segmented progress bar), Outstanding Issues by Site (stacked bar)
- **`approvals-client.tsx`** — Full approval workflow UI: site cards with employee table, compliance badges, approve/request-changes panel, per-employee Draft letter download
- **`downloads-client.tsx`** — File list per site with Download button and **Regenerate files** button (re-runs all 3 generators for stale files)

### CSS / Design System
Uses CSS custom properties defined in `globals.css`:
```css
--brand, --brand-light, --brand-dark    ← primary colour
--neutral-50 … --neutral-900
--green-*, --amber-*, --red-*, --blue-*, --violet-*
--font-mono
```
Animations: `slideUp 0.4s ease both` used on page entry.

---

## Workflow In Detail

### Upload Flow
1. HR Admin uploads `.xlsx` via `/admin/upload-model`
2. File is staged in `storage/staging/`
3. `excel_parser.parse_wage_model()` reads rows → returns list of employee dicts
4. A diff is shown (new employees, departed, changed rates)
5. On confirm: cycle is created (or updated if same FY), employees are upserted, file moved to `storage/uploads/<cycle_id>/`

### Review Flow
1. Regional Manager sees their site in `/review`
2. Opens `/review/<site>` — table of employees with compliance status
3. Can edit `proposed_rate`, `letter_type`, `notes` per employee inline
4. Can run "Bulk Suggest" to auto-fill rates using `change_type` logic
5. Can download a Draft PDF letter per employee (preview before sending)
6. When all employees are compliant → "Submit for approval" button

### Approval Flow
1. Senior Management sees pending sites in `/approvals`
2. Each site card shows staff count, payroll figures, compliance summary, employee detail table
3. Can approve (→ triggers file generation) or request changes (with comment)
4. Regional Manager sees the comment and can re-edit and re-submit

### File Generation (on approval)
Triggered in `review.py / decide_site()` when `decision = "approve"`. Non-blocking (exceptions are printed but don't fail the API response). Generates:
- `PayLetters_<site>_<fy>.zip` — PDF pay letters
- `UKG_Payroll_<site>_<fy>.xlsx` — UKG import
- `ApprovedRates_<site>_<fy>.xlsx` — regional summary

If the files need to be regenerated (e.g. after a code bug fix), HR Admin can click "Regenerate files" on the Downloads page → calls `POST /cycles/{id}/sites/{site}/regenerate-files` which deletes old `GeneratedFile` records and re-runs all 3 generators.

---

## Environment Variables

### Backend (`backend/.env`)
| Var | Default | Notes |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` enables stricter behaviour |
| `DEBUG` | `true` | Set `false` in production |
| `DATABASE_URL` | postgres+asyncpg://... | Async SQLAlchemy URL |
| `DATABASE_URL_SYNC` | postgres+psycopg2://... | Used by Alembic only |
| `SECRET_KEY` | `change-me` | Signs session tokens. Must be long random string |
| `SESSION_COOKIE_NAME` | `carlisle_session` | Must match frontend |
| `SESSION_LIFETIME_HOURS` | `8` | |
| `COOKIE_SECURE` | `false` | **Set `false` for HTTP. Set `true` only with HTTPS** |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated, must include frontend URL |

### Frontend (`frontend/.env.local`)
| Var | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | Public-facing API base URL. **Baked into JS at build time** |
| `API_URL` | Internal server-side API URL (direct to uvicorn, bypasses nginx) |
| `SESSION_COOKIE_NAME` | Must match backend |

---

## Known Issues & Decisions

### Cookie + HTTP
The `Secure` cookie flag must be `false` when running on plain HTTP. Setting `ENVIRONMENT=production` used to silently enable `Secure=true`, breaking login. Now controlled explicitly by `COOKIE_SECURE` env var.

### Recharts Donut Charts
Avoid donut/pie charts for this data — one category often dominates (95%+ "No Letter", etc.) and the `paddingAngle` is larger than tiny slices, causing rendering artifacts. Use segmented progress bars + row lists instead (see `dashboard-charts.tsx`).

### Next.js SSR vs Static
This is **not** a static export. Next.js runs as a Node.js process (`next start`). Server Components do server-side auth checks and data fetching on every request.

### `pnpm` on Debian
If `pnpm` is not found after `npm install -g pnpm`, check `/usr/bin/pnpm` vs `/usr/local/bin/pnpm`. The systemd service `ExecStart` must point to the correct path: use `which pnpm` to confirm.

### Storage Paths
`STORAGE_ROOT` in `storage.py` is computed at import time relative to the file's location:
```python
STORAGE_ROOT = Path(__file__).resolve().parent.parent.parent / "storage"
# = backend/storage/
```
This means it always resolves to `backend/storage/` regardless of working directory. No env var needed.

### Migrations
Alembic uses `DATABASE_URL_SYNC` (psycopg2, not asyncpg) because Alembic doesn't support async connections natively. The async `DATABASE_URL` is used at runtime.

---

## How to Add a New Feature

### Add a new API endpoint
1. Add handler to the relevant router file in `backend/app/api/`
2. Add schema to `backend/app/schemas/` if needed
3. Add client lib function to `frontend/src/lib/`
4. If it affects server-rendered data, add a server-side fetcher to `*.server.ts`

### Add a new page
1. Create `frontend/src/app/(app)/<pagename>/page.tsx` (protected automatically by the `(app)` layout)
2. Add nav link in `frontend/src/lib/nav.ts`
3. Add nav item in `frontend/src/components/sidebar.tsx`

### Add a compliance check
1. Add logic in `backend/app/services/compliance.py`
2. Update `check_employee()` return type in `backend/app/schemas/review.py`
3. Add `_UNSUPPRESSIBLE_CHECKS` entry in `backend/app/api/review.py` if it's a hard-fail legal obligation

### Add a new letter type
1. Add variant to `documents.py / _build_letter_pdf()`
2. Add `LetterType` enum variant in `backend/app/models/employee.py`
3. Update letter assignment logic in `services/compliance.py`
