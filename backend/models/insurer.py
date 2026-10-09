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
