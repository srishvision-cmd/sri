import re
import uuid
from datetime import date
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, SerializationInfo, computed_field, model_serializer, model_validator

from models.commission import CommissionResult
from models.common import UtcDatetime, now_utc

PaymentMode = Literal["Cash", "Online", "Cheque", "Partial Payment"]
PAYMENT_MODES = ["Cash", "Online", "Cheque", "Partial Payment"]
# Cash collected by the agent (fully) or a partial payment leaves a balance the agent owes until settled
OUTSTANDING_MODES = ["Cash", "Partial Payment"]
# Srishvision → broker/insurer premium for a policy.
# Online / Cheque = Srishvision already paid it (own card / netbanking / cheque) → nothing pending.
# Cash / Partial Payment = still pending → shows in Premium Recon until paid (one case or many cases in one payment).
# "Pay Later" is a retired value (migrated to Cash at startup) kept only so old documents still load.
BrokerPayMode = Literal["Cash", "Online", "Cheque", "Partial Payment", "Pay Later"]
BROKER_PAY_MODES = ["Cash", "Online", "Cheque", "Partial Payment"]
BROKER_FULL_MODES = ["Online", "Cheque"]
PolicyStatus = Literal["processing", "extracted", "failed", "flagged", "verified", "duplicate"]
# same vehicle may be re-uploaded only as a renewal: new risk start ≥ this many months after the existing one
RENEWAL_GAP_MONTHS = 10

LOBS = ["Motor", "Health", "Fire", "Marine", "Travel", "Personal Accident", "Liability", "Other"]
COVER_TYPES = ["Package", "Liability Only", "Standalone OD"]
VEHICLE_CLASSES = ["Private Car", "Two Wheeler", "Passenger Carrying", "Goods Carrying", "Miscellaneous"]
GVW_NA_CLASSES = {"Private Car", "Two Wheeler", "Passenger Carrying"}
LIABILITY_ZERO_FIELDS = ("ncb_percent", "idv", "od_premium", "addon_premium")
# common product codes used by the commission grid (insurer product names vary — mapped to these)
PRODUCT_CATEGORIES = [
    "Private Car Package", "Private Car SAOD", "Private Car SATP", "Private Car 1+3 (Bundle)", "Private Car 1+5 (Long Term)",
    "Two Wheeler Package", "Two Wheeler SAOD", "Two Wheeler SATP", "Two Wheeler 1+5 (Bundle)",
    "GCV", "GCV - 3W Goods Carrying", "PCV - 3W Auto", "PCV - Taxi", "PCV - Staff Bus", "PCV - School Bus", "PCV - Others", "Misc D - Tractor", "Misc D - Others", "Health", "Others",
]
BRANCHES = ["Mumbai", "Delhi", "Bengaluru", "Chennai", "Pune", "Hyderabad", "Kolkata", "Ahmedabad"]


class PolicyFields(BaseModel):
    # core
    policy_number: Optional[str] = None
    insurer: Optional[str] = None
    intermediary_name: Optional[str] = None  # Broker / Agent / POS name printed on the policy
    lob: Optional[str] = None
    product_name: Optional[str] = None
    product_category: Optional[str] = None  # common product (auto from cover type / class; editable)
    insured_name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    start_date: Optional[str] = None  # YYYY-MM-DD
    end_date: Optional[str] = None
    tp_end_date: Optional[str] = None  # TP cover expiry — 3 / 5 years for bundled & long-term policies
    sum_insured: Optional[float] = None
    net_premium: Optional[float] = None
    gst: Optional[float] = None
    gross_premium: Optional[float] = None
    # motor
    cover_type: Optional[str] = None  # Package / Liability Only / Standalone OD
    vehicle_class: Optional[str] = None  # Private Car / Two Wheeler / Passenger Carrying / Goods Carrying / Miscellaneous
    vehicle_reg_no: Optional[str] = None
    rto: Optional[str] = None
    registration_date: Optional[str] = None  # YYYY-MM-DD
    make: Optional[str] = None
    model: Optional[str] = None
    mfg_year: Optional[str] = None
    fuel_type: Optional[str] = None  # Petrol / Diesel / CNG / LPG / Electric / Hybrid
    cc: Optional[float] = None
    seating_capacity: Optional[float] = None
    gvw: Optional[float] = None  # gross vehicle weight, kg
    chassis_no: Optional[str] = None
    engine_no: Optional[str] = None
    idv: Optional[float] = None
    od_premium: Optional[float] = None  # own damage incl. add-on covers
    addon_premium: Optional[float] = None  # add-on portion (already inside od_premium)
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


