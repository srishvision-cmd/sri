"""Commission grid Excel template: download (blank or pre-filled with the current grid) and bulk upload.

One row = one rule. A row whose Rule ID (or, when blank, exact conditions) matches a current rule
updates that rule's rate from the row's Applicable From date (versioned); other rows add new rules.
"""
import io
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from pydantic import ValidationError

from lib.auth import require_roles
from lib.db import db
from models.commission import COMPONENTS, CommissionRule, CommissionRuleIn, GridRowError, GridUploadResult
from models.masters import FUEL_BY_TYPE, FUEL_TYPES, MAKES, PRODUCT_TYPES
from models.policy import AGE_BANDS
from models.user import User
from routers.commission import _clean, _signature, _today, apply_rule_update, commission_masters, insert_rule

router = APIRouter(tags=["commission-grid"])
admin_only = require_roles("admin")

# (header, key) — headers are what the admin sees; keys map to rule fields
COLS: list[tuple[str, str]] = [
    ("Rule ID (blank = new rule)", "id"), ("Type", "kind"), ("Rule Name (blank = auto)", "name"), ("Insurance Company", "insurer"),
    ("Channel Partner", "broker"), ("Agent Group (payable)", "agent_group"), ("Agent Code (payable)", "agent_code"),
    ("Product Type", "ptype"), ("Products (comma separated, blank = all of type)", "products"), ("Makes (comma separated)", "makes"),
    ("Model", "model"), ("RTOs (comma separated e.g. TN19,TN20 or TN)", "rtos"), ("Vehicle Age Bands (comma separated)", "vehicle_ages"),
    ("Fuel Types (comma separated)", "fuel_types"), ("NCB", "ncb"), ("Package / SATP", "cover"),
    ("GVW From (kg)", "gvw_min"), ("GVW To (kg)", "gvw_max"), ("CC From", "cc_min"), ("CC To", "cc_max"),
    ("Seating From", "seating_min"), ("Seating To", "seating_max"),
    ("OD %", "od_percent"), ("TP %", "tp_percent"), ("Net %", "net_percent"), ("OD+TP %", "odtp_percent"), ("Flat Amount", "flat_amount"),
    ("Applicable From (YYYY-MM-DD)", "valid_from"), ("Applicable To (YYYY-MM-DD)", "valid_to"), ("Active", "active"),
]
NUMS = ("gvw_min", "gvw_max", "cc_min", "cc_max", "seating_min", "seating_max", *COMPONENTS)
NCB_OUT = {"any": "Any", "with": "With NCB", "without": "Without NCB"}
COVER_OUT = {"any": "Any", "package": "Package", "satp": "SATP"}
ALL_PRODUCTS = [p for items in PRODUCT_TYPES.values() for p in items]
INSTRUCTIONS = [
    "HOW TO USE THIS TEMPLATE",
    "1. One row = one commission rule. Type = Receivable (from channel partner) or Payable (to agent).",
    "2. Leave a condition blank to apply to all (all companies, all RTOs, all makes...).",
    "3. Payables: copy a row and change only the Agent Code / Agent Group and rates to give different agents a different grid for the same company + channel partner.",
    "4. To change an existing rate: download 'Current grid', edit the % and set Applicable From to the date the new rate starts. Policies before that date keep the old rate.",
    "   If you change only the rate and keep the old date, the new rate applies from today.",
    "5. New rules: leave Rule ID blank. A row with exactly the same conditions as an existing rule updates that rule instead of adding a duplicate.",
    "6. PCV rules need Products filled in. GCV rules need GVW From and/or GVW To.",
    "7. Lists of valid values are in the 'Lists' sheet (dropdowns are added on the Grid sheet).",
    "8. Receivable rows are processed before payable rows; a payable can never exceed the matching receivable.",
]


def _split(v) -> list[str]:
    return [x.strip() for x in str(v or "").replace(";", ",").split(",") if x.strip()]


def _num(v) -> Optional[float]:
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace("%", "").replace(",", "").replace("₹", "").strip())
    except ValueError:
        raise ValueError(f"'{v}' is not a number")


def _date(v) -> Optional[str]:
    if v in (None, ""):
        return None
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ValueError(f"date '{v}' — use YYYY-MM-DD")


def _pick(value: str, options: list[str], label: str) -> str:
    hit = next((o for o in options if o.lower() == value.strip().lower()), None)
    if not hit:
        raise ValueError(f"unknown {label} '{value}'")
    return hit


