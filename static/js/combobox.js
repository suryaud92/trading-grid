/* combobox.js — type-to-search symbol picker.
 *
 * Replaces the old <select>. You type, it suggests; you can also enter a
 * symbol that isn't in the list at all, which is how custom tickers work now.
 *
 * The suggestion list is ONE element parented to <body> and positioned over
 * everything. It cannot live inside the pane: panes use overflow:hidden for
 * their rounded corners, which would clip the list to a few pixels.
 */
(function (global) {
  'use strict';

  let listEl = null;
  let active = null;          // {input, opts, matches, cursor}

  function ensureList() {
    if (listEl) return listEl;
    listEl = document.createElement('div');
    listEl.className = 'cbx-list';
    listEl.hidden = true;
    listEl.addEventListener('mousedown', (e) => {
      const row = e.target.closest('[data-idx]');
      if (!row) return;
      e.preventDefault();                       // keep focus; blur would close us
      choose(Number(row.dataset.idx));
    });
    document.body.appendChild(listEl);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', close);
    return listEl;
  }

  function score(item, q) {
    const sym = item.symbol.toLowerCase();
    const label = (item.label || '').toLowerCase();
    const bare = sym.includes(':') ? sym.split(':')[1] : sym;
    if (sym === q || bare === q) return 0;
    if (bare.startsWith(q)) return 1;
    if (sym.startsWith(q)) return 2;
    if (label.startsWith(q)) return 3;
    if (bare.includes(q)) return 4;
    if (label.includes(q)) return 5;
    if (sym.includes(q)) return 6;
    return -1;
  }

  function search(items, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return items.slice(0, 40);
    const hits = [];
    for (const item of items) {
      const s = score(item, q);
      if (s >= 0) hits.push({ item, s });
    }
    hits.sort((a, b) => a.s - b.s || a.item.symbol.length - b.item.symbol.length);
    return hits.slice(0, 40).map((h) => h.item);
  }

  function render() {
    const el = ensureList();
    const { matches, cursor, input } = active;
    const typed = input.value.trim();

    if (!matches.length && !typed) { close(); return; }

    el.innerHTML = '';
    matches.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'cbx-row' + (i === cursor ? ' on' : '');
      row.dataset.idx = String(i);
      const sym = document.createElement('span');
      sym.className = 'cbx-sym';
      sym.textContent = m.symbol;
      const lab = document.createElement('span');
      lab.className = 'cbx-label';
      lab.textContent = m.label && m.label !== m.symbol ? m.label : '';
      row.append(sym, lab);
      el.appendChild(row);
    });

    /* Anything typed that isn't an exact match can still be used as-is. */
    const exact = matches.some((m) => m.symbol.toLowerCase() === typed.toLowerCase());
    if (typed && !exact) {
      const row = document.createElement('div');
      row.className = 'cbx-row custom' + (cursor === matches.length ? ' on' : '');
      row.dataset.idx = String(matches.length);
      row.innerHTML = '<span class="cbx-sym"></span><span class="cbx-label">use as typed ↵</span>';
      row.querySelector('.cbx-sym').textContent = typed.toUpperCase();
      el.appendChild(row);
    }

    if (!el.children.length) { close(); return; }
    el.hidden = false;
    reposition();
    const on = el.querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function reposition() {
    if (!active || !listEl || listEl.hidden) return;
    const r = active.input.getBoundingClientRect();
    const width = Math.max(r.width, 230);
    const spaceBelow = window.innerHeight - r.bottom;
    const height = Math.min(listEl.scrollHeight, 260);
    const above = spaceBelow < height + 12 && r.top > spaceBelow;

    listEl.style.width = width + 'px';
    listEl.style.left = Math.max(6, Math.min(r.left, window.innerWidth - width - 6)) + 'px';
    listEl.style.maxHeight = Math.min(260, above ? r.top - 10 : spaceBelow - 10) + 'px';
    if (above) {
      listEl.style.top = 'auto';
      listEl.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    } else {
      listEl.style.bottom = 'auto';
      listEl.style.top = (r.bottom + 4) + 'px';
    }
  }

  function close() {
    if (listEl) listEl.hidden = true;
    if (active) active.cursor = -1;
  }

  function choose(idx) {
    if (!active) return;
    const { matches, input, opts } = active;
    const picked = idx < matches.length
      ? matches[idx].symbol
      : input.value.trim().toUpperCase();
    if (!picked) return;
    close();
    input.blur();
    opts.onPick(picked);
  }

  function open(input, opts) {
    active = { input, opts, matches: [], cursor: -1 };
    active.matches = search(opts.items(), input.value === opts.current() ? '' : input.value);
    active.cursor = -1;
    render();
  }

  /** Turn a text input into a symbol picker. */
  function attach(input, opts) {
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('role', 'combobox');

    input.addEventListener('focus', () => { input.select(); open(input, opts); });
    input.addEventListener('input', () => {
      if (active && active.input !== input) close();
      active = { input, opts, matches: search(opts.items(), input.value), cursor: 0 };
      render();
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (active && active.input === input) { close(); input.value = opts.current(); }
      }, 120);
    });
    input.addEventListener('keydown', (e) => {
      if (!active || active.input !== input) return;
      const typed = input.value.trim();
      const exact = active.matches.some((m) => m.symbol.toLowerCase() === typed.toLowerCase());
      const max = active.matches.length + (typed && !exact ? 1 : 0) - 1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (listEl && listEl.hidden) { open(input, opts); return; }
        active.cursor = active.cursor >= max ? 0 : active.cursor + 1;
        render();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        active.cursor = active.cursor <= 0 ? max : active.cursor - 1;
        render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(active.cursor >= 0 ? active.cursor : (active.matches.length ? 0 : max));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
        input.value = opts.current();
        input.blur();
      }
    });
  }

  global.Combobox = { attach, search, close };
})(window);