_COVER_RULES = [
    ("Liability Only", r"liability\s*only|third\s*party\s*only|\btp\s*only|act\s*only|\bsatp\b|\blop\b"),
    ("Standalone OD", r"stand\s*-?\s*alone\s*od|own\s*damage\s*only|\bsaod\b"),
    ("Package", r"package|comprehensive|bundled|\bpackage\b"),
]
_CLASS_RULES = [
    ("Two Wheeler", r"two\s*-?\s*wheeler|\b2w\b|motor\s*cycle|scooter|bike"),
    ("Goods Carrying", r"goods|\bgcv\b|commercial\s*vehicle\s*-?\s*goods|truck|lorry|pick\s*-?\s*up"),
    ("Passenger Carrying", r"passenger|\bpcv\b|taxi|\bcab\b|bus|school\s*bus|auto\s*rickshaw"),
    ("Private Car", r"private\s*car|\bpvt\.?\s*car\b|\bcar\b"),
    ("Miscellaneous", r"misc|special\s*type|tractor|\bmisd\b"),
]


def _match(text: str, rules) -> Optional[str]:
    for label, rx in rules:
        if re.search(rx, text, flags=re.IGNORECASE):
            return label
    return None


def _canon(value, options) -> Optional[str]:
    if not value:
        return None
    for o in options:
        if str(value).strip().lower() == o.lower():
            return o
    return None


def _classify(value, options, rules, hint: str, is_motor: bool) -> Optional[str]:
    """Exact option match → keyword match on the value → keyword match on product name (motor only)."""
    return _canon(value, options) or _match(str(value or ""), rules) or (_match(hint, rules) if is_motor else None)


def _apply_applicability(f: dict) -> None:
    if f["cover_type"] == "Liability Only":  # no own-damage section → not applicable, auto 0
        for k in LIABILITY_ZERO_FIELDS:
            f[k] = 0.0
    if f["vehicle_class"] in GVW_NA_CLASSES:  # GVW only applies to goods / misc vehicles
        f["gvw"] = None


# New vehicles carry a placeholder instead of a registration (NEW, NEW-0001, NA, Applied for…).
PLACEHOLDER_REG = re.compile(r"^(NEW(VEHICLE|VEH|REG|REGN|REGISTRATION)?\d{0,6}|NA|NIL|NONE|TBA|TBD|APPLIED(FOR)?|AF|FORREGISTRATION|X+|0+)$")


def is_placeholder_reg(reg) -> bool:
    return bool(PLACEHOLDER_REG.match(re.sub(r"[^A-Z0-9]", "", str(reg or "").upper())))


def new_vehicle_code(f: dict) -> Optional[str]:
    """Unique auto code for a new vehicle: NEW + last 6 of chassis (else engine, else policy no.)."""
    for k in ("chassis_no", "engine_no", "policy_number"):
        v = re.sub(r"[^A-Z0-9]", "", str(f.get(k) or "").upper())
        if len(v) >= 4:
            return f"NEW{v[-6:]}"
    return None


def _normalise_rto(f: dict) -> None:
    """OCR sometimes gives the RTO office name (new vehicles): 'MARTHANDAM' → 'TN75', 'TN 9' → 'TN09'."""
    from models.rto import rto_code

    code = rto_code(f.get("rto"))
    if code:
        f["rto"] = code


def _normalise_registration(f: dict) -> None:
    _normalise_rto(f)
    reg = f.get("vehicle_reg_no")
    if not reg:
        return
    reg = re.sub(r"[^A-Z0-9]", "", str(reg).upper()) or None
    if reg and is_placeholder_reg(reg):
        reg = new_vehicle_code(f)  # same chassis → same code, so real duplicates are still caught
    f["vehicle_reg_no"] = reg
    if reg and not f.get("rto"):
        m = re.match(r"^([A-Z]{2})(\d{1,2})", reg)
        if m and m.group(1) != "BH":  # BH-series plates carry no RTO
            f["rto"] = f"{m.group(1)}{int(m.group(2)):02d}"


