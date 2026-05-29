"""Cycle business logic: employee upsert, diff computation, current-cycle lookup."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import delete as sql_delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AwardRate,
    CycleStatus,
    Employee,
    JuniorRate,
    PPBand,
    ReviewCycle,
)
from app.services.parsers import (
    ParsedAwardRate,
    ParsedEmployee,
    ParsedJuniorRate,
    ParsedPPBand,
)


# Fields we compare row-to-row when diffing an upload against existing data
DIFF_FIELDS: tuple[str, ...] = (
    "first_name",
    "last_name",
    "email",
    "site",
    "category",
    "job_classification",
    "hours_per_week",
    "current_award",
    "current_rate",
)

# ORM field → ParsedEmployee field aliases (when names differ)
_PARSED_FIELD_ALIASES: dict[str, str] = {
    # No remaps needed currently — all DIFF_FIELDS exist on both sides
}


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
        return round(change_input, 4)
    if ct == "no change":
        return round(current_rate, 4)
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


def _parsed_field_name(orm_field: str) -> str:
    return _PARSED_FIELD_ALIASES.get(orm_field, orm_field)


# ─────────────────────────────────────────────────────────────────────────────
#  Persistence
# ─────────────────────────────────────────────────────────────────────────────
def parsed_to_employee(p: ParsedEmployee, *, cycle_id: int, cpi_rate: float) -> Employee:
    """Convert a parsed row into an Employee ORM object. Defaults to No Change."""
    current_rate = p.current_rate

    default_change_type = "No Change"
    default_change_input = 0.0
    default_proposed = round(current_rate, 4) if current_rate is not None else None

    return Employee(
        cycle_id=cycle_id,
        emp_num=p.emp_num,
        first_name=p.first_name or "",
        last_name=p.last_name or "",
        preferred_name=p.preferred_name,
        email=p.email,
        dob=_parse_date(p.dob),
        age=p.age,
        service_start_date=_parse_date(p.service_start_date),
        hire_date=_parse_date(p.hire_date),
        site=p.site,
        category=p.category,
        job_classification=p.job_classification,
        rate_type=p.rate_type,
        hours_per_pay_period=p.hours_per_pay_period,
        hours_per_week=p.hours_per_week,
        current_award=p.current_award,
        current_rate=current_rate,
        # pp_level is NOT imported — assigned during review (or via mapping when client gives us one)
        pp_level=None,
        change_type=default_change_type,
        change_input=None,          # No Change has no meaningful input
        proposed_rate=default_proposed,
        letter_type=None,
        notes=None,
        is_departed=p.is_departed,
    )


# ORM identity fields refreshed on merge (NOT review/workflow state)
_MERGE_FIELDS: tuple[tuple[str, str], ...] = (
    # (orm_field, parsed_field)
    ("first_name",           "first_name"),
    ("last_name",            "last_name"),
    ("preferred_name",       "preferred_name"),
    ("email",                "email"),
    ("age",                  "age"),
    ("site",                 "site"),
    ("category",             "category"),
    ("job_classification",   "job_classification"),
    ("rate_type",            "rate_type"),
    ("hours_per_pay_period", "hours_per_pay_period"),
    ("hours_per_week",       "hours_per_week"),
    ("current_award",        "current_award"),
    ("current_rate",         "current_rate"),
)
_MERGE_DATE_FIELDS: tuple[tuple[str, str], ...] = (
    ("dob",                "dob"),
    ("service_start_date", "service_start_date"),
    ("hire_date",          "hire_date"),
)


def apply_parsed_to_employee(emp: Employee, p: ParsedEmployee) -> bool:
    """Apply identity fields from parsed. Returns True if anything changed.
    Review state (change_type, change_input, proposed_rate, letter_type, notes,
    pp_level) is intentionally left untouched on re-upload.
    """
    changed = False
    for orm_f, parsed_f in _MERGE_FIELDS:
        new_val = getattr(p, parsed_f)
        if new_val is None:
            continue
        if _normalise(getattr(emp, orm_f)) != _normalise(new_val):
            setattr(emp, orm_f, new_val)
            changed = True
    for orm_f, parsed_f in _MERGE_DATE_FIELDS:
        new_val = _parse_date(getattr(p, parsed_f))
        if new_val is None:
            continue
        if getattr(emp, orm_f) != new_val:
            setattr(emp, orm_f, new_val)
            changed = True
    if emp.is_departed and p.emp_num:
        emp.is_departed = False
        changed = True
    return changed


async def upsert_employees(
    db: AsyncSession,
    *,
    cycle: ReviewCycle,
    parsed: Iterable[ParsedEmployee],
) -> tuple[int, int, int]:
    """Insert / update / mark-as-departed employees for a cycle.

    Returns (inserted, updated, departed).
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
            if apply_parsed_to_employee(emp, p):
                updated += 1
        else:
            db.add(parsed_to_employee(p, cycle_id=cycle.id, cpi_rate=cpi_rate))
            inserted += 1

    for emp_num, emp in existing_by_num.items():
        if emp_num not in parsed_nums and not emp.is_departed:
            emp.is_departed = True
            departed += 1

    await db.flush()
    return inserted, updated, departed


