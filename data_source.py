"""
data_source.py — the ONE file you touch to plug in a new broker/feed.

Registered today:
    yfinance   NSE/BSE via Yahoo, free, delayed          — always on
    zerodha    Kite Connect, real ticks                  — on once configured in Settings

=============================================================================
HOW TO ADD A NEW BROKER (Alpaca / Upstox / Polygon / ...)
=============================================================================
Call `register_source(...)` once and give it a `candles` function. Flask, the
grid, the dropdowns and the ticker bar pick it up automatically.

    def upstox_candles(symbol, timeframe, limit):
        r = requests.get(f"https://api.upstox.com/v2/historical-candle/{symbol}/...")
        return [{"time": ..., "open": ..., "high": ...,
                 "low": ..., "close": ..., "volume": ...} for c in r.json()["data"]]

    register_source(key="upstox", label="Upstox",
                    timeframes=["1m", "5m", "1d"],
                    symbols=[{"symbol": "NSE_EQ|INE002A01018", "label": "Reliance"}],
                    candles=upstox_candles)

CONTRACTS
---------
candles(symbol, timeframe, limit) -> list, ASCENDING by time:
    {"time": <epoch seconds, int>, "open","high","low","close","volume": float}
quotes(symbols)  -> {symbol: {"price": float, "time": epoch_seconds}}   [optional]
search(query)    -> [{"symbol","label"}]                                [optional]
stream           -> how the BROWSER gets ticks:
    {"kind": "poll", "interval_ms": 4000, "refresh_ms": 60000}   GET /api/quotes
    Native browser websockets are possible too — add a `case` in
    static/js/feeds.js. (Note: Kite's socket can't be used from the browser;
    its REST API sends no CORS headers and the token must stay server-side.)
=============================================================================
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

import requests

import settings as app_settings

# --------------------------------------------------------------------------
# Expected failures
#
# A symbol that does not exist, or a broker that is not connected, is not a
# server fault. Raising plain exceptions made both come back as 500s, which
# buries genuine faults in the log and tells the browser "server broken" when
# the truth is "that is not available".
# --------------------------------------------------------------------------

class SourceError(Exception):
    """Something the caller asked for cannot be provided. Explainable."""
    status = 400


class NotConnected(SourceError):
    """A broker session is required and missing."""
    status = 503


class NoData(SourceError):
    """The source has nothing for that symbol or timeframe."""
    status = 404


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------

_REGISTRY: dict[str, "Source"] = {}
_ORDER: list[str] = []


class Source:
    def __init__(
        self,
        key: str,
        label: str,
        timeframes: list,
        symbols: list,
        candles: Callable,
        quotes: Optional[Callable] = None,
        search: Optional[Callable] = None,
        stream: Optional[dict] = None,
        default_symbol: Optional[str] = None,
        default_timeframe: Optional[str] = None,
        display_tz_offset_min: int = 0,
        note: str = "",
    ):
        self.key = key
        self.label = label
        self.timeframes = [
            {"id": t, "label": t} if isinstance(t, str) else t for t in timeframes
        ]
        self.symbols = [
            {"symbol": s, "label": s} if isinstance(s, str) else s for s in symbols
        ]
        self._candles = candles
        self._quotes = quotes
        self._search = search
        self.stream = stream or {"kind": "poll", "interval_ms": 5000, "refresh_ms": 60000}
        self.default_symbol = default_symbol or (
            self.symbols[0]["symbol"] if self.symbols else ""
        )
        self.default_timeframe = default_timeframe or (
            self.timeframes[0]["id"] if self.timeframes else "1m"
        )
        self.display_tz_offset_min = display_tz_offset_min
        self.note = note

    def candles(self, symbol, timeframe, limit):
        rows = self._candles(symbol, timeframe, limit) or []
        rows.sort(key=lambda r: r["time"])
        deduped, seen = [], set()
        for r in rows:
            if r["time"] in seen:
                deduped[-1] = r
                continue
            seen.add(r["time"])
            deduped.append(r)
        return deduped[-limit:] if limit else deduped

    def quotes(self, symbols):
        if self._quotes:
            return self._quotes(symbols)
        out = {}
        for s in symbols:
            try:
                last = self.candles(s, self.default_timeframe, 2)[-1]
                out[s] = {"price": last["close"], "time": last["time"]}
            except Exception:
                pass
        return out

    def search(self, query):
        q = (query or "").strip().lower()
        if self._search:
            return self._search(query)
        if not q:
            return self.symbols[:50]
        return [
            s for s in self.symbols
            if q in s["symbol"].lower() or q in s.get("label", "").lower()
        ][:50]

    def describe(self):
        return {
            "key": self.key,
            "label": self.label,
            "timeframes": self.timeframes,
            "symbols": self.symbols,
            "stream": self.stream,
            "defaultSymbol": self.default_symbol,
            "defaultTimeframe": self.default_timeframe,
            "tzOffsetMin": self.display_tz_offset_min,
            "note": self.note,
        }


def register_source(**kwargs) -> Source:
    """Register a broker. This is the 'one function' you call for a new feed."""
    src = Source(**kwargs)
    if src.key not in _REGISTRY:
        _ORDER.append(src.key)
    _REGISTRY[src.key] = src
    return src


def unregister_source(key: str) -> None:
    if key in _REGISTRY:
        del _REGISTRY[key]
        _ORDER.remove(key)


def get_source(key: str) -> Source:
    if key not in _REGISTRY:
        raise KeyError(f"unknown data source '{key}'")
    return _REGISTRY[key]


def all_sources() -> list:
    return [_REGISTRY[k].describe() for k in _ORDER]


# --------------------------------------------------------------------------
# Tiny TTL cache (keeps us off the upstream rate limits)
# --------------------------------------------------------------------------

_cache: dict = {}
_cache_lock = threading.Lock()


CACHE_MAX_ENTRIES = 300


def cached(ttl: float, key: str, producer: Callable):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = producer()
    with _cache_lock:
        _cache[key] = (now, value)
        # Browsing a lot of symbols would otherwise grow this forever: each
        # entry is ~1200 candles. Drop the oldest once it gets big.
        if len(_cache) > CACHE_MAX_ENTRIES:
            for stale in sorted(_cache, key=lambda k: _cache[k][0])[:len(_cache) // 3]:
                del _cache[stale]
    return value


def cache_drop(prefix: str) -> None:
    with _cache_lock:
        for k in [k for k in _cache if k.startswith(prefix)]:
            del _cache[k]


def resample_candles(rows, period, tz_offset_min=0):
    """Roll daily candles up into weekly or monthly ones.

    Several brokers (Kite among them) only serve intraday and daily bars, so
    anything longer has to be built here. Grouping uses the exchange's local
    date, not UTC, or a Monday bar can land in the previous week.

    period: "week" (ISO week, Monday-start) or "month".
    """
    from datetime import datetime, timedelta, timezone

    seconds = None
    if isinstance(period, int):
        seconds = period
    elif period not in ("week", "month"):
        raise ValueError(f"cannot resample to '{period}'")

    tz = timezone(timedelta(minutes=tz_offset_min))
    buckets = {}
    order = []
    for r in rows:
        if seconds:
            # bucket on local time so 2h/4h bars align to the local day, not to
            # midnight UTC (which would cut an Indian session in an odd place)
            key = (r["time"] + tz_offset_min * 60) // seconds
            b = buckets.get(key)
            if b is None:
                buckets[key] = {"time": r["time"], "open": r["open"], "high": r["high"],
                                "low": r["low"], "close": r["close"],
                                "volume": r.get("volume") or 0}
                order.append(key)
            else:
                b["high"] = max(b["high"], r["high"])
                b["low"] = min(b["low"], r["low"])
                b["close"] = r["close"]
                b["volume"] += r.get("volume") or 0
            continue
        local = datetime.fromtimestamp(r["time"], tz)
        if period == "week":
            iso = local.isocalendar()
            key = (iso[0], iso[1])
        else:
            key = (local.year, local.month)
        b = buckets.get(key)
        if b is None:
            buckets[key] = {
                "time": r["time"],          # first bar of the period
                "open": r["open"], "high": r["high"],
                "low": r["low"], "close": r["close"],
                "volume": r.get("volume") or 0,
            }
            order.append(key)
        else:
            b["high"] = max(b["high"], r["high"])
            b["low"] = min(b["low"], r["low"])
            b["close"] = r["close"]          # rows arrive ascending
            b["volume"] += r.get("volume") or 0
    return [buckets[k] for k in order]


# ==========================================================================
# SOURCE 1 — yfinance (Indian equities / indices, and anything else on Yahoo).
# Free and always available. Delayed, and Yahoo is unofficial.
# ==========================================================================

# How far back to ask Yahoo for each interval. These sit at (or just under)
# Yahoo's own ceilings: 7 days for 1m, 60 days for the other intraday bars,
# 730 days for hourly, unlimited for daily and longer. Daily is held at 10y
# rather than max because every pane refetch would otherwise drag decades of
# bars through a 0.1 CPU instance for no visible benefit.
YF_PERIOD = {
    "1m": "7d", "2m": "60d", "5m": "60d", "15m": "60d",
    "30m": "60d", "60m": "730d", "1d": "10y", "1wk": "max", "1mo": "max",
}
# our timeframe id -> yahoo's. Note "1m" is a minute and "1M" is a month.
YF_INTERVAL = {"1h": "60m", "1w": "1wk", "1M": "1mo"}
# Yahoo has no 3m/2h/4h bars, so they are rolled up from the nearest one it does
YF_ROLLUP = {"3m": ("1m", 180), "2h": ("60m", 7200), "4h": ("60m", 14400)}


def _yf():
    import yfinance

    return yfinance


def yfinance_candles(symbol, timeframe, limit):
    yf = _yf()
    rollup = YF_ROLLUP.get(timeframe)
    if rollup:
        base, seconds = rollup
        per = max(2, seconds // 60)
        rows = yfinance_candles(symbol, base, min(limit * per, 5000))
        return resample_candles(rows, seconds, tz_offset_min=330)
    interval = YF_INTERVAL.get(timeframe, timeframe)
    period = YF_PERIOD.get(interval, "1mo")

    def fetch():
        df = yf.Ticker(symbol).history(
            period=period, interval=interval, auto_adjust=False, prepost=False
        )
        rows = []
        for ts, row in df.iterrows():
            t = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
            o, h, l, c = row["Open"], row["High"], row["Low"], row["Close"]
            if any(v != v for v in (o, h, l, c)):
                continue
            rows.append({
                "time": int(t.timestamp()),
                "open": float(o), "high": float(h),
                "low": float(l), "close": float(c),
                "volume": float(row.get("Volume") or 0),
            })
        return rows

    ttl = 20.0 if interval in ("1m", "2m", "5m", "15m", "30m", "60m") else 300.0
    rows = cached(ttl, f"yf:c:{symbol}:{interval}:{period}", fetch)
    if not rows:
        raise NoData(f"no data from yfinance for '{symbol}' @ {timeframe}")
    return list(rows)


def _yf_one_quote(symbol):
    t = _yf().Ticker(symbol)
    try:
        price = t.fast_info["last_price"]
        if price:
            return {"price": float(price), "time": int(time.time())}
    except Exception:
        pass
    df = t.history(period="1d", interval="1m")
    if df is None or df.empty:
        raise ValueError("no quote")
    ts = df.index[-1]
    ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
    return {"price": float(df.iloc[-1]["Close"]), "time": int(ts.timestamp())}


def _safe_quote(symbol):
    try:
        return _yf_one_quote(symbol)
    except Exception:
        return None


def yfinance_quotes(symbols):
    symbols = list(dict.fromkeys(symbols))[:16]

    def fetch():
        out = {}
        with ThreadPoolExecutor(max_workers=min(8, max(1, len(symbols)))) as pool:
            for sym, res in zip(symbols, pool.map(_safe_quote, symbols)):
                if res:
                    out[sym] = res
        return out

    return cached(3.0, "yf:q:" + ",".join(sorted(symbols)), fetch)


def yfinance_search(query):
    """Curated names first, then plausible Yahoo spellings of what was typed.

    Yahoo has no symbol-search API we can rely on, and its Indian tickers need
    a suffix: GOLDBEES is really GOLDBEES.NS. Typing the bare name used to
    offer only the bare name, which then failed to load — so suggest the
    suffixed forms too.
    """
    q = (query or "").strip()
    ql = q.lower()
    hits = [
        s for s in NSE_SYMBOLS
        if ql in s["symbol"].lower() or ql in s["label"].lower()
    ][:40]
    if not q:
        return hits

    known = {h["symbol"].lower() for h in hits}
    suggestions = []
    upper = q.upper()
    if "." not in q and not q.startswith("^"):
        for suffix, where in ((".NS", "NSE"), (".BO", "BSE")):
            cand = upper + suffix
            if cand.lower() not in known:
                suggestions.append({"symbol": cand, "label": f"{upper} on {where}"})
    if upper.lower() not in known:
        suggestions.append({"symbol": upper, "label": f"{upper} (as typed)"})
    return suggestions + hits


def _nse(ticker, name):
    return {"symbol": f"{ticker}.NS", "label": f"{name} ({ticker})"}


NSE_SYMBOLS = [
    {"symbol": "^NSEI", "label": "NIFTY 50"},
    {"symbol": "^NSEBANK", "label": "NIFTY BANK"},
    {"symbol": "^BSESN", "label": "SENSEX"},
    {"symbol": "^CNXIT", "label": "NIFTY IT"},
    _nse("RELIANCE", "Reliance Industries"), _nse("TCS", "Tata Consultancy"),
    _nse("HDFCBANK", "HDFC Bank"), _nse("ICICIBANK", "ICICI Bank"),
    _nse("INFY", "Infosys"), _nse("SBIN", "State Bank of India"),
    _nse("BHARTIARTL", "Bharti Airtel"), _nse("ITC", "ITC"),
    _nse("LT", "Larsen & Toubro"), _nse("AXISBANK", "Axis Bank"),
    _nse("KOTAKBANK", "Kotak Mahindra Bank"), _nse("HINDUNILVR", "Hindustan Unilever"),
    _nse("BAJFINANCE", "Bajaj Finance"), _nse("MARUTI", "Maruti Suzuki"),
    _nse("SUNPHARMA", "Sun Pharma"), _nse("TATAMOTORS", "Tata Motors"),
    _nse("TATASTEEL", "Tata Steel"), _nse("WIPRO", "Wipro"),
    _nse("HCLTECH", "HCL Technologies"), _nse("ADANIENT", "Adani Enterprises"),
    _nse("ADANIPORTS", "Adani Ports"), _nse("ASIANPAINT", "Asian Paints"),
    _nse("TITAN", "Titan Company"), _nse("ULTRACEMCO", "UltraTech Cement"),
    _nse("NESTLEIND", "Nestle India"), _nse("ONGC", "ONGC"),
    _nse("NTPC", "NTPC"), _nse("POWERGRID", "Power Grid"),
    _nse("COALINDIA", "Coal India"), _nse("JSWSTEEL", "JSW Steel"),
    _nse("DRREDDY", "Dr Reddy's Labs"), _nse("CIPLA", "Cipla"),
    _nse("TECHM", "Tech Mahindra"), _nse("GRASIM", "Grasim Industries"),
    _nse("HINDALCO", "Hindalco"), _nse("EICHERMOT", "Eicher Motors"),
    _nse("VEDL", "Vedanta"), _nse("IRFC", "IRFC"),
    _nse("ZOMATO", "Zomato / Eternal"), _nse("PAYTM", "One97 / Paytm"),
    _nse("IRCTC", "IRCTC"), _nse("YESBANK", "Yes Bank"),
    _nse("SUZLON", "Suzlon Energy"),
]

register_source(
    key="yfinance",
    label="yfinance (NSE / BSE)",
    timeframes=[
        {"id": "1m", "label": "1m"}, {"id": "3m", "label": "3m"},
        {"id": "5m", "label": "5m"}, {"id": "15m", "label": "15m"},
        {"id": "30m", "label": "30m"}, {"id": "1h", "label": "1h"},
        {"id": "2h", "label": "2h"}, {"id": "4h", "label": "4h"},
        {"id": "1d", "label": "1D"}, {"id": "1w", "label": "1W"},
        {"id": "1M", "label": "1MO"},
    ],
    symbols=NSE_SYMBOLS,
    candles=yfinance_candles,
    quotes=yfinance_quotes,
    search=yfinance_search,
    stream={"kind": "poll", "interval_ms": 4000, "refresh_ms": 15000},
    default_symbol="^NSEI",
    default_timeframe="15m",
    display_tz_offset_min=330,
    note="Free but delayed (~15 min on some symbols). Ticks only move during "
         "market hours, 09:15–15:30 IST.",
)


# ==========================================================================
# SOURCE 2 — Zerodha Kite Connect (real NSE/BSE ticks).
#
# Credentials come from the Settings screen (settings.py), NOT from env vars,
# and NOT from the browser: a Kite access token can place orders, so it stays
# on the server. The browser only ever sees prices.
#
# Live path: KiteTicker (Zerodha's binary websocket) runs in a background
# thread here and drops ticks into a dict; the browser polls /api/quotes once
# a second and reads them. Kite's REST API sends no CORS headers, so a
# browser-direct design is not possible anyway.
#
# Requires: pip install kiteconnect
# ==========================================================================

KITE_TF = {
    "1m": "minute", "3m": "3minute", "5m": "5minute", "10m": "10minute",
    "15m": "15minute", "30m": "30minute", "1h": "60minute", "1d": "day",
}
KITE_MAX_DAYS = {
    "minute": 60, "3minute": 100, "5minute": 100, "10minute": 100,
    "15minute": 200, "30minute": 200, "60minute": 400, "day": 2000,
}

_kite_client = None
_kite_client_token = None
_kite_ticks: dict = {}
_kite_ticker = None
_kite_subscribed: set = set()
_kite_lock = threading.Lock()


def _kite():
    """Authenticated KiteConnect client, rebuilt whenever the token changes."""
    global _kite_client, _kite_client_token
    cfg = app_settings.kite_credentials()
    if not cfg["api_key"] or not cfg["access_token"]:
        raise NotConnected("Zerodha is not connected — open Settings and sign in to Kite.")
    if _kite_client is None or _kite_client_token != cfg["access_token"]:
        from kiteconnect import KiteConnect

        client = KiteConnect(api_key=cfg["api_key"])
        client.set_access_token(cfg["access_token"])
        _kite_client, _kite_client_token = client, cfg["access_token"]
    return _kite_client


def _kite_instruments():
    """{'NSE:RELIANCE': {...}} — the dump is public and ~2 MB, so cache it 12h."""

    def fetch():
        import gc
        import sys
        from kiteconnect import KiteConnect

        cfg = app_settings.kite_credentials()
        client = KiteConnect(api_key=cfg["api_key"] or "public")
        rows = {}
        # ~59,000 instruments, and the names, expiries and kinds repeat
        # heavily. Interning them shares one copy of each string instead of
        # tens of thousands, which is most of the difference on a 512 MB box.
        intern = sys.intern
        # NFO is the derivatives segment: ~650 futures and ~36,000 option
        # contracts. They are searchable but deliberately kept out of the
        # dropdown head, or every list would be a wall of strikes.
        for exch in ("NSE", "BSE", "NFO"):
            try:
                for i in client.instruments(exch):
                    seg = i.get("segment") or ""
                    if exch in ("NSE", "BSE") and seg not in (exch, "INDICES"):
                        continue
                    itype = i.get("instrument_type") or "EQ"
                    kind = ("FUT" if itype == "FUT"
                            else "OPT" if itype in ("CE", "PE")
                            else "INDEX" if seg == "INDICES" else "EQ")
                    ts = i["tradingsymbol"]
                    rows[intern(exch + ":" + ts)] = {
                        "token": i["instrument_token"],
                        "tradingsymbol": intern(ts),
                        "name": intern(i.get("name") or ts),
                        "kind": intern(kind),
                        "expiry": intern(str(i.get("expiry") or "")),
                        "strike": float(i.get("strike") or 0),
                        "lot": int(i.get("lot_size") or 0),
                    }
            except Exception as err:
                print(f"[kite] instrument dump for {exch} failed: {err}")
        # Parsing 59,000 rows leaves a lot of short-lived garbage. Collecting
        # here hands the peak back rather than carrying it for the process's
        # life, which matters when the whole box is 512 MB.
        gc.collect()
        return rows

    return cached(43200.0, "kite:instruments", fetch)


def _kite_token(symbol):
    sym = symbol if ":" in symbol else "NSE:" + symbol
    rows = _kite_instruments()
    row = rows.get(sym.upper()) or rows.get(sym)
    if not row:
        raise NoData(f"'{symbol}' is not in the Kite NSE/BSE instrument list")
    return row["token"]


def kite_candles(symbol, timeframe, limit):
    from datetime import datetime, timedelta

    # Kite serves nothing longer than a daily bar, so weekly and monthly are
    # rolled up here from dailies.
    rollup = {"1w": "week", "1M": "month"}.get(timeframe)
    if rollup:
        days = {"week": 7, "month": 31}[rollup]
        daily = kite_candles(symbol, "1d", min(limit * days, 2000))
        return resample_candles(daily, rollup, tz_offset_min=330)
    if timeframe in ("2h", "4h"):
        seconds = 7200 if timeframe == "2h" else 14400
        hourly = kite_candles(symbol, "1h", min(limit * (seconds // 3600), 2000))
        return resample_candles(hourly, seconds, tz_offset_min=330)

    interval = KITE_TF.get(timeframe)
    if not interval:
        raise ValueError(f"Kite has no '{timeframe}' interval")
    per_bar = {"minute": 1, "3minute": 3, "5minute": 5, "10minute": 10,
               "15minute": 15, "30minute": 30, "60minute": 60,
               "day": 60 * 24 * 1.6}[interval]
    span_days = min(int(limit * per_bar / (60 * 6.25)) + 2, KITE_MAX_DAYS[interval])
    to_date = datetime.now()
    from_date = to_date - timedelta(days=max(span_days, 2))

    bars = cached(
        3.0, f"kite:c:{symbol}:{interval}:{span_days}",
        lambda: _kite().historical_data(_kite_token(symbol), from_date, to_date, interval),
    )
    return [
        {
            "time": int(b["date"].timestamp()),
            "open": float(b["open"]), "high": float(b["high"]),
            "low": float(b["low"]), "close": float(b["close"]),
            "volume": float(b.get("volume") or 0),
        }
        for b in bars
    ]


def _kite_start_ticker():
    """Open the tick websocket once, in a background thread."""
    global _kite_ticker
    if _kite_ticker is not None:
        return
    from kiteconnect import KiteTicker

    cfg = app_settings.kite_credentials()
    if not cfg["api_key"] or not cfg["access_token"]:
        return
    kws = KiteTicker(cfg["api_key"], cfg["access_token"])

    def on_ticks(ws, ticks):
        now = int(time.time())
        for t in ticks:
            price = t.get("last_price")
            if price is not None:
                _kite_ticks[t["instrument_token"]] = {"price": float(price), "time": now}

    def on_connect(ws, response):
        with _kite_lock:
            tokens = list(_kite_subscribed)
        if tokens:
            ws.subscribe(tokens)
            ws.set_mode(ws.MODE_LTP, tokens)

    kws.on_ticks = on_ticks
    kws.on_connect = on_connect
    kws.on_error = lambda ws, code, reason: print(f"[kite] ticker {code}: {reason}")
    kws.connect(threaded=True)
    _kite_ticker = kws


def kite_stop_ticker():
    """Drop the socket and cached client — called when credentials change."""
    global _kite_ticker, _kite_client, _kite_client_token
    if _kite_ticker is not None:
        try:
            _kite_ticker.close()
        except Exception:
            pass
    _kite_ticker = None
    _kite_client = None
    _kite_client_token = None
    _kite_ticks.clear()
    _kite_subscribed.clear()


def kite_quotes(symbols):
    tokens, by_token = {}, {}
    for s in symbols:
        try:
            tok = _kite_token(s)
        except Exception:
            continue
        tokens[s] = tok
        by_token[tok] = s

    _kite_start_ticker()
    if _kite_ticker is not None:
        fresh = [t for t in by_token if t not in _kite_subscribed]
        if fresh:
            with _kite_lock:
                _kite_subscribed.update(fresh)
            try:
                _kite_ticker.subscribe(fresh)
                _kite_ticker.set_mode(_kite_ticker.MODE_LTP, fresh)
            except Exception as err:
                print(f"[kite] subscribe failed: {err}")

    out = {s: _kite_ticks[tok] for s, tok in tokens.items() if tok in _kite_ticks}

    missing = [s for s in tokens if s not in out]
    if missing:
        try:
            snap = _kite().ltp(*[s if ":" in s else "NSE:" + s for s in missing])
            now = int(time.time())
            for s in missing:
                row = snap.get(s) or snap.get("NSE:" + s)
                if row:
                    out[s] = {"price": float(row["last_price"]), "time": now}
        except Exception as err:
            print(f"[kite] ltp fallback failed: {err}")
    return out


def kite_search(query):
    """Search the whole Kite instrument list, not the dropdown's short head.

    Kite carries ~23,000 NSE+BSE instruments. Shipping those to the browser
    would be a multi-megabyte payload for something the user types two letters
    into, so the dropdown carries a short list and anything else is found here.
    """
    q = (query or "").strip().lower()
    try:
        rows = _kite_instruments()
    except Exception:
        return []
    if not q:
        return _kite_symbol_list()[:50]

    if ":" in q:
        q = q.split(":", 1)[1]

    # Match every word, so "nifty fut" and "reliance 2600 ce" both work.
    terms = [t for t in q.split() if t]
    head = terms[0]

    scored = []
    for key, r in rows.items():
        ts = r["tradingsymbol"].lower()
        name = (r["name"] or "").lower()
        kind = r.get("kind", "EQ")
        hay = ts + " " + name + " " + ("fut" if kind == "FUT" else
                                       "ce pe opt option" if kind == "OPT" else "")
        if not all(t in hay for t in terms):
            continue

        if ts == head:
            rank = 0
        elif ts.startswith(head):
            rank = 1
        elif name.startswith(head):
            rank = 2
        elif head in ts:
            rank = 3
        else:
            rank = 4

        # cash and index first, then futures, then the 36k option strikes
        kind_rank = {"EQ": 0, "INDEX": 0, "FUT": 1, "OPT": 2}.get(kind, 3)
        scored.append((rank, kind_rank, 0 if key.startswith("NSE:") else 1,
                       len(ts), key, r))
        if len(scored) > 8000:
            break

    scored.sort(key=lambda x: x[:4])
    out = []
    for _r, _k, _e, _l, key, r in scored[:50]:
        kind = r.get("kind", "EQ")
        if kind == "OPT":
            label = f"{r['name']} {r['strike']:.0f} {r['tradingsymbol'][-2:]} · {r['expiry']}"
        elif kind == "FUT":
            label = f"{r['name']} futures · {r['expiry']}"
        else:
            label = r["tradingsymbol"] if r["name"] == r["tradingsymbol"] else \
                f"{r['name']} ({r['tradingsymbol']})"
        out.append({"symbol": key, "label": label})
    return out


def _kite_symbol_list():
    head = ["NIFTY 50", "NIFTY BANK", "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK",
            "INFY", "SBIN", "BHARTIARTL", "ITC", "LT", "AXISBANK", "KOTAKBANK",
            "HINDUNILVR", "BAJFINANCE", "MARUTI", "TATAMOTORS", "TATASTEEL",
            "SUNPHARMA", "WIPRO", "HCLTECH", "ADANIENT", "ZOMATO", "IRCTC"]
    try:
        rows = _kite_instruments()
    except Exception as err:
        print(f"[kite] instrument list unavailable ({err})")
        return [{"symbol": "NSE:" + s, "label": s} for s in head]
    out, seen = [], set()
    for s in head:
        key = "NSE:" + s
        if key in rows:
            out.append({"symbol": key, "label": rows[key]["name"]})
            seen.add(key)
    for key in sorted(rows):
        if key in seen or len(out) >= 600:
            continue
        r = rows[key]
        label = r["tradingsymbol"] if r["name"] == r["tradingsymbol"] else \
            f"{r['name']} ({r['tradingsymbol']})"
        out.append({"symbol": key, "label": label})
    return out


def configure_zerodha() -> bool:
    """(Un)register the Zerodha source to match the saved settings.

    Called at boot and again every time Settings are saved, so connecting or
    disconnecting Kite takes effect without restarting the server.
    """
    cfg = app_settings.kite_credentials()
    if not (cfg["api_key"] and cfg["access_token"]):
        unregister_source("zerodha")
        kite_stop_ticker()
        return False

    register_source(
        key="zerodha",
        label="Zerodha (Kite)",
        timeframes=[
            {"id": "1m", "label": "1m"}, {"id": "3m", "label": "3m"},
            {"id": "5m", "label": "5m"}, {"id": "10m", "label": "10m"},
            {"id": "15m", "label": "15m"}, {"id": "30m", "label": "30m"},
            {"id": "1h", "label": "1h"}, {"id": "2h", "label": "2h"},
            {"id": "4h", "label": "4h"}, {"id": "1d", "label": "1D"},
            {"id": "1w", "label": "1W"}, {"id": "1M", "label": "1MO"},
        ],
        symbols=_kite_symbol_list(),
        candles=kite_candles,
        quotes=kite_quotes,
        search=kite_search,
        stream={"kind": "poll", "interval_ms": 1000, "refresh_ms": 4000},
        default_symbol="NSE:NIFTY 50",
        default_timeframe="15m",
        display_tz_offset_min=330,
        note="Real exchange ticks. The Kite access token expires daily "
             "(~6am IST) — reconnect from Settings.",
    )
    return True


configure_zerodha()
