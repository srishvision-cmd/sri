import uuid
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from models.common import UtcDatetime, now_utc

Role = Literal["admin", "agent", "backoffice"]


class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    username: str
    full_name: str
    role: Role
    branch: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    assigned_agent_ids: List[str] = []
    active: bool = True
    must_change_password: bool = False  # set for temp passwords; cleared after the user picks their own
    created_at: UtcDatetime = Field(default_factory=now_utc)


class UserCreate(BaseModel):
    full_name: str = Field(min_length=2)
    role: Literal["agent", "backoffice"]
    branch: str = Field(min_length=1)
    email: Optional[str] = None
    mobile: Optional[str] = None
    assigned_agent_ids: List[str] = []


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    branch: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    assigned_agent_ids: Optional[List[str]] = None
    active: Optional[bool] = None


class Credentials(BaseModel):
    user: User
    username: str
    temp_password: str


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AgentOption(BaseModel):
    id: str
    full_name: str
    username: str
    branch: Optional[str] = None
