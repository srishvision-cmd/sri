"""Pure-function checks for routers.portals: _find_otp extraction and clean_host sanitising.

These import the router module directly (no DB, no network) — safe to unit-test in-process.
"""
from routers.portals import _find_otp, clean_host

ICICI_BODY = ("Dear RAJA, Your OTP to verify your Email id for your IM-2372208-006 "
              "ICICI Lombard login is 442109. Please note this OTP is valid for 2 hrs.")


def test_find_otp_icici_body_not_account_id():
    assert _find_otp("Email Verification", ICICI_BODY) == "442109"


def test_find_otp_is_your_one_time_password():
    assert _find_otp("", "Dear user, 482913 is your one time password") == "482913"


def test_find_otp_verification_code_with_ref():
    assert _find_otp("", "Your verification code is 7712. Ref 2026") == "7712"


def test_clean_host_strips_embedded_url_keeps_other_host():
    assert clean_host("imap.gmail.com/https://glory.herosite.pro", "a@protech.in") == "glory.herosite.pro"


def test_clean_host_strips_scheme_and_path():
    assert clean_host("https://glory.herosite.pro/roundcube", "a@b.in") == "glory.herosite.pro"


def test_clean_host_blank_gmail_defaults():
    assert clean_host("", "x@gmail.com") == "imap.gmail.com"
