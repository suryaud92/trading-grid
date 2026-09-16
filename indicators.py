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
    default: float
    min: float = 1
    max: float = 500


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
            "params": [{"name": p.name, "default": p.default, "min": p.min, "max": p.max}
                       for p in self.params],
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
                pass
        out.append((ind_id, args))
    return out[:8]                      # a sane cap per pane


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
            if tail:
                data = data[-tail:]
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
    return out


def _fmt(v):
    f = float(v)
    return str(int(f)) if f == int(f) else str(f)
