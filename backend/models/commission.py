import uuid
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from models.common import UtcDatetime, now_utc

RuleKind = Literal["receivable", "payable"]  # receivable: broker → company · payable: company → agent
NcbFilter = Literal["any", "with", "without"]
CoverFilter = Literal["any", "package", "satp"]
COMPONENTS = ("od_percent", "tp_percent", "net_percent", "odtp_percent", "flat_amount")


class Broker(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    code: Optional[str] = None
    aliases: List[str] = []  # extra spellings to match the broker name OCR reads from the policy
    active: bool = True
    created_at: UtcDatetime = Field(default_factory=now_utc)


class BrokerIn(BaseModel):
    name: str = Field(min_length=2)
    code: Optional[str] = None
    aliases: List[str] = []
    active: bool = True


class GroupMargin(BaseModel):
    """Payable for the group = receivable % minus `margin` percentage points (61% − 2 → 59%)."""
    insurer: Optional[str] = None  # None = all other companies
    product_type: Optional[str] = None  # "Private Car" / "PCV" / "GCV"…; None = all products
    product: Optional[str] = None  # a specific product inside product_type, e.g. "PCV - Taxi" (None = whole type)
    business_type: Optional[str] = None  # New / Renewal / Rollover / Used (None = all)
    margin: float = Field(ge=0, le=100)  # "On Net": points kept on Net / OD+TP % (and on OD / TP when those are blank)
    od_margin: Optional[float] = Field(default=None, ge=0, le=100)  # points kept on OD % (None = same as margin)
    tp_margin: Optional[float] = Field(default=None, ge=0, le=100)  # points kept on TP % (None = same as margin)
    flat_margin: Optional[float] = Field(default=None, ge=0)  # ₹ kept from a flat-amount receivable (None = pass flat through)
    valid_from: Optional[str] = None  # policy risk-start date this margin applies from (None = always)
    valid_to: Optional[str] = None  # system-set: day before the next line for the same company + product starts
    ended: bool = False  # margin stopped from valid_to + 1 (cleared in the margin grid)


class GroupMarginsIn(BaseModel):
    margins: List[GroupMargin]


class AgentGroup(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    margins: List[GroupMargin] = []  # auto payable grid per company
    created_at: UtcDatetime = Field(default_factory=now_utc)


class AgentGroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class CommissionRuleIn(BaseModel):
    kind: RuleKind
    name: str = Field(min_length=1)
    active: bool = True
    # conditions — empty / None = applies to all
    insurer: Optional[str] = None
    broker_ids: List[str] = []  # channel partners (any of these; empty = all partners)
    agent_group: Optional[str] = None  # payable only
    agent_id: Optional[str] = None  # payable only
    products: List[str] = []
    rtos: List[str] = []  # prefixes: "TN" (state) or "TN10" (RTO)
    ncb: NcbFilter = "any"
    cover: CoverFilter = "any"  # PCV / GCV / Misc D: package only, SATP only, or both
    gvw_min: Optional[float] = None
    gvw_max: Optional[float] = None
    cc_min: Optional[float] = None
    cc_max: Optional[float] = None
    vehicle_ages: List[str] = []  # AGE_BANDS
    fuel_types: List[str] = []  # Petrol / Diesel / CNG …
    business_types: List[str] = []  # New / Renewal / Rollover / Used (empty = all)
    seating_min: Optional[float] = None
    seating_max: Optional[float] = None
    makes: List[str] = []  # any of these manufacturers (empty = all makes)
    model: Optional[str] = None
    valid_from: Optional[str] = None  # effective from (YYYY-MM-DD), compared with policy risk start (else upload) date
    valid_to: Optional[str] = None  # applicable to (inclusive); also set by the system when a newer version supersedes this rate
    apply_to_past: bool = False  # edit only: overwrite the rule (no new version) so past policies use the new rate too
    # commission components (all optional, summed)
    od_percent: Optional[float] = Field(default=None, ge=0, le=100)
    tp_percent: Optional[float] = Field(default=None, ge=0, le=100)
    net_percent: Optional[float] = Field(default=None, ge=0, le=100)
    odtp_percent: Optional[float] = Field(default=None, ge=0, le=100)
    flat_amount: Optional[float] = Field(default=None, ge=0)

    @model_validator(mode="before")
    @classmethod
    def _legacy_broker(cls, data):
        """Older rules / clients sent a single `broker_id`."""
        if isinstance(data, dict) and "broker_id" in data:
            data = dict(data)
            b = data.pop("broker_id")
            if b and not data.get("broker_ids"):
                data["broker_ids"] = [b]
        return data


class CommissionRule(CommissionRuleIn):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    version_of: Optional[str] = None  # id of the first version of this rule
    superseded_by: Optional[str] = None  # newer version id, or "ended" when the rule was stopped
    created_at: UtcDatetime = Field(default_factory=now_utc)
    updated_at: UtcDatetime = Field(default_factory=now_utc)


class RuleMiss(BaseModel):
    rule_id: str
    rule_name: str
    kind: RuleKind
    reasons: List[str]


class CommissionResult(BaseModel):
    receivable: Optional[float] = None
    payable: Optional[float] = None
    margin: Optional[float] = None
    receivable_rule_id: Optional[str] = None
    receivable_rule_name: Optional[str] = None
    receivable_rate: Optional[str] = None  # company's commission % on this policy, e.g. "OD 34% + TP 54%" (saved in the snapshot)
    payable_rule_id: Optional[str] = None
    payable_rule_name: Optional[str] = None
    payable_rate: Optional[str] = None  # agent's commission %, e.g. "OD 15% + TP 2%"
    held: bool = False  # agent commission on hold for this company/product (payable 0)
    hold_reason: Optional[str] = None
    declined: bool = False  # insurer declines this RTO for the product → receivable and payable 0, flagged for review
    declined_reason: Optional[str] = None
    capped: bool = False  # payable was cut down to the receivable
    note: Optional[str] = None
    locked_at: Optional[str] = None  # set once the verified policy's commission is frozen (later rule edits don't change it)
    misses: List[RuleMiss] = []  # single-policy view only: why nearby rules did not apply


class DeclinedRtoIn(BaseModel):
    """Company-wide: the insurer declines / excludes these RTOs for the product (even inside a bundled zone like Metro)."""
    insurer: str = Field(min_length=1, max_length=120)
    product_type: Optional[str] = None  # None = every product
    products: List[str] = []  # empty = every product of the product type
    rtos: List[str] = Field(min_length=1, max_length=500)  # VAHAN codes, e.g. TN29 (a 2-letter state code = whole state)
    note: Optional[str] = Field(default=None, max_length=200)


class DeclinedRto(DeclinedRtoIn):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_by_name: str = ""
    created_at: str = Field(default_factory=lambda: now_utc().isoformat())


class AgentRate(BaseModel):
    """A payable rule as shown to an agent (plain view — no receivable/margin data)."""
    id: str
    name: str
    insurer: Optional[str] = None
    products: List[str] = []
    rtos: List[str] = []
    ncb: NcbFilter = "any"
    cover: CoverFilter = "any"  # PCV / GCV / Misc D: package only, SATP only, or both
    gvw_min: Optional[float] = None
    gvw_max: Optional[float] = None
    cc_min: Optional[float] = None
    cc_max: Optional[float] = None
    vehicle_ages: List[str] = []
    fuel_types: List[str] = []
    business_types: List[str] = []
    seating_min: Optional[float] = None
    seating_max: Optional[float] = None
    makes: List[str] = []
    model: Optional[str] = None
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    od_percent: Optional[float] = None
    tp_percent: Optional[float] = None
    net_percent: Optional[float] = None
    odtp_percent: Optional[float] = None
    flat_amount: Optional[float] = None
    personal: bool = False  # set only for this agent
    group_rate: bool = False  # set for the agent's group
    upcoming: bool = False  # starts after today
    hold_from: Optional[str] = None  # rate stops on this date (commission hold)


class AgentRateCard(BaseModel):
    agent_name: Optional[str] = None
    agent_code: Optional[str] = None
    agent_group: Optional[str] = None
    as_of: str
    rates: List[AgentRate]


class CompanyZoneIn(BaseModel):
    """Manual RTO group, e.g. Chennai = TN01..TN22. `insurer` set = only for that company; None = all companies."""
    insurer: Optional[str] = None
    name: str = Field(min_length=1, max_length=40)
    rtos: List[str] = Field(min_length=1)


class CompanyZone(CompanyZoneIn):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: UtcDatetime = Field(default_factory=now_utc)


class VehicleModelIn(BaseModel):
    make: str = Field(min_length=1)
    model: str = Field(min_length=1, max_length=60)


class GridRowError(BaseModel):
    row: int
    sheet: Optional[str] = None
    error: str


class GridRowPreview(BaseModel):
    row: int
    sheet: Optional[str] = None  # product sheet of the Excel the row came from
    action: Literal["create", "update", "unchanged", "error"]
    kind: Optional[str] = None
    name: Optional[str] = None
    insurer: Optional[str] = None
    changes: List[str] = []  # "OD % 20 → 22", or the rates of a new rule
    effective_from: Optional[str] = None
    error: Optional[str] = None


class GridUploadResult(BaseModel):
    preview: bool = False  # True = nothing saved yet
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    errors: List[GridRowError] = []
    rows: List[GridRowPreview] = []
    learned_insurer: Optional[str] = None  # AI upload only: company whose saved layout was updated
    learned_accuracy: Optional[float] = None  # AI upload only: % of cells the admin did not have to correct


class CompareRates(BaseModel):
    od_percent: Optional[float] = None
    tp_percent: Optional[float] = None
    net_percent: Optional[float] = None
    odtp_percent: Optional[float] = None
    flat_amount: Optional[float] = None


class ComparePayable(BaseModel):
    label: str  # agent / group the payable is for
    source: Literal["rule", "group_margin"]
    rule_name: Optional[str] = None
    rates: CompareRates
    margin: CompareRates  # receivable − payable, per component
    low_margin: bool = False  # some % component leaves less than the minimum margin setting


class CompareRow(BaseModel):
    rule_id: str
    insurer: Optional[str] = None
    product: str
    broker: Optional[str] = None
    rule_name: str
    conditions: List[str] = []
    valid_from: Optional[str] = None
    rates: CompareRates
    payables: List[ComparePayable] = []


class CommissionSettings(BaseModel):
    min_margin: float = Field(default=2.0, ge=0, le=100)  # percentage points; payables leaving less are flagged


class BulkPayableIn(BaseModel):
    """Create a payable for one agent group on every receivable that has no payable yet: receivable − margin points."""
    agent_group: str = Field(min_length=1)
    margin: float = Field(ge=0, le=100)
    insurer: Optional[str] = None  # limit to one company (None = all)
    rule_ids: Optional[List[str]] = None  # limit to these receivables (None = all without a payable)
    preview: bool = True


class BulkPayableRow(BaseModel):
    rule_id: str
    insurer: Optional[str] = None
    product: str
    receivable_name: str
    receivable: CompareRates
    payable: CompareRates
    status: Literal["ready", "created", "skipped", "error"]
    note: Optional[str] = None


class BulkPayableResult(BaseModel):
    preview: bool
    created: int = 0
    rows: List[BulkPayableRow] = []


class MarginGridRow(BaseModel):
    """One company × product line of the group margin grid; margins = group name → points below receivable (None = not set)."""
    insurer: Optional[str] = None  # None = all other companies
    product_type: Optional[str] = None  # None = all products
    product: Optional[str] = None
    business_type: Optional[str] = None  # None = all business types
    margins: Dict[str, Optional[float]] = {}
    since: Dict[str, Optional[str]] = {}  # group → date the current margin applies from (read only)


class MarginGrid(BaseModel):
    groups: List[str]
    rows: List[MarginGridRow]


class MarginGridIn(BaseModel):
    rows: List[MarginGridRow]
    valid_from: Optional[str] = None  # new margins apply from this policy risk-start date (default today)
    apply_to_past: bool = False  # replace the history: margin applies to every policy, old versions removed


class MarginGridSaveResult(BaseModel):
    changed: int


class CommissionHoldIn(BaseModel):
    """Stop agent commission for a company (+ product) from a date, e.g. when the insurer terminates its grid."""
    insurer: Optional[str] = None  # None = all companies
    product_type: Optional[str] = None  # None = all products
    product: Optional[str] = None
    agent_ids: List[str] = []  # both lists empty = all agents
    agent_groups: List[str] = []
    broker_ids: List[str] = []  # channel partners (empty = all partners)
    hold_from: str  # policies with risk start on/after this date get no agent commission while held
    reason: Optional[str] = None


class CommissionHold(CommissionHoldIn):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    released_on: Optional[str] = None  # policies from this date are paid again
    created_by_name: Optional[str] = None
    released_by_name: Optional[str] = None
    created_at: UtcDatetime = Field(default_factory=now_utc)


class HoldReleaseIn(BaseModel):
    released_on: Optional[str] = None  # default today


class AgentHoldNotice(BaseModel):
    """A commission hold as an agent sees it — company / product rates stopped from a date."""
    id: str
    insurer: Optional[str] = None
    product: str  # product, product type or "All products"
    hold_from: str
    released_on: Optional[str] = None
    reason: Optional[str] = None
    upcoming: bool = False  # hold starts after today


# ---------- rule tools: copy rules · rate matrix ----------
RateKey = Literal["od_percent", "tp_percent", "net_percent", "odtp_percent", "flat_amount"]


class RuleRates(BaseModel):
    od_percent: Optional[float] = Field(default=None, ge=0, le=100)
    tp_percent: Optional[float] = Field(default=None, ge=0, le=100)
    net_percent: Optional[float] = Field(default=None, ge=0, le=100)
    odtp_percent: Optional[float] = Field(default=None, ge=0, le=100)
    flat_amount: Optional[float] = Field(default=None, ge=0)


class RuleCopyIn(BaseModel):
    """Copy rules with new company / channel partners / dates; None = keep the source value."""
    rule_ids: List[str] = Field(min_length=1, max_length=500)
    insurer: Optional[str] = None
    broker_ids: Optional[List[str]] = None  # [] = all channel partners
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    rates: Dict[str, RuleRates] = {}  # source rule id → new rates (missing = same rates)
    agent_id: Optional[str] = None  # payable only: copy to this one agent (agent group cleared)
    on_conflict: Literal["keep", "overwrite"] = "keep"  # target already has rules for the company + product
    preview: bool = False


class RuleToolRow(BaseModel):
    key: str  # source rule id (copy) or "age|column" (matrix)
    name: str
    action: Literal["create", "update", "unchanged", "error"]
    error: Optional[str] = None
    rule_id: Optional[str] = None
    conflicts: List[str] = []  # copy to a target: the target's existing rules for the same company + product


class RuleToolResult(BaseModel):
    preview: bool
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    errors: int = 0
    rows: List[RuleToolRow] = []


class ReopenRulesIn(BaseModel):
    """Ended rules (To date already passed) → clear the To date so they apply again from their From date."""
    rule_ids: List[str] = Field(min_length=1, max_length=500)
    preview: bool = True


class MatrixColumn(BaseModel):
    label: str = Field(min_length=1)
    rtos: List[str] = []  # empty = all RTOs
    gvw_min: Optional[float] = None
    gvw_max: Optional[float] = None


class MatrixCell(BaseModel):
    age: Optional[str] = None  # vehicle age band; None = all ages
    col: int = Field(ge=0)  # index into columns
    value: Optional[float] = Field(default=None, ge=0)  # None = leave as is


class RateMatrixIn(BaseModel):
    kind: RuleKind
    insurer: str = Field(min_length=1)
    broker_ids: List[str] = []
    products: List[str] = Field(min_length=1)
    agent_group: Optional[str] = None  # payable only
    agent_id: Optional[str] = None  # payable only
    component: RateKey
    columns: List[MatrixColumn] = Field(min_length=1, max_length=40)
    cells: List[MatrixCell] = Field(max_length=1000)
    valid_from: Optional[str] = None  # blank = new rates from today; earlier policies keep old rates
    preview: bool = False



# ---------- AI grid reading (Excel / PDF / image → rules to approve) ----------
class AiGridRow(BaseModel):
    """One rule read by AI, in the same columns as the grid Excel (lists comma separated)."""
    kind: Optional[str] = None  # Receivable / Payable
    name: Optional[str] = None
    insurer: Optional[str] = None
    broker: Optional[str] = None
    agent_group: Optional[str] = None
    agent_code: Optional[str] = None
    ptype: Optional[str] = None
    products: Optional[str] = None
    makes: Optional[str] = None
    model: Optional[str] = None
    rtos: Optional[str] = None
    vehicle_ages: Optional[str] = None
    fuel_types: Optional[str] = None
    business_types: Optional[str] = None
    ncb: Optional[str] = None
    cover: Optional[str] = None
    gvw_min: Optional[float] = None
    gvw_max: Optional[float] = None
    cc_min: Optional[float] = None
    cc_max: Optional[float] = None
    seating_min: Optional[float] = None
    seating_max: Optional[float] = None
    od_percent: Optional[float] = None
    tp_percent: Optional[float] = None
    net_percent: Optional[float] = None
    odtp_percent: Optional[float] = None
    flat_amount: Optional[float] = None
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    needs_review: bool = False  # AI was unsure (blurry / merged cells) — left unticked for the admin to check
    review_note: Optional[str] = None


class AiGridRead(BaseModel):
    file_name: str
    rows: List[AiGridRow] = []
    note: Optional[str] = None  # AI's summary (company, partner, dates it saw)
    template_insurer: Optional[str] = None  # saved layout used for this read (None = no layout yet)
    template_uses: int = 0  # approved uploads the layout has learned from
    today: str = ""  # server date (YYYY-MM-DD) — rows ending before it are flagged on the check screen


class AiGridApplyIn(BaseModel):
    rows: List[AiGridRow] = Field(min_length=1, max_length=1000)
    preview: bool = True
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    original_rows: List[AiGridRow] = []  # what the AI read for the same rows (same order) → learn the admin's corrections
    template_insurer: Optional[str] = None  # company whose layout to remember (default: most common insurer of the rows)
    file_name: Optional[str] = None
    used_layout: bool = False  # the read was done with a saved layout


class GridCorrection(BaseModel):
    field: str
    ai_value: str
    approved_value: str
    count: int = 1


class GridUploadStat(BaseModel):
    """How much the admin had to fix on one approved AI upload (accuracy = untouched cells / checked cells)."""
    at: UtcDatetime
    file: Optional[str] = None
    rows: int
    cells_checked: int
    cells_corrected: int
    rows_corrected: int
    accuracy: float  # %
    used_layout: bool = False  # the AI already had a saved layout for this read


class GridTemplate(BaseModel):
    """Remembered layout of one company's grid: admin notes + learned corrections + approved example rows (fed to the AI)."""
    id: str
    insurer: str
    kind: str
    notes: str = ""
    corrections: List[GridCorrection] = []
    examples: List[AiGridRow] = []
    uploads: List[GridUploadStat] = []  # newest last, max 30
    uses: int = 0
    last_file: Optional[str] = None
    updated_at: UtcDatetime
    updated_by: Optional[str] = None


class GridTemplateIn(BaseModel):
    notes: str = Field(default="", max_length=2000)


class AgentPayableRow(BaseModel):
    """One receivable rule seen from one agent: what the agent gets today and from where."""
    receivable_id: str
    insurer: Optional[str] = None
    product: str
    products: List[str] = []  # the receivable's products (empty = all products) — drives the product filter
    broker: Optional[str] = None
    receivable_name: str
    conditions: List[str] = []
    receivable: CompareRates
    payable: Optional[CompareRates] = None  # None = no payable for this agent (missing)
    source: Literal["agent_rule", "group_margin", "group_rule", "common_rule", "missing"]
    source_label: str
    agent_rule_id: Optional[str] = None  # agent's own rule with exactly these conditions (edited in place)


class AgentPayablesView(BaseModel):
    agent_id: str
    agent_label: str
    agent_group: Optional[str] = None
    rows: List[AgentPayableRow] = []


class AgentPayableEdit(BaseModel):
    receivable_id: str
    rates: RuleRates


class AgentPayablesIn(BaseModel):
    agent_id: str
    rows: List[AgentPayableEdit] = Field(min_length=1, max_length=1000)
    valid_from: Optional[str] = None  # blank = new rates from today
    valid_to: Optional[str] = None  # blank = open-ended
    preview: bool = True
