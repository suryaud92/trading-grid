# Live Trading Grid

A private split-screen dashboard of live Indian-market candlestick charts
(TradingView **Lightweight Charts**), 1–8 panes, each with its own symbol and
timeframe. Google sign-in, locked to one superadmin account.

* **yfinance** — NSE/BSE via Yahoo. Free, delayed, always available.
* **Zerodha Kite** — real exchange ticks. Configured from the **Settings**
  screen in the UI; no env vars, no redeploy.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py          # http://127.0.0.1:5057
```

With no `FIREBASE_PROJECT_ID` set, **auth is off** and the app opens straight to
the grid — which is what you want on localhost, and is why the startup banner
says so out loud. Never expose that configuration to the internet.

## Using it

| | |
|---|---|
| **Layout 1 / 2 / 2↕ / 3 / 4 / 6 / 8** | 2 side by side, 2↕ stacked, 3 as one large plus two companions, then 2×2, 3×2, 4×2. Bound to the matching keys. |
| **⛶ Maximise** | Blow one chart up full-screen and back. Keyboard: `F` on the active chart. |
| **☰ Watchlist** | Categorised lists (Indian, US tech, Crypto & commodities) in a side drawer, editable, with ↺ to restore the defaults. Clicking loads into the chart you last clicked — or into every chart when symbol sync is on. |
| **✛ Crosshair / 🔗 Symbol** | Scrub time across every chart at once, and change them all to one ticker together. |
| **Symbol search** | Type in a chart's symbol box. Matches appear as you go, by ticker *or* company name. On Zerodha this searches **all ~23,000** NSE/BSE instruments server-side, not just the dropdown's head; on yfinance it suggests the `.NS` / `.BO` spellings Yahoo needs. |
| **Timeframes** | `1m 3m 5m 15m 30m 1h 2h 4h 1D 1W 1MO`, independent per pane. Yahoo has no 3m/2h/4h bars so those are rolled up from 1m and 1h, bucketed on local time so they align to the Indian session rather than to midnight UTC. |
| **fx Indicators** | 14 indicators via pandas-ta — moving averages, Bollinger, Supertrend, VWAP on the chart; RSI, MACD, Stochastic, ATR, ADX, CCI, MFI, OBV in a band below. Editable periods, saved per pane. |
| **🔔 Alerts** | Price alerts above/below a level. Fires a toast, a chime and a desktop notification. |
| **Ticker bar** | Flashes green on an uptick, red on a downtick. |
| **⚙ Settings** | Connect/disconnect Zerodha. |

### Indicators

Click **fx** on any pane. Fourteen indicators, computed server-side with
**pandas-ta**:

**35 of them**, with a filter box in the menu:

| On the chart (15) | In a band below (20) |
|---|---|
| SMA, EMA, WMA, HMA, DEMA, TEMA, ALMA, VWMA, Bollinger, Keltner, Donchian, Supertrend, VWAP, Parabolic SAR, Ichimoku | RSI, Stoch RSI, MACD, Stochastic, ATR, NATR, ADX, CCI, MFI, OBV, CMF, Klinger, Aroon, Williams %R, ROC, TRIX, Choppiness, Z-Score, Awesome Osc, Ultimate Osc |

Add as many overlays as you like — the same one twice with different periods is
fine, so SMA 20 and SMA 50 sit together — and **up to three band indicators**,
each of which gets **its own pane** below the price, with its own price axis and
a divider, the way TradingView does it. That needs real panes, which arrived in
lightweight-charts v5 (`addSeries(Type, opts, paneIndex)`); the code still falls
back to stacked scale margins if it ever runs against v4.

**Volume** is in the list too, drawn as bars coloured by whether the candle
closed up. Yahoo reports no volume for indices, so it stays empty for `^NSEI`
and friends — the pane simply does not appear rather than showing a flat line.

### The full catalog, and the fx menu

`/api/indicators` returns **194** indicators: 36 hand-curated plus 158 generated
by wrapping the rest of pandas-ta. Each generated one is probed once against
synthetic data at startup and only kept if it actually returns something — the
library lists ~193 names and not all of them work on every input, so trusting
the name list alone would put broken entries in the menu.

The **fx menu shows only your chosen subset** (the 36 curated ones by default),
so it stays short. **Settings → Indicator menu** lists all 194 with a search box;
tick any to add it to fx. That choice lives in `localStorage` — it is a display
preference, not a credential. "Reset to defaults" puts it back.

`pandas-ta-classic` is used rather than `pandas-ta`: the original now depends on
numba, which has no Python 3.14 wheels and cannot be installed on current
interpreters. The fork keeps the same API and works on pandas 3 / numpy 2. Its
RSI was checked against an independent Wilder implementation and matches to
2.5e-14.

**Adding one is a single entry** in `indicators.py` — the API, the pane menu and
the chart all read from that catalog, so there is no frontend list to keep in
sync.

Two consequences of computing on the server worth knowing:

* Indicators update with the candle refresh, not on every price tick. That
  refresh is **4s on Zerodha and 15s on yfinance** — there is no point polling
  yfinance faster, because its prices are already ~15 minutes delayed.
  Identical requests are served from a compute cache keyed on the last bar, so
  a fast poll costs almost nothing on the server (~1000x faster than a cold
  computation).
* Values are always computed over the full history even when the browser is
  only topping up the last ten bars — a 200-period SMA needs 200 bars. The
  server computes deep and trims, so the cheap refresh gives numbers identical
  to a full reload. A top-up is ~2.2 KB with five indicators running; eight
  panes at the 4s Zerodha rate come to about 2.2 GB/month, at 15s about 0.6 GB,
  against Render's 5 GB allowance.

### How much history you get

A chart opens with **600 bars** so it appears quickly, then **loads more as you
scroll back**, doubling the window each time until the source runs out. Nothing
extra is fetched unless you actually scroll, so the initial load and the
bandwidth budget are unaffected.

The ceiling is whatever the data source will give. For yfinance that is Yahoo's
own limit per interval, and the lookback windows now sit at those limits:

| Timeframe | Bars available | Reaches back to |
|---|---|---|
| 1m | ~2,000 | 7 days (Yahoo's cap) |
| 5m | ~4,300 | 60 days |
| 15m | ~1,400 | 60 days |
| 1h | 5,000+ | ~3 years |
| 1D | ~2,500 | 10 years |
| 1W | ~1,600 | 1995 |
| 1MO | ~370 | 1995 |

A request is clamped to 5,000 bars server-side. Daily is held at 10 years
rather than Yahoo's full history because every pane refresh would otherwise
drag decades of bars through a 0.1 CPU instance for no visible gain.

### Finding a symbol

There are two boxes and they do different jobs, which is easy to trip over:

* A **chart's symbol box** is the search. It queries the source for anything it
  carries — typing `goldbees` finds `NSE:GOLDBEES` on Zerodha or suggests
  `GOLDBEES.NS` on yfinance.
* The **watchlist filter** only filters that list's own entries. If what you
  type isn't there it offers to add it, and points you at the chart box.

Kite carries about 23,000 NSE+BSE instruments. Shipping those to the browser
would be megabytes for something you type two letters into, so the dropdown
holds a short list and everything else is found through `/api/symbols`, merged
in as you type.

### Watchlists and symbol spelling

Each source spells symbols its own way: yfinance wants `RELIANCE.NS` and
`^NSEI`, Zerodha wants `NSE:RELIANCE` and `NSE:NIFTY 50`. Rather than keeping a
separate list per broker, watchlist entries are **translated on the way into a
pane** — clicking Reliance loads the right spelling for whichever source that
chart is on.

US stocks, crypto and commodities have no Zerodha listing at all. Those entries
are shown struck through when the active chart is on Zerodha, and clicking one
explains itself rather than failing silently.

A stored list that has somehow lost its contents is refilled from the defaults
on load, so the drawer can never strand you with an empty list and no way back.
The ↺ button restores everything.

### Candlestick patterns

All **61 TA-Lib pattern recognisers** — Engulfing, Hammer, Morning Star, Doji,
Three White Soldiers and the rest. They flag individual candles rather than
drawing a line, so they arrive as **markers**: a green arrow under a bullish
candle, a red one above a bearish one, labelled with the pattern name.

Fourteen common ones are in the fx menu; the other 47 are in Settings. Turning
on several at once gets noisy fast — Engulfing alone fires ~45 times in 300
daily bars — so pick the two or three you actually trade.

TA-Lib ships prebuilt wheels now, so it installs without the C-library dance it
used to need.

### Volume Profile and Fair Value Gaps

Neither is a line over time — one is a histogram across *price*, the other a set
of rectangles — so neither can be a chart series. They are painted with
lightweight-charts v5 **primitives** (`static/js/overlays.js`), which hand you a
canvas plus `priceToCoordinate` / `timeToCoordinate`. They travel in their own
`overlays` list on the API response.

**Volume Profile** spreads each candle's volume evenly across its high-low range
rather than dumping it on the close — a wide bar traded at all of those prices,
and close-only binning gives a spiky profile that shifts when you change the bin
count. Volume is conserved exactly. Bars split green/red by whether the candle
closed up, the **POC** (busiest price) is marked, and the **70% value area** is
drawn brighter than the rest. Indices have no volume on Yahoo, so nothing draws.

**Fair Value Gaps** are three-bar imbalances: a bullish gap is a bar whose low
sits above the high from two bars back, leaving prices nobody traded through.
Two filters, both taken from LuxAlgo's Pine implementation:

* the gap must exceed **ATR × 0.25**, so the threshold scales with each
  instrument's own volatility. A fixed percentage cannot: 0.15% is a large move
  on a quiet ETF and noise on a volatile smallcap.
* the middle candle must **close** beyond the gap, not merely poke through it,
  which rejects a long wick that happened to leave a gap behind it.

A gap is marked filled once a later bar trades back into it; filled ones stay on
the chart but faded, because where price reacted still matters. Biggest unfilled
gaps are kept first, capped at 14.

**FVG Positioning Average** turns those gaps into two levels rather than a
scatter of boxes: the average of recent bullish gap *bottoms*, and of bearish
gap *tops*. Where unfilled imbalances cluster tends to be where price reacts, so
the pair act as dynamic support and resistance. Each line breaks where price has
not yet reached it — an average price never traded through is not a level yet.
The gradient shading from the original is not reproduced; the lines are.

### Alerts

Alerts fire on a **crossing**, not on the condition merely being true: setting
"above 100" while the price is already 105 does not fire instantly. It arms
when the price falls back below and fires on the way up. Each fires once.

They are checked **in the browser**, so they only work while the dashboard is
open in a tab. Nothing will reach you overnight or with the laptop shut — that
would need a server-side watcher, which this does not have.

### What the change percentage means

Intraday timeframes show the change **since the previous session's close**
("change today"). Daily, weekly and monthly show the change within the current
bar — this day, this week, this month.

Layout, every pane's config and your custom tickers persist in `localStorage`.

---

## Hosting: read this first

**GitHub Pages and Firebase Hosting are static-only. Neither can run Flask, and
the backend is not optional here.** I tested this from a browser: Zerodha's API
(including the public instrument dump) and Yahoo both return **no
`Access-Control-Allow-Origin` header**, so a page fetching them directly is
blocked by CORS every time. There is no static-only version of this app.

So you need one small always-on Python process. Two shapes:

### Option A — everything in one place (recommended)

Flask serves the API *and* the frontend. One deploy, no CORS, no second URL.
Firebase is used only for Google sign-in, which is free on the Spark plan.

**Render's free tier** is the current free option, and `render.yaml` is included.
Its documented limits matter here:

* spins down after **15 minutes** with no traffic; the next visit takes ~1 min
* **ephemeral filesystem** — wiped on every redeploy, restart *and* spin-down
* 750 free instance-hours per month per workspace

That second point is the one that stings: `instance/settings.json` does not
survive a spin-down, so your saved Kite credentials vanish whenever the app has
been idle. Put `KITE_API_KEY` and `KITE_API_SECRET` in Render's environment
variables so only the access token is lost, and you are back to the daily
reconnect you already have to do.

To stop losing the access token too, move the settings store to Firestore (free
on the Spark plan you are already using for sign-in) — `settings.py` is the only
file that changes.

> **Hugging Face Spaces no longer works for this.** Its free tier offers only
> the Static SDK; Docker and Gradio Spaces now require a paid plan, and Static
> cannot run Python. Other options that genuinely stay awake — Oracle Cloud's
> Always Free VM, Google Cloud Run — need a credit card on file even where the
> usage itself is free.

> Serverless (Vercel/Netlify functions, Firebase Cloud Functions) does **not**
> suit the current design: the Kite tick websocket needs a process that stays
> alive between requests. Firebase Cloud Functions also require the paid Blaze
> plan.

### Option B — frontend on Firebase Hosting / GitHub Pages

Only if you specifically want it. Deploy `static/` there, put the backend on one
of the hosts above, and connect the two:

1. In `static/index.html`, set `window.API_BASE = 'https://your-backend.example'`
2. On the backend, set `ALLOWED_ORIGINS=https://your-frontend.web.app`

