"""Idempotent seed: demo users (fixed passwords) + sample policy MIS records.
Run: cd /app/backend && python seed.py
"""

import asyncio
import os
import random  # deterministic sample data only — never used for secrets
from datetime import timedelta

from lib.auth import hash_password
from lib.db import db, ensure_indexes
from models.common import now_utc
from models.policy import HistoryEntry, PaymentEntry, Policy, PolicyFields
from models.user import User

USERS = [
    dict(username="admin", full_name="Aarav Mehta", role="admin", branch="Mumbai", email="admin@gimis.in", password_env="SEED_ADMIN_PASSWORD"),
    dict(username="agt1001", full_name="Priya Sharma", role="agent", branch="Mumbai", email="priya@gimis.in", mobile="9820011223", password_env="SEED_AGENT_PASSWORD"),
    dict(username="agt1002", full_name="Rohit Verma", role="agent", branch="Delhi", email="rohit@gimis.in", mobile="9811122334", password_env="SEED_AGENT_PASSWORD"),
    dict(username="agt1003", full_name="Sneha Iyer", role="agent", branch="Chennai", email="sneha@gimis.in", mobile="9840033445", password_env="SEED_AGENT_PASSWORD"),
    dict(username="bo2001", full_name="Kunal Desai", role="backoffice", branch="Mumbai", email="kunal@gimis.in", password_env="SEED_BACKOFFICE_PASSWORD"),
]


async def upsert_users() -> dict:
    ids = {}
    for u in USERS:
        env_key = u.pop("password_env")
        password = os.environ.get(env_key)
        if not password:
            raise SystemExit(f"{env_key} is not set in backend/.env — refusing to seed accounts without a password")
        existing = await db.users.find_one({"username": u["username"]}, {"_id": 0, "id": 1})
        if existing:
            await db.users.update_one({"id": existing["id"]}, {"$set": {**u, "active": True, "password_hash": hash_password(password)}})
            ids[u["username"]] = existing["id"]
        else:
            user = User(**u)
            await db.users.insert_one({**user.model_dump(), "password_hash": hash_password(password)})
            ids[u["username"]] = user.id
        u["password_env"] = env_key
    # team mapping: Mumbai backoffice also covers the Delhi agent
    await db.users.update_one({"username": "bo2001"}, {"$set": {"assigned_agent_ids": [ids["agt1002"]]}})
    return ids


SAMPLES = [
    ("Motor", "ICICI Lombard General Insurance", "Private Car Package Policy"),
    ("Motor", "Bajaj Allianz General Insurance", "Two Wheeler Package Policy"),
    ("Health", "Star Health and Allied Insurance", "Family Health Optima"),
    ("Health", "HDFC ERGO General Insurance", "Optima Secure"),
    ("Fire", "New India Assurance", "Bharat Sookshma Udyam Suraksha"),
    ("Motor", "Tata AIG General Insurance", "Auto Secure Private Car"),
    ("Marine", "The Oriental Insurance", "Marine Cargo Open Policy"),
    ("Travel", "Care Health Insurance", "Explore Travel Insurance"),
]
NAMES = ["Rahul Kapoor", "Anita Joshi", "Vikram Singh", "Meera Nair", "Suresh Patil", "Kavya Reddy", "Arjun Malhotra", "Neha Gupta", "Imran Khan", "Pooja Shah", "Deepak Rao", "Ritu Bansal"]
STATUSES = ["verified", "verified", "verified", "extracted", "flagged", "verified", "extracted", "verified"]


