# Carlisle Pay Review — Architectural Overhaul Plan

> Status: planning / not yet started
> Author: NLLP Consulting
> Last updated: 2026-05-26

## What's changing in one sentence

The app moves from **one all-in-one Excel** with **hard-coded rates** → to **4 separate uploads per cycle** with **all rates and bands stored in the DB**, scoped per cycle.

---

## Background — why this is happening

The original prototype assumed a single "Wage Model" Excel could hold everything: employees, their FY25 award, their FY26 award, current rates, PP levels, etc. Carlisle's actual workflow is different — they maintain **four separate documents**:

1. **Employee_Details.xlsx** — the master employee list (UKG-style export)
2. **Award Summary.xlsx** — MA000027 rates table for the year
3. **Pay Progression Tech.xlsx** — Carlisle's internal bands for technical roles (Radiographer, Sonographer, MRI, Management)
4. **Pay Progression Admin.xlsx** — Carlisle's internal bands for support roles (Reception, Booking, Typing, Supervisor)

The MA000027 rates and Carlisle's internal bands are currently **hard-coded in `compliance.py`** (AWARD_RATES, PP_BANDS, etc). When the Fair Work Commission publishes new rates each FY, someone has to edit Python source code. That's wrong — these should be uploaded per cycle.

---

## Decisions already made

| Question | Answer |
|---|---|
| Reference data per cycle or global? | **Per cycle** |
| What about FY24/25 columns in the new files? | **Ignore them** — only read FY25/26 columns |
| Upload order — block if reference data missing? | **All 4 uploaded together in one go** |
| Existing prod data? | **Clear all old data before migrating** |
| FY25 fields throughout schema? | **Drop entirely** |
| Job Classification → PP Convention mapping? | **Pending client response** — fallback is manual dropdown |

---

## Phase 1 — Database foundation

### New tables

**`award_rates`** — replaces the hard-coded `AWARD_RATES` dict

```
id, cycle_id (FK), award_level (e.g. "HPSS HP L1 PP1"),
weekly_rate, laundry, combined_weekly,
hourly_rate, laundry_hourly, combined_hourly,
display_order (preserves Excel ordering for ceiling/progression checks),
section_header (nullable — "Health Professionals: Level 1" etc),
is_off_award (bool — for "Off Award - Contract" rows)
UNIQUE(cycle_id, award_level)
```

**`pp_bands`** — replaces hard-coded `PP_BANDS`

```
id, cycle_id (FK), convention (e.g. "HPSSL5 Technical AssistantEntry"),
award_key (e.g. "HPSSL5"), carlisle_label (e.g. "Technical AssistantEntry"),
stream (admin | tech), section_header (e.g. "Sonographer"),
award_level_group (e.g. "2.1-2.4"),
band_min, band_max,
experience_notes (text), progression_notes (text),
display_order
UNIQUE(cycle_id, convention)
```

**`junior_rates`** — replaces hard-coded `JUNIOR_RATES`

```
id, cycle_id (FK), age, multiplier
UNIQUE(cycle_id, age)
```
(Populated from Award Summary columns O–T)

### Changes to `Employee` model

**Drop:**
- `fy25_award`
- `hist_award_level_changed`, `hist_rate_changed`, `hist_above_award_rate`, `hist_above_pp_rate`, `hist_above_pp_max`

**Add:**
- `preferred_name` (string)
- `job_classification` (string — from Employee_Details, e.g. "Sonographer")
- `service_start_date` (date)
- `hire_date` (date)
- `rate_type` (string — "Hourly" / "Salary")
- `hours_per_pay_period` (decimal)

