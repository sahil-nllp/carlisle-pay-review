"""
Compliance and rate-suggestion service.

All 6 checks from the prototype, rebuilt properly:
  1. Classification      — FY26 award level recognised in MA000027?
  2. Award floor         — proposed rate ≥ award minimum?
  3. Level ceiling       — proposed rate ≥ NEXT level's floor? (needs reclassification)
  4. Junior rate         — employee under 21 at effective date? SS stream % applies
  5. Rate change         — is rate decreasing? (warn)
  6. Pay progression     — valid FY26 → proposed_award pay point advancement?
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

# ─────────────────────────────────────────────────────────────────────────────
#  MA000027 — Health Professionals & Support Services Award 2020
#  Rates effective 01 July 2025 (FY2025-26)
# ─────────────────────────────────────────────────────────────────────────────
AWARD_RATES: dict[str, float] = {
    # Health Professionals
    "HPSS HP L1 PP1": 29.49, "HPSS HP L1 PP2": 30.64, "HPSS HP L1 PP3": 31.99,
    "HPSS HP L1 PP4": 33.09, "HPSS HP L1 PP5": 36.05, "HPSS HP L1 PP6": 37.33,
    "HPSS HP L2 PP1": 37.53, "HPSS HP L2 PP2": 38.90, "HPSS HP L2 PP3": 40.38,
    "HPSS HP L2 PP4": 41.99,
    "HPSS HP L3 PP1": 43.81, "HPSS HP L3 PP2": 45.04, "HPSS HP L3 PP3": 46.01,
    "HPSS HP L3 PP4": 48.05, "HPSS HP L3 PP5": 49.82,  # FY26 determination PR786565
    "HPSS HP L4 PP1": 53.05, "HPSS HP L4 PP2": 56.61,
    "HPSS HP L4 PP3": 61.56, "HPSS HP L4 PP4": 67.96,
    # Support Services — simple levels
    "HPSS SS L1": 25.74, "HPSS SS L2": 26.76, "HPSS SS L3": 27.79,
    "HPSS SS L4": 28.12, "HPSS SS L5": 29.07, "HPSS SS L6": 30.64,
    "HPSS SS L7": 31.19,
    # Support Services — pay points
    "HPSS SS L8 PP1": 32.24, "HPSS SS L8 PP2": 33.09, "HPSS SS L8 PP3": 35.42,
    "HPSS SS L9 PP1": 36.05, "HPSS SS L9 PP2": 37.33, "HPSS SS L9 PP3": 37.63,
    # Aliases used by some wage model versions
    "HPSS SS L8.1": 32.24, "HPSS SS L8.2": 33.09, "HPSS SS L8.3": 35.42,
    "HPSS SS L9.1": 36.05, "HPSS SS L9.2": 37.33, "HPSS SS L9.3": 37.63,
}

# Ordered sequence — used for ceiling / progression checks
AWARD_ORDER: list[str] = [
    # HP stream (lowest → highest)
    "HPSS HP L1 PP1", "HPSS HP L1 PP2", "HPSS HP L1 PP3",
    "HPSS HP L1 PP4", "HPSS HP L1 PP5", "HPSS HP L1 PP6",
    "HPSS HP L2 PP1", "HPSS HP L2 PP2", "HPSS HP L2 PP3", "HPSS HP L2 PP4",
    "HPSS HP L3 PP1", "HPSS HP L3 PP2", "HPSS HP L3 PP3",
    "HPSS HP L3 PP4", "HPSS HP L3 PP5",
    "HPSS HP L4 PP1", "HPSS HP L4 PP2", "HPSS HP L4 PP3", "HPSS HP L4 PP4",
    # SS stream
    "HPSS SS L1", "HPSS SS L2", "HPSS SS L3", "HPSS SS L4",
    "HPSS SS L5", "HPSS SS L6", "HPSS SS L7",
    "HPSS SS L8 PP1", "HPSS SS L8 PP2", "HPSS SS L8 PP3",
    "HPSS SS L9 PP1", "HPSS SS L9 PP2", "HPSS SS L9 PP3",
]

# level → minimum rate of the NEXT level (= the ceiling for that level)
AWARD_NEXT_MIN: dict[str, float] = {}
AWARD_NEXT_LEVEL: dict[str, str] = {}
for _i, _lvl in enumerate(AWARD_ORDER[:-1]):
    _next = AWARD_ORDER[_i + 1]
    if _next in AWARD_RATES:
        AWARD_NEXT_MIN[_lvl] = AWARD_RATES[_next]
        AWARD_NEXT_LEVEL[_lvl] = _next

# level-group → ordered list of pay points within that group
# e.g. "HPSS HP L1" → ["HPSS HP L1 PP1", ..., "HPSS HP L1 PP6"]
LEVEL_PROGRESSION: dict[str, list[str]] = {}
for _lvl in AWARD_ORDER:
    _grp = _lvl.rsplit(" PP", 1)[0] if " PP" in _lvl else _lvl
    LEVEL_PROGRESSION.setdefault(_grp, []).append(_lvl)

# ─────────────────────────────────────────────────────────────────────────────
#  Junior rates — SS stream only (MA000027 Schedule B)
#  Key = age, value = fraction of adult rate
# ─────────────────────────────────────────────────────────────────────────────
JUNIOR_RATES: dict[int, float] = {
    15: 0.40, 16: 0.50, 17: 0.60, 18: 0.70, 19: 0.80, 20: 0.90,
}

# ─────────────────────────────────────────────────────────────────────────────
#  Carlisle Pay Progression Bands (FY25/26)
#  Keys are the "Convention" strings exactly as stored in the wage model Excel
#  and parsed into the pp_level column.
# ─────────────────────────────────────────────────────────────────────────────
PP_BANDS: dict[str, tuple[float, float]] = {
    # ── Technical ─────────────────────────────────────────────────────────────
    "HPSSL5 Technical AssistantEntry":                    (29.07, 31.50),
    "HPSSL6 Technical AssistantAdvanced":                 (30.00, 32.00),
    # Radiographer
    "HPL1.3-1.6 RadiographerNew Grad":                    (33.95, 37.40),
    "HPL2.1-2.4 RadiographerQualified":                   (37.60, 45.00),
    "HPL2.1-2.4 RadiographerBasic Modalities":            (39.00, 45.00),
    "HPL2.1-2.4 RadiographerIntermediate Modalities":     (40.00, 53.00),
    "HPL3.1-3.5 RadiographerAdvanced Modalities":         (48.00, 60.00),
    # MRI
    "HPL2.1-2.4 MRI RadiographerTrainee / Basic":         (43.00, 47.00),
    "HPL2.1-2.4 MRI RadiographerQualified":               (49.00, 56.00),
    "HPL3.1-3.5 MRI RadiographerSenior":                  (56.00, 64.00),
    "HPL3.1-3.5 MRI RadiographerSenior Advanced":         (64.00, 67.00),
    # Sonographer
    "HPL1.1-1.6 SonographerTrainee - Basic":              (34.00, 38.00),
    "HPL1.2-1.6 SonographerTrainee - Intermediate":       (38.00, 45.00),
    "HPL1.3-1.6 SonographerTrainee - Advanced":           (45.00, 52.00),
    "HPL2.1-2.4 SonographerQualified":                    (51.00, 55.00),
    "HPL2.1-2.4 SonographerIntermediate":                 (55.00, 62.00),
    "HPL3.1-3.5 SonographerAdvanced":                     (60.00, 76.00),
    "HPL3.1-3.5 SonographerSenior Advanced":              (68.00, 80.00),
    # Management
    "HPL3.1-3.5 ManagementModality Head":                 (53.00, 67.00),
    "HPL4.1-4.4 ManagementSite / Cluster":                (56.00, 72.00),
    # ── Admin — Patient Services ──────────────────────────────────────────────
    "HPSS SS L4 Pt Services First Year":                  (28.17, 29.12),
    "HPSS SS L5 Pt Services Second Year":                 (29.12, 30.69),
    "HPSS SS L6 Pt Services Third Year":                  (30.69, 31.24),
    "HPSS SS L6 Pt Services Third Year Advanced":         (31.24, 32.18),
    # 2IC
    "HPSS SS L7 2IC First Year":                          (32.18, 33.14),
    "HPSS SS L7 2IC Second Year":                         (33.14, 34.14),
    "HPSS SS L7 2IC Third Year Advanced":                 (34.14, 36.39),
    # Supervisor 1–5
    "HPSS SS L7 SUP 1-5 First Year":                      (32.49, 35.09),
    "HPSS SS L7 SUP 1-5 Second Year":                     (35.09, 36.39),
    "HPSS SS L7 SUP 1-5 Third Year Advanced":             (36.39, 40.23),
    # Supervisor 6+
    "HPSS SS L7 SUP 6+ First Year":                       (32.49, 34.36),
    "HPSS SS L7 SUP 6+ Second Year":                      (34.36, 35.61),
    "HPSS SS L7 SUP 6+ Third Year Advanced":              (35.61, 40.23),
    # Admin Supervisor Large
    "HPSS SS L9 PP1 ADMIN SUP LGE First Year":            (36.10, 37.33),
    "HPSS SS L9 PP2 ADMIN SUP LGE Second Year":           (37.33, 40.23),
    "HPSS SS L9 PP3 ADMIN LGE SUP Third Year Advanced":   (40.23, 44.46),
    # Regional Supervisor
    "HPSS SS L9 PP3 SUP Regional Third Year Advanced":    (40.32, 44.46),
    "HPSS SS L9 PP3 SUP Regional Advanced":               (44.46, 55.00),
    # Typing
    "HPSS SS L5 Typist":                                  (29.12, 30.69),
    "HPSS SS L6 Senior Typist":                           (30.69, 31.24),
    "HPSS SS L6 Typing Team Lead":                        (31.24, 32.29),  # data alias (some rows use L6)
    "HPSS SS L7 Typing Team Lead":                        (31.24, 32.29),
    "HPSS SS L8.1 Typing Pool Lead 1":                    (32.29, 33.14),
    "HPSS SS L8.2 Typing Pool Lead 2":                    (33.14, 35.47),
    "HPSS SS L8.3 Typing Pool Lead 3":                    (35.47, 40.23),
}

# ─────────────────────────────────────────────────────────────────────────────
#  Off-award / non-MA000027 classification detection
#  These employees are on individual contracts or different modern awards.
#  Award floor / progression checks do NOT apply.
# ─────────────────────────────────────────────────────────────────────────────
_OFF_AWARD_MARKERS = (
    "nurses award",
    "off award",
    "off-award",
    "contract",
)

def _is_off_award(level: str) -> bool:
    low = level.lower()
    return any(m in low for m in _OFF_AWARD_MARKERS)

VALID_CHANGE_TYPES = ["% Increase", "CPI Increase", "Per Admin PP", "Fixed Rate", "No Change"]
VALID_LETTER_TYPES = ["A", "B", "C"]


# ─────────────────────────────────────────────────────────────────────────────
#  Check result types
# ─────────────────────────────────────────────────────────────────────────────
CheckStatus = Literal["ok", "warn", "fail", "suppressed"]


@dataclass
class CheckResult:
    """One compliance check — mirrors the prototype's (status, label, detail, recommendation)."""
    status: CheckStatus
    label: str
    detail: str
    recommendation: str = ""