The page uses relative asset paths, so a GitHub Pages subpath works unchanged.
`firebase.json` is included for `firebase deploy --only hosting`.

---

## Sign-in setup (one superadmin)

1. Create a Firebase project → **Authentication → Sign-in method → enable Google**.
2. **Authentication → Settings → Authorized domains**: add the domain the app is
   served from (`your-app.onrender.com`, `you.github.io`, …).
3. **Project settings → Your apps → Web app** gives you the config object.
4. Set on the backend:

```bash
export FIREBASE_PROJECT_ID=your-project-id
export SUPERADMIN_EMAIL=you@gmail.com
export FIREBASE_WEB_CONFIG='{"apiKey":"...","authDomain":"...","projectId":"..."}'
```

Anyone can sign in with Google; only `SUPERADMIN_EMAIL` gets past the server.
Everyone else is signed straight back out with "not authorised".

**Where the security actually is.** The sign-in screen is convenience — the
bundle is public and anyone can call the API directly. The real check is
`auth.py`, which on *every* `/api` request verifies the ID token's signature
against Google's public keys, checks `aud`/`iss` match your project (so a token
minted for a different Firebase project is refused), checks expiry and
`email_verified`, and then compares the email. A forged token with the right
email but the wrong signature is rejected. `/api/health` and `/api/config` are
deliberately public; everything else is gated.

