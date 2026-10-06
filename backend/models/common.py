from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator


def _ensure_utc(dt: datetime) -> datetime:
    # motor returns naive datetimes; normalise so JSON carries the +00:00 offset
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


UtcDatetime = Annotated[datetime, AfterValidator(_ensure_utc)]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