@dataclass
class ComplianceResult:
    overall: CheckStatus = "ok"          # worst of all checks
    checks: list[CheckResult] = field(default_factory=list)

    # Derived values (convenience, used by suggest_rate and API)
    award_minimum: float | None = None
    next_level: str | None = None        # suggested upgrade level (check 3)
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
        """Flat list of check labels that are not 'ok' — for quick filtering."""
        return [c.label for c in self.checks if c.status != "ok"]


def _worst(a: CheckStatus, b: CheckStatus) -> CheckStatus:
    order = {"ok": 0, "warn": 1, "fail": 2}
    return a if order[a] >= order[b] else b


def _normalize(lvl: str) -> str:
    """Normalise award level string for comparison (strip, upper, collapse spaces)."""
    return re.sub(r"\s+", " ", (lvl or "").strip().upper())


# ─────────────────────────────────────────────────────────────────────────────
#  Main compliance check
# ─────────────────────────────────────────────────────────────────────────────
def check_employee(
    *,
    fy26_award: str | None,
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
    fy26_award      This year's award classification (the employee's current level entering this review)
    proposed_award  The next level accepted for this employee in this review (fy26_award → proposed_award)
    proposed_rate   The rate we plan to pay from 1 July
    current_rate    Current rate (used for rate-change direction check)
    pp_level        Carlisle internal P&P band label
    age             Employee's age (integer, from Excel)
    effective_date  The pay effective date (default 30 Jun of FY year)
    """
    result = ComplianceResult()
    pr = proposed_rate or 0.0
    cr = current_rate or 0.0
    fy26_n = _normalize(fy26_award or "")
    pa_n = _normalize(proposed_award or "")

    # ── Populate P&P band bounds (used by API / frontend for reference) ───────
    if pp_level and pp_level in PP_BANDS:
        result.band_min, result.band_max = PP_BANDS[pp_level]

    # ── Short-circuit: off-award / non-MA000027 staff ─────────────────────────
    if fy26_award and _is_off_award(fy26_award):
        result.checks.append(CheckResult(
            "warn", "Classification",
            f"{fy26_award} — off-award / individual contract",
            "Verify against individual contract terms — MA000027 checks not applicable",
        ))
        result.overall = "warn"
        for label in ("Award floor", "Level ceiling", "Age / DOB", "Rate change", "Pay progression"):
            result.checks.append(CheckResult("ok", label, "Skipped — off-award classification"))
        return result

    # Use the canonical form for AWARD_RATES lookups
    fy26_canonical = next(
        (k for k in AWARD_RATES if _normalize(k) == fy26_n), None
    ) if fy26_n else None

    # ── Check 1: Classification ───────────────────────────────────────────────
    if fy26_canonical:
        result.award_minimum = AWARD_RATES[fy26_canonical]
        result.checks.append(CheckResult(
            "ok", "Classification",
            f"{fy26_canonical} — recognised award level",
        ))
    elif fy26_award:
        result.checks.append(CheckResult(
            "warn", "Classification",
            f"{fy26_award} — not in the MA000027 rate table",
            "Update the FY26 Award Level to a valid MA000027 classification",
        ))
        result.overall = _worst(result.overall, "warn")
    else:
        result.checks.append(CheckResult(
            "warn", "Classification",
            "No FY26 award level set",
            "Set the FY26 Award Level before this employee can be processed",
        ))
        result.overall = _worst(result.overall, "warn")

    # ── Check 2: Award floor ──────────────────────────────────────────────────
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

    # ── Award-level upgrade suggestion (displayed in review UI, not a hard check) ─
    # Set next_level when the proposed rate has reached the next award pay-point's
    # floor AND the rate is still within (or below) the PP band ceiling.
    # If the rate has already blown past the band ceiling the "Level ceiling" warning
    # fires instead — those two signals conflict, so we suppress next_level there.
    if fy26_canonical and pr > 0 and fy26_canonical in AWARD_NEXT_MIN:
        if pr >= AWARD_NEXT_MIN[fy26_canonical]:
            band_ok = result.band_max is None or pr <= result.band_max
            if band_ok:
                result.next_level = AWARD_NEXT_LEVEL[fy26_canonical]

    # ── Check 3a: PP band minimum (BC column in Excel) ───────────────────────
    # Proposed rate must be ≥ Carlisle's internal band floor for the role.
    # This is separate from the award floor — an employee can be above the
    # MA000027 minimum but still below Carlisle's own pay band minimum.
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

    # ── Check 3b: PP band ceiling (BG column in Excel) ────────────────────────
    # Proposed rate must be ≤ Carlisle's internal band ceiling for the role.
    # Exceeding it means the Convention role in UKG needs updating.
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
            "No PP band assigned — band ceiling not checked",
        ))
    else:
        result.checks.append(CheckResult(
            "ok", "PP band ceiling", "Band ceiling check skipped — no PP level set",
        ))

    # ── Check 4: Junior rate ──────────────────────────────────────────────────
    is_ss = fy26_canonical is not None and "SS" in (fy26_canonical or "")
    ref_str = effective_date.strftime("%-d %b %Y") if effective_date else "30 Jun 2026"
    if age is not None:
        if age < 21 and is_ss:
            pct = JUNIOR_RATES.get(min(age, 20), 0.40)
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
            "Add an Age or DOB column to the wage model Excel to enable junior rate checking",
        ))
        result.overall = _worst(result.overall, "warn")

    # ── Check 5: Rate change direction ────────────────────────────────────────
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

    # ── Check 6: Pay-point progression (FY26 → proposed next level) ─────────
    # Validates that the next level accepted in this review is a sensible step
    # forward from the employee's current FY26 classification.
    # fy25_award is irrelevant here — that transition already happened.
    if pa_n:
        pa_canonical = next(
            (k for k in AWARD_RATES if _normalize(k) == pa_n), None
        )
        fy26_grp = (fy26_canonical or fy26_n).rsplit(" PP", 1)[0] if " PP" in (fy26_canonical or fy26_n) else (fy26_canonical or fy26_n)
        pa_grp = (pa_canonical or pa_n).rsplit(" PP", 1)[0] if " PP" in (pa_canonical or pa_n) else (pa_canonical or pa_n)

        if not fy26_n:
            result.checks.append(CheckResult(
                "warn", "Pay progression",
                "FY26 award level not set — cannot validate proposed next level",
                "Set the FY26 Award Level first",
            ))
            result.overall = _worst(result.overall, "warn")
        elif fy26_grp != pa_grp:
            # Different level group — intentional reclassification (e.g. L1 → L2)
            result.checks.append(CheckResult(
                "ok", "Pay progression",
                f"Level change: {fy26_canonical or fy26_n} → {pa_canonical or proposed_award} ✓",
            ))
        elif fy26_grp in LEVEL_PROGRESSION:
            pp_list = LEVEL_PROGRESSION[fy26_grp]
            if len(pp_list) == 1:
                result.checks.append(CheckResult(
                    "ok", "Pay progression",
                    f"{pa_canonical or proposed_award} — single-rate level, no pay points ✓",
                ))
            else:
                try:
                    i26 = pp_list.index(fy26_canonical or fy26_n)
                    ipa = pp_list.index(pa_canonical or pa_n)
                    if ipa > i26:
                        steps = ipa - i26
                        result.checks.append(CheckResult(
                            "ok", "Pay progression",
                            f"Advanced {steps} pay point{'s' if steps > 1 else ''}: "
                            f"{fy26_canonical or fy26_n} → {pa_canonical or proposed_award} ✓",
                        ))
                    elif ipa == i26:
                        if i26 == len(pp_list) - 1:
                            result.checks.append(CheckResult(
                                "ok", "Pay progression",
                                f"At top pay point of {fy26_grp} — "
                                f"reclassify to next level for further progression ✓",
                            ))
                        else:
                            next_pp = pp_list[i26 + 1]
                            next_pp_rate = AWARD_RATES.get(next_pp, 0)
                            result.checks.append(CheckResult(
                                "warn", "Pay progression",
                                f"No advancement: proposed next level same as FY26 ({pa_canonical or proposed_award})",
                                f"Advance to {next_pp} (${next_pp_rate:.2f}) "
                                f"if 12+ months satisfactory service at this pay point",
                            ))
                            result.overall = _worst(result.overall, "warn")
                    else:
                        result.checks.append(CheckResult(
                            "warn", "Pay progression",
                            f"Pay point decrease proposed: {fy26_canonical or fy26_n} → {pa_canonical or proposed_award}",
                            "Confirm this pay point reduction is correct and has written approval",
                        ))
                        result.overall = _worst(result.overall, "warn")
                except ValueError:
                    result.checks.append(CheckResult(
                        "warn", "Pay progression",
                        f"Could not locate {fy26_canonical or fy26_n} or {pa_canonical or proposed_award} "
                        f"in the pay point sequence for {fy26_grp}",
                        "Verify FY26 and proposed award level classifications are correct",
                    ))
                    result.overall = _worst(result.overall, "warn")
        else:
            result.checks.append(CheckResult(
                "ok", "Pay progression",
                f"{fy26_canonical or fy26_n} → {pa_canonical or proposed_award}",
            ))
    elif result.next_level:
        # System has detected a progression is due but manager hasn't accepted it yet
        result.checks.append(CheckResult(
            "warn", "Pay progression",
            f"Level progression to {result.next_level} suggested but not yet accepted",
            f"Click Accept to confirm the move to {result.next_level}, or adjust the proposed rate",
        ))
        result.overall = _worst(result.overall, "warn")
    else:
        # No progression due — nothing to validate
        result.checks.append(CheckResult(
            "ok", "Pay progression",
            "No level progression due — check not applicable",
        ))

    # ── Apply suppressions ────────────────────────────────────────────────────
    # Only "warn" checks can be suppressed — hard "fail" checks (Award floor,
    # Junior rate) are legal obligations and cannot be waved away.
    if suppressed_labels:
        for check in result.checks:
            if check.status == "warn" and check.label in suppressed_labels:
                check.status = "suppressed"
        # Recompute overall ignoring suppressed checks
        result.overall = "ok"
        for check in result.checks:
            if check.status != "suppressed":
                result.overall = _worst(result.overall, check.status)

    return result


# ─────────────────────────────────────────────────────────────────────────────
#  Rate suggestion (unchanged logic, uses updated data above)
# ─────────────────────────────────────────────────────────────────────────────
def suggest_rate(
    *,
    current_rate: float | None,
    fy26_award: str | None,
    fy25_award: str | None = None,
    pp_level: str | None,
    cpi_rate: float,
) -> float | None:
    """
    Suggest a proposed rate.

    Logic (same as prototype):
    - For employees due a pay point advance (PP group, not at top): move to next PP's rate
    - Otherwise: CPI bump on current rate
    - Always ≥ award minimum and ≥ P&P band minimum
    """
    if not current_rate:
        return None

    cpi_multiplier = 1.0 + (cpi_rate / 100.0)
    cpi_bumped = round(current_rate * cpi_multiplier, 2)

    # Check if a pay-point advance is due
    fy26_canonical = next(
        (k for k in AWARD_RATES if _normalize(k) == _normalize(fy26_award or "")), None
    ) if fy26_award else None

    pp_advance_rate: float | None = None
    if fy26_canonical and " PP" in fy26_canonical:
        grp = fy26_canonical.rsplit(" PP", 1)[0]
        pp_list = LEVEL_PROGRESSION.get(grp, [])
        try:
            idx = pp_list.index(fy26_canonical)
            if idx < len(pp_list) - 1:
                next_pp = pp_list[idx + 1]
                pp_advance_rate = AWARD_RATES.get(next_pp)
        except ValueError:
            pass

    # Award floor
    award_min = AWARD_RATES.get(fy26_canonical or "") if fy26_canonical else None

    # P&P band floor
    band_min = PP_BANDS[pp_level][0] if pp_level and pp_level in PP_BANDS else None

    # Pick the highest candidate
    candidate = pp_advance_rate if pp_advance_rate and pp_advance_rate > cpi_bumped else cpi_bumped
    if award_min is not None:
        candidate = max(candidate, award_min)
    if band_min is not None:
        candidate = max(candidate, band_min)

    return round(candidate, 2)


def infer_letter_type(
    *,
    fy26_award: str | None,
    proposed_award: str | None,
    proposed_rate: float | None,
    current_rate: float | None,
) -> str | None:
    """
    Determine which letter template to use for this employee.

    This is the FY26→FY27 review cycle letter — based solely on what changes
    within THIS review:

    Letter A — rate change only          (award level stays the same)
    Letter B — rate change + level change (28-day consultation required)
    Letter C — level change only          (no rate movement)
    None     — nothing changed

    Level change = user accepted a suggested reclassification in this review
                   (fy26_award → proposed_award).  fy25_award is irrelevant —
                   that was the previous cycle.
    """
    rate_changed = (
        proposed_rate is not None
        and current_rate is not None
        and abs(proposed_rate - current_rate) >= 0.01
    )
    # Level changed only when the reviewer explicitly accepted a new level
    level_changed = bool(
        fy26_award and proposed_award
        and _normalize(fy26_award) != _normalize(proposed_award)
    )

    if rate_changed and level_changed:
        return "B"
    if rate_changed:
        return "A"
    if level_changed:
        return "C"
    return None
