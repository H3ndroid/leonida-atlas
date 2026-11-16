/* Leonida Atlas – Datenschicht.
   Wird von der Seite (app.js) und vom Service Worker (sw.js) gemeinsam genutzt.
   Quellen: Wikipedia (DE/EN), GTA-Wiki (gta.fandom.com), Reddit r/GTA6. */
(function (g) {
  'use strict';

  // ---------- IndexedDB ----------
  const DB_NAME = 'leonida-atlas';
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['kv', 'pages', 'html']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const os = async (s, m) => (await db()).transaction(s, m).objectStore(s);
  const idb = {
    get: async (s, k) => req((await os(s, 'readonly')).get(k)),
    set: async (s, k, v) => req((await os(s, 'readwrite')).put(v, k)),
    del: async (s, k) => req((await os(s, 'readwrite')).delete(k)),
    all: async s => req((await os(s, 'readonly')).getAll()),
    keys: async s => req((await os(s, 'readonly')).getAllKeys()),
    clear: async s => req((await os(s, 'readwrite')).clear()),
    putMany: async (s, entries) => {
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction(s, 'readwrite'); const o = t.objectStore(s);
        for (const [k, v] of entries) o.put(v, k);
        t.oncomplete = () => res(); t.onerror = () => rej(t.error);
      });
    },
    delMany: async (s, keys) => {
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction(s, 'readwrite'); const o = t.objectStore(s);
        for (const k of keys) o.delete(k);
        t.oncomplete = () => res(); t.onerror = () => rej(t.error);
      });
    }
  };

  // ---------- Einstellungen ----------
  const DEFAULTS = {
    lang: null,            // App-Sprache: de | en | es | fr | ja | ar
    sources: { wploc: true, wpen: true, fandom: true, reddit: true },
    interval: 'auto',      // 'auto' | '15' | '60' | '360' | 'manual'
    offline: false,        // alle Artikel offline speichern
    notify: false,         // Benachrichtigung bei Hintergrund-Updates
    extraWiki: ''          // zusätzliche Wikipedia-Artikel, je Zeile "de:Titel" oder "en:Titel"
  };
  async function getSettings() {
    const s = await idb.get('kv', 'settings');
    const src = Object.assign({}, DEFAULTS.sources, (s && s.sources) || {});
    if (s && s.sources && 'wpde' in s.sources && !('wploc' in s.sources)) src.wploc = s.sources.wpde; // ältere Version
    delete src.wpde;
    return Object.assign({}, DEFAULTS, s || {}, { sources: src });
  }
  // Zusätzliche Wikipedia-Artikel aus den Optionen: { de: [...], en: [...] }
  function extraWiki(s) {
    const out = {};
    for (const l of (s.extraWiki || '').split('\n')) {
      const m = l.trim().match(/^([a-z]{2,3}):(.+)$/i);
      if (m) (out[m[1].toLowerCase()] = out[m[1].toLowerCase()] || []).push(m[2].trim());
    }
    return out;
  }
  // Ist ein gespeicherter Eintrag bei den aktuellen Einstellungen sichtbar?
  function isEnabled(p, s) {
    if (p.src === 'seed') return true;
    if (p.src === 'fd') return !!s.sources.fandom;
    const code = p.src.slice(2);
    return (code === 'en' && s.sources.wpen) || (code === (s.lang || 'en') && s.sources.wploc) || !!extraWiki(s)[code];
  }
  const saveSettings = s => idb.set('kv', 'settings', s);

  // Release-Zeitraum: häufiger aktualisieren
  const RELEASE = new Date(2026, 10, 19).getTime();
  function autoIntervalMin(now = Date.now()) {
    return (now >= RELEASE - 7 * 864e5 && now < RELEASE + 60 * 864e5) ? 15 : 60;
  }
  function intervalMs(s) {
    if (s.interval === 'manual') return Infinity;
    if (s.interval === 'auto') return autoIntervalMin() * 60e3;
    return (+s.interval || 60) * 60e3;
  }

  // ---------- Netzwerk ----------
  const qs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  async function getJSON(url, ms = 20000) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'timeout' : e.name === 'TypeError' ? 'offline' : (e.message || 'offline'));
    } finally { clearTimeout(t); }
  }
  const FD = 'https://gta.fandom.com';
  const fdApi = p => getJSON(FD + '/api.php?' + qs(Object.assign({ format: 'json', formatversion: 2, origin: '*' }, p)));
  const wpApi = (lang, p) => getJSON(`https://${lang}.wikipedia.org/w/api.php?` + qs(Object.assign({ format: 'json', formatversion: 2, origin: '*' }, p)));

  // ---------- Kategorien des GTA-Wikis ----------
  const FD_ROOT = 'Category:Grand Theft Auto VI';
  const FD_EXCLUDE = /image|file|video|gallery|screenshot|artwork|template|stub|user|candidate|deletion|maintenance|cleanup|disambig|redirect|navbox/i;
  const LABELS = [
    [/character|protagonist|antagonist|people|families/i, 'characters'],
    [/vehicle|car|boat|aircraft|motorcycle|bike/i, 'vehicles'],
    [/weapon/i, 'weapons'],
    [/mission|heist|quest|story/i, 'missions'],
    [/location|place|district|neighbo|island|region|building|landmark|street/i, 'places'],
    [/radio|song|music|soundtrack|artist/i, 'music'],
    [/business|compan|brand|store|shop|restaurant/i, 'business'],
    [/gang|organi[sz]ation|cartel|crew|factions?/i, 'gangs'],
    [/trailer|media|marketing|promotion|screenshot/i, 'media'],
    [/animal|wildlife|creature/i, 'animals'],
    [/website|internet|social|app/i, 'web'],
    [/activit|hobb|sport|minigame/i, 'activities'],
    [/clothing|outfit|fashion/i, 'clothing'],
    [/development|leak|beta|cut/i, 'dev'],
    [/achievement|trophy|trophies|collectible/i, 'achievements'],
    [/police|law|government/i, 'police']
  ];
  function catLabel(title) {
    const raw = title.replace(/^Category:/, '').replace(/\s*(in|of|from)\s+(GTA VI|GTA 6|Grand Theft Auto VI)\s*$/i, '')
      .replace(/^(GTA VI|GTA 6|Grand Theft Auto VI)\s*/i, '').trim();
    for (const [re, l] of LABELS) if (re.test(raw)) return l;
    return raw || 'general';
  }

  async function fandomFullCrawl(progress) {
    const queue = [{ title: FD_ROOT, depth: 0, label: 'general' }];
    const seen = new Set([FD_ROOT]); const cats = []; const pages = new Map();
    while (queue.length && cats.length < 90 && pages.size < 4000) {
      const c = queue.shift(); cats.push([c.title, c.label]);
      if (c.depth < 3) {
        let cont = {};
        do {
          const j = await fdApi(Object.assign({ action: 'query', list: 'categorymembers', cmtitle: c.title, cmtype: 'subcat', cmlimit: 500 }, cont));
          for (const m of (j.query && j.query.categorymembers) || []) {
            if (seen.has(m.title) || FD_EXCLUDE.test(m.title)) continue;
            seen.add(m.title);
            queue.push({ title: m.title, depth: c.depth + 1, label: c.depth === 0 ? catLabel(m.title) : c.label });
          }
          cont = j.continue || null;
        } while (cont);
      }
      let cont = {};
      do {
        const j = await fdApi(Object.assign({ action: 'query', generator: 'categorymembers', gcmtitle: c.title, gcmtype: 'page', gcmnamespace: 0, gcmlimit: 500, prop: 'info' }, cont));
        for (const p of (j.query && j.query.pages) || []) {
          if (!pages.has(p.title)) pages.set(p.title, { title: p.title, rev: p.lastrevid, touched: p.touched, cat: c.label });
        }
        cont = j.continue || null;
      } while (cont && pages.size < 4000);
      progress({ k: 'p_fd', c: cats.length, n: pages.size });
    }
    return { pages, cats };
  }

  // Schnelle Prüfung über die letzten Änderungen im Wiki
  async function fandomQuick(sinceMs, knownByTitle, knownCats, progress) {
    const titles = new Set(); let cont = {}; let rounds = 0;
    do {
      const j = await fdApi(Object.assign({ action: 'query', list: 'recentchanges', rcnamespace: 0, rcprop: 'title|ids|timestamp', rctype: 'edit|new', rclimit: 500, rcend: new Date(sinceMs).toISOString() }, cont));
      for (const rc of (j.query && j.query.recentchanges) || []) titles.add(rc.title);
      cont = j.continue || null; rounds++;
    } while (cont && rounds < 6);
    progress({ k: 'p_fdq', n: titles.size });
    const list = [...titles];
    const out = [];
    for (let i = 0; i < list.length && i < 600; i += 50) {
      const batch = list.slice(i, i + 50);
      const j = await fdApi({ action: 'query', titles: batch.join('|'), prop: 'info|categories', cllimit: 'max' });
      for (const p of (j.query && j.query.pages) || []) {
        if (p.missing) continue;
        const known = knownByTitle.get(p.title);
        const inGta6 = (p.categories || []).some(c => knownCats.has(c.title));
        if (known || inGta6) {
          const firstCat = (p.categories || []).find(c => knownCats.has(c.title));
          out.push({ title: p.title, rev: p.lastrevid, touched: p.touched, cat: known ? known.cat : (firstCat ? knownCats.get(firstCat.title) : 'general') });
        }
      }
    }
    return out;
  }

  // ---------- Artikel-HTML ----------
  function plainText(html) {
    return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  async function fetchHtml(page) {
    const params = { action: 'parse', page: page.title, prop: 'text|revid', disableeditsection: 1, disabletoc: 1, redirects: 1 };
    const j = page.src === 'fd' ? await fdApi(params) : await wpApi(page.lang, params);
    if (j.error) throw new Error(j.error.info || j.error.code);
    const html = j.parse.text;
    const rec = { html, rev: j.parse.revid, at: Date.now(), text: plainText(html).slice(0, 6000) };
    await idb.set('html', page.id, rec);
    return rec;
  }

  // ---------- Reddit ----------
  async function fetchNews() {
    const j = await getJSON('https://www.reddit.com/r/GTA6/hot.json?limit=30&raw_json=1');
    const items = ((j.data && j.data.children) || []).map(c => c.data).map(d => ({
      id: d.id, title: d.title, flair: d.link_flair_text || '', score: d.score, comments: d.num_comments,
      at: d.created_utc * 1000, url: 'https://www.reddit.com' + d.permalink, pinned: !!d.stickied
    }));
    const rec = { at: Date.now(), items };
    await idb.set('kv', 'news', rec);
    return rec;
  }

  // ---------- Aktualisierung ----------
  const WP_MAIN = 'Grand Theft Auto VI';

  // Titel des Hauptartikels in einer anderen Sprache über die Sprachverknüpfungen der englischen Wikipedia
  async function localTitle(lang) {
    if (lang === 'en') return WP_MAIN;
    const cached = await idb.get('kv', 'wptitle:' + lang);
    if (cached && Date.now() - cached.at < 7 * 864e5) return cached.title;
    const j = await wpApi('en', { action: 'query', prop: 'langlinks', titles: WP_MAIN, lllang: lang, redirects: 1 });
    const p = j.query && j.query.pages && j.query.pages[0];
    const title = p && p.langlinks && p.langlinks[0] ? p.langlinks[0].title : null;
    await idb.set('kv', 'wptitle:' + lang, { title, at: Date.now() });
    return title;
  }

  async function refresh(opts = {}) {
    const progress = opts.onProgress || (() => {});
    const lock = await idb.get('kv', 'lock');
    if (lock && Date.now() - lock < 4 * 60e3) return { skipped: true };
    await idb.set('kv', 'lock', Date.now());
    const s = await getSettings();
    const result = { added: 0, changed: 0, imported: 0, errors: [], sources: {} };
    const changes = [];
    const fail = (key, e) => { result.errors.push({ src: key, msg: e.message }); result.sources[key] = { ok: false, at: Date.now(), msg: e.message }; };
    try {
      const pagesArr = await idb.all('pages');
      const known = new Map(pagesArr.map(p => [p.id, p]));
      const upserts = new Map();
      const now = Date.now();
      const track = (rec, silent) => {
        const old = known.get(rec.id);
        rec.firstSeen = old ? old.firstSeen : now;
        if (!old) { if (silent) result.imported++; else { result.added++; changes.push({ id: rec.id, title: rec.title, src: rec.src, type: 'new', at: now }); } }
        else if (old.rev !== rec.rev) { result.changed++; rec.changedAt = now; changes.push({ id: rec.id, title: rec.title, src: rec.src, type: 'changed', at: now }); }
        else rec.changedAt = old.changedAt;
        upserts.set(rec.id, rec);
        return !old || old.rev !== rec.rev;
      };

      // Wikipedia: App-Sprache, Englisch und zusätzliche Artikel
      const lang = s.lang || 'en';
      const targets = {};
      const add = (l, t) => { if (t) (targets[l] = targets[l] || new Set()).add(t); };
      if (s.sources.wpen) add('en', WP_MAIN);
      if (s.sources.wploc && lang !== 'en') {
        try { add(lang, await localTitle(lang)); } catch (e) { fail('wp' + lang, e); }
      }
      const extra = extraWiki(s);
      for (const l of Object.keys(extra)) extra[l].forEach(t => add(l, t));
      for (const l of Object.keys(targets)) {
        const key = 'wp' + l;
        progress({ k: 'p_wiki', l: l.toUpperCase() });
        try {
          const j = await wpApi(l, { action: 'query', prop: 'info', titles: [...targets[l]].join('|'), redirects: 1 });
          const hadAny = pagesArr.some(p => p.src === key);
          for (const p of (j.query && j.query.pages) || []) {
            if (p.missing) continue;
            const rec = { id: `${key}:${p.title}`, src: key, lang: l, title: p.title, cat: 'wikipedia', rev: p.lastrevid, touched: p.touched, url: `https://${l}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}` };
            if (track(rec, !hadAny)) { try { await fetchHtml(rec); } catch (e) { /* lädt beim Öffnen */ } }
          }
          result.sources[key] = { ok: true, at: Date.now() };
        } catch (e) { fail(key, e); }
      }

      // GTA-Wiki
      if (s.sources.fandom) {
        try {
          const meta = (await idb.get('kv', 'fdmeta')) || {};
          const fdKnown = pagesArr.filter(p => p.src === 'fd');
          const needFull = meta.v !== 2 || !meta.full || !fdKnown.length || (now - meta.full > 6 * 3600e3) || (opts.manual && now - meta.full > 3600e3);
          let found = [];
          if (needFull) {
            const { pages, cats } = await fandomFullCrawl(progress);
            found = [...pages.values()];
            meta.cats = cats; // [Titel, Bereich] – für spätere Schnellprüfungen
            meta.full = now; meta.v = 2;
            // Seiten, die nicht mehr in den Kategorien stehen, entfernen
            const still = new Set(found.map(p => 'fd:' + p.title));
            const gone = fdKnown.filter(p => !still.has(p.id)).map(p => p.id);
            if (gone.length) { await idb.delMany('pages', gone); await idb.delMany('html', gone); }
          } else {
            const knownByTitle = new Map(fdKnown.map(p => [p.title, p]));
            const knownCats = new Map(meta.cats || []);
            found = await fandomQuick(meta.quick || meta.full, knownByTitle, knownCats, progress);
          }
          meta.quick = now;
          await idb.set('kv', 'fdmeta', meta);
          const silent = !fdKnown.length;
          const toPrefetch = [];
          for (const p of found) {
            const rec = { id: 'fd:' + p.title, src: 'fd', title: p.title, cat: p.cat, rev: p.rev, touched: p.touched, url: FD + '/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_')) };
            if (track(rec, silent) && !silent) toPrefetch.push(rec);
          }
          if (silent && found.length) changes.push({ id: null, n: found.length, src: 'fd', type: 'import', at: now });
          // Geänderte Seiten direkt neu laden, damit sie offline aktuell sind
          for (const rec of toPrefetch.slice(0, 40)) { try { await fetchHtml(rec); } catch (e) { /* später */ } }
          result.sources.fd = { ok: true, at: Date.now(), full: needFull };
        } catch (e) { fail('fd', e); }
      }

      if (upserts.size) await idb.putMany('pages', [...upserts.entries()]);

      // Reddit
      if (s.sources.reddit) {
        progress({ k: 'p_news' });
        try { await fetchNews(); result.sources.reddit = { ok: true, at: Date.now() }; }
        catch (e) { fail('reddit', e); }
      }

      if (changes.length) {
        const log = (await idb.get('kv', 'log')) || [];
        await idb.set('kv', 'log', changes.concat(log).slice(0, 500));
      }
      const prev = (await idb.get('kv', 'last')) || {};
      await idb.set('kv', 'last', { at: Date.now(), errors: result.errors, sources: Object.assign({}, prev.sources || {}, result.sources), reason: opts.reason || 'manual', added: result.added, changed: result.changed });
      return result;
    } finally {
      await idb.del('kv', 'lock');
    }
  }

  // Alle Artikel offline speichern (fehlende oder veraltete)
  async function prefetchAll(opts = {}) {
    const progress = opts.onProgress || (() => {});
    const pages = (await idb.all('pages'));
    const htmls = await idb.all('html'); const keys = await idb.keys('html');
    const revs = new Map(keys.map((k, i) => [k, htmls[i].rev]));
    const todo = pages.filter(p => revs.get(p.id) !== p.rev);
    let done = 0, failed = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (todo.length) {
        if (opts.signal && opts.signal.aborted) return;
        const p = todo.shift();
        try { await fetchHtml(p); } catch (e) { failed++; }
        done++;
        if (done % 5 === 0 || !todo.length) progress({ k: 'p_offline', n: done, m: done + todo.length });
      }
    });
    await Promise.all(workers);
    return { done, failed };
  }

  async function resetData() {
    await idb.clear('pages'); await idb.clear('html');
    for (const k of ['log', 'last', 'news', 'fdmeta', 'lock']) await idb.del('kv', k);
    for (const k of await idb.keys('kv')) if (String(k).startsWith('wptitle:')) await idb.del('kv', k);
  }

  // Text der Hintergrund-Benachrichtigung je Sprache
  const NOTIFY = { de: '{n} Neuigkeiten zu GTA 6', en: '{n} updates about GTA 6', es: '{n} novedades sobre GTA 6', fr: '{n} nouveautés sur GTA 6', ja: 'GTA 6 の更新 {n} 件', ar: '{n} تحديثات حول GTA 6' };

  g.LA = { idb, getSettings, saveSettings, intervalMs, autoIntervalMin, refresh, prefetchAll, fetchHtml, resetData, isEnabled, extraWiki, RELEASE, NOTIFY };
})(typeof self !== 'undefined' ? self : this);
