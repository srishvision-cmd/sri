"""Criterion: insurer family matching keeps different companies apart.

routers.insurers.same_family: True for the ICICI Lombard / TATA AIG spelling variants, False
for HDFC ERGO vs HDFC ERGO Health, Bajaj Allianz General vs Life, ICICI Lombard vs ICICI
Prudential; families([...]) keeps the Health name in its own group.
"""
from routers.insurers import families, same_family


def test_same_family_true_for_spelling_variants():
    assert same_family("ICICI Lombard", "ICICI Lombard General Insurance Company Limited") is True
    assert same_family("ICICI Lombard General Insurance", "ICICI Lombard General Insurance Compan") is True
    assert same_family("TATA AIG GENERAL INSURANCE COMPANY LIMITED", "TATA AIG General Insurance") is True


def test_same_family_false_for_different_companies():
    assert same_family("HDFC ERGO", "HDFC ERGO Health") is False
    assert same_family("Bajaj Allianz General", "Bajaj Allianz Life") is False
    assert same_family("ICICI Lombard", "ICICI Prudential") is False


def test_families_keeps_health_name_in_its_own_group():
    groups = families(["HDFC ERGO", "HDFC ERGO General Insurance", "HDFC ERGO Health Insurance"])
    assert len(groups) == 2
    health_group = next(g for g in groups if any("Health" in n for n in g))
    other_group = next(g for g in groups if g is not health_group)
    assert "HDFC ERGO Health Insurance" in health_group
    assert all("Health" not in n for n in other_group)
    assert set(other_group) == {"HDFC ERGO", "HDFC ERGO General Insurance"}
