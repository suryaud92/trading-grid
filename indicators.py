"""
indicators.py — technical indicators, computed server-side with pandas-ta.

We use `pandas-ta-classic`, the maintained community fork of `pandas-ta`. The
original package now pulls in numba, which has no Python 3.14 wheels, so it
cannot be installed on current interpreters. The fork keeps the same API and
works on pandas 3 / numpy 2. Its RSI was checked against an independent Wilder
implementation and matches to 2.5e-14.

=============================================================================
ADDING AN INDICATOR
=============================================================================
Append one entry to CATALOG. The API, the pane menu and the chart pick it up
automatically — there is no frontend list to keep in sync.

    Spec(
        id="cci", label="CCI", pane="sub",
        params=[Param("length", 20)],
        lines=[Line("cci", "CCI", "#f472b6")],
        fn=lambda df, length: {"cci": ta.cci(df.high, df.low, df.close, length=length)},
    )

`pane` is "price" to draw over the candles, or "sub" for a band underneath.
`fn` returns {line_key: pandas Series}; anything NaN is dropped per line.
=============================================================================
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Callable

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)


@dataclass
class Param:
    name: str
    default: object
    min: float = 1
    max: float = 500
    options: list = None      # [[value, label], ...] renders a dropdown


@dataclass
class Line:
    key: str
    name: str
    color: str
    style: str = "solid"      # solid | dashed
    width: int = 2


@dataclass
class Spec:
    id: str
    label: str
    pane: str                 # "price" | "sub"
    params: list
    lines: list
    fn: Callable
    note: str = ""

    def describe(self):
        return {
            "id": self.id,
            "label": self.label,
            "pane": self.pane,
            "params": [
                {"name": p.name, "default": p.default, "min": p.min, "max": p.max,
                 "options": p.options}
                for p in self.params
            ],
            "lines": [{"key": l.key, "name": l.name, "color": l.color} for l in self.lines],
            "note": self.note,
        }


def _ta():
    import pandas_ta_classic as ta
    return ta


def _frame(candles):
    """Candles -> DataFrame with a UTC DatetimeIndex (VWAP needs a real index)."""
    import pandas as pd

    df = pd.DataFrame(candles)
    df["ts"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df = df.set_index("ts")
    return df


# --------------------------------------------------------------------------
# Catalog
# --------------------------------------------------------------------------

def _sma(df, length):   return {"sma": _ta().sma(df.close, length=int(length))}
def _ema(df, length):   return {"ema": _ta().ema(df.close, length=int(length))}
def _wma(df, length):   return {"wma": _ta().wma(df.close, length=int(length))}


def _bbands(df, length, std):
    out = _ta().bbands(df.close, length=int(length), std=float(std))
    cols = list(out.columns)
    lower = next(c for c in cols if c.startswith("BBL"))
    mid = next(c for c in cols if c.startswith("BBM"))
    upper = next(c for c in cols if c.startswith("BBU"))
    return {"upper": out[upper], "middle": out[mid], "lower": out[lower]}


def _supertrend(df, length, mult):
    out = _ta().supertrend(df.high, df.low, df.close, length=int(length), multiplier=float(mult))
    col = next(c for c in out.columns if c.startswith("SUPERT_"))
    return {"supertrend": out[col]}


def _vwap(df):
    return {"vwap": _ta().vwap(df.high, df.low, df.close, df.volume)}


def _rsi(df, length):
    return {"rsi": _ta().rsi(df.close, length=int(length))}


def _macd(df, fast, slow, signal):
    out = _ta().macd(df.close, fast=int(fast), slow=int(slow), signal=int(signal))
    cols = list(out.columns)
    return {
        "macd": out[next(c for c in cols if c.startswith("MACD_"))],
        "signal": out[next(c for c in cols if c.startswith("MACDs"))],
        "hist": out[next(c for c in cols if c.startswith("MACDh"))],
    }


def _stoch(df, k, d):
    out = _ta().stoch(df.high, df.low, df.close, k=int(k), d=int(d))
    cols = list(out.columns)
    return {
        "k": out[next(c for c in cols if c.startswith("STOCHk"))],
        "d": out[next(c for c in cols if c.startswith("STOCHd"))],
    }


def _atr(df, length):
    return {"atr": _ta().atr(df.high, df.low, df.close, length=int(length))}


def _adx(df, length):
    out = _ta().adx(df.high, df.low, df.close, length=int(length))
    return {"adx": out[next(c for c in out.columns if c.startswith("ADX_"))]}


def _cci(df, length):
    return {"cci": _ta().cci(df.high, df.low, df.close, length=int(length))}


def _obv(df):
    return {"obv": _ta().obv(df.close, df.volume)}


def _mfi(df, length):
    return {"mfi": _ta().mfi(df.high, df.low, df.close, df.volume, length=int(length))}


CATALOG = [
    # ---- drawn over the candles -----------------------------------------
    Spec("sma", "SMA", "price", [Param("length", 20)],
         [Line("sma", "SMA", "#f59e0b")], _sma),
    Spec("ema", "EMA", "price", [Param("length", 20)],
         [Line("ema", "EMA", "#38bdf8")], _ema),
    Spec("wma", "WMA", "price", [Param("length", 20)],
         [Line("wma", "WMA", "#c084fc")], _wma),
    Spec("bbands", "Bollinger", "price", [Param("length", 20), Param("std", 2, 0.1, 10)],
         [Line("upper", "BB upper", "#64748b", width=1),
          Line("middle", "BB mid", "#64748b", style="dashed", width=1),
          Line("lower", "BB lower", "#64748b", width=1)], _bbands),
    Spec("supertrend", "Supertrend", "price", [Param("length", 10), Param("mult", 3, 0.5, 20)],
         [Line("supertrend", "Supertrend", "#14b8a6")], _supertrend),
    Spec("vwap", "VWAP", "price", [],
         [Line("vwap", "VWAP", "#eab308")], _vwap,
         note="Anchored to each session; needs volume, so index symbols may be flat."),

    # ---- drawn in a band below ------------------------------------------
    Spec("rsi", "RSI", "sub", [Param("length", 14)],
         [Line("rsi", "RSI", "#e879f9")], _rsi, note="0-100, with 30/70 guides."),
    Spec("macd", "MACD", "sub", [Param("fast", 12), Param("slow", 26), Param("signal", 9)],
         [Line("macd", "MACD", "#38bdf8"),
          Line("signal", "Signal", "#f59e0b"),
          Line("hist", "Histogram", "#64748b", style="dashed", width=1)], _macd),
    Spec("stoch", "Stochastic", "sub", [Param("k", 14), Param("d", 3)],
         [Line("k", "%K", "#38bdf8"), Line("d", "%D", "#f59e0b")], _stoch,
         note="0-100, with 20/80 guides."),
    Spec("atr", "ATR", "sub", [Param("length", 14)],
         [Line("atr", "ATR", "#fb923c")], _atr),
    Spec("adx", "ADX", "sub", [Param("length", 14)],
         [Line("adx", "ADX", "#a3e635")], _adx, note="Trend strength; above 25 is trending."),
    Spec("cci", "CCI", "sub", [Param("length", 20)],
         [Line("cci", "CCI", "#f472b6")], _cci),
    Spec("mfi", "MFI", "sub", [Param("length", 14)],
         [Line("mfi", "MFI", "#2dd4bf")], _mfi, note="Volume-weighted RSI."),
    Spec("obv", "OBV", "sub", [],
         [Line("obv", "OBV", "#94a3b8")], _obv),
]

BY_ID = {s.id: s for s in CATALOG}

GUIDES = {           # horizontal reference lines for bounded sub-panes
    "rsi": [30, 70],
    "stoch": [20, 80],
    "mfi": [20, 80],
    "adx": [25],
}


def catalog():
    return [s.describe() for s in CATALOG]


def parse_spec(text: str) -> list:
    """'sma:20,sma:50,rsi:14' -> [('sma', [20.0]), ('sma', [50.0]), ('rsi', [14.0])]"""
    out = []
    for chunk in (text or "").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        bits = chunk.split(":")
        ind_id = bits[0].strip().lower()
        if ind_id not in BY_ID:
            continue
        args = []
        for b in bits[1:]:
            try:
                args.append(float(b))
            except ValueError:
                args.append(b)          # a choice, e.g. "week"
        out.append((ind_id, args))
    return out[:8]                      # a sane cap per pane


_calc_cache = {}
_calc_lock = __import__("threading").Lock()


def compute(candles, spec_text, tail=None):
    """Compute the requested indicators over the FULL candle history.

    `tail` trims each returned series to its last N points. The whole series is
    always computed first — a 20-period SMA needs 20 bars of history even if
    only the last one is being sent — which is what lets the browser's
    incremental refresh stay small without the numbers going wrong.
    """
    specs = parse_spec(spec_text)
    if not specs or not candles:
        return []

    # Identical requests arrive from every pane every few seconds once the
    # refresh is fast, and each full computation is tens of milliseconds. The
    # result only changes when a new candle lands, so key the cache on the last
    # bar's timestamp and close: same bar, same answer.
    last = candles[-1]
    ck = (spec_text, len(candles), last["time"], last["close"])
    with _calc_lock:
        hit = _calc_cache.get(ck)
    if hit is not None:
        return [dict(line, data=line["data"][-tail:] if tail else line["data"])
                for line in hit]

    df = _frame(candles)
    times = [int(t) for t in df["time"].tolist()]
    out = []

    for ind_id, args in specs:
        spec = BY_ID[ind_id]
        values = [args[i] if i < len(args) else p.default
                  for i, p in enumerate(spec.params)]
        key_id = ":".join([ind_id] + [_fmt(v) for v in values])

        try:
            series_map = spec.fn(df, *values)
        except Exception as err:
            print(f"[indicators] {key_id} failed: {type(err).__name__}: {err}")
            continue

        for line in spec.lines:
            s = series_map.get(line.key)
            if s is None:
                continue
            data = []
            for t, v in zip(times, s.tolist()):
                if v is None or v != v:          # NaN
                    continue
                data.append({"time": t, "value": round(float(v), 6)})
            if not data:
                continue
            out.append({
                "key": f"{key_id}#{line.key}",
                "group": key_id,
                "name": f"{line.name}" + (f" {_fmt(values[0])}" if values and len(spec.lines) == 1 else ""),
                "pane": spec.pane,
                "color": line.color,
                "style": line.style,
                "width": line.width,
                "guides": GUIDES.get(ind_id, []) if line is spec.lines[0] else [],
                "data": data,
            })

    with _calc_lock:
        if len(_calc_cache) > 200:
            _calc_cache.clear()
        _calc_cache[ck] = out
    return [dict(line, data=line["data"][-tail:] if tail else line["data"]) for line in out]


def _fmt(v):
    if isinstance(v, str):
        return v
    f = float(v)
    return str(int(f)) if f == int(f) else str(f)

PIVOT_ANCHORS = [
    ["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"],
    ["quarter", "Quarterly"], ["half", "6 months"], ["year", "Yearly"],
]


def _anchor_key(ts, anchor, tz_offset_min=330):
    """Which period a bar belongs to, in exchange-local time."""
    from datetime import datetime, timedelta, timezone

    d = datetime.fromtimestamp(ts, timezone(timedelta(minutes=tz_offset_min)))
    if anchor == "day":
        return (d.year, d.month, d.day)
    if anchor == "week":
        iso = d.isocalendar()
        return (iso[0], iso[1])
    if anchor == "month":
        return (d.year, d.month)
    if anchor == "quarter":
        return (d.year, (d.month - 1) // 3)
    if anchor == "half":
        return (d.year, 0 if d.month <= 6 else 1)
    return (d.year,)


def _pivot_levels(method, high, low, close):
    """Classic, Fibonacci or Camarilla levels from one period's H/L/C."""
    rng = high - low
    p = (high + low + close) / 3.0
    if method == "fib":
        return {"P": p,
                "R1": p + 0.382 * rng, "R2": p + 0.618 * rng, "R3": p + rng,
                "S1": p - 0.382 * rng, "S2": p - 0.618 * rng, "S3": p - rng}
    if method == "camarilla":
        return {"P": p,
                "R1": close + rng * 1.1 / 12, "R2": close + rng * 1.1 / 6,
                "R3": close + rng * 1.1 / 4,
                "S1": close - rng * 1.1 / 12, "S2": close - rng * 1.1 / 6,
                "S3": close - rng * 1.1 / 4}
    return {"P": p,
            "R1": 2 * p - low, "R2": p + rng, "R3": high + 2 * (p - low),
            "S1": 2 * p - high, "S2": p - rng, "S3": low - 2 * (high - p)}


