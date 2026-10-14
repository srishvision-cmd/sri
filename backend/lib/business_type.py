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
    """Kept if OCR/user already set it. Else, in priority order:
    New (new vehicle) → Renewal (previous insurer = current insurer, NCB irrelevant) → Rollover (NCB > 0 on the issued policy)
    → Used (NCB = 0 and no previous policy details). Anything else (e.g. other previous insurer with NCB 0 / blank, or NCB unread)
    stays blank so the policy is flagged for manual verification instead of being classified wrongly."""
    given = normalise_business_type(f.get("business_type"))
    if given in BUSINESS_TYPES:
        return given
    if f.get("lob") not in (None, "Motor") and not f.get("vehicle_reg_no"):
        return None
    if is_new_vehicle(f):
        return "New"
    prev, cur = f.get("previous_insurer"), f.get("insurer")
    if prev and cur and (insurer_matches(prev, cur) or insurer_matches(cur, prev)):
        return "Renewal"
    ncb = f.get("ncb_percent")
    if ncb is not None and ncb > 0:
        return "Rollover"
    has_prev = bool(prev or f.get("previous_policy_number"))
    if allow_used and ncb is not None and ncb == 0 and not has_prev:
        return "Used"
    return None