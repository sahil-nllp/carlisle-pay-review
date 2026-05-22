"""Cycle business logic: diff computation, commit/merge, current-cycle lookup."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CycleStatus, Employee, ReviewCycle
from app.services.excel_parser import ParsedEmployee


# Fields we compare row-to-row when diffing an upload against existing data
DIFF_FIELDS: tuple[str, ...] = (
    "first_name",
    "last_name",
    "email",
    "site",
    "department",
    "category",
    "hours_per_week",
    "fy26_award",
    "pp_level",
    "current_rate",
)


# ─────────────────────────────────────────────────────────────────────────────
#  Lookups
# ─────────────────────────────────────────────────────────────────────────────
async def get_active_cycle(db: AsyncSession) -> ReviewCycle | None:
    stmt = (
        select(ReviewCycle)
        .where(ReviewCycle.status != CycleStatus.ARCHIVED.value)
        .order_by(desc(ReviewCycle.created_at))
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def list_cycles(db: AsyncSession) -> list[ReviewCycle]:
    stmt = select(ReviewCycle).order_by(desc(ReviewCycle.created_at))
    result = await db.execute(stmt)
    return list(result.scalars())


async def get_cycle_employees(
    db: AsyncSession, cycle_id: int
) -> list[Employee]:
    stmt = (
        select(Employee)
        .where(Employee.cycle_id == cycle_id)
        .order_by(Employee.site, Employee.last_name, Employee.first_name)
    )
    result = await db.execute(stmt)
    return list(result.scalars())


# ─────────────────────────────────────────────────────────────────────────────
#  Proposed rate calculation (used on import and on PATCH)
# ─────────────────────────────────────────────────────────────────────────────
def calc_proposed_rate(
    *,
    current_rate: float | None,
    change_type: str,
    change_input: float,
) -> float | None:
    """Calculate proposed rate given change type and input.

    change_type values: "CPI Increase" | "% Increase" | "Fixed Rate" |
                        "No Change" | "Per Admin PP"
    change_input meaning:
      - CPI Increase / % Increase : percentage (e.g. 3.5 means 3.5%)
      - Fixed Rate / Per Admin PP  : dollar amount (the new rate directly)
      - No Change                  : ignored
    """
    if current_rate is None:
        return None
    ct = change_type.strip().lower()
    if ct in ("cpi increase", "% increase"):
        return round(current_rate * (1 + change_input / 100), 4)
    if ct == "fixed rate":
        return round(change_input, 4)
    if ct == "per admin pp":
        # Per Admin PP: set to the designated PP rate, but never reduce an existing rate.
        # If the employee's current rate already exceeds the PP rate, keep the current rate.
        return round(max(current_rate, change_input), 4)
    if ct == "no change":
        return round(current_rate, 4)
    # Unknown type — return None so caller can decide
    return None


# ─────────────────────────────────────────────────────────────────────────────
#  Diff: parsed file vs DB
# ─────────────────────────────────────────────────────────────────────────────
def compute_diff(
    parsed: Iterable[ParsedEmployee],
    existing: Iterable[Employee],
) -> tuple[dict[str, int], list[dict]]:
    """Return (summary, diff_rows)."""
    parsed_by_num = {p.emp_num: p for p in parsed if p.emp_num}
    existing_by_num = {e.emp_num: e for e in existing}

    summary = {"new": 0, "removed": 0, "changed": 0, "unchanged": 0}
    rows: list[dict] = []

    for emp_num, parsed_emp in parsed_by_num.items():
        if emp_num not in existing_by_num:
            summary["new"] += 1
            rows.append({
                "emp_num": emp_num,
                "name": _full_name(parsed_emp.first_name, parsed_emp.last_name),
                "site": parsed_emp.site,
                "kind": "new",
                "changes": {},
            })
            continue

        existing_emp = existing_by_num[emp_num]
        changes = _row_changes(parsed_emp, existing_emp)
        if changes:
            summary["changed"] += 1
            rows.append({
                "emp_num": emp_num,
                "name": _full_name(parsed_emp.first_name, parsed_emp.last_name),
                "site": parsed_emp.site,
                "kind": "changed",
                "changes": changes,
            })
        else:
            summary["unchanged"] += 1

    for emp_num, existing_emp in existing_by_num.items():
        if emp_num not in parsed_by_num:
            summary["removed"] += 1
            rows.append({
                "emp_num": emp_num,
                "name": _full_name(existing_emp.first_name, existing_emp.last_name),
                "site": existing_emp.site,
                "kind": "removed",
                "changes": {},
            })

    summary["total"] = len(parsed_by_num)
    return summary, rows


def _row_changes(parsed: ParsedEmployee, existing: Employee) -> dict[str, dict]:
    changes: dict[str, dict] = {}
    for field_name in DIFF_FIELDS:
        new_val = getattr(parsed, _parsed_field_name(field_name))
        old_val = getattr(existing, field_name)
        if _normalise(old_val) != _normalise(new_val):
            changes[field_name] = {"old": _scalar(old_val), "new": _scalar(new_val)}
    return changes


_PARSED_FIELD_ALIASES = {
    "department": "dept",
}


def _parsed_field_name(orm_field: str) -> str:
    return _PARSED_FIELD_ALIASES.get(orm_field, orm_field)


# ─────────────────────────────────────────────────────────────────────────────
#  Persistence
# ─────────────────────────────────────────────────────────────────────────────
async def create_cycle_from_parse(
    db: AsyncSession,
    *,
    fy_label: str,
    effective_date: date,
    letter_date: date,
    cpi_rate: float,
    wage_model_filename: str,
    wage_model_path: str,
    parsed: Iterable[ParsedEmployee],
    created_by_id: int | None,
) -> tuple[ReviewCycle, int]:
    cycle = ReviewCycle(
        fy_label=fy_label,
        effective_date=effective_date,
        letter_date=letter_date,
        cpi_rate=cpi_rate,
        wage_model_filename=wage_model_filename,
        wage_model_path=wage_model_path,
        status=CycleStatus.ACTIVE.value,
        created_by_id=created_by_id,
    )
    db.add(cycle)
    await db.flush()

    inserted = 0
    for p in parsed:
        if not p.emp_num:
            continue
        db.add(_parsed_to_employee(p, cycle_id=cycle.id, cpi_rate=cpi_rate))
        inserted += 1

    await db.commit()
    await db.refresh(cycle)
    return cycle, inserted


async def archive_cycle(db: AsyncSession, cycle: ReviewCycle) -> None:
    cycle.status = CycleStatus.ARCHIVED.value
    await db.flush()


async def merge_into_cycle(
    db: AsyncSession,
    cycle: ReviewCycle,
    parsed: Iterable[ParsedEmployee],
) -> tuple[int, int, int]:
    """Update an existing cycle's employee roster from a parsed file.

    - Existing emp found in upload: update identity fields only (not review state)
    - emp in upload but not in DB: insert with CPI defaults
    - emp in DB but not in upload: mark is_departed = True
    """
    cpi_rate = float(cycle.cpi_rate)
    existing = await get_cycle_employees(db, cycle.id)
    existing_by_num = {e.emp_num: e for e in existing}
    parsed_list = [p for p in parsed if p.emp_num]
    parsed_nums = {p.emp_num for p in parsed_list}

    inserted = 0
    updated = 0
    departed = 0

    for p in parsed_list:
        if p.emp_num in existing_by_num:
            emp = existing_by_num[p.emp_num]
            changed = _apply_parsed_to_employee(emp, p)
            if changed:
                updated += 1
        else:
            db.add(_parsed_to_employee(p, cycle_id=cycle.id, cpi_rate=cpi_rate))
            inserted += 1

    for emp_num, emp in existing_by_num.items():
        if emp_num not in parsed_nums and not emp.is_departed:
            emp.is_departed = True
            departed += 1

    await db.commit()
    return inserted, updated, departed


# ─────────────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _parsed_to_employee(p: ParsedEmployee, *, cycle_id: int, cpi_rate: float) -> Employee:
    """Convert a parsed row into an Employee ORM object with CPI defaults."""
    current_rate = p.current_rate

    # Default everyone to CPI Increase at the cycle rate
    default_change_type = "CPI Increase"
    default_change_input = cpi_rate
    default_proposed = (
        calc_proposed_rate(
            current_rate=current_rate,
            change_type=default_change_type,
            change_input=default_change_input,
        )
        if current_rate is not None
        else None
    )

    return Employee(
        cycle_id=cycle_id,
        emp_num=p.emp_num,
        first_name=p.first_name or "",
        last_name=p.last_name or "",
        email=p.email,
        age=p.age,
        site=p.site,
        department=p.dept,
        category=p.category,
        hours_per_week=p.hours_per_week,
        fy25_award=p.fy25_award,
        current_rate=current_rate,
        fy26_award=p.fy26_award,
        pp_level=p.pp_level,
        # Historical compliance snapshot (FY25→FY26, from Excel)
        hist_award_level_changed=p.hist_award_level_changed,
        hist_rate_changed=       p.hist_rate_changed,
        hist_above_award_rate=   p.hist_above_award_rate,
        hist_above_pp_rate=      p.hist_above_pp_rate,
        hist_above_pp_max=       p.hist_above_pp_max,
        # Review state — initialised with CPI defaults
        change_type=default_change_type,
        change_input=default_change_input,
        proposed_rate=default_proposed,
        letter_type=None,
        notes=None,
        is_departed=p.is_departed,
    )


# Identity fields we overwrite on merge (NOT review/workflow state)
_MERGE_FIELDS: tuple[tuple[str, str], ...] = (
    # (orm_field, parsed_field)
    ("first_name",    "first_name"),
    ("last_name",     "last_name"),
    ("email",         "email"),
    ("age",           "age"),
    ("site",          "site"),
    ("department",    "dept"),
    ("category",      "category"),
    ("hours_per_week","hours_per_week"),
    ("fy25_award",    "fy25_award"),
    ("fy26_award",    "fy26_award"),   # award level can change between uploads
    ("pp_level",      "pp_level"),    # PP band can change too
    ("current_rate",             "current_rate"),
    # Historical compliance snapshot — also refreshed on re-upload
    ("hist_award_level_changed", "hist_award_level_changed"),
    ("hist_rate_changed",        "hist_rate_changed"),
    ("hist_above_award_rate",    "hist_above_award_rate"),
    ("hist_above_pp_rate",       "hist_above_pp_rate"),
    ("hist_above_pp_max",        "hist_above_pp_max"),
)


def _apply_parsed_to_employee(emp: Employee, p: ParsedEmployee) -> bool:
    """Apply identity fields from parsed. Returns True if anything changed.
    Review state (change_type, change_input, proposed_rate, letter_type, notes)
    is intentionally left untouched on re-upload.
    """
    changed = False
    for orm_f, parsed_f in _MERGE_FIELDS:
        new_val = getattr(p, parsed_f)
        if new_val is None:
            continue
        if _normalise(getattr(emp, orm_f)) != _normalise(new_val):
            setattr(emp, orm_f, new_val)
            changed = True
    if emp.is_departed and p.emp_num:
        emp.is_departed = False
        changed = True
    return changed


# ─────────────────────────────────────────────────────────────────────────────
#  Utilities
# ─────────────────────────────────────────────────────────────────────────────
def _normalise(v):
    if v is None or v == "":
        return None
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return str(v).strip()


def _scalar(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return str(v)


def _full_name(first: str | None, last: str | None) -> str:
    parts = [(first or "").strip(), (last or "").strip()]
    name = " ".join(p for p in parts if p)
    return name or "(unnamed)"