def _pivots(df, anchor, method, levels):
    """Pivot points anchored to the PREVIOUS day/week/month/etc.

    Each period's levels are drawn flat across the period that follows, which
    is what makes them usable: the line you trade against today was fixed by
    yesterday's range and does not move under you.
    """
    import pandas as pd

    anchor = str(anchor)
    method = str(method)
    levels = max(1, min(int(levels), 3))

    times = [int(t.timestamp()) for t in df.index]
    highs, lows, closes = list(df.high), list(df.low), list(df.close)

    names = ["P"] + [f"R{i}" for i in range(1, levels + 1)] \
                  + [f"S{i}" for i in range(1, levels + 1)]
    series = {n: [float("nan")] * len(times) for n in names}

    current = None
    agg = None
    previous = None            # levels computed from the period just finished

    for i, ts in enumerate(times):
        key = _anchor_key(ts, anchor)
        if key != current:
            if agg is not None:
                previous = _pivot_levels(method, agg["h"], agg["l"], agg["c"])
            current = key
            agg = {"h": highs[i], "l": lows[i], "c": closes[i]}
        else:
            agg["h"] = max(agg["h"], highs[i])
            agg["l"] = min(agg["l"], lows[i])
            agg["c"] = closes[i]

        if previous:
            for n in names:
                series[n][i] = previous[n]

    idx = df.index
    return {n: pd.Series(series[n], index=idx) for n in names}