async def _lookups() -> dict:
    m = await commission_masters(None)  # type: ignore[arg-type]  # dependency only checks login
    brokers = await db.brokers.find({}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(1000)
    agents = await db.users.find({"role": "agent"}, {"_id": 0, "id": 1, "username": 1}).to_list(5000)
    groups = [g["name"] for g in await db.agent_groups.find({}, {"_id": 0, "name": 1}).to_list(200)]
    used = [n for n in await db.commission_rules.distinct("insurer") if isinstance(n, str) and n not in m.insurers]
    return {"insurers": [*m.insurers, *used], "brokers": brokers, "agents": agents, "groups": groups}


def _type_of(products: list[str]) -> str:
    types = {t for t, items in PRODUCT_TYPES.items() for p in products if p in items}
    return types.pop() if len(types) == 1 else ""


def _rule_row(r: dict, bname: dict, acode: dict) -> list:
    ptype = _type_of(r.get("products") or [])
    products = r.get("products") or []
    out = {
        "id": r["id"], "kind": r["kind"].title(), "name": r["name"], "insurer": r.get("insurer"), "broker": bname.get(r.get("broker_id") or ""),
        "agent_group": r.get("agent_group"), "agent_code": acode.get(r.get("agent_id") or ""), "ptype": ptype,
        "products": "" if ptype and set(products) == set(PRODUCT_TYPES[ptype]) else ", ".join(products),
        "makes": ", ".join(r.get("makes") or []), "model": r.get("model"), "rtos": ", ".join(r.get("rtos") or []),
        "vehicle_ages": ", ".join(r.get("vehicle_ages") or []), "fuel_types": ", ".join(r.get("fuel_types") or []),
        "ncb": NCB_OUT.get(r.get("ncb") or "any"), "cover": COVER_OUT.get(r.get("cover") or "any"),
        "valid_from": r.get("valid_from"), "valid_to": r.get("valid_to"), "active": "Yes" if r.get("active", True) else "No",
        **{k: r.get(k) for k in NUMS},
    }
    return [out.get(k) for _, k in COLS]


@router.get("/commission/grid/template")
async def grid_template(prefill: bool = False, kind: str = "", _: User = Depends(admin_only)):
    lk = await _lookups()
    wb = Workbook()
    ws = wb.active
    ws.title = "Grid"
    ws.append([h for h, _ in COLS])
    head_fill = PatternFill("solid", fgColor="0F766E")
    for c in ws[1]:
        c.font, c.fill, c.alignment = Font(bold=True, color="FFFFFF"), head_fill, Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[1].height = 42
    ws.freeze_panes = "D2"
    for i, (h, _) in enumerate(COLS, start=1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = max(12, min(34, len(h) + 2))
    if prefill:
        q: dict = {"superseded_by": None}
        if kind in ("receivable", "payable"):
            q["kind"] = kind
        rules = await db.commission_rules.find(q, {"_id": 0}).sort([("kind", -1), ("insurer", 1), ("name", 1)]).to_list(5000)
        bname = {b["id"]: b["name"] for b in lk["brokers"]}
        acode = {a["id"]: a["username"].upper() for a in lk["agents"]}
        for r in rules:
            ws.append(_rule_row(r, bname, acode))
    else:
        ex_kind = "Payable" if kind == "payable" else "Receivable"
        ws.append(["", ex_kind, "", lk["insurers"][0] if lk["insurers"] else "", "", "", "", "GCV", "GCV", "Tata Motors, Ashok Leyland", "", "TN19, TN20",
                   "", "Diesel", "Any", "Package", 0, 7500, None, None, None, None, 30, None, None, None, None, _today(), None, "Yes"])

    lists = wb.create_sheet("Lists")
    columns = {
        "Type": ["Receivable", "Payable"], "Insurance Company": lk["insurers"], "Channel Partner": [b["name"] for b in lk["brokers"]],
        "Agent Group": lk["groups"], "Agent Code": [a["username"].upper() for a in lk["agents"]], "Product Type": list(PRODUCT_TYPES),
        "Products": ALL_PRODUCTS, "Vehicle Age Bands": AGE_BANDS, "Fuel Types": sorted({f for v in FUEL_BY_TYPE.values() for f in v}),
        "NCB": list(NCB_OUT.values()), "Package / SATP": list(COVER_OUT.values()), "Active": ["Yes", "No"],
        **{f"Makes · {t}": v for t, v in MAKES.items()},
    }
    ranges = {}
    for ci, (title, values) in enumerate(columns.items(), start=1):
        lists.cell(1, ci, title).font = Font(bold=True)
        for ri, v in enumerate(values, start=2):
            lists.cell(ri, ci, v)
        col = lists.cell(1, ci).column_letter
        lists.column_dimensions[col].width = 26
        ranges[title] = f"Lists!${col}$2:${col}${max(2, len(values) + 1)}"
    key_col = {k: ws.cell(1, i).column_letter for i, (_, k) in enumerate(COLS, start=1)}
    for key, title in (("kind", "Type"), ("insurer", "Insurance Company"), ("broker", "Channel Partner"), ("agent_group", "Agent Group"),
                       ("agent_code", "Agent Code"), ("ptype", "Product Type"), ("ncb", "NCB"), ("cover", "Package / SATP"), ("active", "Active")):
        dv = DataValidation(type="list", formula1=ranges[title], allow_blank=True, showErrorMessage=key in ("kind", "ptype", "ncb", "cover", "active"))
        ws.add_data_validation(dv)
        dv.add(f"{key_col[key]}2:{key_col[key]}2000")

    info = wb.create_sheet("Instructions")
    for line in INSTRUCTIONS:
        info.append([line])
    info["A1"].font = Font(bold=True, size=13)
    info.column_dimensions["A"].width = 140

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    name = f"commission_grid_{kind or 'all'}_{_today()}.xlsx" if prefill else "commission_grid_template.xlsx"
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _auto_name(d: dict, ptype: str) -> str:
    parts = [(d.get("insurer") or "All companies").split(" /")[0], ptype or "All products"]
    if d["products"] and ptype and set(d["products"]) != set(PRODUCT_TYPES.get(ptype, [])):
        parts.append(", ".join(d["products"]))
    if d.get("rtos"):
        parts.append(", ".join(d["rtos"][:4]) + ("…" if len(d["rtos"]) > 4 else ""))
    if d.get("makes"):
        parts.append(", ".join(d["makes"]))
    return " · ".join(parts)


def _parse_row(raw: dict, lk: dict) -> tuple[Optional[str], dict]:
    """Row cells → (rule id or None, CommissionRuleIn kwargs). Raises ValueError with a readable message."""
    s = lambda k: str(raw.get(k) if raw.get(k) is not None else "").strip()  # noqa: E731
    kind = s("kind").lower()
    if kind.startswith("rec"):
        kind = "receivable"
    elif kind.startswith("pay"):
        kind = "payable"
    else:
        raise ValueError("Type must be Receivable or Payable")
    d: dict = {"kind": kind}
    d["insurer"] = _pick(s("insurer"), lk["insurers"], "insurance company") if s("insurer") else None
    if s("broker"):
        b = next((b for b in lk["brokers"] if s("broker").lower() in (b["name"].lower(), (b.get("code") or "").lower())), None)
        if not b:
            raise ValueError(f"unknown channel partner '{s('broker')}'")
        d["broker_id"] = b["id"]
    if kind == "payable":
        d["agent_group"] = _pick(s("agent_group"), lk["groups"], "agent group") if s("agent_group") else None
        if s("agent_code"):
            a = next((a for a in lk["agents"] if a["username"].lower() == s("agent_code").lower()), None)
            if not a:
                raise ValueError(f"unknown agent code '{s('agent_code')}'")
            d["agent_id"] = a["id"]
    ptype = _pick(s("ptype"), list(PRODUCT_TYPES), "product type") if s("ptype") else ""
    products = [_pick(p, ALL_PRODUCTS, "product") for p in _split(raw.get("products"))]
    if ptype and products and any(p not in PRODUCT_TYPES[ptype] for p in products):
        raise ValueError(f"products must belong to {ptype}")
    if ptype == "PCV" and not products:
        raise ValueError("PCV rules need Products (e.g. PCV - Taxi)")
    d["products"] = products or (list(PRODUCT_TYPES[ptype]) if ptype else [])
    ptype = ptype or _type_of(products)
    known_makes = MAKES.get(ptype) or sorted({m for v in MAKES.values() for m in v})
    d["makes"] = [next((k for k in known_makes if k.lower() == m.lower()), m) for m in _split(raw.get("makes"))]
    d["model"] = s("model") or None
    d["rtos"] = [r.upper().replace(" ", "") for r in _split(raw.get("rtos"))]
    d["vehicle_ages"] = [_pick(a, AGE_BANDS, "vehicle age band") for a in _split(raw.get("vehicle_ages"))]
    fuels = FUEL_BY_TYPE.get(ptype) or sorted({*FUEL_TYPES, *[f for v in FUEL_BY_TYPE.values() for f in v]})
    d["fuel_types"] = [_pick(f, fuels, f"fuel type for {ptype or 'this product'}") for f in _split(raw.get("fuel_types"))]
    ncb = s("ncb").lower()
    d["ncb"] = "with" if ncb.startswith("with ") or ncb == "with" else "without" if ncb.startswith("without") else "any"
    cover = s("cover").lower()
    d["cover"] = "package" if cover.startswith("pack") else "satp" if cover.startswith("satp") or cover.startswith("liab") else "any"
    for k in NUMS:
        d[k] = _num(raw.get(k))
    d["valid_from"], d["valid_to"] = _date(raw.get("valid_from")), _date(raw.get("valid_to"))
    d["active"] = s("active").lower() not in ("no", "n", "false", "0", "inactive")
    d["name"] = s("name") or _auto_name(d, ptype)
    return (s("id") or None), d


def _same_rate(old: dict, d: dict) -> bool:
    return all(old.get(k) == d.get(k) for k in (*COMPONENTS, "valid_to", "active", "name"))


@router.post("/commission/grid/upload", response_model=GridUploadResult)
async def grid_upload(file: UploadFile = File(...), _: User = Depends(admin_only)):
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Upload the .xlsx grid template")
    try:
        wb = load_workbook(io.BytesIO(await file.read()), data_only=True, read_only=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the Excel file")
    ws = wb["Grid"] if "Grid" in wb.sheetnames else wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(status_code=400, detail="The sheet is empty")
    by_header = {h.lower(): k for h, k in COLS}
    keys = [by_header.get(str(h or "").strip().lower()) for h in rows[0]]
    if "kind" not in keys or not any(k in keys for k in COMPONENTS):
        raise HTTPException(status_code=400, detail="Header row not recognised — download the template and keep its first row")
    lk = await _lookups()
    parsed: list[tuple[int, dict]] = []
    res = GridUploadResult()
    for n, row in enumerate(rows[1:], start=2):
        raw = {k: v for k, v in zip(keys, row) if k}
        if all(v in (None, "") for v in raw.values()):
            continue
        parsed.append((n, raw))
    parsed.sort(key=lambda nr: 0 if str(nr[1].get("kind") or "").lower().startswith("rec") else 1)  # receivables first

    # normalised through the model so older rules (missing newer fields) compare equal to a re-uploaded row
    current = [CommissionRule(**r).model_dump(exclude={"apply_to_past"}) for r in await db.commission_rules.find({"superseded_by": None}, {"_id": 0}).to_list(5000)]
    newer = {r["id"]: r["superseded_by"] for r in await db.commission_rules.find({"superseded_by": {"$nin": [None, "ended"]}}, {"_id": 0, "id": 1, "superseded_by": 1}).to_list(10000)}
    for n, raw in parsed:
        try:
            rid, kw = _parse_row(raw, lk)
            d = _clean(CommissionRuleIn(**kw))
            ident = lambda r: (r["kind"], r.get("agent_group"), r.get("agent_id"), _signature(r))  # noqa: E731
            for _ in range(50):  # a Rule ID from an older download → follow to the current version
                if rid not in newer:
                    break
                rid = newer[rid]
            old = next((r for r in current if r["id"] == rid), None) if rid else next((r for r in current if ident(r) == ident(d)), None)
            if rid and not old:
                raise ValueError(f"Rule ID {rid} not found (or it is an old version) — clear the Rule ID to add it as a new rule")
            if old:
                if old["kind"] != d["kind"]:
                    raise ValueError("Type cannot change for an existing Rule ID")
                same_conditions = ident(old) == ident(d)
                if same_conditions and _same_rate(old, d) and (not d["valid_from"] or d["valid_from"] == old.get("valid_from")):
                    res.unchanged += 1
                    continue
                if d["valid_from"] == old.get("valid_from") and not _same_rate(old, d):
                    d["valid_from"] = None  # only the rate changed → new rate from today, past policies keep the old one
                saved = await apply_rule_update(old, d)
                current = [r for r in current if r["id"] != old["id"]] + [saved.model_dump()]
                if saved.id != old["id"]:
                    newer[old["id"]] = saved.id
                res.updated += 1
            else:
                saved = await insert_rule(d)
                current.append(saved.model_dump())
                res.created += 1
        except HTTPException as e:
            res.errors.append(GridRowError(row=n, error=str(e.detail)))
        except ValidationError as e:
            err = e.errors()[0]
            res.errors.append(GridRowError(row=n, error=f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}"))
        except ValueError as e:
            res.errors.append(GridRowError(row=n, error=str(e)))
    return res
