import uuid
from typing import List

from pydantic import BaseModel, Field

from models.common import UtcDatetime, now_utc


class InsurerIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    keywords: List[str] = []  # other spellings OCR may read on the policy (lowercase match)
    active: bool = True


class Insurer(InsurerIn):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    builtin: bool = False
    created_at: UtcDatetime = Field(default_factory=now_utc)


class InsurerDupEntry(BaseModel):
    id: str
    name: str
    builtin: bool
    keywords: List[str] = []
    policies: int = 0  # policies whose insurer text is exactly this name
    rules: int = 0  # commission rules for this name


class InsurerDupGroup(BaseModel):
    """Master entries whose names are the same insurer (case-insensitive, punctuation ignored)."""
    key: str
    canonical_id: str  # suggested entry to keep (built-in first, then most policies)
    entries: List[InsurerDupEntry]
    policy_names: List[str] = []  # every spelling of this insurer found on policies (all relinked to the kept name)


class InsurerMergeGroup(BaseModel):
    canonical_id: str
    merge_ids: List[str] = Field(min_length=1, max_length=50)


class InsurerMergeIn(BaseModel):
    groups: List[InsurerMergeGroup] = Field(min_length=1, max_length=200)


class InsurerMergeResult(BaseModel):
    merged: int  # master entries removed
    policies_relinked: int
    rules_relinked: int
