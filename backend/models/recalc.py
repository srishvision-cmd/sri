"""Commission snapshot recalculation (admin) + audit trail, and the missing-payables alert."""
import uuid
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from models.common import UtcDatetime, now_utc


class CommissionValues(BaseModel):
    receivable: Optional[float] = None
    payable: Optional[float] = None
    margin: Optional[float] = None
    receivable_rule_name: Optional[str] = None
    payable_rule_name: Optional[str] = None
    payable_rate: Optional[str] = None


class RecalcPreviewIn(BaseModel):
    policy_ids: List[str] = Field(min_length=1, max_length=500)


class RecalcApplyIn(RecalcPreviewIn):
    reason: str = Field(min_length=5, max_length=500)


class RecalcRow(BaseModel):
    policy_id: str
    policy_number: Optional[str] = None
    customer_name: Optional[str] = None
    agent_name: Optional[str] = None
    status: str
    before: CommissionValues
    after: CommissionValues
    changed: bool = False
    blocked: Optional[str] = None  # why this policy cannot be recalculated (settled / on a statement)


class RecalcPreview(BaseModel):
    rows: List[RecalcRow] = []
    eligible: int = 0
    changed: int = 0
    blocked: int = 0


class RecalcResult(RecalcPreview):
    batch_id: str
    updated: int = 0


class CommissionAudit(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    batch_id: Optional[str] = None
    policy_id: str
    policy_number: Optional[str] = None
    action: Literal["admin_recalculate", "policy_corrected"]
    reason: Optional[str] = None
    by_id: Optional[str] = None
    by_name: str
    by_role: str
    at: UtcDatetime = Field(default_factory=now_utc)
    before: CommissionValues
    after: CommissionValues


class MissingPayableAgent(BaseModel):
    agent_id: str
    agent_label: str
    missing_count: int
    receivables: List[str] = []  # receivable rule names with no payable for this agent


class MissingPayables(BaseModel):
    rule_count: int = 0  # recently uploaded receivable rules being watched
    since: Optional[UtcDatetime] = None
    agents: List[MissingPayableAgent] = []
