"""
auth.py — Google sign-in gate. One superadmin email, enforced on the server.

The frontend signs in with Firebase Auth and sends the resulting ID token as
`Authorization: Bearer <token>` on every /api call. This module verifies that
token's signature against Google's public keys and checks three things:

    * signed by Google, not expired
    * `aud` / `iss` match YOUR Firebase project (so a token minted for some
      other project is rejected)
    * email is in SUPERADMIN_EMAIL (one address, or a comma-separated list)

Verifying server-side is the part that matters. Hiding the UI in JavaScript
stops nobody — anyone can read a static bundle and call the API directly, so
the API is what has to say no.

Config (env):
    FIREBASE_PROJECT_ID=my-project
    SUPERADMIN_EMAIL=you@gmail.com            one address, or several:
    SUPERADMIN_EMAIL=you@gmail.com,partner@gmail.com
    FIREBASE_WEB_CONFIG={"apiKey":"...","authDomain":"...","projectId":"..."}

Everyone listed gets the same access, including the Settings screen.

Leave FIREBASE_PROJECT_ID unset and auth is OFF — the app runs open, which is
what you want on localhost. It refuses to start open if PUBLIC=1 is not set
and a non-loopback host is configured.
"""

from __future__ import annotations

import functools
import json
import os
import threading
import time

import jwt
import requests
from flask import g, jsonify, request

CERT_URL = ("https://www.googleapis.com/robot/v1/metadata/x509/"
            "securetoken@system.gserviceaccount.com")

PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "").strip()

# One address or a comma-separated list. Commas, semicolons and stray spaces
# are all tolerated so a copy-pasted list doesn't lock you out.
SUPERADMIN_EMAILS = {
    e.strip().lower()
    for e in os.environ.get("SUPERADMIN_EMAIL", "").replace(";", ",").split(",")
    if e.strip()
}

_certs: dict = {}
_certs_at = 0.0
_certs_lock = threading.Lock()


def enabled() -> bool:
    return bool(PROJECT_ID and SUPERADMIN_EMAILS)


def web_config() -> dict:
    try:
        return json.loads(os.environ.get("FIREBASE_WEB_CONFIG", "") or "{}")
    except json.JSONDecodeError:
        print("[auth] FIREBASE_WEB_CONFIG is not valid JSON — ignoring")
        return {}


def _google_certs() -> dict:
    """Google's signing certs, refreshed hourly."""
    global _certs, _certs_at
    with _certs_lock:
        if _certs and time.time() - _certs_at < 3600:
            return _certs
    resp = requests.get(CERT_URL, timeout=10)
    resp.raise_for_status()
    with _certs_lock:
        _certs = resp.json()
        _certs_at = time.time()
        return _certs


def verify_token(id_token: str) -> dict:
    """Return the token's claims, or raise ValueError."""
    from cryptography.x509 import load_pem_x509_certificate

    try:
        kid = jwt.get_unverified_header(id_token).get("kid")
    except jwt.PyJWTError as err:
        raise ValueError(f"malformed token: {err}") from err

    certs = _google_certs()
    if kid not in certs:
        _certs.clear()                      # key rotated — refetch once
        certs = _google_certs()
    if kid not in certs:
        raise ValueError("token signed with an unknown key")

    public_key = load_pem_x509_certificate(certs[kid].encode()).public_key()
    try:
        claims = jwt.decode(
            id_token,
            public_key,
            algorithms=["RS256"],
            audience=PROJECT_ID,
            issuer=f"https://securetoken.google.com/{PROJECT_ID}",
        )
    except jwt.ExpiredSignatureError:
        raise ValueError("token expired") from None
    except jwt.PyJWTError as err:
        raise ValueError(f"token rejected: {err}") from err

    email = (claims.get("email") or "").lower()
    if not email:
        raise ValueError("token carries no email")
    if not claims.get("email_verified"):
        raise ValueError("email is not verified")
    if email not in SUPERADMIN_EMAILS:
        raise ValueError(f"{email} is not authorised for this app")
    return claims


def require_admin(view):
    """Gate a Flask view. A no-op when auth is disabled (local dev)."""

    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        if not enabled():
            g.user_email = "local-dev"
            return view(*args, **kwargs)

        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "sign-in required", "code": "unauthenticated"}), 401
        try:
            claims = verify_token(header[7:].strip())
        except ValueError as err:
            return jsonify({"error": str(err), "code": "forbidden"}), 403
        g.user_email = claims.get("email")
        return view(*args, **kwargs)

    return wrapper
