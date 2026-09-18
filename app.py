"""
app.py — Flask bridge + auth gate + settings API.

    python app.py                    # http://127.0.0.1:5057, auth off (local dev)
    FIREBASE_PROJECT_ID=... SUPERADMIN_EMAIL=... python app.py     # gated

Every /api route except /api/health and /api/config requires a verified
Firebase ID token belonging to SUPERADMIN_EMAIL. See auth.py.
"""

import os
import traceback

from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

import auth
import data_source as ds
import indicators as ind
import optionchain as oc
import settings as app_settings

# static_url_path="" so the page can use RELATIVE asset paths and therefore
# also works unchanged from a GitHub Pages subpath.
app = Flask(__name__, static_folder="static", static_url_path="")

# Allow a separately-hosted frontend (Firebase Hosting / GitHub Pages) to call
# this backend. Same-origin deployments need none of this.
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()
]


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


# ------------------------------------------------------------------ public ---

@app.get("/api/health")
def api_health():
    """Public. Also reports which optional pieces actually loaded, so a broken
    dependency in a deploy is visible without signing in."""
    try:
        patterns = len(ind.pattern_catalog())
    except Exception:
        patterns = 0
    # Whether settings survive a restart. Not a secret, and the one thing you
    # need to know when a broker connection keeps vanishing.
    try:
        persistent = app_settings.public_view().get("persistent", False)
    except Exception:
        persistent = False
    return jsonify({
        "ok": True,
        "sources": [s["key"] for s in ds.all_sources()],
        "candlestickPatterns": patterns,
        "settingsPersist": persistent,
    })


@app.get("/api/config")
def api_config():
    """What the frontend needs before anyone has signed in."""
    return jsonify({
        "authEnabled": auth.enabled(),
        "firebase": auth.web_config(),
    })


@app.get("/api/sources")
@auth.require_admin
def api_sources_with_default():
    return jsonify({
        "sources": ds.all_sources(),
        "defaultSource": app_settings.public_view().get("defaultSource") or "",
    })


# --------------------------------------------------------------- market data ---

@app.get("/api/symbols")
@auth.require_admin
def api_symbols():
    src = ds.get_source(request.args["source"])
    return jsonify({"symbols": src.search(request.args.get("q", ""))})


@app.get("/api/candles")
@auth.require_admin
def api_candles():
    src = ds.get_source(request.args["source"])
    symbol = request.args["symbol"]
    timeframe = request.args.get("timeframe", src.default_timeframe)
    limit = max(2, min(int(request.args.get("limit", 500)), 5000))
    spec = request.args.get("indicators", "")

    candles = src.candles(symbol, timeframe, limit)
    lines, overlays, markers = [], [], []
    if spec:
        # Indicators are computed over the FULL history the source can give us,
        # not just the slice being returned. A 200-period SMA needs 200 bars
        # even when the browser is only topping up the last 10, so ask for a
        # deep window and trim each series to match.
        deep = src.candles(symbol, timeframe, max(limit, 1200))
        lines = ind.compute(deep, spec, tail=len(candles))
        # Volume Profile and FVG describe the whole window, not the last bar,
        # so they are always computed over the deep history and sent whole.
        overlays = ind.compute_overlays(deep, spec)
        markers = ind.compute_markers(deep, spec)

    return jsonify({
        "source": src.key,
        "symbol": symbol,
        "timeframe": timeframe,
        "tzOffsetMin": src.display_tz_offset_min,
        "candles": candles,
        "indicators": lines,
        "overlays": overlays,
        "markers": markers,
    })


@app.get("/api/indicators")
@auth.require_admin
def api_indicators():
    """The indicator catalog.

    Returns everything pandas-ta offers that actually works, each flagged
    `curated` or not. The fx menu shows the user's chosen subset; Settings
    lets them pick from the whole list."""
    return jsonify({"indicators": ind.full_catalog() + ind.overlay_catalog()
                                  + ind.pattern_catalog()})


@app.get("/api/quotes")
@auth.require_admin
def api_quotes():
    src = ds.get_source(request.args["source"])
    symbols = [s for s in request.args.get("symbols", "").split(",") if s]
    if not symbols:
        return jsonify({"quotes": {}})
    return jsonify({"source": src.key, "quotes": src.quotes(symbols)})


# -------------------------------------------------------------- option chain ---

@app.get("/api/optionchain/underlyings")
@auth.require_admin
def api_oc_underlyings():
    """Every name with listed options. Comes from Kite's public instrument
    dump, so it works before the broker session is authenticated."""
    return jsonify({"underlyings": oc.underlyings()})


@app.get("/api/optionchain")
@auth.require_admin
def api_oc_chain():
    underlying = (request.args.get("underlying") or "NIFTY").upper()
    expiry = request.args.get("expiry") or None
    around = max(5, min(int(request.args.get("around", 20)), 60))
    center = request.args.get("center")
    center = float(center) if center else None
    return jsonify(oc.chain(underlying, expiry, around, center))


