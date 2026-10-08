"""Encrypt stored third-party passwords (insurer portals, OTP mailbox) with a key derived from JWT_SECRET."""
import base64
import logging
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(("secretbox:" + os.environ["JWT_SECRET"]).encode()).digest()))


def seal(plain: str) -> str:
    return _fernet.encrypt(plain.encode()).decode()


def unseal(token: str) -> str:
    try:
        return _fernet.decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        logging.getLogger("secretbox").warning("Could not decrypt a stored secret (JWT_SECRET changed?) — re-save it")
        return ""
