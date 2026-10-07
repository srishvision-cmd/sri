import uuid
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from models.common import UtcDatetime, now_utc

ReconKind = Literal["agent", "broker"]  # agent → Srishvision (premium collected) · Srishvision → broker (premium remitted)
# "On-account" = apply the party's unallocated (advance) balance to cases; no new money moves.
SettleMode = Literal["Cash", "Online", "Cheque", "NEFT/RTGS", "UPI", "Adjustment", "On-account"]


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
    unallocated: float = 0  # part of the amount kept as on-account balance
    reversed: bool = False
    reversed_by_name: Optional[str] = None
    reversed_at: Optional[UtcDatetime] = None
    created_by_name: str
    created_at: UtcDatetime = Field(default_factory=now_utc)


class AllocationIn(BaseModel):
    policy_id: str
    amount: float = Field(gt=0)


class SettlementIn(BaseModel):
    kind: ReconKind
    party_id: str
    amount: float = Field(gt=0)
    mode: SettleMode
    reference: Optional[str] = None
    paid_on: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    # Required (manual per-case amounts) when the party has more than one outstanding case.
    allocations: List[AllocationIn] = []


class ReconParty(BaseModel):
    party_id: str
    party_name: str
    policies: int
    premium: float
    paid: float
    outstanding: float
    outstanding_policies: int
    on_account: float = 0


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