## Connecting Zerodha

Settings (⚙) → paste your Kite **API key** and **secret** → Save → **Open Kite
login** → sign in at Zerodha. That's it: Zerodha returns you to the dashboard
with `?request_token=...` on the URL, and the app finishes the connection
itself, then strips the token from the address bar (it is a credential, and a
stale one would fail confusingly on the next refresh).

Pasting the token by hand still works from Settings if the automatic path ever
fails. For the redirect to come back to the right place, the **Redirect URL** on
your Kite app must exactly match where the dashboard is served from, e.g.
`https://trading-grid.onrender.com/`.

When creating the Kite app, pick the **Connect** type: the free *Personal* type
excludes historical chart data and live quotes, which are the two things this
app runs on.

"Zerodha (Kite)" then appears in every pane's source dropdown with ~600 NSE/BSE
symbols and intervals `1m 3m 5m 10m 15m 30m 1h 1d`. Symbols are
`EXCHANGE:TRADINGSYMBOL` — `NSE:RELIANCE`, `NSE:NIFTY 50`, `BSE:RELIANCE`.

**Credentials never reach the browser.** They live in `instance/settings.json`
(chmod 600, gitignored); the Settings screen only ever receives masked values.
That is deliberate: a Kite access token can place orders on your account.

**The daily reconnect.** Kite access tokens expire every morning (~6am IST) and
there is no refresh token, so you redo the login step each trading day.
Zerodha's design, not this app's; automating it with stored credentials or TOTP
is against their terms. Also note Kite Connect is a paid subscription and
historical candles are a separate add-on — without it, live prices work but
charts won't load.

