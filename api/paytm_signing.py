"""Signing and verification for the Paytm rail, in one place for both sides of it.

**`PaytmChecksum.verifySignature` raises on a malformed checksum rather than returning False.**
It decrypts the value before comparing, so anything that is not a well formed, correctly padded
ciphertext raises `ValueError` out of the crypto layer. Called directly from a route, that turns a
tampered callback into a 500 and an unhandled traceback instead of a refusal, which is the opposite
of what a signature check is for. Every caller goes through `verify` below, which treats any
failure to verify as a failure to verify.

The key is read at call time rather than import time so that switching rails, or filling in
credentials after the process has started, does not require a restart.
"""

from __future__ import annotations

import json
import os
from typing import Any

from paytmchecksum import PaytmChecksum

# Used only when no Paytm key is configured, so the simulated rail works with no credentials at
# all. It is not a secret, and it can never authenticate anything against Paytm.
DEV_KEY = "trustgate-simulated-merchant-key"


def merchant_key() -> str:
    """The key to sign with, which depends on the rail rather than on what happens to be set.

    The simulated rail always uses the development key, even when real Paytm credentials are
    configured. Otherwise filling in `.env` silently breaks the simulator: the application picks up
    the new key immediately while the already running simulator process is still holding the old
    one, and every signature stops matching for no visible reason.
    """

    if os.getenv("PAYTM_RAIL") == "staging":
        return os.getenv("PAYTM_MERCHANT_KEY", "")
    return DEV_KEY


def canonical(body: dict[str, Any]) -> str:
    """The exact bytes that get signed. Both sides must agree on this, so it lives here."""

    return json.dumps(body, separators=(",", ":"))


def sign(body: dict[str, Any]) -> str:
    return str(PaytmChecksum.generateSignature(canonical(body), merchant_key()))


def sign_params(params: dict[str, str]) -> str:
    """Sign the form-encoded shape Paytm uses for its browser callback."""

    return str(
        PaytmChecksum.generateSignature(PaytmChecksum.getStringByParams(params), merchant_key())
    )


def verify(payload: str, signature: str) -> bool:
    """True only when the signature checks out. Never raises, whatever it is handed."""

    if not signature:
        return False
    try:
        return bool(PaytmChecksum.verifySignature(payload, merchant_key(), signature))
    except Exception:
        # Deliberately broad. Anything that goes wrong while checking a signature means the
        # signature did not check out, and the caller must not have to know how it failed.
        return False


def verify_body(body: dict[str, Any], signature: str) -> bool:
    return verify(canonical(body), signature)


def verify_params(params: dict[str, str], signature: str) -> bool:
    return verify(PaytmChecksum.getStringByParams(params), signature)
