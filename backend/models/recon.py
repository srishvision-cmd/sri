import uuid
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from models.common import UtcDatetime, now_utc

ReconKind = Literal["agent", "broker"]  # agent → Srishvision (premium collected) · Srishvision → broker (premium remitted)
# "On-account" = apply the party's unallocated (advance) balance to cases; no new money moves.
PaidTo = Literal["Broker", "Insurance Company"]
SettleMode = Literal["Cash", "Online", "Cheque", "NEFT/RTGS", "UPI", "Adjustment", "On-account", "Paid at upload"]


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
    paid_to: Optional[PaidTo] = None  # broker side: who Srishvision paid
    paid_on: str
    allocations: List[Allocation] = []
    unallocated: float = 0  # part of the amount kept as on-account balance
    reversed: bool = False
    reversed_by_name: Optional[str] = None
    reversed_at: Optional[UtcDatetime] = None
    created_by_name: str
    created_at: UtcDatetime = Field(default_factory=now_utc)
    note: Optional[str] = None  # e.g. "Excess ₹X adjusted from policy P123 dated 2026-10-17"
    balance_after: Optional[float] = None  # partner outstanding right after this payment (payment log)


class AllocationIn(BaseModel):
    policy_id: str
    amount: float = Field(gt=0)


class SettlementIn(BaseModel):
    kind: ReconKind
    party_id: str
    amount: float = Field(gt=0)
    mode: SettleMode
    reference: Optional[str] = None
    paid_to: Optional[PaidTo] = None
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


class PartyStatementRow(BaseModel):
    policy_id: str
    customer_name: Optional[str] = None
    policy_number: Optional[str] = None
    reg_no: Optional[str] = None
    rto: Optional[str] = None
    insurer: Optional[str] = None
    product: Optional[str] = None
    uploaded_on: str
    gross_premium: float
    od_premium: Optional[float] = None
    tp_premium: Optional[float] = None
    net_premium: Optional[float] = None
    commission_percent: Optional[float] = None  # commission ÷ net premium
    commission: float  # broker: receivable from broker · agent: payable to agent (commission grid)
    paid_by: str  # payment mode on this side
    premium_paid: float
    pending_premium: float
    partial: bool = False  # Partial Payment case → highlighted
    partial_label: Optional[str] = None
    payment_details: Optional[str] = None


class PartyStatement(BaseModel):
    kind: ReconKind
    party_id: str
    party_name: str
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    rows: List[PartyStatementRow]
    total_premium: float
    total_commission: float
    cash_pending: float  # premium pending on full-pending (Cash) cases
    partial_pending: float  # balance pending on Partial Payment cases
    net: float  # commission − cash pending − partial pending
    net_label: str  # who pays whom


class UploadBatchIn(BaseModel):
    """Partial amounts typed on the Upload page for a multi-file batch = TOTAL for the batch (not per file)."""
    policy_ids: List[str] = Field(min_length=1, max_length=200)
    agent_amount: Optional[float] = Field(default=None, ge=0)
    agent_reference: Optional[str] = None
    broker_amount: Optional[float] = Field(default=None, ge=0)
    broker_reference: Optional[str] = None


class UploadBatchPayment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: ReconKind
    party_id: str
    policy_ids: List[str]
    amount: float
    reference: Optional[str] = None
    paid_on: str
    created_by_name: str
    status: Literal["pending", "allocating", "allocated"] = "pending"
    settlement_id: Optional[str] = None
    created_at: UtcDatetime = Field(default_factory=now_utc)


PartnerPayMode = Literal["Cash", "Online", "Cheque", "NEFT/RTGS", "UPI"]


class PartnerPaymentIn(BaseModel):
    """One partial / lump-sum payment from a partner — applied to their oldest outstanding policies first."""
    agent_id: str
    amount: float = Field(gt=0)
    mode: PartnerPayMode
    reference: Optional[str] = Field(default=None, max_length=120)
    paid_on: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class UploadPaymentAction(BaseModel):
    action: Literal["approve", "correct", "discard"]
    amount: Optional[float] = Field(default=None, gt=0)  # correct only