def _fvg_avg(df, lookback, atr_mult):
    """FVG Positioning Average — after the LuxAlgo Pine indicator.

    Rather than drawing every gap, it averages the BOTTOMS of recent bullish
    gaps into one line and the TOPS of recent bearish gaps into another. Where
    unfilled imbalances cluster tends to be where price reacts, so a drift of
    scattered boxes becomes two levels you can actually trade against.

    Each line is dropped (left as a gap in the plot) while price has not yet
    reached it — the original hides the line the same way, because an average
    price has not traded through is not support or resistance yet.
    """
    import pandas as pd

    candles = [
        {"time": int(t.timestamp()), "open": float(o), "high": float(h),
         "low": float(l), "close": float(c)}
        for t, o, h, l, c in zip(df.index, df.open, df.high, df.low, df.close)
    ]
    lookback = max(2, int(lookback))
    gaps = detect_fvgs(candles, float(atr_mult))

    by_index = {}
    for g in gaps:
        by_index.setdefault(g["i"], []).append(g)

    n = len(candles)
    up_line = [float("nan")] * n
    down_line = [float("nan")] * n
    live_up, live_down = [], []

    for i in range(n):
        for g in by_index.get(i, []):
            (live_up if g["dir"] == "bull" else live_down).append(g)

        # a gap's box starts two bars before it completes, as in the original
        live_up = [g for g in live_up if (g["i"] - 2) >= i - lookback]
        live_down = [g for g in live_down if (g["i"] - 2) >= i - lookback]

        window = candles[max(0, i - 4):i + 1]
        highest = max(x["high"] for x in window)
        lowest = min(x["low"] for x in window)

        if live_up:
            avg = sum(g["bottom"] for g in live_up) / len(live_up)
            if highest >= avg:                 # price has reached it
                up_line[i] = avg
        if live_down:
            avg = sum(g["top"] for g in live_down) / len(live_down)
            if lowest <= avg:
                down_line[i] = avg

    idx = df.index
    return {"bull": pd.Series(up_line, index=idx), "bear": pd.Series(down_line, index=idx)}


