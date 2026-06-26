// ==UserScript==
// @name         old.reddit Square Card Grid
// @namespace    https://example.local/old-reddit-square-grid
// @version      1.1.0
// @description  Replace the old.reddit list view with a grid of square image/video preview cards, with prefetching infinite scroll.
// @author       ̊̊̊̊̊̊ ̶a̶n̶t̶i̶m̶o̶n̶y̶CLAUDE ̊̊̊̊̊̊
// @match        *://old.reddit.com/*
// @icon         https://www.redditstatic.com/desktop2x/img/favicon/favicon-32x32.png
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Top frame only, run once
  if (window.top !== window.self) return;
  if (window.__sqGridLoaded) return;
  window.__sqGridLoaded = true;

  /* ------------------------------ CONFIG ------------------------------ *
   * Tweak these to taste, then save in Tampermonkey.                     */
  const CONFIG = {
    cardSize: 230,          // min tile width in px (grid auto-fills columns)
    gap: 8,                 // px gap between tiles
    maxWidth: 1700,         // px max grid width (0 = full width)
    cardClick: 'content',   // clicking a tile: 'content' (image/video/link) or 'comments'
    showTitleOnHover: true, // true = title/score overlay shows only on hover; false = always on
    hideTextPosts: false,   // true = drop self/text posts entirely (pure media grid)
    blurNSFW: true,         // blur nsfw/spoiler previews until hover

    openInNewTab: true,     // open links in a new tab
    skipPromoted: true,     // skip promoted/ad posts

    infiniteScroll: true,   // auto-load the next page as you scroll
    prefetchPages: 2,       // how many pages to fetch ahead and keep buffered
    prefetchImages: true,   // warm the image cache for buffered pages too
    triggerMargin: 900,     // px before the bottom to start loading
  };
  /* ------------------------------------------------------------------- */

  // Don't touch single-post (comments) pages
  if (location.pathname.includes('/comments/')) return;

  const origin = location.origin;
  const seen = new Set();          // fullnames already rendered (dedupe)
  let grid = null;
  let navFooter = null;

  // infinite-scroll state
  const buffer = [];               // [{cards: [el,...]}] pages fetched, not yet shown
  let fetchCursor = null;          // URL of the next page to fetch (null = end)
  let topUpPromise = null;         // in-flight prefetch chain
  let appending = false;           // fill() reentrancy guard
  let ended = false;
  let curStatus = '';

  /* --------------------------- helpers ------------------------------- */
  const fmt = (n) => {
    n = +n;
    if (!isFinite(n)) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return '' + n;
  };
  const abs = (u) => (!u ? '' : u[0] === '/' ? origin + u : u);
  const normSrc = (u) => (!u ? '' : u.startsWith('//') ? 'https:' + u : u);
  const isImageUrl = (u) => /\.(jpe?g|png|gif|webp)(\?|$)/i.test(u || '');
  const raf = () => new Promise((r) => requestAnimationFrame(r));

  // Pull the widest redd.it preview <img> out of a post's cached expando HTML.
  function widestPreview(cachedHtml) {
    if (!cachedHtml) return null;
    let best = null, bestW = 0;
    try {
      const doc = new DOMParser().parseFromString(cachedHtml, 'text/html');
      doc.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (!/redd\.it/.test(src)) return;           // ignore static UI icons
        const w = parseInt(img.getAttribute('width') || '0', 10) || 0;
        if (w >= bestW) { bestW = w; best = src; }
      });
    } catch (e) { /* ignore */ }
    return best;
  }

  // Best available preview source for a post (or null for text posts).
  // Reads via getAttribute so it works on both live and fetched (detached) nodes.
  function getMedia(thing) {
    const thumb = thing.querySelector('.thumbnail img');
    const expando = thing.querySelector('.expando');
    const cached = expando ? expando.getAttribute('data-cachedhtml') : null;

    let src = widestPreview(cached);                            // high-res preview
    if (!src && thumb) {
      const t = normSrc(thumb.getAttribute('src'));
      if (t && !/redditstatic\.com/.test(t)) src = t;          // thumbnail fallback
    }
    if (!src && isImageUrl(thing.dataset.url)) src = normSrc(thing.dataset.url);
    return src || null;
  }

  // Find the "next page" URL from a document (live or fetched).
  function getNextUrl(doc) {
    const a = doc.querySelector('.nav-buttons .next-button a, .nav-buttons a[rel~="next"]');
    if (!a) return null;
    const href = a.getAttribute('href');
    return href ? abs(href) : null;
  }

  /* --------------------------- card build ---------------------------- */
  function buildCard(thing) {
    const d = thing.dataset;
    if (CONFIG.skipPromoted && d.promoted === 'true') return null;

    const media = getMedia(thing);
    const isText = !media;
    if (isText && CONFIG.hideTextPosts) return null;

    const titleEl = thing.querySelector('a.title');
    const title = titleEl ? titleEl.textContent.trim() : '(untitled)';
    const contentUrl = abs(d.url);
    const commentsUrl = abs(d.permalink);
    const sub = d.subredditPrefixed || '';
    const score = fmt(d.score);
    const comments = fmt(d.commentsCount);
    const isVideo = d.kind === 'video';
    const isGallery = d.isGallery === 'true';
    const isNSFW = d.nsfw === 'true' || d.spoiler === 'true';
    const durEl = thing.querySelector('.duration-overlay');
    const dur = durEl ? durEl.textContent.trim() : '';
    const target = CONFIG.openInNewTab ? '_blank' : '_self';
    const mainHref = CONFIG.cardClick === 'comments'
      ? commentsUrl
      : (contentUrl || commentsUrl);

    const card = document.createElement('div');
    card.className = 'sqcard'
      + (isText ? ' sqcard--text' : '')
      + (isNSFW && CONFIG.blurNSFW ? ' sqcard--nsfw' : '');
    if (d.fullname) card.dataset.fullname = d.fullname;
    if (media) card.dataset.media = media;

    // Main media link
    const a = document.createElement('a');
    a.className = 'sqcard-media';
    a.href = mainHref || '#';
    a.target = target;
    a.rel = 'noopener';
    if (media) {
      a.style.backgroundImage = 'url("' + media + '")';
    } else {
      const t = document.createElement('div');
      t.className = 'sqcard-textinner';
      t.textContent = title;
      a.appendChild(t);
    }
    card.appendChild(a);

    // Top-left badges
    const badges = document.createElement('div');
    badges.className = 'sqcard-badges';
    if (isVideo) {
      const b = document.createElement('span');
      b.className = 'sqb sqb-v';
      b.textContent = '\u25B6' + (dur ? ' ' + dur : '');
      badges.appendChild(b);
    }
    if (isGallery) {
      const b = document.createElement('span');
      b.className = 'sqb sqb-g';
      b.textContent = '\u25A6';
      badges.appendChild(b);
    }
    if (isNSFW) {
      const b = document.createElement('span');
      b.className = 'sqb sqb-n';
      b.textContent = 'NSFW';
      badges.appendChild(b);
    }
    if (badges.childNodes.length) card.appendChild(badges);

    // Top-right comments pill -> comments
    const cpill = document.createElement('a');
    cpill.className = 'sqcard-comments';
    cpill.href = commentsUrl;
    cpill.target = target;
    cpill.rel = 'noopener';
    cpill.textContent = '\uD83D\uDCAC ' + comments;
    card.appendChild(cpill);

    // Bottom overlay: title + meta
    const ov = document.createElement('div');
    ov.className = 'sqcard-overlay';
    const tl = document.createElement('a');
    tl.className = 'sqcard-title';
    tl.href = commentsUrl;
    tl.target = target;
    tl.rel = 'noopener';
    tl.textContent = title;
    const meta = document.createElement('div');
    meta.className = 'sqcard-meta';
    meta.textContent = sub + '  \u00B7  \u25B2 ' + score;
    ov.appendChild(tl);
    ov.appendChild(meta);
    card.appendChild(ov);

    return card;
  }

  // Convert a list of .thing.link elements into card elements (deduped).
  function thingsToCards(things) {
    const cards = [];
    things.forEach((thing) => {
      const fn = thing.dataset.fullname;
      if (fn && seen.has(fn)) return;
      const card = buildCard(thing);
      if (!card) return;
      if (fn) seen.add(fn);
      cards.push(card);
    });
    return cards;
  }

  function appendCards(cards) {
    if (!grid || !cards || !cards.length) return;
    const frag = document.createDocumentFragment();
    cards.forEach((c) => frag.appendChild(c));
    grid.appendChild(frag);
  }

  /* ----------------------------- render ------------------------------ */
  function ensureGrid() {
    if (grid && document.contains(grid)) return grid;
    const siteTable = document.getElementById('siteTable');
    if (!siteTable) return null;
    grid = document.createElement('div');
    grid.id = 'sqgrid';
    if (CONFIG.maxWidth) grid.style.maxWidth = CONFIG.maxWidth + 'px';
    grid.style.setProperty('--sq-size', CONFIG.cardSize + 'px');
    grid.style.setProperty('--sq-gap', CONFIG.gap + 'px');
    siteTable.parentNode.insertBefore(grid, siteTable.nextSibling);
    document.body.classList.add('sq-on');
    return grid;
  }

  // Manual "next" footer (used only when infinite scroll is off).
  function syncNav() {
    if (!grid) return;
    const navs = document.querySelectorAll('.nav-buttons');
    const nav = navs[navs.length - 1];
    if (!nav) return;
    if (!navFooter) {
      navFooter = document.createElement('div');
      navFooter.id = 'sqnav';
      grid.parentNode.insertBefore(navFooter, grid.nextSibling);
    }
    navFooter.innerHTML = '';
    navFooter.appendChild(nav.cloneNode(true));
  }

  /* ------------------ infinite scroll / prefetch --------------------- */
  async function fetchPage(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  // Keep fetching ahead until the buffer holds CONFIG.prefetchPages pages.
  function topUpBuffer() {
    if (!CONFIG.infiniteScroll) return Promise.resolve();
    if (!topUpPromise) {
      topUpPromise = (async () => {
        try {
          while (buffer.length < CONFIG.prefetchPages && fetchCursor) {
            const url = fetchCursor;
            let doc;
            try {
              doc = await fetchPage(url);
            } catch (e) {
              console.warn('[sqgrid] prefetch failed:', e);
              break; // leave fetchCursor as-is so it can retry later
            }
            const things = [...doc.querySelectorAll('#siteTable .thing.link')];
            const cards = thingsToCards(things);
            if (CONFIG.prefetchImages) {
              cards.forEach((c) => { if (c.dataset.media) { const im = new Image(); im.src = c.dataset.media; } });
            }
            buffer.push({ cards });
            fetchCursor = getNextUrl(doc); // advance (may become null = end)
          }
        } finally {
          topUpPromise = null;
        }
      })();
    }
    return topUpPromise;
  }

  function nearBottom() {
    const s = document.getElementById('sqsentinel');
    if (!s) return false;
    return s.getBoundingClientRect().top <= window.innerHeight + CONFIG.triggerMargin;
  }

  function setStatus(text) {
    curStatus = text;
    let s = document.getElementById('sqstatus');
    if (!s) {
      s = document.createElement('div');
      s.id = 'sqstatus';
      const sent = document.getElementById('sqsentinel');
      grid.parentNode.insertBefore(s, sent ? sent.nextSibling : null);
    }
    s.textContent = text;
    s.style.display = text ? '' : 'none';
  }

  function markEnded() {
    ended = true;
    setStatus('No more posts.');
  }

  async function fill() {
    if (!CONFIG.infiniteScroll || ended) return;
    if (appending || document.body.classList.contains('sq-off')) return;
    appending = true;
    try {
      while (nearBottom()) {
        if (!buffer.length) {
          if (!fetchCursor) { markEnded(); break; }
          setStatus('Loading\u2026');
          await topUpBuffer();
          if (!buffer.length) {
            if (!fetchCursor) { markEnded(); break; }
            setStatus('Couldn\u2019t load more \u2014 scroll to retry.');
            break;
          }
        }
        appendCards(buffer.shift().cards);
        topUpBuffer();          // refill in the background, don't wait
        await raf();            // let layout settle so nearBottom() re-measures
      }
      if (!ended) {
        if (buffer.length === 0 && !fetchCursor) markEnded();
        else if (curStatus === 'Loading\u2026') setStatus('');
      }
    } finally {
      appending = false;
    }
  }

  function setupInfinite() {
    const sentinel = document.createElement('div');
    sentinel.id = 'sqsentinel';
    grid.parentNode.insertBefore(sentinel, grid.nextSibling);

    fetchCursor = getNextUrl(document);

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) fill();
      }, { root: null, rootMargin: CONFIG.triggerMargin + 'px 0px', threshold: 0 });
      io.observe(sentinel);
    }

    // backup trigger for any layout where IO is flaky
    let t = null;
    window.addEventListener('scroll', () => {
      if (t) return;
      t = setTimeout(() => { t = null; fill(); }, 200);
    }, { passive: true });

    topUpBuffer(); // start prefetching immediately
    fill();        // fill the first screen if the initial page is short
  }

  /* ------- observer (only used when infinite scroll is OFF) ---------- */
  function observe() {
    const targetEl = document.querySelector('.content') || document.body;
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          let things = null;
          if (n.matches && n.matches('.thing.link')) things = [n];
          else if (n.querySelector && n.querySelector('.thing.link')) things = [...n.querySelectorAll('.thing.link')];
          if (things) { appendCards(thingsToCards(things)); syncNav(); }
        });
      }
    });
    mo.observe(targetEl, { childList: true, subtree: true });
  }

  /* ----------------------------- toggle ------------------------------ */
  function addToggle() {
    const btn = document.createElement('button');
    btn.id = 'sqtoggle';
    const setLabel = () => {
      btn.textContent = document.body.classList.contains('sq-off')
        ? '\u25A6 Grid view' : '\u2630 List view';
    };
    if (localStorage.getItem('sqGridOff') === '1') document.body.classList.add('sq-off');
    setLabel();
    btn.addEventListener('click', () => {
      const off = document.body.classList.toggle('sq-off');
      localStorage.setItem('sqGridOff', off ? '1' : '0');
      setLabel();
      if (!off) fill(); // resume loading when switching back to the grid
    });
    document.body.appendChild(btn);
  }

  /* ------------------------------ styles ----------------------------- */
  function injectCSS() {
    const css = `
#sqgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--sq-size, 230px), 1fr));
  gap: var(--sq-gap, 8px);
  padding: 12px;
  margin: 0 auto;
  box-sizing: border-box;
}
.sqcard {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 10px;
  overflow: hidden;
  background: #15171a;
  box-shadow: 0 1px 3px rgba(0,0,0,.28);
}
.sqcard-media {
  display: block;
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transition: transform .25s ease;
}
.sqcard:hover .sqcard-media { transform: scale(1.05); }
.sqcard--text .sqcard-media {
  background: linear-gradient(135deg, #2a2d3a, #181a22);
  display: flex; align-items: center; justify-content: center; padding: 14px;
}
.sqcard-textinner {
  color: #e7e7e7; font-size: 14px; line-height: 1.35; font-weight: 600;
  text-align: center;
  display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden;
}
.sqcard--nsfw .sqcard-media { filter: blur(22px); }
.sqcard--nsfw:hover .sqcard-media { filter: none; }

.sqcard-badges {
  position: absolute; top: 6px; left: 6px; z-index: 3;
  display: flex; gap: 4px; pointer-events: none;
}
.sqb {
  font-size: 11px; font-weight: 700; color: #fff; line-height: 1.3;
  background: rgba(0,0,0,.65); padding: 2px 6px; border-radius: 6px;
}
.sqb-n { background: rgba(255,30,90,.88); }

.sqcard-comments {
  position: absolute; top: 6px; right: 6px; z-index: 4;
  font-size: 11px; font-weight: 700; color: #fff; text-decoration: none;
  background: rgba(0,0,0,.6); padding: 3px 8px; border-radius: 999px;
  opacity: 0; transition: opacity .15s;
}
.sqcard:hover .sqcard-comments { opacity: 1; }
.sqcard-comments:hover { background: rgba(0,0,0,.85); }

.sqcard-overlay {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 3;
  padding: 20px 8px 8px;
  background: linear-gradient(to top, rgba(0,0,0,.92), rgba(0,0,0,.5) 60%, transparent);
  opacity: 0; transition: opacity .15s; pointer-events: none;
}
.sqcard:hover .sqcard-overlay { opacity: 1; pointer-events: auto; }
.sqcard-title {
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  color: #fff; text-decoration: none; font-size: 13px; line-height: 1.3; font-weight: 600;
}
.sqcard-title:hover { text-decoration: underline; }
.sqcard-meta { color: #cfcfcf; font-size: 11px; margin-top: 4px; }

body.sq-titles .sqcard-overlay { opacity: 1; pointer-events: auto; }
body.sq-titles .sqcard-comments { opacity: 1; }

#sqsentinel { height: 1px; width: 100%; }
#sqstatus {
  text-align: center; padding: 18px; color: #9aa0a6;
  font-size: 13px; font-weight: 600; letter-spacing: .02em;
}
#sqnav { text-align: center; padding: 16px; }
#sqnav .nextprev a { color: #4fbcff; }

#sqtoggle {
  position: fixed; top: 10px; right: 12px; z-index: 99999;
  background: #0079d3; color: #fff; border: none; border-radius: 999px;
  padding: 7px 14px; font-size: 12px; font-weight: 700; cursor: pointer;
  box-shadow: 0 2px 6px rgba(0,0,0,.3);
}
#sqtoggle:hover { background: #1484d6; }

body.sq-on #siteTable { display: none; }
body.sq-on.sq-off #siteTable { display: block; }
body.sq-on.sq-off #sqgrid,
body.sq-on.sq-off #sqnav,
body.sq-on.sq-off #sqstatus { display: none; }
`;
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ------------------------------ start ------------------------------ */
  function start() {
    if (!document.getElementById('siteTable')) return;
    injectCSS();
    if (!CONFIG.showTitleOnHover) document.body.classList.add('sq-titles');
    addToggle();
    ensureGrid();
    appendCards(thingsToCards([...document.querySelectorAll('#siteTable .thing.link')]));

    if (CONFIG.infiniteScroll) {
      setupInfinite();
    } else {
      syncNav();
      observe();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
