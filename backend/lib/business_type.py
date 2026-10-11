"""Business type of a policy: New / Renewal / Rollover / Used."""
from datetime import date
from typing import Optional

from lib.commission import insurer_matches
from models.policy import BUSINESS_TYPES, normalise_business_type


def _d(v) -> Optional[date]:
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def is_new_vehicle(f: dict) -> bool:
    """First policy of a new vehicle: placeholder reg no (NEW…) or registered within 60 days before risk start."""
    if str(f.get("vehicle_reg_no") or "").upper().startswith("NEW"):
        return True
    reg, start = _d(f.get("registration_date")), _d(f.get("start_date"))
    return bool(reg and start and 0 <= (start - reg).days <= 60)


def infer_business_type(f: dict, allow_used: bool = True) -> Optional[str]:
    """Kept if OCR/user already set it. Else: new vehicle → New; previous insurer same company → Renewal, other company → Rollover;
    motor with no previous insurer → Used (allow_used=False leaves it blank — used for old policies whose OCR never read the previous insurer)."""
    given = normalise_business_type(f.get("business_type"))
    if given in BUSINESS_TYPES:
        return given
    if f.get("lob") not in (None, "Motor") and not f.get("vehicle_reg_no"):
        prev = f.get("previous_insurer")
        if not prev:
            return None
    if is_new_vehicle(f):
        return "New"
    prev, cur = f.get("previous_insurer"), f.get("insurer")
    if prev:
        same = bool(cur) and (insurer_matches(prev, cur) or insurer_matches(cur, prev))
        return "Renewal" if same else "Rollover"
    return "Used" if allow_used and (f.get("lob") == "Motor" or f.get("vehicle_reg_no")) else None
