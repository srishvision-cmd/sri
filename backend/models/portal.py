import uuid
from typing import List, Optional

from pydantic import BaseModel, Field

from models.common import UtcDatetime, now_utc


class Portal(BaseModel):
    """Insurer portal login shared with agents. Password is never returned here — use /reveal (logged)."""
    id: str
    insurer: str
    url: str
    username: str
    has_password: bool
    otp_filters: List[str] = []  # sender email / domain / subject words that identify this insurer's OTP mails
    notes: Optional[str] = None
    active: bool = True
    updated_at: UtcDatetime


class PortalIn(BaseModel):
    insurer: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=4, max_length=500)
    username: str = Field(min_length=1, max_length=200)
    password: Optional[str] = Field(default=None, max_length=200)  # omit on edit to keep the current one
    otp_filters: List[str] = []
    notes: Optional[str] = Field(default=None, max_length=500)
    active: bool = True


class PortalSecret(BaseModel):
    password: str


class PortalView(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    portal_id: str
    insurer: str
    user_name: str
    user_role: str
    at: UtcDatetime = Field(default_factory=now_utc)


class MailboxSettings(BaseModel):
    host: str = ""
    port: int = 993
    email: str = ""
    has_password: bool = False
    configured: bool = False


class MailboxIn(BaseModel):
    host: str = Field(min_length=3, max_length=200)
    port: int = Field(default=993, ge=1, le=65535)
    email: str = Field(min_length=3, max_length=200)
    password: Optional[str] = Field(default=None, max_length=200)  # omit to keep the current one


class MailboxTest(BaseModel):
    ok: bool
    message: str


class OtpMessage(BaseModel):
    uid: str
    portal_id: Optional[str] = None
    insurer: Optional[str] = None
    sender: str
    subject: str
    received_at: UtcDatetime
    otp: Optional[str] = None
    snippet: str
