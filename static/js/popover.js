/* popover.js — one anchored popover, parented to <body>.
 *
 * Same reason as the combobox list: panes clip their contents, so any menu
 * that hangs off a pane header has to live outside the pane.
 */
(function (global) {
  'use strict';

  let host = null;
  let current = null;         // {anchor, onClose}

  function ensure() {
    if (host) return host;
    host = document.createElement('div');
    host.className = 'pop';
    host.hidden = true;
    document.body.appendChild(host);

    document.addEventListener('mousedown', (e) => {
      if (!current || host.hidden) return;
      if (host.contains(e.target) || current.anchor.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && current && !host.hidden) { e.stopPropagation(); close(); }
    });
    window.addEventListener('resize', close);
    window.addEventListener('scroll', () => { if (current) place(); }, true);
    return host;
  }

  function place() {
    const r = current.anchor.getBoundingClientRect();
    const w = host.offsetWidth || 260;
    const h = host.offsetHeight || 200;
    let left = Math.min(r.right - w, window.innerWidth - w - 8);
    left = Math.max(8, left);
    const below = window.innerHeight - r.bottom;
    host.style.left = left + 'px';
    if (below < h + 12 && r.top > below) {
      host.style.top = 'auto';
      host.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    } else {
      host.style.bottom = 'auto';
      host.style.top = (r.bottom + 6) + 'px';
    }
  }

  function close() {
    if (!current) return;
    const cb = current.onClose;
    current = null;
    if (host) { host.hidden = true; host.innerHTML = ''; }
    if (cb) cb();
  }

  /** build(contentEl, closeFn) fills the popover. Re-opening on the same
   *  anchor toggles it shut, which is what a menu button should do. */
  function open(anchor, build, onClose) {
    ensure();
    const sameAnchor = current && current.anchor === anchor && !host.hidden;
    close();
    if (sameAnchor) return;
    current = { anchor: anchor, onClose: onClose };
    host.innerHTML = '';
    host.hidden = false;
    build(host, close);
    place();
  }

  function isOpen(anchor) {
    return !!current && !host.hidden && (!anchor || current.anchor === anchor);
  }

  global.Popover = { open, close, isOpen };
})(window);
