"""
Compliance and rate-suggestion service.

All 6 checks from the prototype, now driven by a ComplianceContext loaded
from the DB (per cycle) rather than hard-coded module-level dicts.

  1. Classification      — current award level recognised in MA000027?
  2. Award floor         — proposed rate ≥ award minimum?
  3. Level ceiling       — proposed rate ≥ NEXT level's floor? (needs reclassification)
  4. Junior rate         — employee under 21 at effective date? SS stream % applies
  5. Rate change         — is rate decreasing? (warn)
  6. Pay progression     — valid current_award → proposed_award pay point advancement?
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AwardRate, JuniorRate, PPBand


# ─────────────────────────────────────────────────────────────────────────────
#  ComplianceContext — the cycle-scoped data the engine needs
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class ComplianceContext:
    """Pre-computed lookup tables for one review cycle.

    Built by `load_context(db, cycle_id)` from the award_rates / pp_bands /
    junior_rates tables. Pass it into check_employee() / suggest_rate().
    """

    # award_level → hourly_rate (e.g. "HPSS HP L1 PP1" → 29.49)
    award_rates: dict[str, float]

    # Levels in canonical Excel order — used by ceiling / progression checks.
    award_order: list[str]

    # level → minimum rate of the NEXT level (ceiling for THIS level)
    award_next_min: dict[str, float]
    # level → name of the next level
    award_next_level: dict[str, str]

    # level_group ("HPSS HP L2") → ordered list of pay-point levels in that group
    level_progression: dict[str, list[str]]

    # Convention key → (band_min, band_max). None values are preserved.
    pp_bands: dict[str, tuple[float | None, float | None]]

    # Award levels flagged as off-award in the source file
    off_award_levels: set[str]

    # age (int) → multiplier (fraction of adult rate)
    junior_rates: dict[int, float]

    @property
    def is_empty(self) -> bool:
        return not self.award_rates


_EMPTY_CONTEXT = ComplianceContext(
    award_rates={},
    award_order=[],
    award_next_min={},
    award_next_level={},
    level_progression={},
    pp_bands={},
    off_award_levels=set(),
    junior_rates={},
)


def empty_context() -> ComplianceContext:
    """A context with no data — used when a cycle has no reference data loaded yet."""
    return _EMPTY_CONTEXT


async def load_context(db: AsyncSession, cycle_id: int) -> ComplianceContext:
    """Build a ComplianceContext from the DB for one cycle."""
    # Award rates (in display_order)
    rates_res = await db.execute(
        select(AwardRate).where(AwardRate.cycle_id == cycle_id).order_by(AwardRate.display_order)
    )
    rate_rows = rates_res.scalars().all()

    award_rates: dict[str, float] = {}
    award_order: list[str] = []
    off_award: set[str] = set()
    for r in rate_rows:
        if r.is_off_award:
            off_award.add(r.award_level)
            continue
        if r.hourly_rate is None:
            continue
        award_rates[r.award_level] = float(r.hourly_rate)
        award_order.append(r.award_level)

    # Derive next-level / level-progression maps
    award_next_min: dict[str, float] = {}
    award_next_level: dict[str, str] = {}
    for i, lvl in enumerate(award_order[:-1]):
        nxt = award_order[i + 1]
        if nxt in award_rates:
            award_next_min[lvl] = award_rates[nxt]
            award_next_level[lvl] = nxt

    level_progression: dict[str, list[str]] = {}
    for lvl in award_order:
        grp = lvl.rsplit(" PP", 1)[0] if " PP" in lvl else lvl
        level_progression.setdefault(grp, []).append(lvl)

    # PP bands
    bands_res = await db.execute(
        select(PPBand).where(PPBand.cycle_id == cycle_id)
    )
    pp_bands: dict[str, tuple[float | None, float | None]] = {}
    for b in bands_res.scalars().all():
        pp_bands[b.convention] = (
            float(b.band_min) if b.band_min is not None else None,
            float(b.band_max) if b.band_max is not None else None,
        )

    # Junior rates
    juniors_res = await db.execute(
        select(JuniorRate).where(JuniorRate.cycle_id == cycle_id)
    )
    junior_rates = {j.age: float(j.multiplier) for j in juniors_res.scalars().all()}

    return ComplianceContext(
        award_rates=award_rates,
        award_order=award_order,
        award_next_min=award_next_min,
        award_next_level=award_next_level,
        level_progression=level_progression,
        pp_bands=pp_bands,
        off_award_levels=off_award,
        junior_rates=junior_rates,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Result types
# ─────────────────────────────────────────────────────────────────────────────
CheckStatus = Literal["ok", "warn", "fail", "suppressed"]


@dataclass
class CheckResult:
    """One compliance check — (status, label, detail, recommendation)."""
    status: CheckStatus
    label: str
    detail: str
    recommendation: str = ""


@dataclass
class ComplianceResult:
    overall: CheckStatus = "ok"
    checks: list[CheckResult] = field(default_factory=list)

    award_minimum: float | None = None
    next_level: str | None = None
    band_min: float | None = None
    band_max: float | None = None

    @property
    def is_ok(self) -> bool:
        return self.overall != "fail"

    @property
    def has_warnings(self) -> bool:
        return self.overall in ("warn", "fail")

    @property
    def issue_codes(self) -> list[str]:
        return [c.label for c in self.checks if c.status != "ok"]


def _worst(a: CheckStatus, b: CheckStatus) -> CheckStatus:
    order = {"ok": 0, "warn": 1, "fail": 2}
    return a if order[a] >= order[b] else b


def _normalize(lvl: str) -> str:
    return re.sub(r"\s+", " ", (lvl or "").strip().upper())


# ─────────────────────────────────────────────────────────────────────────────
#  Main compliance check
# ─────────────────────────────────────────────────────────────────────────────
def check_employee(
    *,
    context: ComplianceContext,
    current_award: str | None,
    proposed_award: str | None,
    proposed_rate: float | None,
    current_rate: float | None,
    pp_level: str | None,
    age: int | None = None,
    effective_date: date | None = None,
    suppressed_labels: set[str] | None = None,
) -> ComplianceResult:
    """
    Run all 6 compliance checks for one employee.

    Parameters
    ----------
    context         The cycle's ComplianceContext (loaded via load_context())
    current_award   This year's award classification (entering this review)
    proposed_award  The next level accepted for this employee in this review
    proposed_rate   The rate we plan to pay from 1 July
    current_rate    Current rate (used for rate-change direction check)
    pp_level        Carlisle internal PP band convention
    age             Employee's age at effective_date
    effective_date  The pay effective date (default 30 Jun of FY year)
    """
    result = ComplianceResult()
    pr = proposed_rate or 0.0
    cr = current_rate or 0.0
    ca_n = _normalize(current_award or "")
    pa_n = _normalize(proposed_award or "")

    # ── Populate PP band bounds (for UI display) ──────────────────────────────
    if pp_level and pp_level in context.pp_bands:
        result.band_min, result.band_max = context.pp_bands[pp_level]

    # ── Short-circuit: off-award / non-MA000027 staff ────────────────────────
    if current_award and current_award in context.off_award_levels:
        result.checks.append(CheckResult(
            "warn", "Classification",
            f"{current_award} — off-award / individual contract",
            "Verify against individual contract terms — MA000027 checks not applicable",
        ))
        result.overall = "warn"
        for label in ("Award floor", "Level ceiling", "Age / DOB", "Rate change", "Pay progression"):
            result.checks.append(CheckResult("ok", label, "Skipped — off-award classification"))
        return result

    # Canonical form for AWARD_RATES lookups (case-insensitive match)
    ca_canonical = next(
        (k for k in context.award_rates if _normalize(k) == ca_n), None
    ) if ca_n else None

    # ── Check 1: Classification ──────────────────────────────────────────────
    if ca_canonical:
        result.award_minimum = context.award_rates[ca_canonical]
        result.checks.append(CheckResult(
            "ok", "Classification",
            f"{ca_canonical} — recognised award level",
        ))
    elif current_award:
        result.checks.append(CheckResult(
            "warn", "Classification",
            f"{current_award} — not in the MA000027 rate table",
            "Update the award level to a valid MA000027 classification",
        ))
        result.overall = _worst(result.overall, "warn")
    else:
        result.checks.append(CheckResult(
            "warn", "Classification",
            "No award level set",
            "Set the award level before this employee can be processed",
        ))
        result.overall = _worst(result.overall, "warn")

    # ── Check 2: Award floor ─────────────────────────────────────────────────
    floor = result.award_minimum
    if floor is not None:
        if pr == 0:
            result.checks.append(CheckResult(
                "fail", "Award floor",
                f"No proposed rate set — must be ≥ ${floor:.2f}",
                f"Set the proposed rate to at least ${floor:.2f}",
            ))
            result.overall = _worst(result.overall, "fail")
        elif pr >= floor:
            result.checks.append(CheckResult(
                "ok", "Award floor",
                f"${pr:.2f} ≥ ${floor:.2f} minimum ✓",
            ))
        else:
            gap = round(floor - pr, 2)
            pct_need = round(((floor / cr) - 1) * 100, 2) if cr else 0
            result.checks.append(CheckResult(
                "fail", "Award floor",
                f"${pr:.2f} < ${floor:.2f} minimum — short by ${gap:.2f}",
                f"Raise to {pct_need:.1f}% increase, or Fixed Rate ${floor:.2f}",
            ))
            result.overall = _worst(result.overall, "fail")
    else:
        result.checks.append(CheckResult(
            "warn", "Award floor",
            "Cannot check — level not in rate table",
            "Resolve the Classification issue first",
        ))
        result.overall = _worst(result.overall, "warn")

    # ── Detect "level promotion suggestion" — walk up to highest qualifying level ─
    # Keep stepping up the award order as long as the proposed rate meets the next
    # level's floor. Stop at stream boundaries (HP→SS or SS→HP) to avoid
    # cross-stream suggestions. The final candidate is the highest same-stream
    # level the employee's rate qualifies for.
    if ca_canonical and pr > 0:
        def _stream(lvl: str) -> str:
            parts = lvl.split()
            if "HP" in parts:
                return "hp"
            if "SS" in parts:
                return "ss"
            return lvl  # treat unique codes as their own stream

        origin_stream = _stream(ca_canonical)
        candidate = ca_canonical
        highest: str | None = None
        _seen: set[str] = {ca_canonical}   # guard against cycles in bad data
        while candidate in context.award_next_min:
            next_lvl = context.award_next_level[candidate]
            if next_lvl in _seen:
                break
            if _stream(next_lvl) != origin_stream:
                break  # crossed stream boundary — stop
            if pr >= context.award_next_min[candidate]:
                highest = next_lvl
                _seen.add(next_lvl)
                candidate = next_lvl
            else:
                break
        if highest:
            result.next_level = highest

    # ── Check 3a: PP band minimum ────────────────────────────────────────────
    if result.band_min is not None and pr > 0:
        if pr < result.band_min:
            gap = round(result.band_min - pr, 2)
            result.checks.append(CheckResult(
                "warn", "PP band minimum",
                f"${pr:.2f} < band min ${result.band_min:.2f} ({pp_level}) — below Carlisle band floor by ${gap:.2f}",
                f"Raise proposed rate to at least ${result.band_min:.2f} to meet this role's Carlisle band minimum",
            ))
            result.overall = _worst(result.overall, "warn")
        else:
            result.checks.append(CheckResult(
                "ok", "PP band minimum",
                f"${pr:.2f} ≥ band min ${result.band_min:.2f} ✓",
            ))
    elif pp_level:
        result.checks.append(CheckResult(
            "ok", "PP band minimum",
            "No PP band assigned — band minimum not checked",
        ))
    else:
        result.checks.append(CheckResult(
            "ok", "PP band minimum", "Band minimum check skipped — no PP level set",
        ))

    # ── Check 3b: PP band ceiling ────────────────────────────────────────────
    if result.band_max is not None and pr > 0:
        if pr > result.band_max:
            result.checks.append(CheckResult(
                "warn", "PP band ceiling",
                f"${pr:.2f} > band max ${result.band_max:.2f} ({pp_level}) — above Carlisle band ceiling",
                "Update the Convention role in UKG to a higher band",
            ))
            result.overall = _worst(result.overall, "warn")
        else:
            result.checks.append(CheckResult(
                "ok", "PP band ceiling",
                f"${pr:.2f} ≤ band max ${result.band_max:.2f} — within band ✓",
            ))
    elif pp_level:
        result.checks.append(CheckResult(
            "ok", "PP band ceiling",
            "No upper limit for this band — ceiling not applicable",
        ))
    else:
        result.checks.append(CheckResult(
            "ok", "PP band ceiling", "Band ceiling check skipped — no PP level set",
        ))

    # ── Check 4: Junior rate ─────────────────────────────────────────────────
    is_ss = ca_canonical is not None and "SS" in (ca_canonical or "").split()
    ref_str = effective_date.strftime("%-d %b %Y") if effective_date else "30 Jun"
    if age is not None:
        if age < 21 and is_ss:
            pct = context.junior_rates.get(min(age, 20), 0.40)
            adult_min = floor or 0.0
            jmin = round(adult_min * pct, 2)
            if pr >= jmin:
                result.checks.append(CheckResult(
                    "ok", "Junior rate",
                    f"Age {age} at {ref_str} — {int(pct * 100)}% adult = ${jmin:.2f} min; "
                    f"rate ${pr:.2f} ✓",
                ))
            else:
                result.checks.append(CheckResult(
                    "fail", "Junior rate",
                    f"Age {age} at {ref_str} — {int(pct * 100)}% adult = ${jmin:.2f} min; "
                    f"rate ${pr:.2f} is below junior minimum",
                    f"Raise proposed rate to at least ${jmin:.2f} "
                    f"({int(pct * 100)}% of adult minimum for age {age})",
                ))
                result.overall = _worst(result.overall, "fail")
        else:
            lbl = (
                f"Age {age} at {ref_str}"
                if age >= 21
                else f"Age {age} at {ref_str} (HP stream — adult rate applies)"
            )
            result.checks.append(CheckResult(
                "ok", "Age check", f"{lbl} — adult rate applies ✓",
            ))
    else:
        result.checks.append(CheckResult(
            "warn", "Age / DOB",
            f"No age on record — junior rate check skipped (ref: {ref_str})",
            "Add a DOB to the Employee_Details file to enable junior rate checking",
        ))
        result.overall = _worst(result.overall, "warn")

    # ── Check 5: Rate change direction ───────────────────────────────────────
    diff = pr - cr if pr > 0 and cr > 0 else 0
    if pr == 0:
        result.checks.append(CheckResult(
            "warn", "Rate change", "No proposed rate set", "Set the proposed rate",
        ))
        result.overall = _worst(result.overall, "warn")
    elif abs(diff) < 0.005:
        result.checks.append(CheckResult("ok", "Rate change", "No change — rate held"))
    elif diff > 0:
        pct_chg = (diff / cr * 100) if cr else 0
        result.checks.append(CheckResult(
            "ok", "Rate change",
            f"${cr:.2f} → ${pr:.2f} (+${diff:.2f} / +{pct_chg:.1f}%) ✓",
        ))
    else:
        result.checks.append(CheckResult(
            "warn", "Rate change",
            f"${cr:.2f} → ${pr:.2f} (−${abs(diff):.2f} — rate decrease)",
            "Confirm this decrease is intentional and obtain written management approval",
        ))
        result.overall = _worst(result.overall, "warn")

    # ── Check 6: Pay-point progression (current_award → proposed_award) ─────
    if pa_n:
        pa_canonical = next(
            (k for k in context.award_rates if _normalize(k) == pa_n), None
        )
        ca_grp = (ca_canonical or ca_n).rsplit(" PP", 1)[0] if " PP" in (ca_canonical or ca_n) else (ca_canonical or ca_n)
        pa_grp = (pa_canonical or pa_n).rsplit(" PP", 1)[0] if " PP" in (pa_canonical or pa_n) else (pa_canonical or pa_n)

        if not ca_n:
            result.checks.append(CheckResult(
                "warn", "Pay progression",
                "Current award level not set — cannot validate proposed next level",
                "Set the award level first",
            ))
            result.overall = _worst(result.overall, "warn")
        elif ca_grp != pa_grp:
            result.checks.append(CheckResult(
                "ok", "Pay progression",
                f"Level change: {ca_canonical or ca_n} → {pa_canonical or proposed_award} ✓",
            ))
        elif ca_grp in context.level_progression:
            pp_list = context.level_progression[ca_grp]
            if len(pp_list) == 1:
                result.checks.append(CheckResult(
                    "ok", "Pay progression",
                    f"{pa_canonical or proposed_award} — single-rate level, no pay points ✓",
                ))
            else:
                try:
                    i_ca = pp_list.index(ca_canonical or ca_n)
                    i_pa = pp_list.index(pa_canonical or pa_n)
                    if i_pa > i_ca:
                        steps = i_pa - i_ca
                        result.checks.append(CheckResult(
                            "ok", "Pay progression",
                            f"Advanced {steps} pay point{'s' if steps > 1 else ''}: "
                            f"{ca_canonical or ca_n} → {pa_canonical or proposed_award} ✓",
                        ))
                    elif i_pa == i_ca:
                        if i_ca == len(pp_list) - 1:
                            result.checks.append(CheckResult(
                                "ok", "Pay progression",
                                f"At top pay point of {ca_grp} — "
                                f"reclassify to next level for further progression ✓",
                            ))
                        else:
                            next_pp = pp_list[i_ca + 1]
                            next_pp_rate = context.award_rates.get(next_pp, 0)
                            result.checks.append(CheckResult(
                                "warn", "Pay progression",
                                f"No advancement: proposed next level same as current ({pa_canonical or proposed_award})",
                                f"Advance to {next_pp} (${next_pp_rate:.2f}) "
                                f"if 12+ months satisfactory service at this pay point",
                            ))
                            result.overall = _worst(result.overall, "warn")
                    else:
                        result.checks.append(CheckResult(
                            "warn", "Pay progression",
                            f"Pay point decrease proposed: {ca_canonical or ca_n} → {pa_canonical or proposed_award}",
                            "Confirm this pay point reduction is correct and has written approval",
                        ))
                        result.overall = _worst(result.overall, "warn")
                except ValueError:
                    result.checks.append(CheckResult(
                        "warn", "Pay progression",
                        f"Could not locate {ca_canonical or ca_n} or {pa_canonical or proposed_award} "
                        f"in the pay point sequence for {ca_grp}",
                        "Verify award level classifications are correct",
                    ))
                    result.overall = _worst(result.overall, "warn")
        else:
            result.checks.append(CheckResult(
                "ok", "Pay progression",
                f"{ca_canonical or ca_n} → {pa_canonical or proposed_award}",
            ))
    elif result.next_level:
        result.checks.append(CheckResult(
            "ok", "Pay progression",
            f"No award level change proposed — {result.next_level} available if eligible",
        ))
    else:
        result.checks.append(CheckResult(
            "ok", "Pay progression",
            "No level progression due — check not applicable",
        ))

    # ── Apply suppressions ───────────────────────────────────────────────────
    if suppressed_labels:
        for check in result.checks:
            if check.status == "warn" and check.label in suppressed_labels:
                check.status = "suppressed"
        result.overall = "ok"
        for check in result.checks:
            if check.status != "suppressed":
                result.overall = _worst(result.overall, check.status)

    return result


# ─────────────────────────────────────────────────────────────────────────────
#  Rate suggestion
# ─────────────────────────────────────────────────────────────────────────────
def suggest_rate(
    *,
    context: ComplianceContext,
    current_rate: float | None,
    current_award: str | None,
    pp_level: str | None,
    cpi_rate: float,
) -> float | None:
    """Suggest a proposed rate.

    Logic:
    - For employees due a pay point advance (PP group, not at top): move to next PP's rate
    - Otherwise: CPI bump on current rate
    - Always ≥ award minimum and ≥ PP band minimum
    """
    if not current_rate:
        return None

    cpi_multiplier = 1.0 + (cpi_rate / 100.0)
    cpi_bumped = round(current_rate * cpi_multiplier, 2)

    ca_canonical = next(
        (k for k in context.award_rates if _normalize(k) == _normalize(current_award or "")), None
    ) if current_award else None

    pp_advance_rate: float | None = None
    if ca_canonical and " PP" in ca_canonical:
        grp = ca_canonical.rsplit(" PP", 1)[0]
        pp_list = context.level_progression.get(grp, [])
        try:
            idx = pp_list.index(ca_canonical)
            if idx < len(pp_list) - 1:
                next_pp = pp_list[idx + 1]
                pp_advance_rate = context.award_rates.get(next_pp)
        except ValueError:
            pass

    award_min = context.award_rates.get(ca_canonical or "") if ca_canonical else None
    band_min = (
        context.pp_bands[pp_level][0]
        if pp_level and pp_level in context.pp_bands
        else None
    )

    candidate = (
        pp_advance_rate
        if pp_advance_rate and pp_advance_rate > cpi_bumped
        else cpi_bumped
    )
    if award_min is not None:
        candidate = max(candidate, award_min)
    if band_min is not None:
        candidate = max(candidate, band_min)

    return round(candidate, 2)


def infer_letter_type(
    *,
    current_award: str | None,
    proposed_award: str | None,
    proposed_rate: float | None,
    current_rate: float | None,
) -> str | None:
    """Determine which letter template to use for this employee.

    Letter A — rate increase only ("Increase in your Remuneration")
    Letter B — rate increase + level change ("Increase in Remuneration & Change to Award Level")
    Letter C — level change only, no rate change ("Realignment of your Award level")
    None     — nothing changed (no letter required)
    """
    rate_changed = (
        proposed_rate is not None
        and current_rate is not None
        and abs(proposed_rate - current_rate) >= 0.01
    )
    level_changed = bool(
        current_award and proposed_award
        and _normalize(current_award) != _normalize(proposed_award)
    )

    if rate_changed and level_changed:
        return "B"
    if rate_changed:
        return "A"
    if level_changed:
        return "C"
    return None


# ─────────────────────────────────────────────────────────────────────────────
#  Constants for code that needs the list of valid types
# ─────────────────────────────────────────────────────────────────────────────
VALID_CHANGE_TYPES = ["% Increase", "CPI Increase", "Per Admin PP", "Fixed Rate", "No Change"]
VALID_LETTER_TYPES = ["A", "B", "C"]