def vehicle_age(start_date, registration_date, mfg_year) -> Optional[float]:
    """Age at risk start: exact from registration date, else whole years from year of manufacture."""
    start = _parse_date(start_date)
    if not start:
        return None
    reg_date = _parse_date(registration_date)
    if reg_date and reg_date <= start:
        return round((start - reg_date).days / 365.25, 1)
    year_match = re.search(r"(19|20)\d{2}", str(mfg_year or ""))
    return float(max(0, start.year - int(year_match.group(0)))) if year_match else None


def derive_fields(f: dict) -> dict:
    """Normalise reg no, derive RTO, cover type / vehicle class rules, and vehicle age at risk start."""
    f = dict(f)
    hint = " ".join(str(f.get(k) or "") for k in ("product_name", "plan_name"))
    is_motor = f.get("lob") == "Motor" or bool(f.get("vehicle_reg_no"))
    f["cover_type"] = _classify(f.get("cover_type"), COVER_TYPES, _COVER_RULES, hint, is_motor)
    f["vehicle_class"] = _classify(f.get("vehicle_class"), VEHICLE_CLASSES, _CLASS_RULES, hint, is_motor)
    _apply_applicability(f)
    _normalise_registration(f)
    age = vehicle_age(f.get("start_date"), f.get("registration_date"), f.get("mfg_year"))
    f["vehicle_age_years"] = age
    f["vehicle_age_bucket"] = age_bucket(age) if age is not None else None
    if f.get("product_category") not in PRODUCT_CATEGORIES:
        f["product_category"] = product_category(f, hint, is_motor)
    return f


def _years_between(a, b) -> Optional[float]:
    da, db_ = _parse_date(a), _parse_date(b)
    return round((db_ - da).days / 365.25, 1) if da and db_ and db_ > da else None


AGE_BANDS = ["New Vehicle", "1-5 Years", "6-7 Years", "8-10 Years", "11-12 Years", "13-15 Years", "Above 15 Years"]


def age_band(age: Optional[float]) -> Optional[str]:
    """Commission-grid vehicle age band from age at risk start (completed years)."""
    if age is None:
        return None
    y = int(age)
    for limit, band in ((0, "New Vehicle"), (5, "1-5 Years"), (7, "6-7 Years"), (10, "8-10 Years"), (12, "11-12 Years"), (15, "13-15 Years")):
        if y <= limit:
            return band
    return "Above 15 Years"


_COVER_CODE = {"Package": "Package", "Standalone OD": "SAOD", "Liability Only": "SATP"}


def product_category(f: dict, hint: str, is_motor: bool) -> Optional[str]:
    if f.get("lob") == "Health":
        return "Health"
    if not is_motor:
        return None
    cls, h = f.get("vehicle_class"), hint.lower()
    if cls in ("Private Car", "Two Wheeler"):
        cover = f.get("cover_type") or "Package"
        tp_years = _years_between(f.get("start_date"), f.get("tp_end_date"))
        bundled = cover == "Package" and ((tp_years or 0) >= 2.5 or re.search(r"bundle|long\s*term|1\s*\+\s*[35]|3\s*years?\s*tp|5\s*years?\s*tp", h))
        if bundled:
            long5 = (tp_years or 0) >= 4.5 or re.search(r"1\s*\+\s*5|5\s*years?", h)
            if cls == "Two Wheeler":
                return "Two Wheeler 1+5 (Bundle)"
            return "Private Car 1+5 (Long Term)" if long5 else "Private Car 1+3 (Bundle)"
        return f"{cls} {_COVER_CODE.get(cover, 'Package')}"
    three_w = re.search(r"three\s*wheel|3\s*-?\s*wheel|\b3w\b|rickshaw|\bauto\b|\bape\b|\bre\s*compact|tempo", h + " " + str(f.get("model") or "").lower())
    if cls == "Goods Carrying":
        return "GCV - 3W Goods Carrying" if three_w else "GCV"
    if cls == "Passenger Carrying":
        if three_w:
            return "PCV - 3W Auto"
        if re.search(r"school", h):
            return "PCV - School Bus"
        if re.search(r"staff|employee", h):
            return "PCV - Staff Bus"
        if re.search(r"taxi|\bcab\b|maxi", h):
            return "PCV - Taxi"
        return "PCV - Others"
    if cls == "Miscellaneous":
        return "Misc D - Tractor" if re.search(r"tractor", h + " " + str(f.get("model") or "").lower() + " " + str(f.get("make") or "").lower()) else "Misc D - Others"
    return "Others"


