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
    f = float(v)
    return str(int(f)) if f == int(f) else str(f)

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
