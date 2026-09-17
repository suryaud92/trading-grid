"""
optionchain.py — NSE-style option chain, built from Kite's data.

Kite gives strikes, expiries, last price, open interest, volume and market
depth. It does NOT give implied volatility, so that is computed here from the
option's own price by inverting Black-Scholes.

Everything needs a live Zerodha connection: yfinance has no Indian options at
all, so there is no free fallback for this screen.
"""

from __future__ import annotations

import datetime
import math

import data_source as ds

RISK_FREE = 0.065          # ~India 10y; IV is only mildly sensitive to this
MAX_STRIKES = 60           # rows either side of the money, before the UI trims


# --------------------------------------------------------------- pricing ---

def _norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def black_scholes(spot, strike, years, vol, is_call, rate=RISK_FREE):
    if years <= 0 or vol <= 0 or spot <= 0 or strike <= 0:
        intrinsic = (spot - strike) if is_call else (strike - spot)
        return max(intrinsic, 0.0)
    d1 = (math.log(spot / strike) + (rate + 0.5 * vol * vol) * years) / (vol * math.sqrt(years))
    d2 = d1 - vol * math.sqrt(years)
    disc = math.exp(-rate * years)
    if is_call:
        return spot * _norm_cdf(d1) - strike * disc * _norm_cdf(d2)
    return strike * disc * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


def implied_vol(price, spot, strike, years, is_call, rate=RISK_FREE):
    """Invert Black-Scholes by bisection.

    Bisection rather than Newton: it cannot diverge, and deep out-of-the-money
    options have a vega near zero where Newton happily runs off to infinity.
    Thirty iterations over 1%..600% lands within a rounding error.
    """
    if price is None or price <= 0 or years <= 0 or spot <= 0:
        return None

    # The floor is the DISCOUNTED bound, not plain intrinsic. A deep
    # in-the-money European put legitimately trades below K - S, because the
    # strike is received at expiry rather than today; using undiscounted
    # intrinsic rejected perfectly good quotes and printed no IV for them.
    disc = strike * math.exp(-rate * years)
    floor = max((spot - disc) if is_call else (disc - spot), 0.0)
    if price < floor - 1e-6:
        return None                       # genuinely below fair value: bad quote

    lo, hi = 0.01, 6.0
    if black_scholes(spot, strike, years, hi, is_call, rate) < price:
        return None                       # not solvable inside a sane range
    for _ in range(30):
        mid = (lo + hi) / 2
        if black_scholes(spot, strike, years, mid, is_call, rate) < price:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2 * 100, 2)   # as a percentage


# ------------------------------------------------------------ instruments ---

def _fno():
    """{underlying: {expiry: {strike: {'CE': key, 'PE': key}}}} from the dump."""

    def build():
        tree = {}
        for key, r in ds._kite_instruments().items():
            if r.get("kind") != "OPT" or not key.startswith("NFO:"):
                continue
            name = r["name"]
            exp = r["expiry"]
            side = r["tradingsymbol"][-2:]
            if side not in ("CE", "PE") or not exp:
                continue
            tree.setdefault(name, {}).setdefault(exp, {}) \
                .setdefault(r["strike"], {})[side] = key
        return tree

    return ds.cached(43200.0, "oc:tree", build)


def underlyings():
    tree = _fno()
    head = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX"]
    names = sorted(tree)
    ordered = [n for n in head if n in tree] + [n for n in names if n not in head]
    return [{"name": n, "expiries": sorted(tree[n])} for n in ordered]


def expiries(underlying):
    return sorted(_fno().get(underlying, {}))


# ------------------------------------------------------------------ chain ---

def _spot_for(underlying):
    """Index level, or the cash price for a stock underlying."""
    index_map = {
        "NIFTY": "NSE:NIFTY 50", "BANKNIFTY": "NSE:NIFTY BANK",
        "FINNIFTY": "NSE:NIFTY FIN SERVICE", "MIDCPNIFTY": "NSE:NIFTY MID SELECT",
        "NIFTYNXT50": "NSE:NIFTY NEXT 50", "SENSEX": "BSE:SENSEX",
    }
    candidate = index_map.get(underlying, "NSE:" + underlying)
    try:
        quotes = ds.kite_quotes([candidate])
        if candidate in quotes:
            return quotes[candidate]["price"], candidate
    except Exception:
        pass
    return None, candidate


