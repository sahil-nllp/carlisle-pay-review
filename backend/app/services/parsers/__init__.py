"""Excel parsers for the 4 source files in a Carlisle pay review cycle.

Each parser is independent and returns a typed ParseResult dataclass with
warnings collected as the file is read.
"""
from app.services.parsers.award_summary import (
    AwardSummaryParseResult,
    ParsedAwardRate,
    ParsedJuniorRate,
    parse_award_summary,
)
from app.services.parsers.employees import (
    EmployeeParseResult,
    ParsedEmployee,
    parse_employee_details,
)
from app.services.parsers.pp_admin import parse_pp_admin
from app.services.parsers.pp_bands_common import PPBandParseResult, ParsedPPBand
from app.services.parsers.pp_tech import parse_pp_tech

__all__ = [
    "AwardSummaryParseResult",
    "EmployeeParseResult",
    "PPBandParseResult",
    "ParsedAwardRate",
    "ParsedEmployee",
    "ParsedJuniorRate",
    "ParsedPPBand",
    "parse_award_summary",
    "parse_employee_details",
    "parse_pp_admin",
    "parse_pp_tech",
]
