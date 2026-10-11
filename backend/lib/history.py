"""Policy audit-trail entries — shared by the policy, recon, statement and on-spot routers (kept here to avoid router import cycles)."""
from typing import Optional

from models.policy import HistoryEntry
from models.user import User


def history(user: User | None, action: str, note: Optional[str] = None) -> dict:
    if user is None:
        return HistoryEntry(by_name="AI OCR Engine", by_role="system", action=action, note=note).model_dump()
    return HistoryEntry(by_name=user.full_name, by_role=user.role, action=action, note=note).model_dump()
