/* indicators.js — the maths. Pure functions over a candle array, no DOM.
 *
 * Every function takes candles [{time,open,high,low,close,volume}] ascending
 * and returns [{time, value}] ready to hand to a Lightweight Charts line
 * series. Leading bars with too little history are omitted rather than
 * returned as nulls, which is what the chart library expects.
 */
(function (global) {
  'use strict';

  function closes(candles) { return candles.map((c) => c.close); }

  /** Simple moving average. */
  function sma(candles, period) {
    if (!(period > 0) || candles.length < period) return [];
    const out = [];
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) sum -= candles[i - period].close;
      if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
    }
    return out;
  }

  /** Exponential moving average, seeded with the first SMA. */
  function ema(candles, period) {
    if (!(period > 0) || candles.length < period) return [];
    const k = 2 / (period + 1);
    const out = [];
    let seed = 0;
    for (let i = 0; i < period; i++) seed += candles[i].close;
    let prev = seed / period;
    out.push({ time: candles[period - 1].time, value: prev });
    for (let i = period; i < candles.length; i++) {
      prev = candles[i].close * k + prev * (1 - k);
      out.push({ time: candles[i].time, value: prev });
    }
    return out;
  }

  /** Bollinger bands -> {upper, middle, lower}, population standard deviation. */
  function bollinger(candles, period, mult) {
    period = period || 20;
    mult = mult == null ? 2 : mult;
    const upper = [], middle = [], lower = [];
    if (candles.length < period) return { upper, middle, lower };
    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
      const mean = sum / period;
      let varSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const d = candles[j].close - mean;
        varSum += d * d;
      }
      const sd = Math.sqrt(varSum / period);
      const t = candles[i].time;
      middle.push({ time: t, value: mean });
      upper.push({ time: t, value: mean + mult * sd });
      lower.push({ time: t, value: mean - mult * sd });
    }
    return { upper, middle, lower };
  }

  /** Wilder's RSI (the standard one), 0-100. */
  function rsi(candles, period) {
    period = period || 14;
    const out = [];
    if (candles.length <= period) return out;

    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = candles[i].close - candles[i - 1].close;
      if (d >= 0) gain += d; else loss -= d;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    const push = (i) => {
      const value = avgLoss === 0 ? 100
        : avgGain === 0 ? 0
        : 100 - 100 / (1 + avgGain / avgLoss);
      out.push({ time: candles[i].time, value: value });
    };
    push(period);

    for (let i = period + 1; i < candles.length; i++) {
      const d = candles[i].close - candles[i - 1].close;
      const g = d > 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      push(i);
    }
    return out;
  }

  /* What a pane can switch on. `scale` "price" draws over the candles;
   * "rsi" gets its own band at the bottom of the chart. */
  const CATALOG = [
    { id: 'sma1', label: 'SMA',        scale: 'price', color: '#f59e0b', fields: [['period', 20]] },
    { id: 'sma2', label: 'SMA',        scale: 'price', color: '#a78bfa', fields: [['period', 50]] },
    { id: 'ema',  label: 'EMA',        scale: 'price', color: '#38bdf8', fields: [['period', 20]] },
    { id: 'bb',   label: 'Bollinger',  scale: 'price', color: '#64748b', fields: [['period', 20], ['mult', 2]] },
    { id: 'rsi',  label: 'RSI',        scale: 'rsi',   color: '#e879f9', fields: [['period', 14]] },
  ];

  /** Compute one configured indicator -> [{key, color, data, ...}] lines. */
  function compute(id, candles, cfg) {
    const spec = CATALOG.find((c) => c.id === id);
    if (!spec || !candles || !candles.length) return [];
    const period = Number(cfg && cfg.period) || spec.fields[0][1];

    switch (id) {
      case 'sma1':
      case 'sma2':
        return [{ key: id, color: spec.color, width: 2, data: sma(candles, period) }];
      case 'ema':
        return [{ key: id, color: spec.color, width: 2, data: ema(candles, period) }];
      case 'bb': {
        const mult = Number(cfg && cfg.mult) || 2;
        const b = bollinger(candles, period, mult);
        return [
          { key: 'bb_u', color: spec.color, width: 1, data: b.upper },
          { key: 'bb_m', color: spec.color, width: 1, dashed: true, data: b.middle },
          { key: 'bb_l', color: spec.color, width: 1, data: b.lower },
        ];
      }
      case 'rsi':
        return [{ key: 'rsi', color: spec.color, width: 2, scale: 'rsi', data: rsi(candles, period) }];
      default:
        return [];
    }
  }

  global.Indicators = { sma, ema, bollinger, rsi, compute, CATALOG, closes };
})(typeof window !== 'undefined' ? window : globalThis);
