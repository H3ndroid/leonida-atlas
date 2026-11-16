/* Leonida Atlas – Oberfläche (mehrsprachig) */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '');
  const I = window.I18N;
  const LANGS = window.I18N_LANGS;

  // ---------- Sprache ----------
  let LANG = 'en', LOC = 'en', rtf, nf;
  function fill(s, p) { return p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] != null ? p[k] : m)) : s; }
  function t(k, p) {
    const s = (I[LANG] && I[LANG][k] != null) ? I[LANG][k] : (I.en[k] != null ? I.en[k] : k);
    return Array.isArray(s) ? s.map(x => fill(x, p)) : fill(s, p);
  }
  const has = k => I[LANG] && I[LANG][k] != null;
  function detectLang() {
    const saved = ls.get('lang', null);
    if (saved && I[saved]) return saved;
    const cands = (navigator.languages || [navigator.language || 'en']).map(l => String(l).slice(0, 2).toLowerCase());
    return cands.find(l => I[l]) || 'en';
  }
  function applyLang(code) {
    LANG = I[code] ? code : 'en';
    LOC = LANG === 'ar' ? 'ar-u-nu-latn' : LANG;
    document.documentElement.lang = LANG;
    document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
    rtf = new Intl.RelativeTimeFormat(LOC, { numeric: 'auto' });
    nf = new Intl.NumberFormat(LOC);
  }
  const num = n => nf.format(n);
  const unit = (n, u) => new Intl.NumberFormat(LOC, { style: 'unit', unit: u, unitDisplay: 'long' }).format(n);
  const langName = code => { try { return new Intl.DisplayNames([LOC], { type: 'language' }).of(code); } catch (e) { return code.toUpperCase(); } };
  const dirOf = code => code === 'ar' ? 'rtl' : 'ltr';

  // ---------- Lokale Vorlieben ----------
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('la:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('la:' + k, JSON.stringify(v)); } catch (e) { /* egal */ } }
  };
  let favs = new Set(ls.get('favs', []));
  const saveFavs = () => ls.set('favs', [...favs]);

  // ---------- Zeit ----------
  function ago(ts) {
    if (!ts) return t('never');
    const s = (ts - Date.now()) / 1000, a = Math.abs(s);
    if (a < 45) return rtf.format(0, 'second');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  }
  const fmtDate = ts => new Date(ts).toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtTime = ts => new Date(ts).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
  const isoT = s => s ? Date.parse(s) : 0;

  // ---------- Zustand ----------
  const S = { pages: [], byId: new Map(), saved: new Set(), log: [], news: null, last: null, settings: null, busy: false, progress: '', index: null };

  function seedPages() {
    return window.SEED.map(e => Object.assign({ id: e.id, src: 'seed', cat: e.cat, lang: e.t[LANG] ? LANG : 'en' }, e.t[LANG] || e.t.en));
  }
  async function loadState() {
    S.settings = await LA.getSettings();
    const dbPages = await LA.idb.all('pages');
    S.pages = seedPages().concat(dbPages.filter(p => LA.isEnabled(p, S.settings)));
    S.byId = new Map(S.pages.map(p => [p.id, p]));
    S.saved = new Set(await LA.idb.keys('html'));
    S.log = ((await LA.idb.get('kv', 'log')) || []).map(e => Object.assign({}, e, { type: e.type === 'neu' ? 'new' : e.type === 'geändert' ? 'changed' : e.type }));
    S.news = await LA.idb.get('kv', 'news');
    S.last = await LA.idb.get('kv', 'last');
    S.index = null;
  }

  // Namen von Quellen und Bereichen
  function srcName(src) {
    if (src === 'seed') return t('src_seed');
    if (src === 'fd') return t('src_fd');
    if (src === 'reddit') return t('src_reddit');
    if (/^wp/.test(src)) return t('wp_lang', { l: langName(src.slice(2)) });
    return src;
  }
  const FD_DE_LEGACY = { 'Figuren': 'characters', 'Fahrzeuge': 'vehicles', 'Waffen': 'weapons', 'Missionen': 'missions', 'Orte': 'places', 'Musik & Radio': 'music', 'Firmen & Marken': 'business', 'Gangs & Organisationen': 'gangs', 'Trailer & Medien': 'media', 'Tiere': 'animals', 'Websites & Apps': 'web', 'Aktivitäten': 'activities', 'Kleidung': 'clothing', 'Entwicklung': 'dev', 'Erfolge & Sammelobjekte': 'achievements', 'Polizei & Behörden': 'police', 'Allgemein': 'general' };
  function catName(p) {
    if (p.src === 'seed') return t('cat_' + p.cat);
    if (p.src === 'fd') { const k = FD_DE_LEGACY[p.cat] || p.cat; return has('fd_' + k) || I.en['fd_' + k] ? t('fd_' + k) : k; }
    return srcName(p.src);
  }
  const errText = m => (m === 'offline' || m === 'timeout') ? t('err_' + m) : m;
  const progText = p => typeof p === 'string' ? p : t(p.k, Object.assign({}, p, { n: p.n != null ? num(p.n) : p.n, m: p.m != null ? num(p.m) : p.m, c: p.c != null ? num(p.c) : p.c }));

  // ---------- Navigation ----------
  const ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    wissen: '<path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/>',
    neu: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    suche: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    merkliste: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    einstellungen: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>'
  };
  const NAV = [['home', 'nav_home'], ['wissen', 'nav_wiki'], ['neu', 'nav_new'], ['suche', 'nav_search'], ['merkliste', 'nav_favs'], ['einstellungen', 'nav_settings']];
  function unseenCount() { const seen = ls.get('seenLog', 0); return S.log.filter(e => e.at > seen && e.type !== 'import').length; }
  function renderNav(active) {
    const n = unseenCount();
    $('#rail').setAttribute('aria-label', t('nav_home'));
    $('#nav').innerHTML = NAV.map(([k, l]) => `<a href="#${k}" ${active === k ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span class="lbl">${esc(t(l))}</span>${k === 'neu' && n ? `<span class="badge">${n > 99 ? '99+' : num(n)}</span>` : ''}</a>`).join('');
  }
  function renderChrome() {
    $('#langCode').textContent = LANG.toUpperCase();
    $('#langBtn').setAttribute('aria-label', `${t('lang_btn')} (${LANGS.find(l => l[0] === LANG)[1]})`);
    $('#langBtn').title = t('lang_btn');
    $('#refreshBtn').setAttribute('aria-label', t('refresh'));
    $('#langTitle').textContent = t('lang_title');
    $('#langClose').textContent = t('close');
    $('meta[name=description]').setAttribute('content', t('doc_title'));
  }

  // ---------- Sprachauswahl ----------
  function openLangDialog() {
    const dlg = $('#langDlg');
    $('#langList').innerHTML = LANGS.map(([code, name]) =>
      `<button type="button" data-lang="${code}" lang="${code}" dir="${dirOf(code)}" aria-current="${code === LANG}"><span class="n">${esc(name)}</span><span class="c">${esc(code === LANG ? '✓ ' + code.toUpperCase() : code.toUpperCase())}</span></button>`).join('');
    $('#langList').onclick = e => { const b = e.target.closest('button[data-lang]'); if (b) { dlg.close(); setLang(b.dataset.lang); } };
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    const cur = $('#langList [aria-current="true"]'); if (cur) cur.focus();
  }
  async function setLang(code) {
    if (code === LANG) return;
    const before = LANG;
    applyLang(code);
    ls.set('lang', LANG);
    S.settings.lang = LANG;
    await LA.saveSettings(S.settings);
    await loadState();
    renderChrome(); renderStatus(); route(true);
    // Wikipedia-Artikel in der neuen Sprache laden, falls noch nicht vorhanden
    const need = S.settings.sources.wploc && LANG !== 'en' && LANG !== before && !S.pages.some(p => p.src === 'wp' + LANG);
    if (need && navigator.onLine) runRefresh(false, true);
  }

  // ---------- Status & Aktualisieren ----------
  function nextAutoText() {
    const ms = LA.intervalMs(S.settings);
    if (!isFinite(ms)) return t('st_auto_off');
    const due = ((S.last && S.last.at) || 0) + ms;
    const min = Math.round((due - Date.now()) / 60e3);
    return min <= 0 ? t('st_next_soon') : t('st_next', { t: rtf.format(min, 'minute') });
  }
  function renderStatus() {
    const btn = $('#refreshBtn');
    btn.disabled = S.busy; btn.classList.toggle('busy', S.busy);
    btn.querySelector('.lbl').textContent = S.busy ? t('loading') : t('refresh');
    let html;
    if (S.busy) html = `<b>${esc(progText(S.progress || { k: 'st_checking' }))}</b>`;
    else if (!navigator.onLine) html = `<b>${esc(t('st_offline'))}</b><br><span class="long">${esc(t('st_offline_sub'))}</span>`;
    else if (S.last) {
      const errs = (S.last.errors || []).length;
      html = `${esc(t('st_stand', { t: '\u0000' })).replace('\u0000', `<b>${esc(ago(S.last.at))}</b>`)}<br><span class="long">${errs ? `<span class="err">${esc(t('st_errors', { n: num(errs) }))}</span> · ` : ''}${esc(nextAutoText())}</span>`;
    } else html = `<b>${esc(t('st_never'))}</b>`;
    $('#status').innerHTML = html;
  }

  async function runRefresh(manual, quiet) {
    if (S.busy) return;
    if (!navigator.onLine) { if (manual) toast(t('t_no_net')); return; }
    S.busy = true; S.progress = { k: 'st_checking' }; renderStatus();
    let res;
    try {
      res = await LA.refresh({ manual, reason: manual ? 'manual' : 'auto', onProgress: p => { S.progress = p; renderStatus(); } });
      if (res.skipped && manual) toast(t('t_busy_bg'));
      if (!res.skipped && S.settings.offline) await LA.prefetchAll({ onProgress: p => { S.progress = p; renderStatus(); } });
    } catch (e) { res = { errors: [{ src: '', msg: e.message }] }; }
    S.busy = false;
    await loadState();
    renderStatus(); rerender();
    if (res && !res.skipped && !quiet && (manual || res.added || res.changed)) {
      const parts = [];
      if (res.added) parts.push(t('t_new_n', { n: num(res.added) }));
      if (res.changed) parts.push(t('t_changed_n', { n: num(res.changed) }));
      const sep = LANG === 'ja' ? '、' : LANG === 'ar' ? '، ' : ', ';
      let msg = parts.length ? t('t_updated', { list: parts.join(sep) }) : (res.imported ? t('t_loaded', { n: num(res.imported) }) : t('t_uptodate'));
      if (res.errors && res.errors.length) msg += ' ' + t('t_unreachable', { list: [...new Set(res.errors.map(e => srcName(e.src)))].join(sep) });
      toast(msg, parts.length ? { label: t('t_view'), href: '#neu' } : null);
    }
  }
  function maybeAuto() {
    if (S.busy || document.hidden || !navigator.onLine) return;
    const ms = LA.intervalMs(S.settings);
    if (isFinite(ms) && (!S.last || Date.now() - S.last.at >= ms)) runRefresh(false);
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, action) {
    const host = $('#toastHost');
    host.innerHTML = `<div class="toast" role="status">${esc(msg)}${action ? `<button type="button">${esc(action.label)}</button>` : ''}</div>`;
    if (action) host.querySelector('button').onclick = () => { host.innerHTML = ''; if (action.href) location.hash = action.href; if (action.fn) action.fn(); };
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { host.innerHTML = ''; }, action ? 9000 : 5000);
  }

  // ---------- Router ----------
  let current = { name: 'home', arg: '' };
  function parseHash() {
    const h = location.hash.slice(1) || 'home';
    const i = h.indexOf('/');
    return i < 0 ? { name: h, arg: '' } : { name: h.slice(0, i), arg: decodeURIComponent(h.slice(i + 1)) };
  }
  function route(keepScroll) {
    current = parseHash();
    renderNav(current.name === 'artikel' ? '' : current.name);
    (VIEWS[current.name] || VIEWS.home)(current.arg);
    if (!keepScroll) window.scrollTo(0, 0);
  }
  function rerender() {
    renderNav(current.name);
    if (current.name === 'artikel') return;
    if (current.name === 'suche') { runSearch($('#q') ? $('#q').value : current.arg); return; }
    (VIEWS[current.name] || VIEWS.home)(current.arg);
  }
  function setTitle(x) {
    $('#title').textContent = x || 'Leonida Atlas';
    document.title = x ? `${x} – Leonida Atlas` : t('doc_title');
  }
  const V = () => $('#view');

  // ---------- Bausteine ----------
  const pageDate = p => p.changedAt || isoT(p.touched) || 0;
  const bdi = (s, lang) => `<bdi${lang ? ` lang="${lang}"` : ''}>${esc(s)}</bdi>`;
  function pageLink(p, extra) {
    return `<a class="row" href="#artikel/${enc(p.id)}"><span class="t">${bdi(p.title, p.lang)}${S.saved.has(p.id) ? `<span class="saved" title="${esc(t('saved_offline'))}"></span>` : ''}${extra ? `<span class="sub">${extra}</span>` : ''}</span><span class="m">${esc(srcName(p.src))}</span></a>`;
  }
  function logRows(items) {
    if (!items.length) return `<p class="empty">${esc(t('empty_log'))}</p>`;
    return '<ul class="rows">' + items.map(e => {
      const p = e.id && S.byId.get(e.id);
      const title = e.type === 'import' ? esc(t('log_import', { n: num(e.n || 0) })) : bdi(e.title);
      const inner = `<span class="t">${title}<span class="sub">${esc(srcName(e.src))} · ${esc(fmtTime(e.at))}, ${esc(ago(e.at))}</span></span><span class="tag ${e.type}">${esc(t('tag_' + e.type))}</span>`;
      return `<li>${p ? `<a class="row" href="#artikel/${enc(p.id)}">${inner}</a>` : `<div class="row">${inner}</div>`}</li>`;
    }).join('') + '</ul>';
  }
  function newsRows(n) {
    if (!S.settings.sources.reddit) return `<p class="empty">${esc(t('news_off'))}</p>`;
    if (!S.news || !S.news.items.length) return `<p class="empty">${esc(t('news_none'))}</p>`;
    return '<ul class="rows">' + S.news.items.filter(i => !i.pinned).slice(0, n).map(i =>
      `<li><a class="row" href="${esc(i.url)}" target="_blank" rel="noopener"><span class="t"><bdi lang="en">${esc(i.title)}</bdi><span class="sub">${i.flair ? bdi(i.flair, 'en') + ' · ' : ''}${esc(t('comments', { n: num(i.comments) }))} · ${esc(ago(i.at))}</span></span><span class="m">▲ ${num(i.score)}</span></a></li>`).join('') + '</ul>';
  }

  // ---------- Countdown ----------
  function heroText() {
    const now = new Date(), rel = new Date(LA.RELEASE);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((today - rel) / 864e5);
    const date = fmtDate(LA.RELEASE);
    if (now < rel) {
      const diff = rel - now;
      const d = Math.floor(diff / 864e5), h = Math.floor(diff / 36e5) % 24, m = Math.floor(diff / 6e4) % 60;
      const big = d > 0 ? t('hero_days', { d: unit(d, 'day'), h: unit(h, 'hour') }) : t('hero_hours', { h: unit(h, 'hour'), m: unit(m, 'minute') });
      return { big, small: t('hero_sub', { date }) };
    }
    if (days === 0) return { big: t('hero_today'), small: t('hero_today_sub') };
    return { big: t('hero_after', { d: unit(days, 'day') }), small: t('hero_after_sub', { date, n: num(S.pages.length) }) };
  }
  const heroHtml = h => h.big.map(l => `<span>${esc(l)}</span>`).join('');

  // ---------- Ansichten ----------
  const VIEWS = {
    home() {
      setTitle('');
      const h = heroText();
      const src = (S.last && S.last.sources) || {};
      const row = (key, name, enabled) => {
        const st = src[key];
        const cls = !enabled ? '' : st ? (st.ok ? 'ok' : 'bad') : '';
        const txt = !enabled ? t('s_off') : st ? (st.ok ? t('s_ok', { t: ago(st.at) }) : t('s_bad', { m: errText(st.msg) })) : t('s_unknown');
        return `<li><span class="dot ${cls}"></span><span><b>${esc(name)}</b> <span class="muted">– ${esc(txt)}</span></span></li>`;
      };
      const ss = S.settings.sources;
      const quick = S.pages.filter(p => p.src === 'seed').slice(0, 8);
      V().innerHTML = `
        <section class="horizon" aria-label="${esc(t('release_aria'))}">
          <div class="sun"></div><div class="water"></div>
          <div class="copy"><p class="count" id="count">${heroHtml(h)}</p><p id="countSmall">${esc(h.small)}</p></div>
        </section>
        <div class="grid">
          <section class="card span-7"><h2>${esc(t('h_changes'))}</h2>${logRows(S.log.slice(0, 7))}
            ${S.log.length > 7 ? `<p><a href="#neu">${esc(t('all_changes'))}</a></p>` : ''}</section>
          <section class="card span-5"><h2>${esc(t('h_sources'))}</h2>
            <ul class="src-list">
              ${row('fd', t('src_fd'), ss.fandom)}
              ${LANG !== 'en' ? row('wp' + LANG, srcName('wp' + LANG), ss.wploc) : ''}
              ${row('wpen', srcName('wpen'), ss.wpen)}
              ${row('reddit', t('src_reddit'), ss.reddit)}
            </ul>
            <p class="muted" style="margin:14px 0 0">${esc(t('home_stats', { n: num(S.pages.length), m: num(S.saved.size) }))} ${S.last ? esc(t('home_checked', { t: fmtTime(S.last.at) })) : ''}</p>
          </section>
          <section class="card span-7"><h2>${esc(t('h_news'))}</h2>${newsRows(8)}</section>
          <section class="card span-5"><h2>${esc(t('h_basics'))}</h2><ul class="rows">${quick.map(p => `<li>${pageLink(p)}</li>`).join('')}</ul></section>
        </div>`;
    },

    wissen(arg) {
      setTitle(t('nav_wiki'));
      const groups = { seed: new Map(), fd: new Map(), wp: new Map() };
      for (const p of S.pages) {
        const g = p.src === 'seed' ? 'seed' : p.src === 'fd' ? 'fd' : 'wp';
        const key = g === 'wp' ? 'wp:all' : `${g}:${FD_DE_LEGACY[p.cat] || p.cat}`;
        if (!groups[g].has(key)) groups[g].set(key, { label: g === 'wp' ? t('wp_articles') : catName(p), items: [] });
        groups[g].get(key).items.push(p);
      }
      const fdSorted = [...groups.fd.entries()].sort((a, b) => b[1].items.length - a[1].items.length);
      const all = new Map([...groups.seed, ...fdSorted, ...groups.wp]);
      const sel = all.has(arg) ? arg : [...all.keys()][0];
      const link = ([k, v]) => `<a href="#wissen/${enc(k)}" aria-current="${k === sel}">${esc(v.label)}<span>${num(v.items.length)}</span></a>`;
      const g = all.get(sel);
      const items = !g ? [] : g.items[0].src === 'seed' ? g.items.slice() : g.items.slice().sort((a, b) => a.title.localeCompare(b.title, LOC));
      V().innerHTML = `
        <div class="split">
          <nav class="cats" aria-label="${esc(t('areas'))}" id="cats">
            <h3>${esc(t('grp_basics'))}</h3>${[...groups.seed].map(link).join('')}
            <h3>${esc(t('grp_fd'))}</h3>${fdSorted.length ? fdSorted.map(link).join('') : `<p class="empty" style="padding:4px 12px">${esc(t('fd_pending'))}</p>`}
            ${groups.wp.size ? `<h3>${esc(t('grp_wp'))}</h3>` + [...groups.wp].map(link).join('') : ''}
          </nav>
          <section>
            <div class="list-head"><h2>${esc(g ? g.label : t('nav_wiki'))}</h2>
              ${items.length > 12 ? `<input class="filter" id="flt" type="search" placeholder="${esc(t('filter_ph'))}" aria-label="${esc(t('filter_ph'))}">` : ''}</div>
            <div class="pagelist" id="plist"></div>
          </section>
        </div>`;
      const cur = $('#cats [aria-current="true"]');
      if (cur && matchMedia('(max-width:760px)').matches) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
      const draw = f => {
        const nfl = norm(f);
        $('#plist').innerHTML = items.filter(p => !nfl || norm(p.title).includes(nfl)).map(p =>
          `<a href="#artikel/${enc(p.id)}"><span class="t">${bdi(p.title, p.lang || (p.src === 'fd' ? 'en' : ''))}</span>${S.saved.has(p.id) ? `<span class="saved" title="${esc(t('saved_offline'))}"></span>` : ''}<span class="sub">${esc(p.summary || (srcName(p.src) + (pageDate(p) ? ' · ' + t('changed_ago', { t: ago(pageDate(p)) }) : '')))}</span></a>`).join('') || `<p class="empty">${esc(t('no_hits'))}</p>`;
      };
      draw('');
      const f = $('#flt'); if (f) f.oninput = () => draw(f.value);
    },

    async artikel(id) {
      const p = S.byId.get(id);
      if (!p) { setTitle(''); V().innerHTML = `<div class="reader"><p class="notice">${esc(t('art_missing'))}</p><a class="btn" href="#wissen">${esc(t('to_wiki'))}</a></div>`; return; }
      setTitle(p.title);
      const fav = favs.has(id);
      const contentLang = p.src === 'seed' ? p.lang : (p.lang || 'en');
      V().innerHTML = `
        <article class="reader">
          <a class="btn back" href="#wissen" id="backBtn">${esc(t('back'))}</a>
          <h2 class="title" lang="${contentLang}" dir="${dirOf(contentLang)}">${esc(p.title)}</h2>
          <div class="meta">
            <span class="tag">${esc(srcName(p.src))}</span>
            <span>${esc(catName(p))}</span>
            ${pageDate(p) ? `<span>${esc(t('last_changed', { t: ago(pageDate(p)) }))}</span>` : ''}
            ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(t('open_orig'))}</a>` : ''}
            <button class="btn" id="favBtn" type="button" aria-pressed="${fav}">${esc(fav ? t('faved') : t('fav'))}</button>
          </div>
          <div id="note">${p.src === 'fd' && LANG !== 'en' ? `<p class="notice">${esc(t('only_en'))}</p>` : ''}</div>
          <div class="prose" id="prose" lang="${contentLang}" dir="${dirOf(contentLang)}"><p class="muted">${esc(t('art_loading'))}</p></div>
        </article>`;
      $('#backBtn').onclick = e => { if (history.length > 1) { e.preventDefault(); history.back(); } };
      $('#favBtn').onclick = () => {
        if (favs.has(id)) favs.delete(id); else favs.add(id);
        saveFavs();
        const on = favs.has(id);
        $('#favBtn').textContent = on ? t('faved') : t('fav'); $('#favBtn').setAttribute('aria-pressed', on);
      };
      if (p.src === 'seed') { $('#prose').innerHTML = p.html + `<p class="muted" style="margin-top:2em">${esc(t('seed_stand'))}</p>`; return; }

      let rec = await LA.idb.get('html', id);
      const stale = !rec || rec.rev !== p.rev;
      const show = r => {
        $('#prose').innerHTML = '';
        $('#prose').appendChild(cleanHtml(r.html, p));
        if (stale && !navigator.onLine) $('#note').insertAdjacentHTML('beforeend', `<p class="notice">${esc(t('art_stale'))}</p>`);
      };
      if (rec) show(rec);
      if (stale && navigator.onLine) {
        try {
          rec = await LA.fetchHtml(p);
          S.saved.add(id);
          if (parseHash().arg === id) show(rec);
        } catch (e) {
          if (!rec && parseHash().arg === id) $('#prose').innerHTML = `<p class="notice">${esc(t('art_error', { m: errText(e.message) }))}</p>`;
        }
      } else if (!rec) {
        $('#prose').innerHTML = `<p class="notice">${esc(t('art_not_saved'))}</p>`;
      }
    },

    neu() {
      setTitle(t('h_changes'));
      ls.set('seenLog', Date.now());
      renderNav('neu');
      const byDay = new Map();
      for (const e of S.log) { const d = fmtDate(e.at); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(e); }
      V().innerHTML = S.log.length ? [...byDay].map(([d, items]) => `<section class="card" style="margin-bottom:16px"><h2>${esc(d)}</h2>${logRows(items)}</section>`).join('')
        : `<section class="card">${logRows([])}<p><button class="btn primary" type="button" id="goRefresh">${esc(t('refresh_now'))}</button></p></section>`;
      const g = $('#goRefresh'); if (g) g.onclick = () => runRefresh(true);
    },

    suche(q) {
      setTitle(t('nav_search'));
      V().innerHTML = `
        <div class="search"><input id="q" type="search" placeholder="${esc(t('search_ph'))}" aria-label="${esc(t('nav_search'))}" value="${esc(q || '')}" autocomplete="off" enterkeyhint="search"></div>
        <div id="results"></div>`;
      const inp = $('#q'); let tm;
      inp.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { history.replaceState(null, '', '#suche/' + enc(inp.value)); runSearch(inp.value); }, 160); };
      if (!matchMedia('(pointer: coarse)').matches || !q) inp.focus();
      runSearch(q || '');
    },

    merkliste() {
      setTitle(t('nav_favs'));
      const items = [...favs].map(id => S.byId.get(id)).filter(Boolean);
      V().innerHTML = `<section class="card">${items.length ? '<ul class="rows">' + items.map(p => `<li>${pageLink(p, esc(catName(p)))}</li>`).join('') + '</ul>'
        : `<p class="empty">${esc(t('favs_empty'))}</p>`}</section>`;
    },

    einstellungen() {
      setTitle(t('nav_settings'));
      const s = S.settings;
      const chk = (k, label, sub) => `<div class="opt"><input type="checkbox" id="s_${k}" ${s.sources[k] ? 'checked' : ''}><label for="s_${k}"><b>${esc(label)}</b><span class="sub">${esc(sub)}</span></label></div>`;
      const curName = LANGS.find(l => l[0] === LANG)[1];
      V().innerHTML = `
        <div class="set">
          <section class="card"><h2>${esc(t('set_lang'))}</h2>
            <div class="opt"><label><b>${esc(curName)}</b><span class="sub">${esc(t('set_lang_sub'))}</span></label>
              <button class="btn" type="button" id="b_lang"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/></svg>${esc(t('lang_btn'))}</button></div>
          </section>
          <section class="card"><h2>${esc(t('set_auto'))}</h2>
            <div class="opt"><label for="s_int"><b>${esc(t('set_interval'))}</b><span class="sub">${esc(t('set_interval_sub', { t: unit(LA.autoIntervalMin(), 'minute') }))}</span></label>
              <select id="s_int">${[['auto', 'iv_auto'], ['15', 'iv_15'], ['60', 'iv_60'], ['360', 'iv_360'], ['manual', 'iv_manual']].map(([v, l]) => `<option value="${v}" ${s.interval === v ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select></div>
            <div class="opt"><input type="checkbox" id="s_off" ${s.offline ? 'checked' : ''}><label for="s_off"><b>${esc(t('set_offline'))}</b><span class="sub">${esc(t('set_offline_sub'))}</span></label></div>
            <div class="opt"><input type="checkbox" id="s_not" ${s.notify ? 'checked' : ''}><label for="s_not"><b>${esc(t('set_notify'))}</b><span class="sub">${esc(t('set_notify_sub'))}</span></label></div>
            <p class="muted" id="bgInfo"></p>
          </section>
          <section class="card"><h2>${esc(t('set_sources'))}</h2>
            ${chk('fandom', 'GTA Wiki (gta.fandom.com)', t('src_fd_sub'))}
            ${LANG !== 'en' ? chk('wploc', `${t('src_wploc')} – ${langName(LANG)}`, t('src_wploc_sub')) : ''}
            ${chk('wpen', t('src_wpen'), t('src_wpen_sub'))}
            ${chk('reddit', t('src_reddit'), t('src_reddit_sub'))}
            <div class="opt"><label for="s_extra" style="flex:1"><b>${esc(t('set_extra'))}</b><span class="sub">${esc(t('set_extra_sub'))}</span>
              <textarea id="s_extra" placeholder="en:Rockstar North" dir="ltr">${esc(s.extraWiki)}</textarea></label></div>
          </section>
          <section class="card"><h2>${esc(t('set_data'))}</h2>
            <p class="muted">${esc(t('data_stats', { n: num(S.pages.length), m: num(S.saved.size) }))} <span id="quota"></span></p>
            <div class="btnrow">
              <button class="btn primary" type="button" id="b_pre">${esc(t('btn_prefetch'))}</button>
              <button class="btn" type="button" id="b_reset">${esc(t('btn_reset'))}</button>
            </div>
          </section>
          <section class="card"><h2>${esc(t('set_about'))}</h2><p class="muted">${esc(t('about'))}</p></section>
        </div>`;
      const save = () => LA.saveSettings(S.settings);
      $('#b_lang').onclick = openLangDialog;
      $('#s_int').onchange = async e => { S.settings.interval = e.target.value; await save(); renderStatus(); };
      $('#s_off').onchange = async e => { S.settings.offline = e.target.checked; await save(); if (e.target.checked) toast(t('t_will_save'), { label: t('t_start_now'), fn: prefetchNow }); };
      $('#s_not').onchange = async e => {
        if (e.target.checked && 'Notification' in window) {
          const r = await Notification.requestPermission();
          if (r !== 'granted') { e.target.checked = false; toast(t('t_notify_denied')); return; }
        }
        S.settings.notify = e.target.checked; await save();
      };
      for (const k of ['fandom', 'wploc', 'wpen', 'reddit']) {
        const el = $('#s_' + k);
        if (el) el.onchange = async e => { S.settings.sources[k] = e.target.checked; await save(); await loadState(); toast(e.target.checked ? t('t_src_on') : t('t_src_off')); };
      }
      $('#s_extra').onchange = async e => { S.settings.extraWiki = e.target.value; await save(); };
      $('#b_pre').onclick = prefetchNow;
      $('#b_reset').onclick = async () => {
        if (!confirm(t('confirm_reset'))) return;
        await LA.resetData(); await loadState(); renderStatus(); route(); toast(t('t_reset_done'));
      };
      if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { const q = $('#quota'); if (q) q.textContent = t('quota', { n: num(Math.round(e.usage / 1048576)) }); });
      bgSyncInfo().then(x => { const el = $('#bgInfo'); if (el) el.textContent = x; });
    }
  };

  async function prefetchNow() {
    if (S.busy) return;
    if (!navigator.onLine) { toast(t('t_no_net')); return; }
    S.busy = true; S.progress = { k: 'p_prep' }; renderStatus();
    let r;
    try { r = await LA.prefetchAll({ onProgress: p => { S.progress = p; renderStatus(); } }); } catch (e) { r = { done: 0, failed: 1 }; }
    S.busy = false; await loadState(); renderStatus(); rerender();
    toast(r.done ? t('t_saved', { n: num(r.done - r.failed) }) + (r.failed ? ' ' + t('t_failed', { n: num(r.failed) }) : '') : t('t_all_saved'));
  }

  // ---------- Artikel-HTML aufbereiten ----------
  function cleanHtml(html, page) {
    const base = page.src === 'fd' ? 'https://gta.fandom.com' : `https://${page.lang}.wikipedia.org`;
    const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
    const r = doc.getElementById('r');
    r.querySelectorAll('script,style,link,meta,noscript,iframe,form,.mw-editsection,.navbox,.navbox-styles,.noprint,.metadata,.ambox,.toc,#toc,sup.reference,.reference,.mw-references-wrap,.references,.reflist,.printfooter,.catlinks,.mw-empty-elt,.sistersitebox,.mbox-small,.hatnote,.authority-control').forEach(e => e.remove());
    r.querySelectorAll('[style],[bgcolor],[color],[width]').forEach(e => { if (e.tagName !== 'IMG') { e.removeAttribute('style'); e.removeAttribute('bgcolor'); e.removeAttribute('color'); e.removeAttribute('width'); } });
    r.querySelectorAll('img').forEach(img => {
      let src = img.getAttribute('data-src') || img.getAttribute('src') || '';
      if (src.startsWith('//')) src = 'https:' + src; else if (src.startsWith('/')) src = base + src;
      if (!src || src.startsWith('data:')) { img.remove(); return; }
      img.setAttribute('src', src); img.removeAttribute('srcset'); img.removeAttribute('data-src'); img.removeAttribute('style');
      img.setAttribute('loading', 'lazy'); img.setAttribute('decoding', 'async'); img.classList.remove('lazyload');
    });
    r.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) { a.setAttribute('data-jump', href.slice(1)); a.setAttribute('href', '#artikel/' + enc(page.id)); return; }
      const m = href.match(/^\/wiki\/([^#?]+)/);
      if (m) {
        const target = S.byId.get(page.src + ':' + decodeURIComponent(m[1]).replace(/_/g, ' '));
        if (target) { a.setAttribute('href', '#artikel/' + enc(target.id)); return; }
        a.setAttribute('href', base + href);
      } else if (href.startsWith('//')) a.setAttribute('href', 'https:' + href);
      else if (href.startsWith('/')) a.setAttribute('href', base + href);
      a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener');
    });
    r.querySelectorAll('table').forEach(tb => {
      if (tb.closest('.portable-infobox') || tb.classList.contains('infobox')) return;
      const w = doc.createElement('div'); w.className = 'table-wrap'; tb.replaceWith(w); w.appendChild(tb);
    });
    const frag = document.createDocumentFragment();
    while (r.firstChild) frag.appendChild(document.adoptNode(r.firstChild));
    return frag;
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-jump]');
    if (!a) return;
    e.preventDefault();
    const id = a.getAttribute('data-jump');
    const el = document.getElementById(id) || document.getElementById(decodeURIComponent(id));
    if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  // ---------- Suche ----------
  async function buildIndex() {
    const texts = new Map();
    const keys = await LA.idb.keys('html'); const vals = await LA.idb.all('html');
    keys.forEach((k, i) => texts.set(k, vals[i].text || ''));
    S.index = S.pages.map(p => {
      const body = p.src === 'seed' ? (p.summary + ' ' + p.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) : (texts.get(p.id) || '');
      return { p, t: norm(p.title), c: norm(catName(p)), b: norm(body), raw: body };
    });
  }
  function snippet(raw, words) {
    const n = norm(raw);
    let pos = -1;
    for (const w of words) { pos = n.indexOf(w); if (pos >= 0) break; }
    if (pos < 0) return '';
    const start = Math.max(0, pos - 60);
    let s = esc((start ? '…' : '') + raw.slice(start, pos + 140) + '…');
    for (const w of words) s = s.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
    return s;
  }
  async function runSearch(q) {
    const box = $('#results'); if (!box) return;
    const words = norm(q).split(/\s+/).filter(w => w.length > 1 || /[^\x00-\x7f]/.test(w));
    if (!words.length) { box.innerHTML = `<section class="card"><p class="empty">${esc(t('search_intro', { n: num(S.pages.length) }))}</p></section>`; return; }
    if (!S.index) { box.innerHTML = `<p class="muted">${esc(t('search_building'))}</p>`; await buildIndex(); }
    const res = [];
    for (const e of S.index) {
      let score = 0, all = true;
      for (const w of words) {
        const inT = e.t.includes(w), inC = e.c.includes(w), inB = e.b.includes(w);
        if (!inT && !inC && !inB) { all = false; break; }
        score += (e.t.startsWith(w) ? 12 : inT ? 8 : 0) + (inC ? 3 : 0) + (inB ? 1 : 0);
      }
      if (all) res.push([score + (e.p.src === 'seed' ? 4 : 0), e]);
    }
    res.sort((a, b) => b[0] - a[0]);
    box.innerHTML = res.length
      ? `<section class="card"><h2>${esc(t('search_hits', { n: num(res.length) }))}</h2><ul class="rows">${res.slice(0, 150).map(([, e]) => `<li>${pageLink(e.p, snippet(e.raw, words) || esc(catName(e.p)))}</li>`).join('')}</ul></section>`
      : `<section class="card"><p class="empty">${esc(t('search_none', { q }))}</p></section>`;
  }

  // ---------- Service Worker ----------
  async function setupSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast(t('t_newversion'), { label: t('t_reload'), fn: () => location.reload() });
        });
      });
      await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) {
        const st = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => null);
        if (st && st.state === 'granted') await reg.periodicSync.register('la-refresh', { minInterval: 60 * 60e3 }).catch(() => {});
      }
      navigator.serviceWorker.addEventListener('message', async e => { if (e.data && e.data.type === 'updated') { await loadState(); renderStatus(); rerender(); } });
      setInterval(() => reg.update().catch(() => {}), 6 * 3600e3);
    } catch (e) { /* App läuft auch ohne Service Worker */ }
  }
  async function bgSyncInfo() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && 'periodicSync' in reg && (await reg.periodicSync.getTags()).includes('la-refresh')) return t('bg_on');
    } catch (e) { /* ignorieren */ }
    return t('bg_off');
  }

  // ---------- Start ----------
  $('#refreshBtn').onclick = () => runRefresh(true);
  $('#langBtn').onclick = openLangDialog;
  $('#langClose').onclick = () => $('#langDlg').close();
  $('#langDlg').addEventListener('click', e => { if (e.target === $('#langDlg')) $('#langDlg').close(); });
  window.addEventListener('hashchange', () => route());
  window.addEventListener('online', () => { renderStatus(); maybeAuto(); });
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderStatus(); maybeAuto(); } });
  setInterval(() => {
    renderStatus(); maybeAuto();
    if (current.name === 'home' && $('#count')) { const h = heroText(); $('#count').innerHTML = heroHtml(h); $('#countSmall').textContent = h.small; }
  }, 30e3);

  (async function init() {
    applyLang(detectLang());
    S.settings = await LA.getSettings();
    if (S.settings.lang !== LANG) { S.settings.lang = LANG; await LA.saveSettings(S.settings); }
    await loadState();
    renderChrome(); renderStatus(); route();
    setupSW();
    maybeAuto();
  })();
})();
