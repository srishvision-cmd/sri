import uuid
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from models.common import UtcDatetime, now_utc

RuleKind = Literal["receivable", "payable"]  # receivable: broker → company · payable: company → agent
NcbFilter = Literal["any", "with", "without"]
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


class AgentGroup(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    created_at: UtcDatetime = Field(default_factory=now_utc)


class AgentGroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class CommissionRuleIn(BaseModel):
    kind: RuleKind
    name: str = Field(min_length=1)
    active: bool = True
    # conditions — empty / None = applies to all
    insurer: Optional[str] = None
    broker_id: Optional[str] = None
    agent_group: Optional[str] = None  # payable only
    agent_id: Optional[str] = None  # payable only
    products: List[str] = []
    rtos: List[str] = []  # prefixes: "TN" (state) or "TN10" (RTO)
    ncb: NcbFilter = "any"
    gvw_min: Optional[float] = None
    gvw_max: Optional[float] = None
    cc_min: Optional[float] = None
    cc_max: Optional[float] = None
    vehicle_ages: List[str] = []  # AGE_BANDS
    fuel_types: List[str] = []  # Petrol / Diesel / CNG …
    seating_min: Optional[float] = None
    seating_max: Optional[float] = None
    make: Optional[str] = None
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
    payable_rule_id: Optional[str] = None
    payable_rule_name: Optional[str] = None
    capped: bool = False  # payable was cut down to the receivable
    note: Optional[str] = None
    misses: List[RuleMiss] = []  # single-policy view only: why nearby rules did not apply


class AgentRate(BaseModel):
    """A payable rule as shown to an agent (plain view — no receivable/margin data)."""
    id: str
    name: str
    insurer: Optional[str] = None
    broker_name: Optional[str] = None
    products: List[str] = []
    rtos: List[str] = []
    ncb: NcbFilter = "any"
    gvw_min: Optional[float] = None
    gvw_max: Optional[float] = None
    cc_min: Optional[float] = None
    cc_max: Optional[float] = None
    vehicle_ages: List[str] = []
    fuel_types: List[str] = []
    seating_min: Optional[float] = None
    seating_max: Optional[float] = None
    make: Optional[str] = None
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


class AgentRateCard(BaseModel):
    agent_name: Optional[str] = None
    agent_code: Optional[str] = None
    agent_group: Optional[str] = None
    as_of: str
    rates: List[AgentRate]
