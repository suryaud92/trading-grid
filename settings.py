"""
settings.py — server-side settings store.

Broker credentials live HERE, on the server, never in the browser and never in
git. A Kite access token can place orders on your account, so the UI only ever
sees a masked version and a connection status.

Storage is a single JSON file, chmod 600:
    instance/settings.json          (override with SETTINGS_FILE)

On a container host with an ephemeral disk (Render free, HF Spaces) the file is
wiped on redeploy, which means reconnecting Kite from Settings — the token dies
daily anyway. Set KITE_API_KEY / KITE_API_SECRET as env vars to survive that;
env values are used as defaults and the UI still owns the access token.
"""

from __future__ import annotations

import json
import os
import threading
import time

SETTINGS_FILE = os.environ.get(
    "SETTINGS_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "instance", "settings.json"),
)

_lock = threading.RLock()
_cache: dict | None = None

_DEFAULTS = {
    "kite_api_key": "",
    "kite_api_secret": "",
    "kite_access_token": "",
    "kite_connected_at": 0,
    "kite_user": "",
}


def _read() -> dict:
    global _cache
    with _lock:
        if _cache is None:
            data = dict(_DEFAULTS)
            try:
                with open(SETTINGS_FILE) as fh:
                    data.update(json.load(fh))
            except FileNotFoundError:
                pass
            except Exception as err:
                print(f"[settings] {SETTINGS_FILE} unreadable ({err}); using defaults")
            # env vars seed the app credentials but never the access token
            data["kite_api_key"] = data["kite_api_key"] or os.environ.get("KITE_API_KEY", "")
            data["kite_api_secret"] = (
                data["kite_api_secret"] or os.environ.get("KITE_API_SECRET", "")
            )
            _cache = data
        return dict(_cache)


def _write(data: dict) -> None:
    global _cache
    with _lock:
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        tmp = SETTINGS_FILE + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, SETTINGS_FILE)
        try:
            os.chmod(SETTINGS_FILE, 0o600)
        except OSError:
            pass
        _cache = dict(data)


def update(**fields) -> dict:
    data = _read()
    data.update(fields)
    _write(data)
    return data


def kite_credentials() -> dict:
    d = _read()
    return {
        "api_key": d["kite_api_key"],
        "api_secret": d["kite_api_secret"],
        "access_token": d["kite_access_token"],
    }


def _mask(value: str) -> str:
    if not value:
        return ""
    return value[:4] + "•" * 8 + value[-2:] if len(value) > 8 else "•" * len(value)


def public_view() -> dict:
    """What the Settings screen is allowed to see. No raw secrets."""
    d = _read()
    connected = bool(d["kite_api_key"] and d["kite_access_token"])
    age_h = (time.time() - d["kite_connected_at"]) / 3600 if d["kite_connected_at"] else None
    return {
        "kite": {
            "apiKey": d["kite_api_key"],                   # not secret; it's in the login URL
            "apiSecretSet": bool(d["kite_api_secret"]),
            "apiSecretMasked": _mask(d["kite_api_secret"]),
            "accessTokenMasked": _mask(d["kite_access_token"]),
            "connected": connected,
            "connectedAt": d["kite_connected_at"] or None,
            "connectedHoursAgo": round(age_h, 1) if age_h is not None else None,
            "user": d["kite_user"],
            "envManaged": {
                "apiKey": bool(os.environ.get("KITE_API_KEY")),
                "apiSecret": bool(os.environ.get("KITE_API_SECRET")),
            },
        }
    }