def _volume(df):
    # Yahoo reports zero volume for indices (^NSEI, ^NSEBANK). Returning an
    # all-zero series would give you an empty pane with a -0.05..0.05 axis, so
    # return nothing and let the pane simply not appear.
    if float(df.volume.abs().sum()) == 0:
        return {}
    return {"volume": df.volume}


def _hma(df, length):   return {"hma": _ta().hma(df.close, length=int(length))}
def _dema(df, length):  return {"dema": _ta().dema(df.close, length=int(length))}
def _tema(df, length):  return {"tema": _ta().tema(df.close, length=int(length))}
def _alma(df, length):  return {"alma": _ta().alma(df.close, length=int(length))}
def _vwma(df, length):  return {"vwma": _ta().vwma(df.close, df.volume, length=int(length))}


def _keltner(df, length, scalar):
    out = _ta().kc(df.high, df.low, df.close, length=int(length), scalar=float(scalar))
    c = list(out.columns)
    return {"upper": out[next(x for x in c if x.startswith("KCU"))],
            "middle": out[next(x for x in c if x.startswith("KCB"))],
            "lower": out[next(x for x in c if x.startswith("KCL"))]}


def _donchian(df, length):
    out = _ta().donchian(df.high, df.low, lower_length=int(length), upper_length=int(length))
    c = list(out.columns)
    return {"upper": out[next(x for x in c if x.startswith("DCU"))],
            "middle": out[next(x for x in c if x.startswith("DCM"))],
            "lower": out[next(x for x in c if x.startswith("DCL"))]}


def _psar(df, af, maxaf):
    out = _ta().psar(df.high, df.low, df.close, af=float(af), max_af=float(maxaf))
    c = list(out.columns)
    long_c = next(x for x in c if x.startswith("PSARl"))
    short_c = next(x for x in c if x.startswith("PSARs"))
    return {"psar": out[long_c].fillna(out[short_c])}


def _ichimoku(df, tenkan, kijun, senkou):
    vis, _fwd = _ta().ichimoku(df.high, df.low, df.close,
                               tenkan=int(tenkan), kijun=int(kijun), senkou=int(senkou))
    c = list(vis.columns)
    pick = lambda pre: vis[next(x for x in c if x.startswith(pre))]
    return {"span_a": pick("ISA"), "span_b": pick("ISB"),
            "tenkan": pick("ITS"), "kijun": pick("IKS")}


def _stochrsi(df, length):
    out = _ta().stochrsi(df.close, length=int(length))
    c = list(out.columns)
    return {"k": out[next(x for x in c if x.startswith("STOCHRSIk"))],
            "d": out[next(x for x in c if x.startswith("STOCHRSId"))]}


def _aroon(df, length):
    out = _ta().aroon(df.high, df.low, length=int(length))
    c = list(out.columns)
    return {"up": out[next(x for x in c if x.startswith("AROONU"))],
            "down": out[next(x for x in c if x.startswith("AROOND"))]}


def _willr(df, length):  return {"willr": _ta().willr(df.high, df.low, df.close, length=int(length))}
def _roc(df, length):    return {"roc": _ta().roc(df.close, length=int(length))}
def _trix(df, length):   return {"trix": _ta().trix(df.close, length=int(length)).iloc[:, 0]}
def _cmf(df, length):    return {"cmf": _ta().cmf(df.high, df.low, df.close, df.volume, length=int(length))}
def _natr(df, length):   return {"natr": _ta().natr(df.high, df.low, df.close, length=int(length))}
def _chop(df, length):   return {"chop": _ta().chop(df.high, df.low, df.close, length=int(length))}
def _zscore(df, length): return {"zscore": _ta().zscore(df.close, length=int(length))}
def _ao(df):             return {"ao": _ta().ao(df.high, df.low)}
def _uo(df):             return {"uo": _ta().uo(df.high, df.low, df.close)}
def _kvo(df):            return {"kvo": _ta().kvo(df.high, df.low, df.close, df.volume).iloc[:, 0]}