# ------------------------------------------------------------------ settings ---

@app.get("/api/settings")
@auth.require_admin
def api_settings_get():
    view = app_settings.public_view()
    view["user"] = g.get("user_email")
    view["sources"] = [s["key"] for s in ds.all_sources()]
    return jsonify(view)


@app.post("/api/settings/default-source")
@auth.require_admin
def api_settings_default_source():
    """Which feed new charts open on."""
    body = request.get_json(silent=True) or {}
    key = (body.get("source") or "").strip()
    known = [s["key"] for s in ds.all_sources()]
    if key and key not in known:
        return jsonify({"error": f"unknown source '{key}'"}), 400
    app_settings.update(default_source=key)
    return jsonify(app_settings.public_view())


@app.post("/api/settings/kite")
@auth.require_admin
def api_settings_kite_save():
    """Save the Kite app credentials (api_key / api_secret)."""
    body = request.get_json(silent=True) or {}
    api_key = (body.get("apiKey") or "").strip()
    api_secret = (body.get("apiSecret") or "").strip()
    if not api_key:
        return jsonify({"error": "API key is required"}), 400

    fields = {"kite_api_key": api_key}
    if api_secret:                       # blank means "keep the stored one"
        fields["kite_api_secret"] = api_secret
    app_settings.update(**fields)
    ds.cache_drop("kite:")
    ds.configure_zerodha()
    return jsonify(app_settings.public_view())


@app.get("/api/settings/kite/login-url")
@auth.require_admin
def api_settings_kite_login_url():
    cfg = app_settings.kite_credentials()
    if not cfg["api_key"]:
        return jsonify({"error": "Save your Kite API key first"}), 400
    from kiteconnect import KiteConnect

    return jsonify({"loginUrl": KiteConnect(api_key=cfg["api_key"]).login_url()})


@app.post("/api/settings/kite/connect")
@auth.require_admin
def api_settings_kite_connect():
    """Exchange a request_token for an access token and switch the source on."""
    import time

    body = request.get_json(silent=True) or {}
    request_token = (body.get("requestToken") or "").strip()
    if not request_token:
        return jsonify({"error": "request_token is required"}), 400

    cfg = app_settings.kite_credentials()
    if not (cfg["api_key"] and cfg["api_secret"]):
        return jsonify({"error": "Save your Kite API key and secret first"}), 400

    from kiteconnect import KiteConnect

    kite = KiteConnect(api_key=cfg["api_key"])
    data = kite.generate_session(request_token, api_secret=cfg["api_secret"])

    ds.kite_stop_ticker()
    app_settings.update(
        kite_access_token=data["access_token"],
        kite_connected_at=int(time.time()),
        kite_user=data.get("user_name") or data.get("user_id") or "",
    )
    ds.cache_drop("kite:")
    ds.configure_zerodha()
    return jsonify(app_settings.public_view())


@app.post("/api/settings/kite/disconnect")
@auth.require_admin
def api_settings_kite_disconnect():
    ds.kite_stop_ticker()
    app_settings.update(kite_access_token="", kite_connected_at=0, kite_user="")
    ds.configure_zerodha()
    return jsonify(app_settings.public_view())


# -------------------------------------------------------------------- plumbing ---

@app.after_request
def finish(resp):
    origin = request.headers.get("Origin")
    if origin and origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/api/<path:_any>", methods=["OPTIONS"])
def api_preflight(_any):
    return ("", 204)


@app.errorhandler(Exception)
def on_error(exc):
    if isinstance(exc, HTTPException):
        return jsonify({"error": exc.description}), exc.code
    if isinstance(exc, KeyError):
        return jsonify({"error": f"missing or unknown parameter: {exc}"}), 400
    app.logger.error("api error: %s\n%s", exc, traceback.format_exc())
    return jsonify({"error": str(exc) or exc.__class__.__name__}), 500


def _boot_banner(port):
    print(f"\n  Trading dashboard  ->  http://127.0.0.1:{port}")
    if auth.enabled():
        allowed = ", ".join(sorted(auth.SUPERADMIN_EMAILS))
        print(f"  Auth: ON  — {len(auth.SUPERADMIN_EMAILS)} account(s) may sign in: {allowed}")
    else:
        print("  Auth: OFF — anyone who can reach this port has full access.")
        print("        Set FIREBASE_PROJECT_ID and SUPERADMIN_EMAIL before exposing it.")
    print(f"  Sources: {', '.join(s['key'] for s in ds.all_sources())}\n")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5057))
    host = os.environ.get("HOST", "127.0.0.1")
    _boot_banner(port)
    app.run(host=host, port=port, debug=bool(os.environ.get("DEBUG")), threaded=True)
