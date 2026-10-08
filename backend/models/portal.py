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
    all_agents: bool = True  # False → only agent_ids can see it (admin/backoffice always see all)
    agent_ids: List[str] = []
    # Own OTP mailbox for this portal login (blank email → default mailbox). Admin only; blanked for others.
    mailbox_host: Optional[str] = None
    mailbox_port: int = 993
    mailbox_email: Optional[str] = None
    has_mailbox_password: bool = False
    updated_at: UtcDatetime


class PortalIn(BaseModel):
    insurer: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=4, max_length=500)
    username: str = Field(min_length=1, max_length=200)
    password: Optional[str] = Field(default=None, max_length=200)  # omit on edit to keep the current one
    otp_filters: List[str] = []
    notes: Optional[str] = Field(default=None, max_length=500)
    active: bool = True
    all_agents: bool = True
    agent_ids: List[str] = Field(default=[], max_length=500)
    mailbox_host: Optional[str] = Field(default=None, max_length=200)
    mailbox_port: int = Field(default=993, ge=1, le=65535)
    mailbox_email: Optional[str] = Field(default=None, max_length=200)
    mailbox_password: Optional[str] = Field(default=None, max_length=200)  # omit to keep


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
    expires_at: Optional[UtcDatetime] = None  # shown for 1 minute after it arrives


class OtpError(BaseModel):
    insurers: List[str]
    message: str


class OtpClaim(BaseModel):
    """'I am requesting the OTP now' — only the claimer sees that portal's next OTP."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    portal_id: str
    insurer: str
    user_id: str
    user_name: str
    at: UtcDatetime = Field(default_factory=now_utc)
    expires_at: UtcDatetime


class OtpRequestIn(BaseModel):
    portal_id: str


class OtpFeed(BaseModel):
    messages: List[OtpMessage]
    errors: List[OtpError] = []
    waiting: List[OtpClaim] = []  # my active requests
    others_waiting: List[str] = []  # "Name · Insurer" of other users waiting on the same portals