async def archive_cycle(db: AsyncSession, cycle: ReviewCycle) -> None:
    cycle.status = CycleStatus.ARCHIVED.value
    await db.flush()


# ─────────────────────────────────────────────────────────────────────────────
#  Reference data upserts — wipe-and-replace per cycle on every upload.
# ─────────────────────────────────────────────────────────────────────────────
async def replace_award_rates(
    db: AsyncSession,
    cycle_id: int,
    parsed: Iterable[ParsedAwardRate],
) -> int:
    """Delete all award_rates for this cycle and insert the new set."""
    await db.execute(sql_delete(AwardRate).where(AwardRate.cycle_id == cycle_id))
    count = 0
    for p in parsed:
        db.add(AwardRate(
            cycle_id=cycle_id,
            award_level=p.award_level,
            weekly_rate=p.weekly_rate,
            laundry=p.laundry,
            combined_weekly=p.combined_weekly,
            hourly_rate=p.hourly_rate,
            laundry_hourly=p.laundry_hourly,
            combined_hourly=p.combined_hourly,
            display_order=p.display_order,
            section_header=p.section_header,
            is_off_award=p.is_off_award,
        ))
        count += 1
    await db.flush()
    return count


async def replace_pp_bands(
    db: AsyncSession,
    cycle_id: int,
    parsed: Iterable[ParsedPPBand],
) -> int:
    """Delete all pp_bands for this cycle and insert the new set."""
    await db.execute(sql_delete(PPBand).where(PPBand.cycle_id == cycle_id))
    count = 0
    for p in parsed:
        db.add(PPBand(
            cycle_id=cycle_id,
            convention=p.convention,
            award_key=p.award_key,
            carlisle_label=p.carlisle_label,
            stream=p.stream,
            section_header=p.section_header,
            award_level_group=p.award_level_group,
            band_min=p.band_min,
            band_max=p.band_max,
            experience_notes=p.experience_notes,
            progression_notes=p.progression_notes,
            display_order=p.display_order,
        ))
        count += 1
    await db.flush()
    return count


async def append_pp_bands(
    db: AsyncSession,
    cycle_id: int,
    parsed: Iterable[ParsedPPBand],
) -> int:
    """Insert pp_bands without deleting existing ones (used when uploading
    admin + tech streams separately into the same cycle).
    """
    count = 0
    for p in parsed:
        db.add(PPBand(
            cycle_id=cycle_id,
            convention=p.convention,
            award_key=p.award_key,
            carlisle_label=p.carlisle_label,
            stream=p.stream,
            section_header=p.section_header,
            award_level_group=p.award_level_group,
            band_min=p.band_min,
            band_max=p.band_max,
            experience_notes=p.experience_notes,
            progression_notes=p.progression_notes,
            display_order=p.display_order,
        ))
        count += 1
    await db.flush()
    return count


async def replace_junior_rates(
    db: AsyncSession,
    cycle_id: int,
    parsed: Iterable[ParsedJuniorRate],
) -> int:
    """Delete all junior_rates for this cycle and insert the new set."""
    await db.execute(sql_delete(JuniorRate).where(JuniorRate.cycle_id == cycle_id))
    count = 0
    for p in parsed:
        db.add(JuniorRate(cycle_id=cycle_id, age=p.age, multiplier=p.multiplier))
        count += 1
    await db.flush()
    return count


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


def _parse_date(v: str | None):
    """Convert an ISO date string back into a date for the ORM."""
    if v is None:
        return None
    try:
        return datetime.fromisoformat(v).date()
    except (TypeError, ValueError):
        return None