CATALOG += [
    Spec("pivots", "Pivot Points", "price",
         [Param("anchor", "day", options=PIVOT_ANCHORS),
          Param("method", "classic", options=[["classic", "Classic"],
                                              ["fib", "Fibonacci"],
                                              ["camarilla", "Camarilla"]]),
          Param("levels", 2, 1, 3)],
         [Line("P", "Pivot", "#eab308", width=2),
          Line("R1", "R1", "#f87171", style="dashed", width=1),
          Line("R2", "R2", "#ef4444", style="dashed", width=1),
          Line("R3", "R3", "#b91c1c", style="dashed", width=1),
          Line("S1", "S1", "#4ade80", style="dashed", width=1),
          Line("S2", "S2", "#22c55e", style="dashed", width=1),
          Line("S3", "S3", "#15803d", style="dashed", width=1)], _pivots,
         note="Support and resistance from the previous period's range. "
              "Anchor to the day, week, month, quarter, 6 months or year."),

    Spec("fvgavg", "FVG Positioning Avg", "price",
         [Param("lookback", 30, 2, 500), Param("ATR x", 0.25, 0.05, 5)],
         [Line("bull", "Bull average", "#089981"),
          Line("bear", "Bear average", "#F23645")], _fvg_avg,
         note="Average of recent unfilled gap edges, as dynamic support and "
              "resistance. A line breaks where price has not reached it."),

    # Volume gets its own pane, drawn as bars rather than a line.
    Spec("volume", "Volume", "sub", [],
         [Line("volume", "Volume", "#64748b", style="histogram")], _volume,
         note="Indices report no volume on Yahoo, so this stays empty for ^NSEI etc."),

    # ---- more overlays ---------------------------------------------------
    Spec("hma", "HMA", "price", [Param("length", 20)],
         [Line("hma", "HMA", "#fb7185")], _hma),
    Spec("dema", "DEMA", "price", [Param("length", 20)],
         [Line("dema", "DEMA", "#22d3ee")], _dema),
    Spec("tema", "TEMA", "price", [Param("length", 20)],
         [Line("tema", "TEMA", "#4ade80")], _tema),
    Spec("alma", "ALMA", "price", [Param("length", 20)],
         [Line("alma", "ALMA", "#facc15")], _alma),
    Spec("vwma", "VWMA", "price", [Param("length", 20)],
         [Line("vwma", "VWMA", "#f97316")], _vwma),
    Spec("keltner", "Keltner", "price", [Param("length", 20), Param("scalar", 2, 0.1, 10)],
         [Line("upper", "KC upper", "#818cf8", width=1),
          Line("middle", "KC mid", "#818cf8", style="dashed", width=1),
          Line("lower", "KC lower", "#818cf8", width=1)], _keltner),
    Spec("donchian", "Donchian", "price", [Param("length", 20)],
         [Line("upper", "DC upper", "#94a3b8", width=1),
          Line("middle", "DC mid", "#94a3b8", style="dashed", width=1),
          Line("lower", "DC lower", "#94a3b8", width=1)], _donchian),
    Spec("psar", "Parabolic SAR", "price", [Param("af", 0.02, 0.001, 1), Param("maxaf", 0.2, 0.01, 1)],
         [Line("psar", "PSAR", "#f43f5e", width=1)], _psar),
    Spec("ichimoku", "Ichimoku", "price",
         [Param("tenkan", 9), Param("kijun", 26), Param("senkou", 52)],
         [Line("tenkan", "Tenkan", "#38bdf8", width=1),
          Line("kijun", "Kijun", "#f43f5e", width=1),
          Line("span_a", "Span A", "#4ade80", style="dashed", width=1),
          Line("span_b", "Span B", "#f59e0b", style="dashed", width=1)], _ichimoku),

    # ---- more band indicators -------------------------------------------
    Spec("stochrsi", "Stoch RSI", "sub", [Param("length", 14)],
         [Line("k", "%K", "#38bdf8"), Line("d", "%D", "#f59e0b")], _stochrsi,
         note="0-100, with 20/80 guides."),
    Spec("aroon", "Aroon", "sub", [Param("length", 14)],
         [Line("up", "Aroon up", "#4ade80"), Line("down", "Aroon down", "#f43f5e")], _aroon),
    Spec("willr", "Williams %R", "sub", [Param("length", 14)],
         [Line("willr", "Williams %R", "#c084fc")], _willr, note="-100 to 0."),
    Spec("roc", "ROC", "sub", [Param("length", 12)],
         [Line("roc", "ROC", "#facc15")], _roc),
    Spec("trix", "TRIX", "sub", [Param("length", 18)],
         [Line("trix", "TRIX", "#22d3ee")], _trix),
    Spec("cmf", "Chaikin MF", "sub", [Param("length", 20)],
         [Line("cmf", "CMF", "#34d399")], _cmf),
    Spec("natr", "NATR", "sub", [Param("length", 14)],
         [Line("natr", "NATR", "#fb923c")], _natr, note="ATR as a percentage of price."),
    Spec("chop", "Choppiness", "sub", [Param("length", 14)],
         [Line("chop", "CHOP", "#a78bfa")], _chop, note="Above 61 is choppy, below 38 trending."),
    Spec("zscore", "Z-Score", "sub", [Param("length", 30)],
         [Line("zscore", "Z-Score", "#f472b6")], _zscore),
    Spec("ao", "Awesome Osc", "sub", [],
         [Line("ao", "AO", "#60a5fa")], _ao),
    Spec("uo", "Ultimate Osc", "sub", [],
         [Line("uo", "UO", "#fbbf24")], _uo, note="0-100, with 30/70 guides."),
    Spec("kvo", "Klinger", "sub", [],
         [Line("kvo", "KVO", "#94a3b8")], _kvo),
]