class HistoryEntry(BaseModel):
    at: UtcDatetime = Field(default_factory=now_utc)
    by_name: str
    by_role: str
    action: str
    note: Optional[str] = None


class PaymentEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    amount: float
    reference: Optional[str] = None
    paid_on: Optional[str] = None  # YYYY-MM-DD
    recorded_by_name: str
    settlement_id: Optional[str] = None  # recon batch that created this entry (for reversal)
    at: UtcDatetime = Field(default_factory=now_utc)


def payment_totals(mode: Optional[str], payments: list, gross: Optional[float]) -> tuple[Optional[float], Optional[float]]:
    """(amount_paid, outstanding). Online/Cheque settle the whole premium; Cash/Partial sum the settlement ledger."""
    if mode is None:
        return None, None
    if mode not in OUTSTANDING_MODES:
        return gross, 0.0
    paid = round(sum(float(p["amount"] if isinstance(p, dict) else p.amount) for p in payments), 2)
    return paid, (None if gross is None else round(max(gross - paid, 0.0), 2))


def effective_broker_mode(mode: Optional[str], agent_mode: Optional[str]) -> str:
    """Older policies have no broker payment mode: Online/Cheque premium went straight to the broker/insurer → paid; else Cash (pending)."""
    if mode:
        return "Cash" if mode == "Pay Later" else mode
    return agent_mode if agent_mode in ("Online", "Cheque") else "Cash"


def broker_totals(mode: Optional[str], payments: list, gross: Optional[float], agent_mode: Optional[str] = None) -> float:
    """Premium paid to the broker: full gross for Online/Cheque, else Σ broker payment entries (recon / single-case payments)."""
    # a legacy policy that already has broker payments recorded was treated as pending → keep summing those
    if effective_broker_mode(mode, None if payments else agent_mode) in BROKER_FULL_MODES and gross is not None:
        return round(gross, 2)
    return round(sum(float(p["amount"] if isinstance(p, dict) else p.amount) for p in payments), 2)


def is_partial(doc: dict) -> bool:
    """Highlight flag: Partial Payment on either side (agent → Srishvision or Srishvision → broker)."""
    return doc.get("payment_mode") == "Partial Payment" or doc.get("broker_payment_mode") == "Partial Payment"


