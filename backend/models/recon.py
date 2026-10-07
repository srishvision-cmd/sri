import uuid
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from models.common import UtcDatetime, now_utc

ReconKind = Literal["agent", "broker"]  # agent → Srishvision (premium collected) · Srishvision → broker (premium remitted)
SettleMode = Literal["Cash", "Online", "Cheque", "NEFT/RTGS", "UPI", "Adjustment"]


class Allocation(BaseModel):
    policy_id: str
    policy_number: Optional[str] = None
    reg_no: Optional[str] = None
    amount: float


class Settlement(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: ReconKind
    party_id: str
    party_name: str
    amount: float
    mode: SettleMode
    reference: Optional[str] = None  # cheque no / UTR
    paid_on: str
    allocations: List[Allocation] = []
    created_by_name: str
    created_at: UtcDatetime = Field(default_factory=now_utc)


class SettlementIn(BaseModel):
    kind: ReconKind
    party_id: str
    amount: float = Field(gt=0)
    mode: SettleMode
    reference: Optional[str] = None
    paid_on: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    policy_ids: List[str] = []  # allocate to these (in order); empty = oldest outstanding first


class ReconParty(BaseModel):
    party_id: str
    party_name: str
    policies: int
    premium: float
    paid: float
    outstanding: float
    outstanding_policies: int


class ReconPolicy(BaseModel):
    policy_id: str
    policy_number: Optional[str] = None
    reg_no: Optional[str] = None
    insured_name: Optional[str] = None
    insurer: Optional[str] = None
    uploaded_on: Optional[str] = None
    premium: float
    paid: float
    outstanding: float