async def seed_policies(ids: dict) -> int:
    await db.policies.delete_many({"seeded": True})
    rnd = random.Random(42)
    agents = [("agt1001", "Priya Sharma", "Mumbai"), ("agt1002", "Rohit Verma", "Delhi"), ("agt1003", "Sneha Iyer", "Chennai")]
    docs = []
    for i in range(18):
        lob, insurer, product = SAMPLES[i % len(SAMPLES)]
        code, agent_name, branch = agents[i % 3]
        created = now_utc() - timedelta(days=rnd.randint(0, 45), hours=rnd.randint(0, 20))
        start = (created + timedelta(days=1)).date()
        net = float(rnd.choice([3200, 5400, 8900, 12500, 18750, 24300, 41200, 76500]))
        gst = round(net * 0.18, 2)
        f = PolicyFields(
            policy_number=f"{insurer.split()[0][:3].upper()}/{lob[:2].upper()}/{240000 + i * 137}",
            insurer=insurer, lob=lob, product_name=product,
            insured_name=NAMES[i % len(NAMES)], mobile=f"98{rnd.randint(10000000, 99999999)}",
            start_date=start.isoformat(), end_date=(start + timedelta(days=364)).isoformat(),
            sum_insured=float(rnd.choice([300000, 500000, 1000000, 2500000])),
            net_premium=net, gst=gst, gross_premium=round(net + gst, 2),
        )
        if lob == "Motor":
            state = {"Mumbai": "MH", "Delhi": "DL", "Chennai": "TN"}[branch]
            f.vehicle_reg_no = f"{state}{rnd.randint(1, 20):02d}{rnd.choice(['AB', 'CK', 'DZ'])}{rnd.randint(1000, 9999)}"
            make, model, cc, seats, gvw, vclass = rnd.choice([
                ("Maruti Suzuki", "Swift VXI", 1197, 5, None, "Private Car"), ("Hyundai", "Creta SX", 1497, 5, None, "Private Car"),
                ("Honda", "Activa 6G", 109, 2, None, "Two Wheeler"), ("Tata", "Nexon XZ+", 1199, 5, None, "Private Car"),
                ("Tata", "Ace Gold", 694, 2, 1615, "Goods Carrying"), ("Ashok Leyland", "Dost+", 1478, 2, 2860, "Goods Carrying"),
                ("Force", "Traveller 26", 2596, 26, None, "Passenger Carrying"),
            ])
            f.make, f.model, f.cc, f.seating_capacity, f.gvw = make, model, float(cc), float(seats), (float(gvw) if gvw else None)
            f.vehicle_class = vclass
            f.cover_type = "Liability Only" if i % 4 == 1 else "Package"
            f.addon_premium = round(net * 0.12, 2)
            mfg = rnd.choice([2022, 2020, 2018, 2016, 2013, 2011])
            f.mfg_year = str(mfg)
            f.registration_date = f"{mfg}-{rnd.randint(1, 12):02d}-15"
            f.idv = float(rnd.choice([65000, 420000, 780000, 1150000]))
            f.tp_premium = 2094.0 if not f.gvw else 16049.0
            f.od_premium = round(max(net - f.tp_premium, 0), 2)
            f.ncb_percent = float(rnd.choice([0, 20, 25, 35, 45]))
        if lob == "Health":
            f.plan_name = "Floater - Gold"
            f.members_covered = "Self (38), Spouse (35), Son (8)"
            f.deductible = 0.0
        f = PolicyFields(**f.model_dump())  # re-validate so RTO / vehicle age are derived
        status = STATUSES[i % len(STATUSES)]
        p = Policy(
            status=status, agent_id=ids[code], agent_name=agent_name, agent_code=code.upper(), branch=branch,
            uploaded_by_id=ids[code], uploaded_by_name=agent_name, fields=f,
            confidence={k: round(rnd.uniform(0.72, 0.99), 2) for k, v in f.model_dump().items() if v is not None},
            flag_reason="Gross premium does not match payment receipt" if status == "flagged" else None,
            verified_by_name="Kunal Desai" if status == "verified" else None,
            verified_at=created + timedelta(hours=6) if status == "verified" else None,
            created_at=created, updated_at=created,
            history=[HistoryEntry(at=created, by_name=agent_name, by_role="agent", action="Uploaded", note="Seeded sample record")],
        )
        mode = ["Cash", "Online", "Partial Payment", "Cheque", "Partial Payment", "Online"][i % 6]
        p.payment_mode = mode
        p.fields.intermediary_name = "GI MIS Insurance Brokers Pvt Ltd"
        if mode == "Partial Payment":
            p.payments = [PaymentEntry(amount=round((p.fields.gross_premium or 0) * 0.4, 2), reference="Seed advance", paid_on=created.date().isoformat(), recorded_by_name=agent_name)]
        docs.append({**p.to_doc(), "seeded": True})
    await db.policies.insert_many(docs)
    return len(docs)


async def migrate_uploaded() -> int:
    """Split legacy make_model into make/model and persist derived RTO + vehicle age on uploaded records."""
    n = 0
    async for d in db.policies.find({"seeded": {"$ne": True}}, {"_id": 0, "id": 1, "fields": 1}):
        f = dict(d.get("fields") or {})
        legacy = f.pop("make_model", None)
        if legacy and not f.get("make"):
            parts = legacy.split(" ", 1)
            f["make"], f["model"] = parts[0], (parts[1] if len(parts) > 1 else None)
        await db.policies.update_one({"id": d["id"]}, {"$set": {"fields": PolicyFields(**f).model_dump()}})
        n += 1
    return n


async def main():
    await ensure_indexes()
    ids = await upsert_users()
    # live mode: demo policies are no longer seeded (pass --demo to load them for local testing only)
    import sys
    n = await seed_policies(ids) if "--demo" in sys.argv else 0
    m = await migrate_uploaded()
    print(f"Seeded {len(ids)} users and {n} sample policies; migrated {m} uploaded records")


if __name__ == "__main__":
    asyncio.run(main())