def partial_label(doc: dict) -> Optional[str]:
    if not is_partial(doc):
        return None
    sides = [n for n, k in (("Agent", "payment_mode"), ("Broker", "broker_payment_mode")) if doc.get(k) == "Partial Payment"]
    b = doc.get("upload_batch_id")
    return f"Partial ({' + '.join(sides)})" + (f" · batch {b[:8]}" if b else "")


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
    duplicate_reason: Optional[str] = None
    duplicate_of_id: Optional[str] = None
    flag_reason: Optional[str] = None
    verified_by_name: Optional[str] = None
    verified_at: Optional[UtcDatetime] = None
    created_at: UtcDatetime = Field(default_factory=now_utc)
    updated_at: UtcDatetime = Field(default_factory=now_utc)
    history: List[HistoryEntry] = []
    payment_mode: Optional[PaymentMode] = None
    payments: List[PaymentEntry] = []
    broker_id: Optional[str] = None
    broker_name: Optional[str] = None
    commission: Optional[CommissionResult] = None  # admin-only, computed on read from the commission grid
    broker_payments: List[PaymentEntry] = []  # premium Srishvision has remitted to the broker for this policy
    @model_serializer(mode="wrap")
    def _redact_for_agent(self, handler, info: SerializationInfo):
        """Agents never see broker data (our broker or the intermediary OCR read) — API JSON only; DB writes are unaffected."""
        data = handler(self)
        if info.mode == "json":
            from lib.auth import VIEWER_ROLE  # late import: auth imports models
            if VIEWER_ROLE.get() == "agent":
                data.update(broker_id=None, broker_name=None, broker_payment_mode=None, broker_payments=[], broker_paid=0, broker_outstanding=None)
                if isinstance(data.get("fields"), dict):
                    data["fields"]["intermediary_name"] = None
        return data

    upload_batch_id: Optional[str] = None  # set when a Partial amount was typed once for a multi-file upload
    broker_payment_mode: Optional[BrokerPayMode] = None  # None (older policies) → follows agent mode (see effective_broker_mode)
    commission_statement_no: Optional[str] = None
    commission_paid: bool = False
    commission_paid_date: Optional[str] = None
    commission_utr: Optional[str] = None
    file_size: Optional[int] = None  # stored (compressed) bytes
    original_size: Optional[int] = None  # bytes as uploaded

    @computed_field
    @property
    def amount_paid(self) -> Optional[float]:
        return payment_totals(self.payment_mode, self.payments, self.fields.gross_premium)[0]

    @computed_field
    @property
    def outstanding(self) -> Optional[float]:
        return payment_totals(self.payment_mode, self.payments, self.fields.gross_premium)[1]

    @computed_field
    @property
    def broker_paid(self) -> float:
        return broker_totals(self.broker_payment_mode, self.broker_payments, self.fields.gross_premium, self.payment_mode)

    @computed_field
    @property
    def broker_outstanding(self) -> Optional[float]:
        """Premium still owed to the broker (None when no broker / premium unknown)."""
        if not self.broker_id or self.fields.gross_premium is None:
            return None
        return round(max(self.fields.gross_premium - self.broker_paid, 0), 2)

    def to_doc(self) -> dict:
        return self.model_dump(exclude={"amount_paid", "outstanding", "commission", "broker_paid", "broker_outstanding"})


COMPUTED_POLICY_KEYS = {"amount_paid", "outstanding"}


class BrokerSetIn(BaseModel):
    broker_id: Optional[str] = None


class BulkBrokerIn(BaseModel):
    policy_ids: List[str] = Field(min_length=1, max_length=500)
    broker_id: Optional[str] = None


class ReassignAgentIn(BaseModel):
    policy_ids: List[str] = Field(min_length=1, max_length=500)
    agent_id: str


class ReassignResult(BaseModel):
    updated: int
    agent_name: str
    agent_code: str


class PaymentModeIn(BaseModel):
    payment_mode: PaymentMode


class BrokerPayModeIn(BaseModel):
    broker_payment_mode: BrokerPayMode


class PaymentIn(BaseModel):
    amount: float = Field(gt=0)
    reference: Optional[str] = None
    paid_on: Optional[str] = None


class AgentOutstanding(BaseModel):
    agent_id: str
    agent_name: str
    agent_code: str
    branch: Optional[str] = None
    policies: int
    total_premium: float
    paid: float
    outstanding: float


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
    outstanding: float


class UsageGroup(BaseModel):
    label: str
    files: int
    stored_bytes: int
    original_bytes: int
    ocr_runs: int
    est_cost_inr: float


class UsageMonth(BaseModel):
    month: str  # YYYY-MM
    ocr_runs: int
    files: int
    est_cost_inr: float


class Usage(BaseModel):
    total_files: int
    stored_bytes: int
    original_bytes: int
    avg_file_bytes: int
    under_target_files: int  # files stored at ≤ 100 KB
    target_bytes: int
    ocr_runs: int
    ocr_success: int
    ocr_failed: int
    ocr_runs_this_month: int
    est_cost_per_policy_inr: float
    est_cost_total_inr: float
    est_cost_this_month_inr: float
    model_name: str
    by_month: List[UsageMonth]
    by_branch: List[UsageGroup]
    by_agent: List[UsageGroup]


class Meta(BaseModel):
    branches: List[str]
    lobs: List[str]
    age_buckets: List[str]
    cover_types: List[str]
    vehicle_classes: List[str]
    payment_modes: List[str]
    product_categories: List[str]


class RecompressResult(BaseModel):
    checked: int
    compressed: int
    saved_bytes: int
    remaining: int  # files still above target and not yet tried