BY_ID = {s.id: s for s in CATALOG}
GUIDES.update({
    "stochrsi": [20, 80],
    "willr": [-80, -20],
    "uo": [30, 70],
    "chop": [38.2, 61.8],
    "aroon": [50],
    "zscore": [-2, 0, 2],
    "roc": [0],
    "cmf": [0],
    "ao": [0],
    "trix": [0],
})


# ==========================================================================
# The long tail — every other indicator pandas-ta exposes.
#
# The curated CATALOG above is what the fx menu shows by default. This builds
# generic entries for everything else so they can be switched on from Settings.
# Each is probed once against synthetic data and only kept if it actually
# returns something: the library has ~193 indicators and not all of them work
# on every input, so trusting the name list alone would put broken entries in
# the menu.
# ==========================================================================

AUTO_COLORS = ["#38bdf8", "#f59e0b", "#4ade80", "#f472b6", "#a78bfa",
               "#fb923c", "#22d3ee", "#facc15", "#fb7185", "#94a3b8"]

PRICE_CATEGORIES = {"overlap"}          # these draw on the candles; the rest get a band

_auto_cache = None


def _probe_frame(n=260):
    import numpy as np, pandas as pd

    rng = np.random.default_rng(11)
    close = 100 * np.cumprod(1 + rng.normal(0, 0.012, n))
    df = pd.DataFrame({
        "open": close * (1 + rng.normal(0, 0.002, n)),
        "high": close * (1 + abs(rng.normal(0, 0.006, n))),
        "low": close * (1 - abs(rng.normal(0, 0.006, n))),
        "close": close,
        "volume": rng.integers(1000, 50000, n).astype(float),
    })
    df.index = pd.to_datetime(
        [1700000000 + i * 900 for i in range(n)], unit="s", utc=True)
    return df


def _generic_fn(name):
    """Call df.ta.<name>(...) and turn whatever comes back into named series."""
    def fn(df, *args):
        import pandas as pd

        kwargs = {}
        if args:
            kwargs["length"] = int(args[0])
        try:
            result = getattr(df.ta, name)(**kwargs)
        except TypeError:
            result = getattr(df.ta, name)()        # doesn't take a length
        if result is None:
            return {}
        if isinstance(result, tuple):
            result = result[0]
        if isinstance(result, pd.Series):
            return {name: result}
        if isinstance(result, pd.DataFrame):
            return {str(c): result[c] for c in result.columns}
        return {}
    return fn


def _build_auto():
    ta = _ta()
    df = _probe_frame()
    curated = {s.id for s in CATALOG}
    specs = []

    for category, names in getattr(ta, "Category", {}).items():
        pane = "price" if category in PRICE_CATEGORIES else "sub"
        for name in names:
            if name in curated or not hasattr(df.ta, name):
                continue
            fn = _generic_fn(name)
            try:
                produced = fn(df, 14)
            except Exception:
                try:
                    produced = fn(df)
                except Exception:
                    continue
            cols = [k for k, v in (produced or {}).items()
                    if v is not None and hasattr(v, "dropna") and len(v.dropna()) > 0]
            if not cols:
                continue
            cols = cols[:4]
            lines = [Line(c, c, AUTO_COLORS[i % len(AUTO_COLORS)]) for i, c in enumerate(cols)]
            takes_length = False
            try:
                takes_length = fn(df, 20) is not None
            except Exception:
                pass
            specs.append(Spec(
                name, name.upper().replace("_", " "), pane,
                [Param("length", 14)] if takes_length else [],
                lines, fn, note=f"{category} · auto-generated wrapper",
            ))
    return specs


def all_specs():
    """Curated entries first, then everything else that actually works."""
    global _auto_cache
    if _auto_cache is None:
        try:
            _auto_cache = _build_auto()
        except Exception as err:
            print(f"[indicators] auto-catalog failed: {type(err).__name__}: {err}")
            _auto_cache = []
        for s in _auto_cache:
            if s.id not in BY_ID:
                BY_ID[s.id] = s
    return CATALOG + _auto_cache


def full_catalog():
    return [dict(s.describe(), curated=(s in CATALOG)) for s in all_specs()]


# ==========================================================================
# Overlays — things that are not a line over time.
#
# Volume Profile is a histogram across PRICE, and a Fair Value Gap is a
# rectangle. Neither can be a series, so they travel in their own list on the
# API response and are drawn by chart primitives in static/js/overlays.js.
# ==========================================================================

