import re
import uuid
from datetime import date
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from models.common import UtcDatetime, now_utc

PolicyStatus = Literal["processing", "extracted", "failed", "flagged", "verified"]

LOBS = ["Motor", "Health", "Fire", "Marine", "Travel", "Personal Accident", "Liability", "Other"]
BRANCHES = ["Mumbai", "Delhi", "Bengaluru", "Chennai", "Pune", "Hyderabad", "Kolkata", "Ahmedabad"]


class PolicyFields(BaseModel):
    # core
    policy_number: Optional[str] = None
    insurer: Optional[str] = None
    lob: Optional[str] = None
    product_name: Optional[str] = None
    insured_name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None
    sum_insured: Optional[float] = None
    net_premium: Optional[float] = None
    gst: Optional[float] = None
    gross_premium: Optional[float] = None
    # motor
    vehicle_reg_no: Optional[str] = None
    rto: Optional[str] = None
    registration_date: Optional[str] = None  # YYYY-MM-DD
    make: Optional[str] = None
    model: Optional[str] = None
    mfg_year: Optional[str] = None
    cc: Optional[float] = None
    seating_capacity: Optional[float] = None
    gvw: Optional[float] = None  # gross vehicle weight, kg
    chassis_no: Optional[str] = None
    engine_no: Optional[str] = None
    idv: Optional[float] = None
    od_premium: Optional[float] = None  # own damage incl. add-on covers
    tp_premium: Optional[float] = None  # third party / liability
    ncb_percent: Optional[float] = None
    # derived server-side (never OCR'd / edited)
    vehicle_age_years: Optional[float] = None
    vehicle_age_bucket: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _derive(cls, data):
        # every construction (OCR, PATCH body, DB read) recomputes RTO + vehicle age
        return derive_fields(data) if isinstance(data, dict) else data
    # health
    plan_name: Optional[str] = None
    members_covered: Optional[str] = None
    deductible: Optional[float] = None


NUMERIC_FIELDS = {k for k, f in PolicyFields.model_fields.items() if f.annotation == Optional[float]}
DERIVED_FIELDS = {"vehicle_age_years", "vehicle_age_bucket"}
AGE_BUCKETS = ["Below 5 Years", "5-7 Years", "7-10 Years", "Above 10 Years"]


def _parse_date(v) -> Optional[date]:
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def age_bucket(age: float) -> str:
    if age < 5:
        return AGE_BUCKETS[0]
    if age < 7:
        return AGE_BUCKETS[1]
    if age < 10:
        return AGE_BUCKETS[2]
    return AGE_BUCKETS[3]


def derive_fields(f: dict) -> dict:
    """Normalise reg no, derive RTO from it, and compute vehicle age at risk start."""
    f = dict(f)
    reg = f.get("vehicle_reg_no")
    if reg:
        reg = re.sub(r"[^A-Z0-9]", "", str(reg).upper()) or None
        f["vehicle_reg_no"] = reg
    if reg and not f.get("rto"):
        m = re.match(r"^([A-Z]{2})(\d{1,2})", reg)
        if m and m.group(1) != "BH":
            f["rto"] = f"{m.group(1)}{int(m.group(2)):02d}"
    start = _parse_date(f.get("start_date"))
    reg_date = _parse_date(f.get("registration_date"))
    year_match = re.search(r"(19|20)\d{2}", str(f.get("mfg_year") or ""))
    age: Optional[float] = None
    if start and reg_date and reg_date <= start:
        age = round((start - reg_date).days / 365.25, 1)
    elif start and year_match:
        age = float(max(0, start.year - int(year_match.group(0))))
    f["vehicle_age_years"] = age
    f["vehicle_age_bucket"] = age_bucket(age) if age is not None else None
    return f


class HistoryEntry(BaseModel):
    at: UtcDatetime = Field(default_factory=now_utc)
    by_name: str
    by_role: str
    action: str
    note: Optional[str] = None


class Policy(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    file_name: Optional[str] = None
    file_mime: Optional[str] = None
    has_file: bool = False
    status: PolicyStatus = "processing"
    agent_id: str
    agent_name: str
    agent_code: str
    branch: Optional[str] = None
    uploaded_by_id: str
    uploaded_by_name: str
    fields: PolicyFields = Field(default_factory=PolicyFields)
    confidence: Dict[str, float] = {}
    ocr_error: Optional[str] = None
    flag_reason: Optional[str] = None
    verified_by_name: Optional[str] = None
    verified_at: Optional[UtcDatetime] = None
    created_at: UtcDatetime = Field(default_factory=now_utc)
    updated_at: UtcDatetime = Field(default_factory=now_utc)
    history: List[HistoryEntry] = []


class PolicyUpdate(BaseModel):
    fields: PolicyFields
    note: Optional[str] = None


class FlagIn(BaseModel):
    reason: str = Field(min_length=3)


class VerifyIn(BaseModel):
    note: Optional[str] = None


class GroupStat(BaseModel):
    label: str
    count: int
    premium: float


class Stats(BaseModel):
    total: int
    processing: int
    extracted: int
    flagged: int
    verified: int
    failed: int
    gross_premium: float
    net_premium: float
    by_lob: List[GroupStat]
    by_insurer: List[GroupStat]
    by_agent: List[GroupStat]
    by_age: List[GroupStat]


class Meta(BaseModel):
    branches: List[str]
    lobs: List[str]
    age_buckets: List[str]