On a host with an ephemeral disk (Render free, HF Spaces), `instance/` is wiped
on redeploy. Set `KITE_API_KEY` and `KITE_API_SECRET` as env vars so only the
daily access-token step is left.

## Keeping it awake (Render free tier)

Render shuts a free service down after 15 minutes without traffic and wipes its
disk, which drops the saved Zerodha connection. `.github/workflows/keep-awake.yml`
pings `/api/health` every 10 minutes during Indian market hours to prevent that.

It is deliberately **not** 24/7: Render allows 750 free instance-hours a month
and a month is 744 hours, so running round the clock would consume the whole
allowance and suspend the service. The market-hours window costs about 180 hours
a month instead. Outside those hours it sleeps, which costs nothing — the Kite
token expires around 6am IST daily, so you reconnect each morning either way.

Change `APP_URL` in that file if your Render URL changes. GitHub disables
scheduled workflows after 60 days of repo inactivity; any commit re-enables it.

### Staying inside the free tier

Measured, not estimated:

| | |
|---|---|
| Memory | ~150 MB peak with a full 8-symbol grid, against **512 MB** |
| CPU | a full 8-pane refresh cycle completes in ~6 ms locally, against a 4 s budget |
| Bandwidth | ~1.0 GB/month on yfinance, ~3.2 GB on Zerodha at 4 s, against **5 GB** |
| Instance hours | ~182 of **750**, thanks to the market-hours-only pinger |
| GitHub Actions | free — Actions minutes are unlimited on public repos |