def chain(underlying, expiry=None, around=25, center=None):
    tree = _fno().get(underlying)
    if not tree:
        raise ValueError(f"no option contracts for '{underlying}'")
    exps = sorted(tree)
    expiry = expiry if expiry in tree else exps[0]
    strikes = sorted(tree[expiry])
    if not strikes:
        raise ValueError("that expiry has no strikes")

    spot, spot_key = _spot_for(underlying)

    all_strikes = list(strikes)

    # Only quote strikes near the middle: a full chain runs to 400 contracts
    # and Kite caps a quote call at 500 instruments. `center` lets the user
    # pin the window to a strike of their choosing instead of the money.
    anchor = center if center in strikes else (
        min(strikes, key=lambda s: abs(s - spot)) if spot else None)
    if anchor is not None:
        at = strikes.index(anchor)
        strikes = strikes[max(0, at - around):at + around + 1]
    else:
        strikes = strikes[:2 * around + 1]

    keys = []
    for st in strikes:
        for side in ("CE", "PE"):
            k = tree[expiry][st].get(side)
            if k:
                keys.append(k)

    kite = ds._kite()
    quotes = {}
    for i in range(0, len(keys), 400):           # Kite caps a quote call
        quotes.update(kite.quote(*keys[i:i + 400]) or {})

    try:
        exp_date = datetime.date.fromisoformat(expiry)
    except ValueError:
        exp_date = datetime.date.today()
    # options expire at 15:30 IST
    exp_dt = datetime.datetime.combine(exp_date, datetime.time(15, 30),
                                       datetime.timezone(datetime.timedelta(minutes=330)))
    years = max((exp_dt - datetime.datetime.now(exp_dt.tzinfo)).total_seconds(), 0) / (365 * 86400)

    def leg(key, strike, is_call):
        q = quotes.get(key)
        if not q:
            return None
        depth = q.get("depth") or {}
        buy = (depth.get("buy") or [{}])[0]
        sell = (depth.get("sell") or [{}])[0]
        ltp = q.get("last_price")
        bid, ask = buy.get("price"), sell.get("price")
        oi, vol = q.get("oi") or 0, q.get("volume") or 0

        # Which price is worth believing?
        #
        # On an illiquid chain most contracts never trade, and their "last
        # price" is a stale print from days ago — we saw calls quoted at three
        # times their intrinsic value. Feeding that to Black-Scholes produces a
        # confident, meaningless 80% IV. So prefer the live mid when there is a
        # real two-sided market, fall back to the last trade only if something
        # actually traded, and otherwise decline to publish an IV at all.
        price, basis = None, None
        if bid and ask and ask > bid:
            spread = (ask - bid) / ((ask + bid) / 2)
            if spread < 0.6:
                price, basis = (bid + ask) / 2, "mid"
        if price is None and ltp and (vol > 0 or oi > 0):
            price, basis = ltp, "ltp"

        iv = implied_vol(price, spot, strike, years, is_call) if (spot and price) else None
        # a genuine option rarely trades above 200% vol; beyond that the input
        # is junk rather than the market being excited
        if iv is not None and iv > 200:
            iv, basis = None, None

        return {
            "symbol": key,
            "oi": q.get("oi"),
            "volume": q.get("volume"),
            "ltp": ltp,
            "change": q.get("net_change"),
            "bid": bid, "bidQty": buy.get("quantity"),
            "ask": ask, "askQty": sell.get("quantity"),
            "iv": iv,
            "ivFrom": basis,
            "traded": bool(vol or oi),
        }

    rows = []
    for st in strikes:
        pair = tree[expiry][st]
        rows.append({
            "strike": st,
            "call": leg(pair.get("CE"), st, True) if pair.get("CE") else None,
            "put": leg(pair.get("PE"), st, False) if pair.get("PE") else None,
        })

    return {
        "underlying": underlying,
        "spot": spot,
        "spotSymbol": spot_key,
        "expiry": expiry,
        "expiries": exps,
        "rows": rows,
        "strikes": all_strikes,
        "center": anchor,
        "daysToExpiry": round(years * 365, 2),
        "asOf": int(datetime.datetime.now().timestamp()),
    }
