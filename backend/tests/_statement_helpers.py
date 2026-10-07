"""Shared helpers for commission-statement test files: build a tscheck agent with one
commission-earning policy (payable > 0 via a receivable+payable rule pair) and one Cash
policy with outstanding premium, both created "today" so the default daily/weekly/monthly
statement picks them up.
"""
from datetime import datetime, timezone

import httpx

from ._commission_helpers import (
    DB, admin_client, create_agent, create_broker, delete_broker, delete_policy, delete_rule,
    delete_user, insert_policy, rule_body, uniq,
)


def set_payment_mode(policy_id: str, mode: str) -> None:
    if DB is not None:
        DB.policies.update_one({"id": policy_id}, {"$set": {"payment_mode": mode}})


def fix_created_at_type(policy_id: str) -> None:
    """insert_policy stores created_at as an ISO string (fine for most tests), but the
    statements endpoint filters created_at with a real BSON datetime range — convert the
    fixture's created_at to an actual datetime so the policy falls inside the statement period."""
    if DB is not None:
        DB.policies.update_one({"id": policy_id}, {"$set": {"created_at": datetime.now(timezone.utc)}})


def delete_statement(statement_id: str) -> None:
    if DB is not None:
        DB.commission_statements.delete_one({"id": statement_id})


def build_scenario(admin: httpx.Client) -> dict:
    """Returns dict with agent, rule_ids[], broker, pid_commission, pid_cash, expected_payable."""
    insurer = uniq("insurer")
    broker = create_broker(admin)
    agent = create_agent(admin, broker_id=broker["id"])
    rule_ids = []

    rec = admin.post("/commission/rules", json=rule_body(
        "receivable", uniq("rec"), insurer=insurer, broker_id=broker["id"],
        products=["Private Car Package"], od_percent=20, tp_percent=2.5,
    ))
    assert rec.status_code == 200, rec.text
    rule_ids.append(rec.json()["id"])

    pay = admin.post("/commission/rules", json=rule_body(
        "payable", uniq("pay"), insurer=insurer, broker_id=broker["id"],
        products=["Private Car Package"], od_percent=15, tp_percent=2,
    ))
    assert pay.status_code == 200, pay.text
    rule_ids.append(pay.json()["id"])

    pid_commission = insert_policy(agent, insurer=insurer, broker_id=broker["id"], od_premium=10000, tp_premium=3000,
                                    product_category="Private Car Package")
    fix_created_at_type(pid_commission)
    pid_cash = insert_policy(agent, insurer=uniq("insurer"), od_premium=1500, tp_premium=0)
    set_payment_mode(pid_cash, "Cash")
    fix_created_at_type(pid_cash)

    return {
        "agent": agent, "broker": broker, "rule_ids": rule_ids, "insurer": insurer,
        "pid_commission": pid_commission, "pid_cash": pid_cash, "expected_payable": 1560.0,
        "expected_cash_outstanding": 1500.0,
    }


def teardown_scenario(scenario: dict) -> None:
    for pid in (scenario.get("pid_commission"), scenario.get("pid_cash")):
        if pid:
            delete_policy(pid)
    for rid in scenario.get("rule_ids", []):
        delete_rule(rid)
    delete_user(scenario["agent"]["username"])
    delete_broker(scenario["broker"]["id"])
