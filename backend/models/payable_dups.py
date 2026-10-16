from typing import List, Optional

from pydantic import BaseModel, Field


class PayableDupIn(BaseModel):
    agent: str = Field(min_length=1, max_length=80)  # agent code (AGT1021), id or full name
    insurer: str = Field(min_length=1, max_length=120)  # company (first word is matched, like the rule list)
    delete: bool = False  # False = report only


class PayableDupRule(BaseModel):
    id: str
    name: str
    insurer: Optional[str] = None
    products: List[str] = []
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    rate: Optional[str] = None
    updated_at: Optional[str] = None
    keep: bool


class PayableDupGroup(BaseModel):
    rules: List[PayableDupRule]


class PayableDupReport(BaseModel):
    agent_label: str
    insurer: str
    total: int  # current payable rule documents for this agent + company
    rule_ids: List[str]
    unique_rules: int
    groups: List[PayableDupGroup]  # only groups with more than one document
    to_delete: int
    deleted: int = 0