Two things keep bandwidth down. Routine refreshes fetch three bars and merge
them rather than re-pulling 600. And Volume Profile / FVG — by far the biggest
part of the payload — ride along only on a full reload and every tenth top-up,
since a profile over 1200 bars does not meaningfully change in four seconds.
Without that throttle, eight panes with overlays at the Zerodha rate came to
5.19 GB/month, just over the line.

**Polling faster than the current rates is not free.** One-second refreshes
would be ~12 GB/month. If you want that, the instance needs upgrading.

Exceeding a limit with no payment method on file causes Render to **suspend**
free services for the rest of the month — it cannot bill you. Adding a card is
what changes that.

### Bandwidth

The routine candle refresh asks for ~10 bars and merges them in, rather than
re-pulling the full 600 every minute. That matters on a free host: the full pull
was ~65 KB per pane per minute, about 4 GB a month on eight panes, against
Render's 5 GB allowance. The incremental version is roughly 0.12 GB. A complete
re-pull still happens when the tab returns to the foreground.

## Adding another broker

Everything lives in **`data_source.py`**; `app.py` and the frontend never name a
broker. Write a `candles()` function and register it:

```python
def upstox_candles(symbol, timeframe, limit):
    r = requests.get(f"https://api.upstox.com/v2/historical-candle/{symbol}/...", timeout=10)
    return [{"time": ..., "open": ..., "high": ...,
             "low": ..., "close": ..., "volume": ...} for c in r.json()["data"]]

register_source(
    key="upstox", label="Upstox",
    timeframes=["1m", "5m", "1d"],
    symbols=[{"symbol": "NSE_EQ|INE002A01018", "label": "Reliance"}],
    candles=upstox_candles,
)
```

Restart and it's in every pane's source dropdown. Optional hooks: `quotes()` for
live ticks, `search()`, `display_tz_offset_min` (330 puts the axis in IST), and
`stream` for the transport. A native browser websocket needs one extra `case` in
`static/js/feeds.js`; polled sources need no frontend change.

## Files

```
app.py                  Flask: /api/config /api/sources /api/candles /api/quotes /api/settings/*
auth.py                 Firebase ID-token verification + superadmin check
settings.py             server-side credential store (chmod 600, gitignored)
data_source.py          ← the only file a new broker touches
static/index.html
static/css/style.css    grid layouts, ticker flash, gate + settings dialog
static/js/feeds.js      auth-aware REST client + batched poller
static/js/pane.js       one pane: dropdowns, chart, ticker bar
static/js/app.js        grid, count selector, localStorage
static/js/auth.js       Google sign-in gate (ES module)
static/js/settings.js   the Settings dialog
Dockerfile / Procfile / render.yaml / firebase.json
```

## Notes

* **Run one worker.** The Kite websocket and its tick cache are per-process;
  `--workers 2` would open two sockets and serve whichever cache a request
  landed on. Concurrency comes from `--threads`. The included configs do this.
* All yfinance panes batch into a single request per tick, and polling pauses
  while the tab is hidden.
* Yahoo is unofficial and rate-limits; responses are TTL-cached (3 s quotes,
  20 s intraday candles). Kite: ~1 req/s quotes, ~3 req/s historical — which is
  why ticks come off the websocket rather than polling `ltp()`.
* Backend candles are always UTC epoch seconds; the pane applies the source's
  `tzOffsetMin` for the displayed axis only.
* Lightweight Charts loads from unpkg (pinned 4.2.0; v5 builds also work). To
  run fully offline, drop the standalone file into `static/js/` and repoint the
  `<script>` tag.
* Market data only. No order placement anywhere in this code.

## Deliberately not included

* **No trading.** It cannot place, change or cancel orders — market data only.
* **No drawing tools** (trendlines, fibs).
* **No server-side alerting.** See the alerts note above.