def volume_profile(candles, bins=24, value_area=0.70):
    """Volume by price level, plus the POC and value area.

    Each candle's volume is spread evenly across its high-low range rather than
    dumped on the close: a wide bar traded across all of those prices, and
    close-only binning produces a spiky profile that moves about when you
    change the bin count.
    """
    if not candles:
        return None
    lo = min(c["low"] for c in candles)
    hi = max(c["high"] for c in candles)
    if hi <= lo:
        return None
    bins = max(6, min(int(bins), 120))
    step = (hi - lo) / bins

    up = [0.0] * bins
    down = [0.0] * bins
    for c in candles:
        vol = float(c.get("volume") or 0)
        if vol <= 0:
            continue
        first = max(0, min(bins - 1, int((c["low"] - lo) / step)))
        last = max(0, min(bins - 1, int((c["high"] - lo) / step)))
        touched = last - first + 1
        share = vol / touched
        bucket = up if c["close"] >= c["open"] else down
        for b in range(first, last + 1):
            bucket[b] += share

    totals = [up[i] + down[i] for i in range(bins)]
    grand = sum(totals)
    if grand <= 0:
        return None

    poc = max(range(bins), key=lambda i: totals[i])

    # grow outwards from the POC until 70% of traded volume is enclosed
    lo_i = hi_i = poc
    covered = totals[poc]
    while covered < grand * value_area and (lo_i > 0 or hi_i < bins - 1):
        below = totals[lo_i - 1] if lo_i > 0 else -1
        above = totals[hi_i + 1] if hi_i < bins - 1 else -1
        if above >= below:
            hi_i += 1
            covered += totals[hi_i]
        else:
            lo_i -= 1
            covered += totals[lo_i]

    return {
        "type": "volume_profile",
        "bins": [
            {"low": lo + i * step, "high": lo + (i + 1) * step,
             "up": round(up[i], 2), "down": round(down[i], 2),
             "total": round(totals[i], 2),
             "inValueArea": lo_i <= i <= hi_i}
            for i in range(bins)
        ],
        "max": round(max(totals), 2),
        "poc": lo + (poc + 0.5) * step,
        "vah": lo + (hi_i + 1) * step,
        "val": lo + lo_i * step,
    }


def _atr_values(candles, length=200):
    """Wilder ATR as a plain list, with a sensible value before it warms up.

    Early bars fall back to the running average range, which is what the
    reference Pine script does — otherwise the first 200 bars would have no
    threshold at all and every hairline gap would qualify.
    """
    n = len(candles)
    if not n:
        return []
    trs = []
    cum = 0.0
    out = []
    prev_close = candles[0]["close"]
    atr = None
    for i, c in enumerate(candles):
        tr = max(c["high"] - c["low"],
                 abs(c["high"] - prev_close),
                 abs(c["low"] - prev_close))
        prev_close = c["close"]
        trs.append(tr)
        cum += c["high"] - c["low"]
        if i + 1 == length:
            atr = sum(trs[-length:]) / length
        elif atr is not None:
            atr = (atr * (length - 1) + tr) / length
        out.append(atr if atr is not None else cum / (i + 1))
    return out


def detect_fvgs(candles, atr_mult=0.25, atr_length=200):
    """Three-bar imbalances, filtered the way the LuxAlgo script does it.

    Two conditions beyond the bare gap:

    * the gap must be wider than ATR x multiplier, so the threshold scales
      with each instrument's own volatility instead of a fixed percentage
      that is huge on a quiet ETF and meaningless on a volatile smallcap;
    * the middle candle must CLOSE beyond the gap, not merely poke through it,
      which filters out a long wick that left a gap behind it.
    """
    atr = _atr_values(candles, atr_length)
    found = []
    for i in range(2, len(candles)):
        a, mid, c = candles[i - 2], candles[i - 1], candles[i]
        threshold = atr[i] * atr_mult
        if (c["low"] > a["high"] and mid["close"] > a["high"]
                and (c["low"] - a["high"]) > threshold):
            found.append({"i": i, "time": c["time"], "dir": "bull",
                          "bottom": a["high"], "top": c["low"]})
        elif (c["high"] < a["low"] and mid["close"] < a["low"]
                and (a["low"] - c["high"]) > threshold):
            found.append({"i": i, "time": c["time"], "dir": "bear",
                          "bottom": c["high"], "top": a["low"]})
    return found


def fair_value_gaps(candles, atr_mult=0.25, keep=14):
    """Three-bar imbalances (ICT 'fair value gaps').

    Bullish when a bar's low sits above the high of two bars earlier, leaving
    a band of prices nobody traded through. A gap is 'filled' once a later bar
    trades back into it; filled ones are kept but flagged, because where price
    reacted still matters.
    """
    if len(candles) < 3:
        return None
    zones = []
    for gap in detect_fvgs(candles, atr_mult):
        i, direction = gap["i"], gap["dir"]
        bottom, top = gap["bottom"], gap["top"]

        filled_time = None
        for j in range(i + 1, len(candles)):
            nxt = candles[j]
            if (direction == "bull" and nxt["low"] <= bottom) or \
               (direction == "bear" and nxt["high"] >= top):
                filled_time = nxt["time"]
                break
        zones.append({
            "time": gap["time"], "top": top, "bottom": bottom,
            "dir": direction, "filledTime": filled_time,
        })

    zones.sort(key=lambda z: (z["filledTime"] is not None,
                              -(z["top"] - z["bottom"]) / (z["top"] or 1)))
    return {"type": "fvg", "zones": zones[:keep], "lastTime": candles[-1]["time"]}


