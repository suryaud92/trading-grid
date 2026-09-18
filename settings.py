"""
settings.py — server-side settings store.

Broker credentials live HERE, on the server, never in the browser and never in
git. A Kite access token can place orders on your account, so the UI only ever
sees a masked version and a connection status.

Two backends, chosen automatically:

* **Firestore**, when FIREBASE_SERVICE_ACCOUNT holds a service-account JSON.
  Survives restarts and redeploys, so a connection made on your phone is
  already there on your laptop, and your API key and secret are entered once
  rather than after every deploy.
* **A local JSON file** otherwise (instance/settings.json, chmod 600) — fine
  for localhost, but on a host with an ephemeral disk like Render's free tier
  it is wiped on every restart, which is exactly what made Kite look
  device-specific when it never was.

Env vars KITE_API_KEY / KITE_API_SECRET still act as defaults either way.
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
_store = None            # a Firestore document handle, or None for file mode
_store_checked = False
_store_error = ""        # why Firestore is not in use, for diagnostics


def _firestore():
    """The settings document, or None if Firestore is not configured.

    Resolved once: if the credentials are missing or wrong we fall back to the
    file rather than failing every read, because losing the broker connection
    is worse than losing persistence.
    """
    global _store, _store_checked
    if _store_checked:
        return _store
    _store_checked = True

    global _store_error
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not raw:
        _store_error = "FIREBASE_SERVICE_ACCOUNT is not set on this server"
        return None
    try:
        from google.cloud import firestore
        from google.oauth2 import service_account

        info = json.loads(raw)
        creds = service_account.Credentials.from_service_account_info(info)
        client = firestore.Client(project=info.get("project_id"), credentials=creds)
        _store = client.collection("tradingGrid").document("settings")
        _store.get()                     # fail fast if the key is wrong
        print("[settings] using Firestore — settings persist across restarts")
    except Exception as err:
        _store_error = f"{type(err).__name__}: {err}"[:300]
        print(f"[settings] Firestore unavailable ({_store_error}); "
              "falling back to the local file")
        _store = None
    return _store


def store_status():
    """(persistent, reason) — safe to expose; it names no credential."""
    doc = _firestore()
    return (doc is not None), ("" if doc is not None else _store_error)

_DEFAULTS = {
    "default_source": "",          # which feed new charts open on
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
            doc = _firestore()
            if doc is not None:
                try:
                    snap = doc.get()
                    if snap.exists:
                        data.update(snap.to_dict() or {})
                except Exception as err:
                    print(f"[settings] Firestore read failed ({err}); using defaults")
            else:
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
        doc = _firestore()
        if doc is not None:
            try:
                doc.set(data)
            except Exception as err:
                print(f"[settings] Firestore write failed ({err}); writing the file too")
                doc = None
        if doc is None:
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
        "persistent": _firestore() is not None,
        "defaultSource": d.get("default_source") or "",
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
