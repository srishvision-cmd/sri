"""Criterion: GCV 3W goods carrying product derivation.

A Goods Carrying policy with product_name containing 'Three Wheeler' derives
fields.product_category == 'GCV - 3W Goods Carrying' (via GET /api/policies/{id}); a normal
truck (model 'LPT 1613') stays 'GCV'.
"""
from ._commission_helpers import (
    admin_client, create_agent, delete_policy, delete_user, insert_policy,
)


def test_gcv_3w_goods_carrying_derivation():
    admin = admin_client()
    agent = create_agent(admin)
    policy_ids = []
    try:
        three_w_id = insert_policy(
            agent, insurer="Generic Insurer", vehicle_class="Goods Carrying", cover_type="Package",
            product_category=None, product_name="Commercial Vehicle Three Wheeler Goods Carrying",
        )
        policy_ids.append(three_w_id)
        truck_id = insert_policy(
            agent, insurer="Generic Insurer", vehicle_class="Goods Carrying", cover_type="Package",
            product_category=None, model="LPT 1613",
        )
        policy_ids.append(truck_id)

        r_3w = admin.get(f"/policies/{three_w_id}")
        assert r_3w.status_code == 200, r_3w.text
        fields_3w = r_3w.json()["fields"]
        assert fields_3w["product_category"] == "GCV - 3W Goods Carrying", f"expected GCV - 3W Goods Carrying, got {fields_3w['product_category']}"

        r_truck = admin.get(f"/policies/{truck_id}")
        assert r_truck.status_code == 200, r_truck.text
        fields_truck = r_truck.json()["fields"]
        assert fields_truck["product_category"] == "GCV", f"expected GCV for normal truck, got {fields_truck['product_category']}"
    finally:
        for pid in policy_ids:
            delete_policy(pid)
        delete_user(agent["username"])
