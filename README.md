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
| **Charts 1 / 2 / 4 / 6 / 8** | 1 = full screen, 2 = side by side, 4 = 2×2, 6 = 3×2, 8 = 4×2. Also bound to the number keys. |
| **Symbol search** | Type in the symbol box and matches appear as you go, by ticker *or* company name ("tata" finds Tata Steel, Tata Motors and TCS). Anything not in the list can be entered as typed and is remembered. |
| **Timeframes** | `1m 5m 15m 30m 1h 1D 1W 1MO` (Kite adds `3m` and `10m`), independent per pane. |
| **ƒx Indicators** | SMA ×2, EMA, Bollinger Bands and RSI, with editable periods. RSI gets its own band under the price with 30/70 guides. Saved per pane. |
| **🔔 Alerts** | Price alerts above/below a level. Fires a toast, a chime and a desktop notification. |
| **Ticker bar** | Flashes green on an uptick, red on a downtick. |
| **⚙ Settings** | Connect/disconnect Zerodha. |

### Indicators

Click **ƒx** on any pane. Each row has a checkbox and its period(s), so SMA can
be 20 and 50 at once, Bollinger takes a period and a multiplier. Everything is
computed in the browser from the candles already on screen — no extra requests.
The maths is in `static/js/indicators.js` and is unit-tested (RSI is Wilder's,
checked against an independent implementation).

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
login** → sign in at Zerodha → paste the `request_token` back (the whole
redirect URL works, it's parsed for you) → **Connect**.

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
