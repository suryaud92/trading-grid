/* overlays.js — the two things that aren't lines over time.
 *
 * Volume Profile is a histogram across PRICE, and a Fair Value Gap is a
 * rectangle spanning a range of prices and bars. Neither can be a series, so
 * they're drawn with lightweight-charts v5 primitives: a primitive gets a
 * canvas and the chart's coordinate converters, and paints whatever it likes.
 *
 * Both take their numbers from the server (indicators.py) and only handle
 * drawing here.
 */
(function (global) {
  'use strict';

  const LWC = global.LightweightCharts;
  const supported = !!(LWC && LWC.version);

  /* Shared plumbing: a primitive with one pane view that calls `paint`. */
  function makePrimitive(paint, zOrder) {
    const view = {
      update() {},
      zOrder: () => zOrder || 'bottom',
      renderer() {
        return {
          draw: (target) => {
            if (!primitive.chart || !primitive.series || !primitive.data) return;
            try {
              target.useMediaCoordinateSpace((scope) => {
                paint(scope.context, scope.mediaSize, primitive);
              });
            } catch (err) {
              console.warn('[overlay] draw failed', err);
            }
          },
        };
      },
    };
    const primitive = {
      data: null,
      shift: 0,
      attached(p) { this.chart = p.chart; this.series = p.series; this.requestUpdate = p.requestUpdate; },
      detached() { this.chart = null; this.series = null; },
      updateAllViews() {},
      paneViews() { return [view]; },
      setData(data, shift) {
        this.data = data;
        this.shift = shift || 0;
        if (this.requestUpdate) this.requestUpdate();
      },
    };
    return primitive;
  }

  /* ------------------------------------------------------- volume profile */

  function paintVolumeProfile(ctx, size, self) {
    const vp = self.data;
    if (!vp || !vp.bins || !vp.max) return;
    const series = self.series;

    // bars hang off the right edge, using at most a third of the pane so the
    // candles stay readable underneath
    const maxWidth = Math.min(size.width * 0.22, 130);
    const right = size.width - 2;

    ctx.save();
    vp.bins.forEach((bin) => {
      const yTop = series.priceToCoordinate(bin.high);
      const yBot = series.priceToCoordinate(bin.low);
      if (yTop == null || yBot == null) return;
      const h = Math.max(1, Math.abs(yBot - yTop) - 1);
      const y = Math.min(yTop, yBot);
      const w = (bin.total / vp.max) * maxWidth;
      if (w < 0.5) return;

      const upW = bin.total ? (bin.up / bin.total) * w : 0;
      const alpha = bin.inValueArea ? 0.55 : 0.22;
      ctx.fillStyle = 'rgba(34,197,94,' + alpha + ')';
      ctx.fillRect(right - w, y, upW, h);
      ctx.fillStyle = 'rgba(239,68,68,' + alpha + ')';
      ctx.fillRect(right - w + upW, y, w - upW, h);
    });

    const poc = series.priceToCoordinate(vp.poc);
    if (poc != null) {
      ctx.strokeStyle = 'rgba(250,204,21,.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(right - maxWidth, poc);
      ctx.lineTo(right, poc);
      ctx.stroke();
      ctx.fillStyle = 'rgba(250,204,21,.9)';
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('POC', right - maxWidth - 4, poc + 3);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------ fair value gaps */

  function paintFvg(ctx, size, self) {
    const fvg = self.data;
    if (!fvg || !fvg.zones) return;
    const series = self.series;
    const ts = self.chart.timeScale();
    const shift = self.shift;

    ctx.save();
    fvg.zones.forEach((z) => {
      const yTop = series.priceToCoordinate(z.top);
      const yBot = series.priceToCoordinate(z.bottom);
      if (yTop == null || yBot == null) return;

      let x1 = ts.timeToCoordinate(z.time + shift);
      if (x1 == null) x1 = 0;                       // scrolled off to the left
      const rightLimit = size.width - (self.reserveRight || 0);
      let x2 = z.filledTime ? ts.timeToCoordinate(z.filledTime + shift) : rightLimit;
      if (x2 == null) x2 = rightLimit;
      if (x2 <= x1) x2 = x1 + 2;

      const filled = !!z.filledTime;
      const bull = z.dir === 'bull';
      const base = bull ? '34,197,94' : '239,68,68';
      ctx.fillStyle = 'rgba(' + base + ',' + (filled ? 0.06 : 0.16) + ')';
      ctx.fillRect(x1, Math.min(yTop, yBot), x2 - x1, Math.abs(yBot - yTop));

      if (!filled) {
        ctx.strokeStyle = 'rgba(' + base + ',.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, yTop); ctx.lineTo(x2, yTop);
        ctx.moveTo(x1, yBot); ctx.lineTo(x2, yBot);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    ctx.restore();
  }

  const Overlays = {
    supported,
    PAINTERS: { volume_profile: paintVolumeProfile, fvg: paintFvg },

    /** Build a primitive for an overlay payload type, or null if unknown. */
    create(type) {
      const paint = this.PAINTERS[type];
      if (!paint || !supported) return null;
      return makePrimitive(paint, type === 'fvg' ? 'bottom' : 'top');
    },
  };

  global.Overlays = Overlays;
})(window);