OVERLAY_SPECS = {
    "vprofile": {
        "id": "vprofile", "label": "Volume Profile", "pane": "overlay",
        "params": [{"name": "bins", "default": 24, "min": 6, "max": 120}],
        "lines": [{"key": "vprofile", "name": "Volume Profile", "color": "#60a5fa"}],
        "note": "Volume by price, with POC and 70% value area. Needs volume, "
                "so indices show nothing.",
        "fn": lambda candles, *a: volume_profile(candles, a[0] if a else 24),
    },
    "fvg": {
        "id": "fvg", "label": "Fair Value Gaps", "pane": "overlay",
        "params": [{"name": "ATR x", "default": 0.25, "min": 0.05, "max": 5}],
        "lines": [{"key": "fvg", "name": "FVG", "color": "#22c55e"}],
        "note": "Three-bar imbalances sized against ATR, so the threshold scales "
                "with each instrument. Unfilled are outlined, filled are faded.",
        "fn": lambda candles, *a: fair_value_gaps(candles, a[0] if a else 0.25),
    },
}


def overlay_catalog():
    return [{k: v for k, v in spec.items() if k != "fn"} | {"curated": True}
            for spec in OVERLAY_SPECS.values()]


def compute_overlays(candles, spec_text):
    out = []
    for chunk in (spec_text or "").split(","):
        bits = chunk.strip().split(":")
        name = bits[0].strip().lower()
        spec = OVERLAY_SPECS.get(name)
        if not spec or not candles:
            continue
        args = []
        for b in bits[1:]:
            try:
                args.append(float(b))
            except ValueError:
                pass
        try:
            result = spec["fn"](candles, *args)
        except Exception as err:
            print(f"[overlays] {name} failed: {type(err).__name__}: {err}")
            continue
        if result:
            result["key"] = ":".join([name] + [_fmt(a) for a in args])
            out.append(result)
    return out


# ==========================================================================
# Candlestick patterns — TA-Lib's 61 recognisers, drawn as markers.
#
# These are not lines either: each one flags individual candles, so they come
# back as chart markers (an arrow under a bullish candle, above a bearish one)
# rather than a series. TA-Lib returns +100 bullish, -100 bearish, 0 nothing.
#
# A handful are curated into the fx menu; the rest are available from Settings.
# ==========================================================================

PATTERN_CURATED = {
    "CDLENGULFING", "CDLHAMMER", "CDLINVERTEDHAMMER", "CDLSHOOTINGSTAR",
    "CDLDOJI", "CDLMORNINGSTAR", "CDLEVENINGSTAR", "CDLHARAMI",
    "CDL3WHITESOLDIERS", "CDL3BLACKCROWS", "CDLPIERCING", "CDLDARKCLOUDCOVER",
    "CDLMARUBOZU", "CDLHANGINGMAN",
}

_patterns_cache = None


def _talib():
    import talib
    return talib


def _pretty_pattern(fn_name):
    """CDL3WHITESOLDIERS -> '3 White Soldiers'"""
    import re

    body = fn_name[3:].title()
    body = re.sub(r"(\d+)", r" \1 ", body)
    return " ".join(body.split())


def pattern_specs():
    """One entry per TA-Lib CDL function, discovered from the library itself."""
    global _patterns_cache
    if _patterns_cache is not None:
        return _patterns_cache
    try:
        talib = _talib()
        names = [f for f in talib.get_functions() if f.startswith("CDL")]
    except Exception as err:
        print(f"[patterns] TA-Lib unavailable ({err}); candlestick patterns disabled")
        _patterns_cache = []
        return _patterns_cache

    _patterns_cache = [{
        "id": "pat_" + name[3:].lower(),
        "label": _pretty_pattern(name),
        "pane": "markers",
        "params": [],
        "lines": [{"key": name, "name": _pretty_pattern(name), "color": "#22c55e"}],
        "note": "Candlestick pattern · arrows on matching candles",
        "curated": name in PATTERN_CURATED,
        "_fn": name,
    } for name in sorted(names)]
    return _patterns_cache


PATTERN_BY_ID = None


def _pattern_index():
    global PATTERN_BY_ID
    if PATTERN_BY_ID is None:
        PATTERN_BY_ID = {p["id"]: p for p in pattern_specs()}
    return PATTERN_BY_ID


def pattern_catalog():
    return [{k: v for k, v in p.items() if not k.startswith("_")} for p in pattern_specs()]


def compute_markers(candles, spec_text):
    """Markers for every requested pattern, merged and sorted by time."""
    wanted = [b.strip().split(":")[0].lower() for b in (spec_text or "").split(",")]
    index = _pattern_index()
    active = [index[w] for w in wanted if w in index]
    if not active or len(candles) < 5:
        return []

    import numpy as np

    talib = _talib()
    o = np.array([c["open"] for c in candles], dtype=float)
    h = np.array([c["high"] for c in candles], dtype=float)
    low = np.array([c["low"] for c in candles], dtype=float)
    cl = np.array([c["close"] for c in candles], dtype=float)

    out = []
    for spec in active:
        try:
            result = getattr(talib, spec["_fn"])(o, h, low, cl)
        except Exception as err:
            print(f"[patterns] {spec['_fn']} failed: {err}")
            continue
        short = spec["label"]
        for i, raw in enumerate(result):
            val = int(raw)
            if val == 0:
                continue
            bullish = val > 0
            out.append({
                "time": candles[i]["time"],
                "position": "belowBar" if bullish else "aboveBar",
                "shape": "arrowUp" if bullish else "arrowDown",
                "color": "#22c55e" if bullish else "#ef4444",
                "text": short,
            })

    out.sort(key=lambda m: m["time"])
    return out[-300:]        # a busy chart with several patterns would be unreadable
