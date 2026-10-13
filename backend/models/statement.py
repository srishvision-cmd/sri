import uuid
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from models.common import UtcDatetime, now_utc

PeriodType = Literal["daily", "weekly", "monthly", "custom"]
StatementStatus = Literal["pending_approval", "approved", "rejected", "paid"]  # legacy "generated" → pending_approval (migration)


class StatementLine(BaseModel):
    policy_id: str
    policy_number: Optional[str] = None
    reg_no: Optional[str] = None
    insured_name: Optional[str] = None
    insurer: Optional[str] = None
    product: Optional[str] = None
    start_date: Optional[str] = None
    net_premium: Optional[float] = None
    payable: float
    rule_name: Optional[str] = None
    commission_rate: Optional[str] = None  # agent's commission %, e.g. "OD 15% + TP 2%"


class OutstandingLine(BaseModel):
    policy_id: str
    policy_number: Optional[str] = None
    reg_no: Optional[str] = None
    insured_name: Optional[str] = None
    payment_mode: Optional[str] = None
    gross_premium: Optional[float] = None
    outstanding: float
    deducted: float = 0.0  # part of this outstanding recovered from the commission


class CommissionStatement(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    number: str
    agent_id: str
    agent_name: str
    agent_code: str
    branch: Optional[str] = None
    period_type: PeriodType
    from_date: str
    to_date: str
    lines: List[StatementLine] = []
    outstanding_lines: List[OutstandingLine] = []
    total_payable: float = 0.0
    total_outstanding: float = 0.0
    outstanding_deducted: float = 0.0
    outstanding_balance: float = 0.0  # carried forward when commission < outstanding
    net_payable: float = 0.0
    status: StatementStatus = "pending_approval"
    approval_log: List["StatementAudit"] = []  # every generate / approve / reject / pay with who + when
    approved_by_name: Optional[str] = None
    approved_at: Optional[UtcDatetime] = None
    paid_date: Optional[str] = None
    utr: Optional[str] = None
    paid_by_name: Optional[str] = None
    created_by_name: str
    created_at: UtcDatetime = Field(default_factory=now_utc)


class StatementAudit(BaseModel):
    action: Literal["generated", "approved", "rejected", "paid"]
    by_id: Optional[str] = None
    by_name: str
    by_role: str
    at: UtcDatetime = Field(default_factory=now_utc)
    note: Optional[str] = None


class StatementDecisionIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


class StatementRejectIn(BaseModel):
    note: str = Field(min_length=3, max_length=500)


CommissionStatement.model_rebuild()


class StatementGenerateIn(BaseModel):
    agent_id: str
    period_type: PeriodType
    ref_date: Optional[str] = None  # any date inside the period (daily/weekly/monthly)
    from_date: Optional[str] = None  # custom only
    to_date: Optional[str] = None


class StatementPaidIn(BaseModel):
    paid_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    utr: str = Field(min_length=4, max_length=40)
