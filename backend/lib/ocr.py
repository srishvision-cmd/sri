"""AI OCR: Gemini reads a policy PDF/image and returns structured PolicyFields + confidences."""

import asyncio
import json
import os
import re

from emergentintegrations.llm.chat import FileContentWithMimeType, LlmChat, UserMessage

OCR_TIMEOUT_S = 120

from models.policy import DERIVED_FIELDS, LOBS, NUMERIC_FIELDS, PolicyFields, derive_fields

MODEL_PROVIDER = "gemini"
MODEL_NAME = "gemini-3-flash-preview"

SYSTEM = (
    "You are a precise OCR and data-extraction engine for Indian general insurance policy documents "
    "(policy schedules, certificates of insurance, cover notes). You only output strict JSON."
)

_FIELD_KEYS = [k for k in PolicyFields.model_fields if k not in DERIVED_FIELDS]

PROMPT = f"""Read the attached insurance policy document carefully and extract the data.
Return ONLY a JSON object (no markdown) of the form:
{{"fields": {{...}}, "confidence": {{...}}}}

"fields" must contain exactly these keys: {", ".join(_FIELD_KEYS)}.
Rules:
- Use null for anything not present in the document. Never invent values.
- Dates as YYYY-MM-DD (start_date = risk start / policy from, end_date = expiry / policy to).
- Monetary and numeric values as plain numbers (no commas, no currency symbols). ncb_percent as a number like 20.
- gst = total tax (IGST or CGST+SGST). net_premium = premium before tax. gross_premium = total premium payable incl. tax.
- lob must be one of: {", ".join(LOBS)}.
- insurer = insurance company name (e.g. "ICICI Lombard General Insurance").
- product_name = product / policy type (e.g. "Private Car Package Policy").
- members_covered (health only) = comma separated list like "Self (34), Spouse (31), Son (5)".
- vehicle_reg_no without spaces in upper case, e.g. MH02AB1234. rto = RTO code like MH02 (from the RTO / registering authority, else from the reg no).
- registration_date = vehicle date of registration (YYYY-MM-DD), mfg_year = 4-digit year of manufacture.
- make = manufacturer only (e.g. "Hyundai"); model = model + variant (e.g. "i20 Asta 1.2").
- cc = cubic capacity / engine displacement; seating_capacity = number of seats incl. driver; gvw = gross vehicle weight in kg (commercial vehicles).
- od_premium = total Own Damage premium INCLUDING all add-on cover premiums (zero dep, RSA, engine protect, consumables, etc.) net of NCB/discounts.
- tp_premium = total Third Party / Liability premium (incl. PA owner-driver and legal liability covers).
"confidence" maps each non-null field key to your confidence between 0 and 1.
"""


def _parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("OCR engine returned no JSON")
    return json.loads(text[start : end + 1])


def _coerce(key: str, value):
    if value is None or value == "":
        return None
    if key in NUMERIC_FIELDS:
        if isinstance(value, (int, float)):
            return float(value)
        cleaned = re.sub(r"[^0-9.\-]", "", str(value))
        try:
            return float(cleaned) if cleaned else None
        except ValueError:
            return None
    s = str(value).strip()
    return s or None


async def extract_policy(file_path: str, mime: str, session_id: str) -> tuple[dict, dict]:
    chat = LlmChat(
        api_key=os.environ["EMERGENT_LLM_KEY"],
        session_id=session_id,
        system_message=SYSTEM,
    ).with_model(MODEL_PROVIDER, MODEL_NAME)

    # Backend-only structured extraction (never shown token-by-token), so a single non-streaming call
    # with a hard timeout is used — a hung stream must never leave a record stuck in "processing".
    message = UserMessage(text=PROMPT, file_contents=[FileContentWithMimeType(mime_type=mime, file_path=file_path)])
    try:
        text = await asyncio.wait_for(chat.send_message(message), timeout=OCR_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise RuntimeError(f"OCR timed out after {OCR_TIMEOUT_S}s")

    data = _parse_json(text)
    raw = data.get("fields") if isinstance(data.get("fields"), dict) else data
    fields = PolicyFields(**derive_fields({k: _coerce(k, raw.get(k)) for k in _FIELD_KEYS}))
    if fields.lob and fields.lob not in LOBS:
        fields.lob = "Other"
    conf_raw = data.get("confidence") or {}
    confidence = {
        k: max(0.0, min(1.0, float(v)))
        for k, v in conf_raw.items()
        if k in PolicyFields.model_fields and isinstance(v, (int, float)) and getattr(fields, k) is not None
    }
    return fields.model_dump(), confidence