**Keep but stop importing from Excel:**
- `pp_level` — becomes the **Convention key** from PP files; assigned during review or via mapping (pending client answer)
- Rename `fy26_award` → `current_award` (year-specific naming doesn't scale)

### Changes to `ReviewCycle` model

**Drop:**
- `wage_model_filename`, `wage_model_path` (single file is gone)

**Add:**
- `employee_file_path`, `employee_file_uploaded_at`
- `award_summary_path`, `award_summary_uploaded_at`
- `pp_admin_path`, `pp_admin_uploaded_at`
- `pp_tech_path`, `pp_tech_uploaded_at`
- `reference_data_ready` (bool — true once all 3 reference files loaded)

### Migration strategy

Single Alembic revision that:
1. Drops old columns + tables (no backfill — clearing all data)
2. Creates new tables
3. Renames `fy26_award` → `current_award`

On prod: clear all existing data manually first → then run migration.

---

## Phase 2 — Excel parsers (split into 4)

Refactor `excel_parser.py` into:

**`parse_employee_details(file)` → list[ParsedEmployee]**
- Column detection by keyword (same fuzzy approach as today)
- Maps: Employee Number → emp_num, Payroll Name Selection → site, Job Classification → job_classification, Amount → current_rate, Award Agreement → current_award, etc.
- DOB → calculates `age` at cycle effective_date

**`parse_award_summary(file)` → list[ParsedAwardRate] + list[ParsedJuniorRate]**
- **Only reads FY25/26 columns** (cols G–I — "As per Award for 1/07/2025")
- Skips B–E entirely (those are 2024 rates)
- Picks up section headers ("Health Professionals: Level 1") so we preserve grouping
- Skips `#N/A` rows (but logs them — those are off-award placeholders)
- Cols O–T → junior multipliers (50%, 50%, 60%, 70%, 80%, 90% for ages 15–20)

**`parse_pp_admin(file)` → list[ParsedPPBand]**
- **Only reads FY25/26 columns** (cols N–Q — "2025/2026 Award rates")
- Skips J–L entirely (2024/2025)
- Captures Convention key, Award, Carlisle label, section headers
- Stream = `admin`

**`parse_pp_tech(file)` → list[ParsedPPBand]**
- **Only reads FY25/26 columns** (cols M–N — "FY 25/26")
- Skips J–K (FY 24/25)
- Stops reading at the appendix (row 42+ is exam types, not bands)
- Stream = `tech`

Tolerances stay the same as today: header keyword detection, optional columns, blank rows.

---

## Phase 3 — Upload flow (backend + frontend)

### Backend API — new endpoints

**`POST /cycles/upload-files`** — single endpoint, accepts all 4 files in one multipart request
- Stages all 4 in `storage/staging/<staging_id>/`
- Validates each parses correctly
- Returns a combined diff preview:
  - Employee diff (new / changed / removed)
  - Award rates summary (X levels found, Y off-award rows)
  - PP bands summary (X admin bands, Y tech bands)
  - Warnings (missing rows, unparseable lines)

**`POST /cycles/apply-upload`** — commits all 4 in one transaction
- Creates or updates cycle
- Upserts award_rates / pp_bands / junior_rates (all 3 wiped + replaced for that cycle)
- Upserts employees
- Moves files to `storage/uploads/<cycle_id>/`
- Sets `reference_data_ready = true`

### Frontend — new upload UI

Replace `upload-model-client.tsx` with a 4-slot uploader:

```
┌─ Wage Review Files ─────────────────────────┐
│                                             │
│  1. Employee Details        [Browse]        │
│  2. Award Summary           [Browse]        │
│  3. Pay Progression Tech    [Browse]        │
│  4. Pay Progression Admin   [Browse]        │
│                                             │
│  [ Validate all 4 files → ]                 │
└─────────────────────────────────────────────┘
```

After all 4 are selected → user clicks "Validate" → backend stages them all → returns the combined diff → user picks Archive / Merge / Fresh → loader (already built earlier) shows during apply.

---

## Phase 4 — Compliance engine refactor

### Remove from `compliance.py`

- `AWARD_RATES` dict
- `AWARD_ORDER` list
- `AWARD_NEXT_MIN`, `AWARD_NEXT_LEVEL` dicts
- `LEVEL_PROGRESSION` dict
- `JUNIOR_RATES` dict
- `PP_BANDS` dict
- `_OFF_AWARD_MARKERS` tuple → replaced by DB flag

### Add `ComplianceContext`

```python
@dataclass
class ComplianceContext:
    award_rates: dict[str, float]            # award_level → hourly_rate
    award_order: list[str]                   # in display_order
    award_next_level: dict[str, str]         # derived from order
    award_next_min: dict[str, float]
    level_progression: dict[str, list[str]]  # derived
    pp_bands: dict[str, tuple[float, float]] # convention → (min, max)
    off_award_levels: set[str]
    junior_rates: dict[int, float]
```

**Loader function:**

```python
async def load_context(db, cycle_id: int) -> ComplianceContext: ...
```

### Refactor `check_employee()`

```python
def check_employee(
    *, context: ComplianceContext,
    current_award, proposed_award, proposed_rate, current_rate, pp_level,
    age, effective_date, suppressed_labels,
) -> ComplianceResult: ...
```

All 7 call sites in `review.py` updated to load the context once per request and pass it in (instead of re-loading per employee).

### Same change for `suggest_rate()`

---

## Phase 5 — Review page updates

- Remove `fy25_award` column from the employee table
- Drop the historical compliance snapshot expanded section (5 hist_ columns)
- Add **PP Band dropdown** in the review row — populated from `pp_bands` for this cycle, defaults to current `pp_level` if set, blank if not
- Add **Job Classification** as a read-only display badge (helpful context for picking the PP band)
- Update **bulk-suggest** to skip employees with no `pp_level` set (and report them as a separate count)
- Update compliance display to show "PP band not assigned" as a separate **fail** check if `pp_level` is missing (depends on what client says about Job Classification mapping)

---

## Phase 6 — Document generation update

- `documents.py` already reads from Employee fields, so most of it survives unchanged
- Letters reference `fy25_award` in one place — drop that
- Confirm UKG upload format and Regional Excel summary still work with the new schema

---

## Phase 7 — Deploy

1. Clear all data on GCP (manual SQL)
2. `git pull`
3. `alembic upgrade head` (one big migration)
4. `systemctl restart carlisle-payreview-api`
5. `pnpm install && pnpm build`
6. `systemctl restart carlisle-payreview-web`
7. Upload all 4 files fresh

---

## Implementation order (recommended)

| Step | What | Why first |
|---|---|---|
| 1 | DB models + Alembic migration | Foundation — nothing else compiles without it |
| 2 | 4 Excel parsers (backend) | Pure functions, easy to unit test in isolation |
| 3 | ComplianceContext + refactor `compliance.py` | Decouple from hard-coded constants before touching the API |
| 4 | Backend upload API (stage + apply) | Now we can actually load data into the new tables |
| 5 | Update all `check_employee` call sites in `review.py` | API works again end-to-end |
| 6 | Frontend 4-file upload UI | UI catches up with backend |
| 7 | Review page tweaks (drop fy25, add PP dropdown, show job_classification) | Polish + UX for the new model |
| 8 | Documents.py cleanup | Final loose end |
| 9 | Deploy | |

---

## Open items waiting on client

### 1. Job Classification → PP Convention mapping

The `Employee_Details` file gives us each person's *Award Agreement* (e.g. "HPSS HP L2 PP4") and *Job Classification* (e.g. "Sonographer"). The Pay Progression files define internal bands using a "Convention" key like:

- `HPL2.1-2.4 SonographerQualified` (band $37.60–$45.00)
- `HPL2.1-2.4 SonographerBasic Modalities` (band $39.00–$45.00)
- `HPL2.1-2.4 SonographerIntermediate Modalities` (band $40.00–$53.00)
- `HPL3.1-3.5 SonographerAdvanced` (band $48.00–$60.00)

So for one employee classified as "Sonographer" at L2 PP4, there are multiple possible bands depending on experience/competency — and we can't tell from Employee_Details which band applies.

**Options to present to client:**

1. **Add a "Pay Progression Convention" column to Employee_Details** — easiest for the system, more work for whoever maintains the file
2. **Regional Managers assign during review** — works but adds friction
3. **Persist last cycle's assignment** — assign once, system carries it forward
4. **Use an existing mapping** — if Carlisle finance already has employee → Convention somewhere, we just import it

**Recommendation to client:** ask first if Option 4 exists. Otherwise default to Option 3.

**Workaround if client takes time to respond:** ship Phase 7 with manual dropdown only (Option 2); add auto-mapping later.

---

## Already done in this session (does not conflict)

These changes landed before the overhaul started and will be preserved:

- Pay progression check rewritten to use `current_award → proposed_award` instead of `fy25_award → fy26_award`
- Pay progression warns when system suggests a level but manager hasn't accepted
- Pay progression made unsuppressible (backend + frontend)
- Per Admin PP behaves identically to Fixed Rate
- Fixed Rate / Per Admin PP default to current rate
- Loading indicator on Apply step of upload

The Phase 2 parser refactor + Phase 4 compliance refactor will preserve all the above logic — just feeds data from DB instead of constants.
