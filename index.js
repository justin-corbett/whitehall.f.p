// -----------------------------------------
// Whitehall F.P.
// -----------------------------------------

gsap.registerPlugin(CustomEase, ScrollTrigger);

history.scrollRestoration = "manual";

// Force scroll to top on load — guards against the browser restoring a
// remembered scroll position, and against Lenis's own internal position.
window.scrollTo(0, 0);
window.addEventListener('load', () => {
  window.scrollTo(0, 0);
  if (lenis && typeof lenis.scrollTo === "function") {
    lenis.scrollTo(0, { immediate: true, force: true });
  }
  // Extra refresh once every subresource (images, webfont) has actually
  // loaded. The reveal ScrollTriggers are created earlier, as soon as a
  // page's markup is in the DOM — before a late webfont swap or hero image
  // load can finish settling the layout — so an above-the-fold once:true
  // trigger measured against that not-yet-final layout could otherwise
  // never fire. 'load' only ever runs once per real page load, so this
  // doesn't affect normal Barba navigations.
  if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
});

let lenis = null;
let nextPage = document;
let onceFunctionsInitialized = false;
let navTimeline = null;
// True from the moment a Barba navigation starts (barba.hooks.before)
// until closeNavForTransition() actually runs (leave timeline's
// onComplete, screen covered). While true, a link's mouseleave is
// suppressed (see initNavLinkHoverEffects) so its hover color doesn't
// revert while the menu is still visually open — it stays frozen until
// closeNavForTransition resets everything at once, unseen.
let navigatingAway = false;
// Recomputes the nav's resting (non-hovered) colors from the current
// page; assigned inside initNavLinkHoverEffects, called again on every
// Barba navigation from barba.hooks.afterEnter.
let updateNavRestingColors = () => {};
// Instant (non-animated) version of closeNav(), assigned inside
// initFullScreenNavigation. forceResetNavLinks (the full visual close) is
// called from the leave timeline's onComplete, once the screen is
// actually covered — see closeNavForTransition's comment; barba.hooks.
// before calls only disableNavLinkPointerEvents immediately.
let forceResetNavLinks = () => {};
let disableNavLinkPointerEvents = () => {};

// The actual visual nav close for an in-flight navigation — called from
// the leave timeline's onComplete (screen fully covered) rather than
// synchronously from barba.hooks.before, so it never happens while the
// outgoing page is still visible underneath. Flips the status attribute
// so CSS treats it as closed, pauses/resets navTimeline, force-hides the
// tile, resets hover state, and does a belt-and-suspenders char reset.
function closeNavForTransition() {
  const navStatusEl = document.querySelector('[data-navigation-status]');
  if (navStatusEl) {
    navStatusEl.setAttribute('data-navigation-status', 'not-active');
  }
  if (navTimeline) {
    navTimeline.pause(0);
  }
  forceResetNavLinks();
  hardResetNavChars();
  navigatingAway = false;
}

// b131 — animated nav close for a navigation started from the open menu:
// assigned inside initFullScreenNavigation; resolves once the menu has
// finished closing (immediately if it's already closed).
let closeNavAnimated = () => Promise.resolve();
// True while a transition began with the menu open: the leave swaps the
// pages behind the open menu, then the enter closes the menu and fades the
// new page in. leaveDone flags the leave's prepare step as finished.
let navWasOpenForTransition = false;
// Logo state captured when a transition starts, so the transition only
// replays the intro if the logo wasn't already on screen.
let navLogoWasShown = true;
let navAutoHideSuppressed = false;
let navBarIsVisible = () => true;
let forceNavBarVisible = () => {};
let leaveDone = false;
let navClosed = Promise.resolve(); // resolves once the menu has finished closing
let hardNavigating = false; // a full page load has taken over from this transition
// b144 — nav class/colour sync held back until the open menu has closed.
let pendingNavUpdateData = null;

const hasLenis = typeof window.Lenis !== "undefined";
const hasScrollTrigger = typeof window.ScrollTrigger !== "undefined";

const rmMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = rmMQ.matches;
rmMQ.addEventListener?.("change", e => (reducedMotion = e.matches));
rmMQ.addListener?.(e => (reducedMotion = e.matches));

const has = (s) => !!nextPage.querySelector(s);

let staggerDefault = 0.05;
let durationDefault = 0.6;

// The site's one easing curve. Every tween uses it (named here so it is
// changed in one place); only scrubbed scroll tweens stay linear.
const WH_EASE = "Whitehall Custom Ease";
CustomEase.create(WH_EASE, "0.625, 0.05, 0, 1");
gsap.defaults({ ease: WH_EASE, duration: durationDefault });

// -----------------------------------------
// Build tag
// -----------------------------------------
const BUILD = 'b289';
console.log('[build]', BUILD);

// Belt-and-suspenders hard reset, called alongside forceResetNavLinks()
// in barba.hooks.before: explicitly re-asserts every nav-char back to
// hidden via gsap.set(), rather than relying on navTimeline.pause(0)'s
// own (lazy/cached) tween start-values. No-op when pause(0) already did
// its job correctly.
function hardResetNavChars() {
  const dbg = window.__navDebug;
  if (!dbg) return;
  const allChars = (dbg.navLinkSplits || []).flatMap(s => s.chars);
  if (allChars.length) gsap.set(allChars, { yPercent: 100 });
}

// -----------------------------------------
// BRAND COLORS
// -----------------------------------------

// Mirrors the color variables set up in the Webflow Designer (Variables
// panel) so JS and Designer can't drift apart silently. If a brand color
// changes there, update it here too.
const COLORS = {
  hallWhite: '#f6f7ef',    // Brand – Primary/hall-white
  kiwiSkin: '#6d4139',     // kiwi-skin
  kanukaPink: '#e2aebc',   // Brand – Secondary/kānuka-pink
  stone: '#d2cec1',        // Brand – Secondary/stone
  forest: '#002e20',       // Forest
  spring: '#d3fa9a',       // Spring
  leaf: '#2e6f40',         // Leaf
  deepLake: '#10293a'      // Deep Lake
};

// -----------------------------------------
// Console signature
// -----------------------------------------
function addConsoleBrand() {
  console.log(
    '\n %c ✦ Site by Daymark ✦ ',
    'background: #000; color: #fff; padding: 5px 0; margin-right: 5px;',
    'https://www.daymark.co.nz/ \n\n'
  );
}
addConsoleBrand();



// -----------------------------------------
// FUNCTION REGISTRY
// -----------------------------------------

// b121 — .field focus -> its sibling .field_label loses "large" (floats up);
// blur with an empty value -> gets it back. focusin/focusout bubble, so one
// listener on document covers every current and future .field.
//
// b122 — browser autofill fills the field WITHOUT firing focus, so the label
// stayed big and overlapped the filled text. Now the label state is derived
// from the field itself (has a value, or is :-webkit-autofill) via
// syncFieldLabel, run on input/change events and re-checked a few times
// shortly after each page enter (Chrome autofills a beat after load, and
// doesn't always expose .value until interaction — :-webkit-autofill does
// match though).
function syncFieldLabel(field) {
  const labels = Array.from(field.parentElement ? field.parentElement.children : [])
    .filter(el => el !== field && el.classList.contains('field_label'));
  let autofilled = false;
  try { autofilled = field.matches(':-webkit-autofill'); } catch (e) {}
  const filled = field.value.length > 0 || autofilled || document.activeElement === field;
  labels.forEach(label => label.classList.toggle('large', !filled));
}

function syncAllFormFieldLabels(scope) {
  (scope || document).querySelectorAll('.field').forEach(syncFieldLabel);
}

// Autofill lands at unpredictable times after load — re-check a few times.
function syncFormFieldLabelsSoon(scope) {
  syncAllFormFieldLabels(scope);
  [100, 400, 1000, 2000].forEach(ms => setTimeout(() => syncAllFormFieldLabels(scope), ms));
}

function initFormFieldLabels() {
  const fieldFrom = (e) => (e.target.closest ? e.target.closest('.field') : null);

  document.addEventListener('focusin', (e) => {
    const field = fieldFrom(e);
    if (field) syncFieldLabel(field);
  });
  document.addEventListener('focusout', (e) => {
    const field = fieldFrom(e);
    if (field) syncFieldLabel(field);
  });
  // Autofill / paste / programmatic fills dispatch input and/or change.
  document.addEventListener('input', (e) => {
    const field = fieldFrom(e);
    if (field) syncFieldLabel(field);
  });
  document.addEventListener('change', (e) => {
    const field = fieldFrom(e);
    if (field) syncFieldLabel(field);
  });
  // Chrome fires an animationstart-less autofill; this catches the case where
  // the first autofill is applied on the first user click anywhere.
  document.addEventListener('click', () => setTimeout(() => syncAllFormFieldLabels(), 50), { passive: true });

  syncFormFieldLabelsSoon();
}

// b123 — the visible "Send message" button is a styled <a class="btn"> sitting
// next to Webflow's real (hidden) submit input (.submit_button) inside
// .submit-button__wrap. Clicking the link triggers the real form submit via
// requestSubmit(submitter), which — unlike a bare .click() on a detached
// handler — runs native validation (required fields, email format, minlength)
// and fires the form's "submit" event, so Basin/Turnstile + Webflow's own
// handlers behave exactly as if the real button was pressed. Delegated on
// document (capture phase, bound once) so it survives Barba page swaps.
function initFormSubmitMirror() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.submit-button__wrap .btn');
    if (!btn) return;
    const wrap = btn.closest('.submit-button__wrap');
    const realSubmit = wrap && wrap.querySelector('.submit_button, input[type="submit"], button[type="submit"]');
    const form = (realSubmit && realSubmit.form) || btn.closest('form');
    if (!form) return;

    e.preventDefault(); // href="#" — don't jump / let Barba treat it as a nav

    if (typeof form.requestSubmit === 'function') {
      try {
        form.requestSubmit(realSubmit || undefined);
        return;
      } catch (err) { /* fall through */ }
    }
    if (realSubmit) realSubmit.click();
    else form.submit();
  }, true);
}

// b125 — mirror the real submit button's sending state onto the custom .btn.
// Webflow swaps the real button's value to its "Waiting text" (set per-button
// in the Designer) while the form posts, then restores it. We mirror that
// text onto the .btn, falling back to "Sending message…" if no waiting text
// is configured. .btn__middle's label is a roll-hover (char-split, fixed
// width) built by initButtonHoverFocus, so rather than rewriting that markup
// we hide it and show a plain status span while sending, then put it back.
// Done when Webflow shows its success/fail block, hides the form, or the
// button's value returns to its original.
const FORM_SENDING_FALLBACK = 'Sending message…';

function setBtnStatus(btn, text) {
  const middle = btn.querySelector('.btn__middle');
  if (!middle) return;
  let status = middle.querySelector('.btn__status');
  const rollWrap = Array.from(middle.children).find(el => !el.classList.contains('btn__status'));
  if (text) {
    if (!status) {
      status = document.createElement('span');
      status.className = 'btn__status';
      middle.appendChild(status);
    }
    status.textContent = text;
    if (rollWrap) rollWrap.style.display = 'none';
    btn.setAttribute('aria-busy', 'true');
    btn.style.pointerEvents = 'none'; // no double-submits while sending
  } else {
    if (status) status.remove();
    if (rollWrap) rollWrap.style.display = '';
    btn.removeAttribute('aria-busy');
    btn.style.pointerEvents = '';
  }
}

function watchFormSending(form) {
  const wrap = form.querySelector('.submit-button__wrap');
  const btn = wrap && wrap.querySelector('.btn');
  const real = wrap && wrap.querySelector('.submit_button, input[type="submit"], button[type="submit"]');
  if (!btn || !real || btn._sendingWatch) return;

  const origValue = real.value;
  const root = form.closest('.w-form') || form.parentElement;
  const started = performance.now();
  let valueChanged = false;

  const visible = (el) => !!(el && el.offsetParent !== null && getComputedStyle(el).display !== 'none');
  const finish = () => {
    clearInterval(btn._sendingWatch);
    btn._sendingWatch = null;
    setBtnStatus(btn, null);
  };

  btn._sendingWatch = setInterval(() => {
    const elapsed = performance.now() - started;
    if (real.value !== origValue) valueChanged = true;
    setBtnStatus(btn, real.value !== origValue ? real.value : FORM_SENDING_FALLBACK);

    const done = root && (visible(root.querySelector('.w-form-done')) || visible(root.querySelector('.w-form-fail')));
    const formHidden = !visible(form);
    const valueRestored = valueChanged && real.value === origValue;
    if (done || formHidden || valueRestored || elapsed > 20000) finish();
  }, 100);
  // Show it immediately rather than waiting for the first tick.
  setBtnStatus(btn, FORM_SENDING_FALLBACK);
}

function initFormSendingState() {
  // Capture phase: runs before Webflow's own submit handler. 'submit' only
  // fires once native validation has passed, so invalid attempts never flip
  // the button into its sending state.
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form && form.querySelector && form.querySelector('.submit-button__wrap .btn')) {
      watchFormSending(form);
    }
  }, true);
}

// b127 — preload the Home hero video when the visit starts on a page that
// isn't Home. The persistent bunny player only exists in Home's HTML, so a
// visit starting elsewhere had nothing to hand over: going Home meant
// initialising the player and fetching the video from scratch. Instead, once
// the landing page has fully loaded and the browser is idle (plus a short
// extra delay, and a low fetch priority), fetch Home's HTML, lift out its
// persistent player(s), initialise them inside the park host, and register
// them in parkedBunnyPlayers — exactly where a Home -> elsewhere visit would
// have left them. The existing reclaim path (reparentBunnyPlayers /
// reclaimParkedBunnyPlayer) then drops the already-buffering video into the
// hero slot when the user navigates Home. Everything is skipped on Home
// itself, on Save-Data / 2g connections, and if no HLS playback is possible.
let homeHeroPreloadStarted = false;

function preloadHomeHeroVideo() {
  if (homeHeroPreloadStarted) return;
  // On Home (or any page that already has a persistent player) — nothing to do.
  if (document.querySelector('[data-bunny-persist="true"]') || parkedBunnyPlayers.size) return;
  const conn = navigator.connection;
  if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) return;
  const probe = document.createElement('video');
  const canHls = !!(window.Hls && window.Hls.isSupported && window.Hls.isSupported()) ||
    !!probe.canPlayType('application/vnd.apple.mpegurl');
  if (!canHls) return;
  homeHeroPreloadStarted = true;

  fetch('/', { credentials: 'same-origin', priority: 'low' })
    .then(r => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
    .then(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('[data-bunny-persist="true"][data-bunny-background-init][data-bunny-id]').forEach(src => {
        const id = src.getAttribute('data-bunny-id');
        // The user may have reached Home (or something else holding this id)
        // while the fetch was in flight — then Home inits its own, leave it.
        if (document.querySelector('[data-bunny-id="' + id + '"]') || parkedBunnyPlayers.has(id)) return;

        const player = document.importNode(src, true);
        // Lazy mode would wait for the player to scroll into view; here we
        // want it to start buffering now.
        player.setAttribute('data-player-lazy', 'false');
        player.setAttribute('data-bunny-preload', '');
        // Own wrapper, so initBunnyPlayerBackground's scope never touches
        // other players already sitting in the park host.
        const holder = document.createElement('div');
        holder.appendChild(player);
        getBunnyParkHost().appendChild(holder);

        initBunnyPlayerBackground(holder);
        // Buffer only — don't play (or keep decoding) while it's parked
        // behind another page. Disconnecting before the observer's first
        // callback fires stops its autoplay; reclaim restarts playback.
        if (player._io) { try { player._io.disconnect(); } catch (_) {} player._io = null; }
        const video = player.querySelector('video');
        try { if (video) video.pause(); } catch (_) {}

        parkedBunnyPlayers.set(id, player);
      });
    })
    .catch(err => {
      homeHeroPreloadStarted = false;
    });
}

// Secondary to the landing page: wait for full load, then idle, then a beat.
function schedulePreloadHomeHeroVideo() {
  const start = () => {
    const run = () => setTimeout(preloadHomeHeroVideo, 1500);
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
    else run();
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

function initOnceFunctions() {
  initLenis();
  if (onceFunctionsInitialized) return;
  onceFunctionsInitialized = true;

  // b121 — floating form labels (CTA form). Delegated on document, bound
  // once, so it keeps working on every Barba-swapped container with no
  // per-page re-init (the old jQuery $(".field").on(...) only bound to
  // fields present at first load, so it died after a page change).
  initFormFieldLabels();
  initEmailCopy();
  initFooterLogoScroll();
  initPagePrefetch();
  initFormSubmitMirror();
  initFormSendingState();

  // Nav and grid overlay live outside the Barba container, so check
  // document directly and only set them up once.
  if (document.querySelector('[data-navigation-toggle="toggle"]')) {
    initFullScreenNavigation();
  }

  initMenuButtonHover();
  initUnderlineLinks(document);

  if (document.querySelector('[data-animated-grid]')) {
    initAnimatedGrid();
  }

  if (document.querySelector('.nav__bar')) {
    initNavAutoHide();
  }
}

// b137 — menu button label rolls up on hover, same mechanic as the .btn text
// (see buildRollPairs / initButtonHoverFocus): the label slides up out of a
// clipped wrapper while an identical clone rises into place from below.
// The label itself is left untouched (Home's intro SplitText and the nav
// timeline's autoAlpha both act on it), so the clone is a sibling: it's
// aria-hidden, takes the label's classes (same type), and mirrors its live
// colour while a roll is active so colour-zone tints still apply.
function initMenuButtonHover() {
  const navEl = document.querySelector('[data-navigation-status]');
  const button = document.querySelector('.nav__button');
  const label = button ? button.querySelector('.nav__button-label') : null;
  if (!navEl || !button || !label || !label.parentNode || label._rollBound) return;
  label._rollBound = true;

  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-block;overflow:hidden;position:relative;vertical-align:top;';
  label.parentNode.insertBefore(wrap, label);
  wrap.appendChild(label);

  const clone = document.createElement('span');
  clone.className = label.className;
  clone.setAttribute('aria-hidden', 'true');
  // b151 — hover swaps "Menu" for "Open" (clone carries the hover word).
  clone.textContent = 'Open';
  clone.style.cssText += ';position:absolute;top:0;left:0;width:auto;white-space:nowrap;pointer-events:none;transition:none;';
  wrap.appendChild(clone);
  gsap.set(clone, { yPercent: 100, autoAlpha: 1 });

  // Size the clipped wrapper to the wider word so neither is cut off.
  const fitWrap = () => {
    wrap.style.minWidth = '';
    const w = Math.max(label.getBoundingClientRect().width, clone.getBoundingClientRect().width);
    if (w) wrap.style.minWidth = Math.ceil(w) + 'px';
  };
  fitWrap();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitWrap);

  const syncColor = () => { clone.style.color = getComputedStyle(label).color; };
  let syncing = false;
  const startSync = () => { if (!syncing) { syncing = true; gsap.ticker.add(syncColor); } };
  const stopSync = () => { if (syncing) { syncing = false; gsap.ticker.remove(syncColor); } };
  syncColor();

  // b138 — overwrite:'auto' (not true) and a property-scoped kill below:
  // overwrite:true / killTweensOf(label) also destroyed navTimeline's own
  // autoAlpha tween on the label, so the menu text stopped fading out when
  // the menu opened.
  const ROLL = { duration: 0.65, ease: WH_EASE, overwrite: 'auto' };
  const isOpen = () => navEl.getAttribute('data-navigation-status') === 'active';

  const rollIn = () => {
    if (isOpen()) return;
    startSync();
    gsap.to(label, { yPercent: -100, ...ROLL });
    gsap.to(clone, { yPercent: 0, ...ROLL });
  };
  const rollOut = (instant) => {
    if (!instant && isOpen()) return; // b152 — keep "Open" in place while the menu is open
    if (instant) {
      gsap.killTweensOf([label, clone], 'yPercent');
      gsap.set(label, { yPercent: 0 });
      gsap.set(clone, { yPercent: 100 });
      stopSync();
      return;
    }
    gsap.to(label, { yPercent: 0, ...ROLL });
    gsap.to(clone, { yPercent: 100, ...ROLL, onComplete: stopSync });
  };

  button.addEventListener('mouseenter', rollIn);
  button.addEventListener('mouseleave', () => rollOut(false));
  button.addEventListener('focus', rollIn);
  button.addEventListener('blur', () => rollOut(false));
  // b152 — on open, keep "Open" showing and fade it out with the label (no
  // flash back to "Menu"); once the menu starts closing, reset the roll
  // instantly while the label is still transparent.
  let wasOpen = isOpen();
  new MutationObserver(() => {
    const open = isOpen();
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      startSync();
      gsap.to(clone, { autoAlpha: 0, duration: 0.3, ease: WH_EASE, overwrite: 'auto' });
    } else {
      gsap.killTweensOf(clone);
      gsap.set(clone, { yPercent: 100, autoAlpha: 1 });
      gsap.killTweensOf(label, 'yPercent');
      gsap.set(label, { yPercent: 0 });
      stopSync();
    }
  }).observe(navEl, { attributes: true, attributeFilter: ['data-navigation-status'] });
}

// Page prefetch. Barba fetches the destination HTML on click and starts the
// transition only once it arrives, so a slow or cold response reads as a
// dead click. Warming Barba's cache ahead of the click removes that wait:
// every internal link is fetched quietly after load, and anything missed is
// fetched on hover / touch / focus.
function initPagePrefetch() {
  const warmed = new Set();
  const isWarmable = link => {
    if (!link || !link.href || link.target === '_blank' || link.hasAttribute('download')) return false;
    if (link.hasAttribute('data-barba-prevent') || link.closest('[data-barba-prevent]')) return false;
    if (!/^https?:$/.test(link.protocol) || link.origin !== window.location.origin) return false;
    return link.pathname !== window.location.pathname;
  };
  const warm = link => {
    if (!isWarmable(link)) return;
    const href = link.href.split('#')[0];
    if (warmed.has(href) || barba.cache.has(href)) return;
    warmed.add(href);
    const request = barba.request(href, barba.timeout, barba.onRequestError.bind(barba, 'barba'), barba.cache, barba.headers);
    barba.cache.set(href, request, 'barba', 200);
    request.catch(() => { barba.cache.delete(href); warmed.delete(href); });
  };

  const intent = e => warm(e.target.closest && e.target.closest('a[href]'));
  ['pointerenter', 'touchstart', 'focusin'].forEach(type => document.addEventListener(type, intent, { capture: true, passive: true }));
  document.addEventListener('mouseover', intent, { passive: true });

  const connection = navigator.connection || {};
  if (connection.saveData) return;
  const warmAll = () => {
    const queue = [...document.querySelectorAll('a[href]')].filter(isWarmable);
    const next = () => {
      const link = queue.shift();
      if (!link) return;
      warm(link);
      setTimeout(next, 150);
    };
    next();
  };
  const start = () => ('requestIdleCallback' in window ? requestIdleCallback(warmAll, { timeout: 3000 }) : setTimeout(warmAll, 1500));
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', () => setTimeout(start, 500), { once: true });
}

// Footer logo: on the homepage it scrolls smoothly to the top instead of
// reloading the page; everywhere else it is a normal link home. Capture
// phase so Barba never sees the same-page click.
function initFooterLogoScroll() {
  document.addEventListener('click', e => {
    const link = e.target.closest && e.target.closest('.footer__logo');
    if (!link || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    if (link.pathname.replace(/\/$/, '') !== window.location.pathname.replace(/\/$/, '')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (lenis) lenis.scrollTo(0, { duration: 2, easing: gsap.parseEase(WH_EASE) });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, true);
}

// b162 — links tagged [data-copy-email] copy their address to the clipboard instead of
// opening a mail client, and its text reads "Copied to clipboard" for 3s.
// Delegated on document (bound once) so it survives Barba swaps. Text is
// swapped at the text-node level so any SplitText line wrappers stay intact.
function initEmailCopy() {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MESSAGE = 'Copied to clipboard';
  const HOLD_MS = 3000;

  const getEmail = (a) => {
    const href = a.getAttribute('href') || '';
    if (/^mailto:/i.test(href)) return decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]).trim();
    const t = (a.textContent || '').trim();
    return EMAIL_RE.test(t) ? t : null;
  };

  const copyText = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  };

  document.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('[data-copy-email]');
    if (!a) return;
    const email = getEmail(a);
    if (!email) return;
    e.preventDefault();
    e.stopPropagation();
    if (a._copyTimer) return; // already showing the message

    const ok = await copyText(email);
    if (!ok) { window.location.href = 'mailto:' + email; return; }

    const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) { if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode); }
    if (!nodes.length) return;
    const originals = nodes.map(n => n.nodeValue);
    // data-copy-email="lowercase" shows the message in lowercase, whatever the link's own text-transform
    const lowercase = a.getAttribute('data-copy-email') === 'lowercase';
    nodes[0].nodeValue = lowercase ? MESSAGE.toLowerCase() : MESSAGE;
    for (let i = 1; i < nodes.length; i++) nodes[i].nodeValue = '';
    if (lowercase) a.style.textTransform = 'none';
    a._copyTimer = setTimeout(() => {
      nodes.forEach((n, i) => { n.nodeValue = originals[i]; });
      if (lowercase) a.style.textTransform = '';
      a._copyTimer = null;
    }, HOLD_MS);
  }, true);
}

function initBeforeEnterFunctions(next) {
  nextPage = next || document;

  // With the maps module already loaded (visited Contact earlier), start the
  // incoming page's map by hand — Webflow only does it on a full page load.
  if (next && next.querySelector('.w-widget-map')) Webflow.require('maps')?.ready();

  // Runs before the enter animation
  // if (has('[data-something]')) initSomething();
}

// .nav__logo / .nav__button-label live in the persistent Global component
// (outside the Barba container), so they're the same DOM nodes across
// every page. initColorZones() tweens their `color` inline while
// scrolling a page's own colored sections, but only runs on pages that
// have [data-color-zone] sections — so navigating to a page without any
// left the previous page's inline color stuck on the nav. Called from the
// leave timeline's onComplete (screen still covered) rather than
// barba.hooks.afterEnter (page already visible), so the nav is already
// correct before the incoming page is shown — no color flash.
// b141 — [data-color-zone-target] can be the Barba container element ITSELF
// (Our Approach: <main data-barba="container" data-color-zone-target>).
// querySelector only searches descendants, so it never found it and the nav
// colour override was silently never applied (it only ever looked right by
// accident, via a tint carried over from the previous page).
function findColorZoneTarget(scope) {
  if (!scope) return null;
  if (scope.matches && scope.matches('[data-color-zone-target]')) return scope;
  return scope.querySelector('[data-color-zone-target]');
}

function applyNavDefaultColor(scope) {
  const target = findColorZoneTarget(scope);
  const key = target ? target.getAttribute('data-nav-default-color') : null;
  const color = key ? COLORS[key] : null;
  if (!color) return;
  const navTargets = [document.querySelector('.nav__logo'), document.querySelector('.nav__button-label')].filter(Boolean);
  if (navTargets.length) gsap.set(navTargets, { color });
}

function resetPersistentNavColor(next) {
  const navLogoEl = document.querySelector('.nav__logo');
  const menuLabelEl = document.querySelector('.nav__button-label');
  const navTargets = [navLogoEl, menuLabelEl].filter(Boolean);
  if (!navTargets.length) return;

  // b140 — kill the OUTGOING page's colour-zone triggers and any in-flight
  // colour tween on the nav BEFORE clearing. gsap.set(clearProps) doesn't stop
  // a running tween, and the old page's zone triggers (revertToDefault /
  // setZone) can still fire as scroll resets to 0 — either re-applied the
  // old page's tint (light green) right after it was cleared, so Home came
  // back with the wrong nav colour.
  colorZoneSTs.forEach(st => st.kill());
  colorZoneSTs = [];
  gsap.killTweensOf(navTargets, 'color');

  gsap.set(navTargets, { clearProps: 'color' });

  // If the incoming page defines its own resting override (see
  // initColorZones' own data-nav-default-color handling), apply it now
  // too, from the incoming container directly (already in the DOM by
  // this point, just not yet visible) rather than waiting for
  // initColorZones to run later in afterEnter.
  const target = findColorZoneTarget(next);
  const overrideKey = target ? target.getAttribute('data-nav-default-color') : null;
  const override = overrideKey ? COLORS[overrideKey] : null;
  if (override) {
    gsap.set(navTargets, { color: override });
  }
}

// -----------------------------------------
// WEBFLOW SPA FORMS + TURNSTILE RESET
// -----------------------------------------
// b124 — Webflow's form JS and Cloudflare Turnstile only initialise on a full
// page load. After a Barba swap the new page's submit button stays locked
// (w-form-loading / disabled), no AJAX handler is bound (submit falls through
// to a native GET), and the Turnstile token is stale/missing. Re-initialise
// Webflow's forms and re-render Turnstile after every transition (Ross
// Anderson's fix). Needs Turnstile enabled in Site Settings -> Apps &
// Integrations -> Form integrations, plus a hidden Webflow form in the global
// structure so the Turnstile runtime loads on pages with no form of their own.
let webflowFormsFirstLoad = true;

function initWebflowForms() {
  // First load is a real page load — Webflow already initialised everything.
  if (webflowFormsFirstLoad) {
    webflowFormsFirstLoad = false;
    return;
  }
  requestAnimationFrame(() => {
    resetWebflowForms();
    resetTurnstile();
  });
}

// Webflow.destroy()/ready() below rebuilds every Lottie on the page, including
// the nav logo, which blanks out and restarts. Hold a static copy of the logo
// over it while that happens, then put the rebuilt Lottie on its last frame.
function holdNavLogo() {
  const logo = document.querySelector('.nav__logo');
  const wrap = logo && logo.querySelector('.logo__main__lottie');
  const svg = wrap && wrap.querySelector('svg');
  if (!svg) return () => {};
  const prevPosition = logo.style.position;
  if (getComputedStyle(logo).position === 'static') logo.style.position = 'relative';
  const box = wrap.getBoundingClientRect();
  const base = logo.getBoundingClientRect();
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;pointer-events:none;top:' + (box.top - base.top) + 'px;left:' + (box.left - base.left) + 'px;width:' + box.width + 'px;height:' + box.height + 'px;';
  const copy = svg.cloneNode(true);
  // The site CSS tints the Lottie through `.logo__main__lottie svg path`; the
  // copy sits outside that selector, so apply the same fill directly.
  copy.querySelectorAll('path').forEach(p => p.style.setProperty('fill', 'currentColor', 'important'));
  holder.appendChild(copy);
  logo.appendChild(holder);
  return () => {
    holder.remove();
    logo.style.position = prevPosition;
  };
}

function settleNavLogo(release) {
  const started = performance.now();
  const check = () => {
    const anim = getNavLogoLottie();
    if (anim) {
      const finish = () => {
        anim.loop = false;
        // A replay that was mid-flight when the rebuild hit carries on from
        // where it had got to; otherwise rest on the last frame.
        const elapsed = performance.now() - navLogoPlayStart;
        const total = anim.getDuration() * 1000;
        if (navLogoPlayStart && elapsed < total) {
          console.log('[logo] resume after rebuild', { elapsed: Math.round(elapsed), total: Math.round(total) });
          anim.setDirection(1);
          anim.goToAndPlay(elapsed, false);
        } else {
          console.log('[logo] rest on last frame after rebuild', { elapsed: Math.round(elapsed), total: Math.round(total) });
          anim.goToAndStop(anim.totalFrames - 1, true);
        }
        requestAnimationFrame(release);
      };
      if (anim.isLoaded) finish();
      else anim.addEventListener('DOMLoaded', finish);
    } else if (performance.now() - started < 3000) {
      requestAnimationFrame(check);
    } else {
      console.log('[logo] rebuilt Lottie not found after 3s');
      release();
    }
  };
  requestAnimationFrame(check);
}

function resetWebflowForms() {
  const w = window.Webflow;
  if (!w) return;
  console.log('[logo] webflow reset: hold logo', { shown: navLogoWasShown, sinceLastPlayMs: Math.round(performance.now() - navLogoPlayStart) });
  const releaseLogo = holdNavLogo();
  w.destroy();
  w.ready();
  settleNavLogo(releaseLogo);
  if (w.require) {
    const forms = w.require("forms");
    if (forms && forms.preview) forms.preview();
  }
  document.querySelectorAll(".w-form").forEach((wrapper) => {
    wrapper.classList.remove("w-form-loading");
    wrapper.querySelectorAll('[type="submit"]').forEach((btn) => {
      btn.classList.remove("w-form-loading");
      btn.removeAttribute("disabled");
    });
  });
}

function resetTurnstile() {
  if (!window.turnstile) return;
  document.querySelectorAll(".w-form form").forEach((form) => {
    const sitekey = form.getAttribute("data-turnstile-sitekey");
    if (!sitekey) return;
    form.querySelectorAll('[id^="cf-chl-widget"]').forEach((el) => el.remove());
    form.querySelectorAll(".cf-turnstile").forEach((el) => el.remove());
    const container = document.createElement("div");
    form.appendChild(container);
    window.turnstile.render(container, { sitekey });
  });
}

function initAfterEnterFunctions(next) {
  nextPage = next || document;

  initWebflowForms(); // b124 — see WEBFLOW SPA FORMS + TURNSTILE RESET above

  // Runs after enter animation completes.
  //
  // [data-line-reveal] and .text-display-large/medium are handled earlier
  // and intentionally left out here — prepared from the leave timeline's
  // onComplete, activated at the enter timeline's "startEnter" label. See
  // prepareLineReveal/activateLineReveal and prepareDisplayLargeReveal/
  // activateDisplayLargeReveal. prepareOnceAnimation and playOnceAnimation run both halves
  // together for the true first load, which has no covered window to
  // prepare behind.
  if (has('[data-bunny-background-init]')) initBunnyPlayerBackground(nextPage);
  if (has('[data-parallax="trigger"]')) initGlobalParallax(nextPage);
  if (has('.section__about')) initHeroAboutParallax(nextPage);
  if (has('.btn')) initButtonHoverFocus(nextPage);
  initUnderlineLinks(nextPage);
  // b122 — new page's fields may be autofilled; re-sync their labels.
  if (has('.field')) syncFormFieldLabelsSoon(nextPage);
  // b133 — apply a page's data-nav-default-color even when the page has no
  // [data-color-zone] sections. initColorZones (below) is the only other
  // place that applied it, and it's skipped on zone-less pages like Our
  // Approach — so on a hard refresh the logo/menu label stayed the CSS
  // default (white); only a Barba navigation (resetPersistentNavColor) got it.
  applyNavDefaultColor(nextPage);
  if (has('[data-color-zone]')) initColorZones(nextPage);
  // See PARALLAX IMAGE SLIDER (Smooothy) section for why this needs its
  // own destroy-then-rebuild, not just a plain init.
  if (has('[data-parallax-init]')) initParallaxImageSlider(nextPage);


  if(hasLenis){
    lenis.resize();
  }

  if (hasScrollTrigger) {
    ScrollTrigger.refresh();
  }
}



// -----------------------------------------
// PAGE TRANSITIONS
// -----------------------------------------

// True first load has no covered-transition window to prepare behind, so the
// two halves of a transition's reveal run back to back: prepare (hide)
// straight away, behind the preloader if there is one, then play once it has
// gone, so nothing shows before it animates in.
function prepareOnceAnimation(next) {
  resetPage(next);

  const loadReveal = prepareLoadReveal(next);
  // prepareDisplayLargeReveal must run before prepareLineReveal: it
  // populates heroTitleGroups (see that map's own comment), which
  // prepareLineReveal reads to tag the hero's own intro paragraph so
  // activateDisplayLargeReveal fires it together with the title instead
  // of activateLineReveal giving it its own trigger.
  const displayLarge = prepareDisplayLargeReveal(next);
  const lines = prepareLineReveal(next);

  return {
    loadReveal,
    displayLarge,
    lines,
    stickers: prepareStickerReveal(next),
    images: prepareImageReveal(next),
    entryImages: prepareEntryImages(next),
    rules: prepareRuleReveal(next)
  };
}

function playOnceAnimation({ loadReveal, displayLarge, lines, stickers, images, entryImages, rules }) {
  playLoadReveal(loadReveal);
  openEntryWindow(displayLarge);
  revealEntryImages(entryImages, entryHeadingLines);
  activateLineReveal(lines);
  activateDisplayLargeReveal(displayLarge, lines);
  activateStickerReveal(stickers);
  activateImageReveal(images);
  activateRuleReveal(rules);
  // An above-the-fold ScrollTrigger (the hero title, since "top 90%" is
  // already past at scroll 0) can be created with a stale start position
  // and never fire its once:true onEnter — refreshing right after
  // creation corrects it. Below-the-fold reveals aren't affected; they
  // fire normally as the user scrolls to them.
  if (hasScrollTrigger) ScrollTrigger.refresh();
}

// -----------------------------------------
// PRELOADER
// -----------------------------------------

// First visit only. Plays the Webflow Lottie for four seconds, then wipes the panel away bottom-up, the same way the
// menu panel closes, while the Lottie drifts up and fades out with it. If the page has a
// hero video it is already loading behind the panel, and the panel waits (up
// to a limit) until it is playing. Resolves as the wipe nears its end so the
// page intro can start with it. The markup is the Loader component;
// html.preloader-skip (site head) hides it on repeat visits.
const PRELOADER_KEY = 'wh-preloader-seen'; // timestamp of the last play; the head snippet reads it too
const PRELOADER_EXPIRY = 24 * 60 * 60 * 1000; // plays again once a day
const PRELOADER_FORCE = new URLSearchParams(location.search).has('preloader'); // ?preloader to test
const PRELOADER_HOLD = 2.75; // seconds the Lottie plays before the wipe
const PRELOADER_VIDEO_MAX = 3; // longest the wipe waits for the hero video
const PRELOADER_FADE = 0.3;
const PRELOADER_FADE_AT = 2.6; // seconds in when the Lottie starts fading, ahead of the wipe
const PRELOADER_LIFT = -200; // yPercent the Lottie is pulled up by the wipe
const PRELOADER_WIPE = { duration: 0.9, ease: WH_EASE };
const PRELOADER_INTRO_AT = 0.5; // seconds into the wipe when the page intro starts (the ease is visually done by then)

function getPreloaderLottie(preloader) {
  const lottie = Webflow.require('lottie')?.lottie;
  const animations = lottie ? lottie.getRegisteredAnimations() : [];
  return animations.find(anim => preloader.contains(anim.wrapper));
}

function waitSeconds(seconds) {
  return new Promise(resolve => gsap.delayedCall(seconds, resolve));
}

function waitForHeroVideo(container) {
  const player = container.querySelector('[data-bunny-background-init]');
  if (!player || player.dataset.playerStatus === 'playing') return Promise.resolve();

  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      if (player.dataset.playerStatus !== 'playing') return;
      observer.disconnect();
      resolve();
    });
    observer.observe(player, { attributes: true, attributeFilter: ['data-player-status'] });
    waitSeconds(PRELOADER_VIDEO_MAX).then(() => {
      observer.disconnect();
      resolve();
    });
  });
}

async function runPreloader(container) {
  const preloader = document.querySelector('[data-preloader]');
  if (!preloader) return;

  const lastSeen = Number(localStorage.getItem(PRELOADER_KEY));
  if (Date.now() - lastSeen < PRELOADER_EXPIRY && !PRELOADER_FORCE) {
    preloader.remove();
    return;
  }
  localStorage.setItem(PRELOADER_KEY, Date.now());

  await new Promise(resolve => Webflow.push(resolve));
  getPreloaderLottie(preloader)?.goToAndPlay(0, true);
  const lottieEl = preloader.querySelector('[data-preloader-lottie]');
  gsap.delayedCall(PRELOADER_FADE_AT, () => {
    gsap.to(lottieEl, { autoAlpha: 0, duration: PRELOADER_FADE, ease: WH_EASE });
  });
  await Promise.all([waitSeconds(PRELOADER_HOLD), waitForHeroVideo(container)]);

  await new Promise(resolve => {
    const tl = gsap.timeline({ onComplete: () => preloader.remove() });
    tl.to(lottieEl, { yPercent: PRELOADER_LIFT, ...PRELOADER_WIPE }, 0);
    tl.to(preloader, { clipPath: 'inset(0% 0% 100% 0%)', ...PRELOADER_WIPE }, 0);
    tl.call(resolve, null, PRELOADER_INTRO_AT);
  });
}

// Holds prepared (SplitText + hidden) state for the incoming page's
// scroll reveals between the leave timeline's onComplete (where it's
// prepared, screen still covered) and the enter timeline's "startEnter"
// label (where it's actually played/activated) — see prepareLoadReveal/
// playLoadReveal and prepareLineReveal/activateLineReveal and
// prepareDisplayLargeReveal/activateDisplayLargeReveal.
let pendingLoadReveal = null;
let pendingLineReveals = null;
let pendingDisplayLargeReveals = null;
// See prepareStickerReveal/activateStickerReveal.
let pendingStickerReveals = null;
// b117 — see prepareImageReveal/activateImageReveal.
let pendingImageReveals = null;
let pendingEntryImages = null;
// b143 — see prepareRuleReveal/activateRuleReveal.
let pendingRuleReveals = null;

// The hero's own intro paragraph is synced to fire in the exact same
// onEnter callback as its title's reveal (see activateDisplayLargeReveal),
// rather than getting its own independent ScrollTrigger — two separately
// created triggers aren't guaranteed to fire on the same tick, and this
// way the paragraph's duration can also be derived from the title tween's
// real GSAP-reported duration instead of a hand-recomputed formula.
//
// Populated by prepareDisplayLargeReveal (always called before
// prepareLineReveal — see the call sites in prepareOnceAnimation and
// runPageLeaveAnimation's onComplete): each hero section's title group,
// keyed by the .section__hero__content element it belongs to, plus that
// group's introWrap (the true intro block — see prepareDisplayLargeReveal's
// own comment for why that scoping matters). prepareLineReveal reads this
// to decide whether a given [data-line-reveal] element is the hero's own
// intro paragraph and should be tagged for activateDisplayLargeReveal to
// fire, instead of getting its own trigger from activateLineReveal.
let heroTitleGroups = new Map();

// b129 — simple fade transition (see runPageLeaveAnimation).
const TRANSITION_FADE_OUT = 0.5;
const TRANSITION_FADE_IN = 0.6;
const NAV_LOGO_OUT = 0.2; // logo fade-out before its Lottie replays on a page transition
const TRANSITION_BG_DURATION = 0.9;
let pageBaseBg = null;
let transitionNextBg = null;

// A container's own background colour, or the body's default when the
// container is transparent.
function getContainerBg(el) {
  const c = getComputedStyle(el).backgroundColor;
  if (!c || c === 'transparent' || /,\s*0\)$/.test(c)) return pageBaseBg;
  return c;
}

function runPageLeaveAnimation(current, next) {
  // navWasOpenForTransition is decided in barba.hooks.before (b144), which
  // always runs first, so every hook agrees on it.
  leaveDone = false;

  const tl = gsap.timeline({
    onComplete: () => {
      // Screen is fully covered by the transition panel at this point —
      // safe to hand off/park any persistent bunny players without the
      // user seeing them move.
      reparentBunnyPlayers(current, next);
      // Nav is only actually closed here, now that the panel has covered
      // the screen (see barba.hooks.before's comment for why). If the user
      // navigated via a link/CTA that isn't the nav menu, the menu was
      // never open and this is a harmless no-op.
      // b131 — with the menu open, closing + nav colour reset are deferred to
      // the enter (animated close); see runPageEnterAnimation.
      if (!navWasOpenForTransition) {
        closeNavForTransition();
        resetPersistentNavColor(next);
      }
      // Tear down the outgoing page's Smooothy instance(s) (ticker
      // callback + its own drag/resize listeners) before `current.remove()`
      // below detaches its DOM — see destroyParallaxImageSliders' comment.
      try {
        destroyParallaxImageSliders();
      } catch (err) {
      }
      // Prepared here (hidden state only) while still covered; actually
      // played/activated later from runPageEnterAnimation's "startEnter"
      // label. Each guarded independently — one throwing (e.g. a stale
      // SplitText on a persistent nav element) must not skip the others,
      // or everything after it silently never gets its hidden/prepared
      // state and stays invisible for good.
      try {
        pendingLoadReveal = prepareLoadReveal(next, { chrome: false });
      } catch (err) {
        pendingLoadReveal = null;
      }
      // prepareDisplayLargeReveal must run before prepareLineReveal: it
      // populates heroTitleGroups, which prepareLineReveal reads to tag
      // the hero's own intro paragraph for activateDisplayLargeReveal to
      // fire directly.
      try {
        pendingDisplayLargeReveals = prepareDisplayLargeReveal(next);
      } catch (err) {
        pendingDisplayLargeReveals = null;
        heroTitleGroups = new Map();
      }
      try {
        pendingLineReveals = prepareLineReveal(next);
      } catch (err) {
        pendingLineReveals = null;
      }
      // Same prepare/activate split as the other reveals: hidden state set
      // up now while still covered, ScrollTriggers created later from
      // "pageReady" so a sticker above the fold pops in right as it
      // appears rather than sitting fully visible for a beat first.
      try {
        pendingStickerReveals = prepareStickerReveal(next);
      } catch (err) {
        pendingStickerReveals = null;
      }
      // b117 — see prepareImageReveal/activateImageReveal.
      try {
        pendingImageReveals = prepareImageReveal(next);
      } catch (err) {
        pendingImageReveals = null;
      }
      pendingEntryImages = prepareEntryImages(next);
      // b143 — horizontal rules draw in from 0 width.
      try {
        pendingRuleReveals = prepareRuleReveal(next);
      } catch (err) {
        pendingRuleReveals = null;
      }
      current.remove();
      leaveDone = true;
    }
  });

  if (reducedMotion) {
    // Immediate swap behavior if user prefers reduced motion
    return tl.set(current, { autoAlpha: 0 });
  }

  // b129 — page transition simplified: no shutter panel/logo. The outgoing
  // page's content just fades out, then the incoming page fades in. If the
  // two pages have different background colours (the colour lives on the
  // [data-barba="container"] itself, e.g. Our Approach's green), the body
  // behind them tweens from the old colour to the new one so the colour
  // change animates instead of snapping.
  if (pageBaseBg === null) pageBaseBg = getComputedStyle(document.body).backgroundColor;
  const fromBg = getContainerBg(current);
  const toBg = getContainerBg(next);
  // Move each container's own bg onto the body for the duration, so fading
  // a container's content doesn't also fade its colour to the body's default.
  gsap.set(document.body, { backgroundColor: fromBg });
  gsap.set(current, { backgroundColor: 'transparent' });
  gsap.set(next, { backgroundColor: 'transparent' });
  if (navWasOpenForTransition) {
    // Menu is covering the page — swap colour/content instantly behind it.
    gsap.set(document.body, { backgroundColor: toBg });
  } else {
    gsap.to(document.body, { backgroundColor: toBg, duration: TRANSITION_BG_DURATION, ease: WH_EASE, overwrite: 'auto' });
  }
  transitionNextBg = toBg;

  tl.set(next, {
    autoAlpha: 0
  }, 0);

  if (navWasOpenForTransition) {
    tl.set(current, { opacity: 0 }, 0);
  } else {
    tl.to(current, {
      opacity: 0,
      duration: TRANSITION_FADE_OUT,
      ease: WH_EASE
    }, 0);
  }
}

async function runPageEnterAnimation(next){

  // The page is about to be reloaded in full — leave the screen as it is.
  if (hardNavigating) return new Promise(() => {});

  // b131 — menu was open: wait for the leave's swap, then animate the menu
  // closed (page behind it is already the new one, still hidden), and only
  // then fade the new page in and run its reveals.
  if (navWasOpenForTransition) {
    await new Promise(r => { const t = () => (leaveDone ? r() : setTimeout(t, 16)); t(); });
    await navClosed;
    closeNavForTransition();
    resetPersistentNavColor(next);
    if (pendingNavUpdateData) {
      initBarbaNavUpdate(pendingNavUpdateData);
      updateNavRestingColors();
      pendingNavUpdateData = null;
    }
  }

  const tl = gsap.timeline();

  if (reducedMotion) {
    // Immediate swap behavior if user prefers reduced motion — settle any
    // prepared hero intro straight to its finished state rather than
    // playing the roll-in.
    if (pendingLoadReveal) {
      const { wordmark, menuChars, logo } = pendingLoadReveal;
      gsap.set(wordmark, { autoAlpha: 1 });
      const wordmarkAnim = getLottieIn(wordmark);
      if (wordmarkAnim) wordmarkAnim.goToAndStop(wordmarkAnim.totalFrames - 1, true);
      if (menuChars) gsap.set(menuChars, { yPercent: 0 });
      if (logo) {
        gsap.set(logo, { autoAlpha: 1 });
        finishNavLogo();
      }
      pendingLoadReveal = null;
    }
    // b115 — matches prepareLineReveal's new resting state (opacity/y/filter),
    // not the old yPercent-only mask reset.
    (pendingLineReveals || []).forEach(({ split, unit, underline }) => { gsap.set(split ? split.lines : unit, { opacity: 1, y: 0 }); releaseUnderline(underline); });
    pendingLineReveals = null;
    // b113 — lines, not words, now that DISPLAY_LARGE_ANIM splits by line.
    (pendingDisplayLargeReveals || []).forEach(({ splits }) => splits.forEach(split => gsap.set(split.lines, { opacity: 1, y: 0 })));
    pendingDisplayLargeReveals = null;
    // b120 — matches prepareStickerReveal's new resting state (opacity/y/filter,
    // not the old autoAlpha/y/scale bounce-pop).
    (pendingStickerReveals || []).forEach(({ el }) => gsap.set(el, { opacity: 1, y: 0 }));
    pendingStickerReveals = null;
    // b117/b118 — matches prepareImageReveal's resting state (scale is no
    // longer part of this reveal — it's driven continuously by
    // initGlobalParallax's own scrubbed tween instead, untouched here).
    (pendingImageReveals || []).forEach(({ el }) => gsap.set(el, { opacity: 1, y: 0 }));
    pendingImageReveals = null;
    (pendingEntryImages || []).forEach(el => gsap.set(el, { clearProps: 'opacity' }));
    pendingEntryImages = null;
    (pendingRuleReveals || []).forEach(el => gsap.set(el, { scaleX: 1 }));
    pendingRuleReveals = null;
    tl.set(next, { autoAlpha: 1 });
    tl.call(() => { gsap.set('.nav__logo', { autoAlpha: 1 }); finishNavLogo(); });
    tl.add("pageReady")
    tl.call(resetPage, [next], "pageReady");
    return new Promise(resolve => tl.call(resolve, null, "pageReady"));
  }

  // b129 — fade only: wait for the outgoing fade to finish (it also runs
  // the prepare step in its onComplete), then fade the new page in.
  tl.add("startEnter", navWasOpenForTransition ? 0.05 : TRANSITION_FADE_OUT + 0.05);

  tl.call(() => {
    // Play the hero intro (prepared earlier, hidden, in the leave
    // timeline's onComplete) right as the page becomes visible.
    try {
      playLoadReveal(pendingLoadReveal);
    } catch (err) {
    }
    pendingLoadReveal = null;
    // A visible logo stays as it is; otherwise it draws in with the page.
    console.log('[logo] startEnter', { navLogoWasShown });
    if (!navLogoWasShown) forceNavBarVisible();
    navAutoHideSuppressed = false;
  }, null, "startEnter");

  tl.fromTo(next, { autoAlpha: 0 }, {
    autoAlpha: 1,
    duration: TRANSITION_FADE_IN,
    ease: WH_EASE,
    immediateRender: false
  }, "startEnter");

  // Scroll reveals activate shortly after the fade begins so headings
  // animate in as the page appears.
  tl.add("pageReady", "startEnter+=0.15");
  tl.call(resetPage, [next], "pageReady");
  // Scroll-triggered heading reveals have to wait until here: resetPage()
  // just cleared the position:fixed/top/left/right/bottom that
  // barba.hooks.beforeEnter applied to `next`, putting it back into real
  // document flow with its actual scrollable height. ScrollTrigger.create()
  // needs that real layout to compute correct start/end positions — created
  // any earlier (e.g. at "startEnter", while `next` was still viewport-
  // clamped), triggers below the very top of the page get garbage
  // start/end values and never fire. Elements are already hidden from the
  // earlier "prepare" step, so activating a beat later here causes no
  // visible flash — it just means the reveal begins slightly after the
  // page appears rather than in the same instant.
  tl.call(() => {
    // Keep a reference before it's nulled out below: activateDisplayLargeReveal
    // needs it too, to fire the hero's own intro paragraph in the same
    // callback as the title (see both functions' own comments).
    const linePreparedForHero = pendingLineReveals;
    openEntryWindow(pendingDisplayLargeReveals);
    try {
      activateLineReveal(pendingLineReveals);
    } catch (err) {
    }
    pendingLineReveals = null;
    // Images in view follow the heading lines; set before the headings fire,
    // since the intro text keys off whether an image leads.
    revealEntryImages(pendingEntryImages, entryHeadingLines);
    pendingEntryImages = null;
    try {
      activateDisplayLargeReveal(pendingDisplayLargeReveals, linePreparedForHero);
    } catch (err) {
    }
    pendingDisplayLargeReveals = null;
    try {
      activateStickerReveal(pendingStickerReveals);
    } catch (err) {
    }
    pendingStickerReveals = null;
    try {
      activateImageReveal(pendingImageReveals);
    } catch (err) {
    }
    pendingImageReveals = null;
    try {
      activateRuleReveal(pendingRuleReveals);
    } catch (err) {
    }
    pendingRuleReveals = null;
    // An above-the-fold ScrollTrigger created just above (the hero title
    // especially, since its "top 90%" start point is already behind us at
    // scroll 0) can come out with a stale start position computed against
    // layout that predates this navigation, and never fire its once:true
    // onEnter. Refreshing right after creation corrects it — hooks.
    // afterEnter (below) also refreshes, but only once this timeline's
    // promise has resolved, which is a cycle too late for a trigger that
    // needed firing immediately. Below-the-fold reveals aren't affected;
    // they fire normally as the user scrolls to them.
    if (hasScrollTrigger) ScrollTrigger.refresh();
  }, null, "pageReady");

  // Hand the colours back to the page itself once both the fade and the
  // body's colour tween have finished (visually identical: body already
  // equals the new page's colour by then).
  tl.call(() => {
    gsap.set(next, { clearProps: 'backgroundColor' });
    gsap.set(document.body, { clearProps: 'backgroundColor' });
  }, null, "startEnter+=" + Math.max(TRANSITION_FADE_IN, TRANSITION_BG_DURATION));

  return new Promise(resolve => {
    tl.call(resolve, null, "pageReady");
  });
}


// -----------------------------------------
// BARBA HOOKS + INIT
// -----------------------------------------

document.addEventListener('DOMContentLoaded', function () {

barba.hooks.before(data => {
  // b144 — decided once, up front, before anything else touches the nav.
  const navStatusAtStart = document.querySelector('[data-navigation-status]');
  navWasOpenForTransition = !reducedMotion && !!navStatusAtStart && navStatusAtStart.getAttribute('data-navigation-status') === 'active';
  pendingNavUpdateData = null;
  // Leave the open menu visually in place through the leave transition
  // (data-navigation-status stays 'active', navTimeline and the nav-char
  // transforms untouched) instead of snapping it shut instantly — closing
  // it immediately would expose the outgoing page underneath for however
  // long the transition panel takes to cover the screen. The actual close
  // (closeNavForTransition, called from the leave timeline's onComplete
  // below) happens only once the panel has finished covering.
  //
  // Pointer-events are still disabled right away, so nothing in the
  // (still visually open) menu can be clicked/hovered mid-transition.
  disableNavLinkPointerEvents();
  // b178 — with the menu open, start closing it right away instead of waiting
  // for the leave step. The outgoing page is hidden first so the closing menu
  // reveals the page background, not the old content.
  navClosed = Promise.resolve();
  if (navWasOpenForTransition && data && data.current && data.current.container) {
    const outgoing = data.current.container;
    if (pageBaseBg === null) pageBaseBg = getComputedStyle(document.body).backgroundColor;
    gsap.set(document.body, { backgroundColor: getContainerBg(outgoing) });
    gsap.set(outgoing, { backgroundColor: 'transparent', opacity: 0 });
    navClosed = closeNavAnimated();
  }
  // Also suppress the hover mouseleave's color revert for the same
  // reason — see navigatingAway's own comment and the mouseleave listener
  // in initNavLinkHoverEffects.
  navigatingAway = true;

  const logoEl = document.querySelector('.nav__logo');
  const logoStyle = logoEl ? getComputedStyle(logoEl) : null;
  navLogoWasShown = !navWasOpenForTransition && navBarIsVisible() && !!logoStyle &&
    logoStyle.visibility !== 'hidden' && parseFloat(logoStyle.opacity) > 0.5;
  navAutoHideSuppressed = true;
  console.log('[logo] transition start', { shown: navLogoWasShown, barVisible: navBarIsVisible(), opacity: logoStyle && logoStyle.opacity, visibility: logoStyle && logoStyle.visibility, menuOpen: navWasOpenForTransition });
  // Safety net in case the enter step never runs.
  setTimeout(() => { navAutoHideSuppressed = false; }, 6000);

  // Warm any persistent bunny players (data-bunny-persist="true") right
  // at the start of the transition — force playback and drop their own
  // IntersectionObserver before anything moves. The actual reparenting
  // happens later, from the leave timeline's onComplete (see
  // reparentBunnyPlayers), once the transition panel has covered the
  // screen — not here.
  if (data && data.current && data.current.container) {
    warmBunnyPlayers(data.current.container);
  }
});

barba.hooks.beforeEnter(data => {
  // Position new container on top.
  //
  // `bottom: 0` matters as much as top/left/right here, even though the
  // container is about to be fully covered/faded anyway: without it, this
  // fixed-position box has no height constraint and grows to fit all of
  // its content (the whole page — thousands of px) instead of clamping to
  // the viewport. That oversized box then becomes the containing block
  // for anything inside it sized by percentage or its own `fixed`
  // positioning — including .home_hero__section and, critically, the
  // persistent bunny video player once it's reclaimed into the hero slot
  // during this same window (see reparentBunnyPlayers, called from the
  // leave timeline's onComplete, which runs well before resetPage()'s
  // clearProps normally undoes this at the "pageReady" label). The result
  // was the reclaimed player rendering in a ~1440x11554 box instead of
  // the viewport's ~1440x900 — logged directly via the [bunny-park]
  // diagnostics — which is what showed up as the video looking
  // dramatically zoomed in and blurred (a 1920x1080 frame stretched to
  // cover a box twelve times taller than it should be). Same root cause
  // as the original b54 fixed-position/containing-block bug, just
  // resurfacing in a different descendant.
  gsap.set(data.next.container, {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  });

  if (lenis && typeof lenis.stop === "function") {
    lenis.stop();
  }

  // Webflow ships its maps module only with pages that use it, so it is
  // missing when arriving from a page without a map (e.g. Home -> Contact)
  // and can't be loaded after the fact. Fall back to a full page load there,
  // once the menu has closed / the old page has faded out.
  if (data.next.container.querySelector('.w-widget-map') && !Webflow.require('maps')) {
    const settled = navWasOpenForTransition ? navClosed : waitSeconds(TRANSITION_FADE_OUT);
    hardNavigating = true;
    return settled.then(() => window.location.assign(data.next.url.href));
  }

  initBeforeEnterFunctions(data.next.container);
  applyThemeFrom(data.next.container);
});

barba.hooks.afterLeave(data => {
  if(hasScrollTrigger){
    // With sync:true, leave() and enter() run concurrently, and Barba
    // only fires afterLeave/afterEnter once BOTH have resolved — so by
    // the time this runs, the INCOMING page's own reveals (activateLine-
    // Reveal/activateDisplayLargeReveal, ScrollTrigger.create() calls
    // made at enter's "pageReady") have very likely already happened.
    // A blanket "kill everything except nav-auto-hide" sweep here was
    // killing those newly-created triggers milliseconds after they were
    // made — confirmed live: activate would report a trigger count going
    // up, then this sweep would immediately report killing nearly all of
    // them, wiping out every reveal below the fold. So instead of a
    // blanket kill, only kill triggers whose trigger element is no
    // longer in the document — i.e. ones that belonged to the page we
    // just left (removed via current.remove() in the leave timeline's
    // onComplete). A trigger with no element at all (like nav-auto-hide,
    // matched below anyway) is left alone rather than guessed at.
    const toKill = ScrollTrigger.getAll().filter(trigger => {
      if (trigger.vars.id === 'nav-auto-hide') return false;
      const el = trigger.trigger;
      return !!el && !document.contains(el);
    });
    toKill.forEach(trigger => trigger.kill());
  }
  // Container is already removed from the DOM, but still detached —
  // tear down its HLS.js/IntersectionObserver instances explicitly.
  if (data && data.current && data.current.container) {
    destroyBunnyPlayers(data.current.container);
  }
});

barba.hooks.enter(data => {
  // b144 — with the menu open, DON'T touch the nav yet: updateNavRestingColors
  // snaps the tile's background to the destination's resting colour (Home's
  // yellow) instantly, while the menu is still showing. Defer both until the
  // menu has finished closing (see runPageEnterAnimation), then apply them
  // while it's hidden. The menu closes in its own current colours, then the
  // page transitions in.
  if (navWasOpenForTransition) {
    pendingNavUpdateData = data;
    return;
  }
  initBarbaNavUpdate(data);
  // Recompute the nav's resting colors for the page we're navigating TO
  // (location.pathname is already updated by Barba here), so they're
  // correct before closeNavForTransition's resetAllLinks() runs shortly
  // after, at the leave timeline's onComplete.
  updateNavRestingColors();
})

barba.hooks.afterEnter(data => {
  // Run page functions
  initAfterEnterFunctions(data.next.container);

  // Settle
  if(hasLenis){
    lenis.resize();
    lenis.start();
  }

  if(hasScrollTrigger){
    ScrollTrigger.refresh();
  }
});

// CMS template pages don't carry the body attribute Barba needs; without it
// barba.init throws, the wh-loading class is never cleared and no intro runs.
if (!document.querySelector('[data-barba="wrapper"]')) {
  document.body.setAttribute('data-barba', 'wrapper');
}

barba.init({
  debug: false,
  timeout: 7000,
  preventRunning: true,
  transitions: [
    {
      name: "default",
      sync: true,

      // First load
      async once(data) {
        initOnceFunctions();
        // b127 — if this first page isn't Home, warm Home's hero video in the
        // background once the page has loaded (no-op on Home).
        schedulePreloadHomeHeroVideo();

        // Start the hero video loading now so it is playing by the time the
        // preloader finishes (initAfterEnterFunctions skips it once initialised).
        initBunnyPlayerBackground(data.next.container);

        const intro = prepareOnceAnimation(data.next.container);
        // The page is hidden by the site head until its intro state is set (no flash of final content).
        document.documentElement.classList.remove('wh-loading');
        await runPreloader(data.next.container);
        playOnceAnimation(intro);
      },

      // Current page leaves
      async leave(data) {
        return runPageLeaveAnimation(data.current.container, data.next.container);
      },

      // New page enters
      async enter(data) {
        return runPageEnterAnimation(data.next.container);
      }
    }
  ],
});

}); // end DOMContentLoaded



// -----------------------------------------
// GENERIC + HELPERS
// -----------------------------------------

const themeConfig = {
  light: {
    nav: "dark",
    transition: "light"
  },
  dark: {
    nav: "light",
    transition: "dark"
  }
};

function applyThemeFrom(container) {
  const pageTheme = container?.dataset?.pageTheme || "light";
  const config = themeConfig[pageTheme] || themeConfig.light;

  document.body.dataset.pageTheme = pageTheme;
  const transitionEl = document.querySelector('[data-theme-transition]');
  if (transitionEl) {
    transitionEl.dataset.themeTransition = config.transition;
  }

  const nav = document.querySelector('[data-theme-nav]');
  if (nav) {
    nav.dataset.themeNav = config.nav;
  }
}

function initLenis() {
  if (lenis) return; // already created
  if (!hasLenis) return;

  lenis = new Lenis({
    autoRaf: true,
    lerp: 0.165,
    wheelMultiplier: 1.25,
  });

  if (hasScrollTrigger) {
    lenis.on("scroll", ScrollTrigger.update);
  }
}

function resetPage(container){
  window.scrollTo(0, 0);
  // Also clear the leftover inline transform from the enter animation's
  // `y` tween. GSAP leaves `transform: translate(0px, 0px)` on the
  // container even once it has animated back to 0 — and any inline
  // transform on an ancestor (even a no-op one) creates a new containing
  // block for descendant `position: fixed` elements, which breaks the
  // fixed-position hero (e.g. .home_hero__section) inside it.
  gsap.set(container, { clearProps: "position,top,left,right,bottom,transform" });

  if(hasLenis){
    lenis.resize();
    // Lenis keeps its own virtual scroll position, separate from the
    // native window.scrollTo(0,0) above — re-home it explicitly on every
    // navigation (not just first load), or a stale non-zero reading can
    // survive from the previous page right as this page's reveal
    // ScrollTriggers refresh.
    lenis.scrollTo(0, { immediate: true, force: true });
    lenis.start();
  }
}

function debounceOnWidthChange(fn, ms) {
  let last = innerWidth,
    timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (innerWidth !== last) {
        last = innerWidth;
        fn.apply(this, args);
      }
    }, ms);
  };
}

function initBarbaNavUpdate(data) {
  var tpl = document.createElement('template');
  tpl.innerHTML = data.next.html.trim();
  var nextNodes = tpl.content.querySelectorAll('[data-barba-update]');
  var currentNodes = document.querySelectorAll('nav [data-barba-update]');

  currentNodes.forEach(function (curr, index) {
    var next = nextNodes[index];
    if (!next) return;

    // Aria-current sync
    var newStatus = next.getAttribute('aria-current');
    if (newStatus !== null) {
      curr.setAttribute('aria-current', newStatus);
    } else {
      curr.removeAttribute('aria-current');
    }

    // Class list sync
    var newClassList = next.getAttribute('class') || '';
    var oldClassList = curr.getAttribute('class') || '';
    // Diagnostic only — logs which nodes get their class attribute
    // swapped here, useful for tracing nav-link state issues.
    if (oldClassList !== newClassList) {
    }
    curr.setAttribute('class', newClassList);
  });
}



// -----------------------------------------
// YOUR FUNCTIONS GO BELOW HERE
// -----------------------------------------

// Reusable heading reveal — tag any element with [data-line-reveal] in
// Webflow. Values match staggertext.webflow.io's source, but once-only
// (not repeating) rather than replaying every scroll-back.
//
// Split into prepare/activate, same as Home's hero intro (see
// prepareLoadReveal/playLoadReveal): the hidden state is set up here while
// the page is still covered (called from the leave timeline's onComplete),
// and the ScrollTriggers that actually fire the reveal are only created
// later, once the page is about to be shown (activateLineReveal, at
// "startEnter") — so an above-the-fold heading reveals right as it
// appears, instead of sitting visible as static text first.
// -----------------------------------------
// UNDERLINE LINKS ([data-underline-link])
// -----------------------------------------

// GSAP-driven version of the old CSS pseudo-element underline, same look and
// timing. Each bar is a real span whose visible stretch is a clip-path
// (left edge / right edge, in %), so an interrupted hover carries on from
// wherever the line has got to instead of snapping its origin across.
//   default: rests empty; hover draws it in from the left, hover-out
//            wipes it away to the right.
//   "alt":   one line that rests underlined. Hover (and hover-out) wipes it
//            away to the right, then a fresh line draws in from the left.
//            A swipe always plays through; if the pointer has moved on by
//            the time it ends, one more swipe follows.
const UNDERLINE = { duration: 0.735, wipe: 0.5, ease: WH_EASE, altDelay: 0.3, height: '0.0625em', boldHeight: '0.1em' };

function ensureUnderlineStyle() {
  if (document.getElementById('wh-underline-js')) return;
  const style = document.createElement('style');
  style.id = 'wh-underline-js';
  style.textContent =
    '[data-underline-link][data-ul-js]::before,[data-underline-link][data-ul-js]::after{content:none!important;}';
  document.head.appendChild(style);
}

function makeUnderlineBar(link) {
  const el = document.createElement('span');
  el.setAttribute('aria-hidden', 'true');
  // The line thickens with the type: bold text gets a heavier underline.
  const height = parseInt(getComputedStyle(link).fontWeight, 10) >= 600 ? UNDERLINE.boldHeight : UNDERLINE.height;
  el.style.cssText =
    'position:absolute;left:0;bottom:-0.0625em;width:100%;pointer-events:none;background-color:currentColor;' +
    'height:' + height + ';';
  link.appendChild(el);
  const bar = { el, l: 0, r: 100 };
  bar.apply = () => { el.style.clipPath = 'inset(0 ' + bar.r + '% 0 ' + bar.l + '%)'; };
  bar.apply();
  return bar;
}

function underlineBarEmpty(bar) {
  return 100 - bar.l - bar.r < 0.5;
}

function underlineGrow(bar, delay) {
  // An empty bar always starts from the left edge.
  if (underlineBarEmpty(bar)) { bar.l = 0; bar.r = 100; bar.apply(); }
  gsap.to(bar, { l: 0, r: 0, duration: UNDERLINE.duration, ease: UNDERLINE.ease, delay: delay || 0, overwrite: true, onUpdate: bar.apply });
}

function underlineWipe(bar, delay) {
  // Left edge runs across to the right edge, which stays where it is.
  gsap.to(bar, { l: 100 - bar.r, duration: UNDERLINE.duration, ease: UNDERLINE.ease, delay: delay || 0, overwrite: true, onUpdate: bar.apply });
}

function setupUnderline(link) {
  if (link._ul) return link._ul;
  ensureUnderlineStyle();
  link.setAttribute('data-ul-js', '');
  if (getComputedStyle(link).position === 'static') link.style.position = 'relative';

  const alt = link.getAttribute('data-underline-link') === 'alt';
  const main = makeUnderlineBar(link);
  const state = { alt, main, hovered: false, waiting: false, swiping: false };
  if (alt) {
    main.l = 0; main.r = 0; main.apply(); // rests underlined
  } else {
    main.l = 100; main.r = 0; main.apply();
  }
  link._ul = state;

  // alt: wipe out to the right, then draw a new line in from the left.
  const swipe = () => {
    state.swiping = true;
    gsap.killTweensOf(main);
    const tl = gsap.timeline({ onComplete: () => { state.swiping = false; } });
    tl.to(main, { l: 100 - main.r, duration: UNDERLINE.wipe, ease: UNDERLINE.ease, onUpdate: main.apply });
    tl.call(() => { main.l = 0; main.r = 100; main.apply(); });
    tl.to(main, { r: 0, duration: UNDERLINE.duration, ease: UNDERLINE.ease, onUpdate: main.apply });
  };

  const source = link.closest('[data-hover]') || link;
  const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  source.addEventListener('mouseenter', () => {
    if (!canHover()) return;
    state.hovered = true;
    if (alt) {
      if (!state.swiping) swipe();
    } else {
      underlineGrow(main, 0);
    }
  });
  source.addEventListener('mouseleave', () => {
    if (!state.hovered) return;
    state.hovered = false;
    if (!alt) underlineWipe(main, 0); // alt: a swipe in flight just plays out
  });
  return state;
}

function initUnderlineLinks(scope) {
  (scope || document).querySelectorAll('[data-underline-link]').forEach(setupUnderline);
}

// Underlined links inside revealed text: the line sits outside the split
// words, so it is held back until the reveal starts and then drawn in with it.
function holdUnderline(el) {
  const link = el.closest('[data-underline-link]') || el.querySelector('[data-underline-link]');
  if (!link) return null;
  const state = setupUnderline(link);
  if (!state) return null;
  state.waiting = true;
  if (state.alt) {
    gsap.killTweensOf(state.main);
    state.swiping = false;
    state.main.l = 0; state.main.r = 100; state.main.apply();
  }
  return link;
}

function releaseUnderline(link) {
  const state = link && link._ul;
  if (!state || !state.waiting) return;
  state.waiting = false;
  if (state.alt && !state.swiping) underlineGrow(state.main, UNDERLINE.altDelay);
}

// An inline run like "Send your CV to / email link / and we'll get back to
// you" is spaced in the Designer with margins on the link, and there is no
// whitespace between the elements. Without whitespace the browser has no
// place to break between them, so "to" and the address (and the address and
// "and") are glued into one unbreakable chunk and wrap in odd places. Real
// spaces go in between, and the link margins that stood in for them go out.
function spaceInlineRuns(scope) {
  (scope || document).querySelectorAll('[data-line-reveal]').forEach(el => {
    if (getComputedStyle(el).display !== 'inline') return;
    const next = el.nextSibling;
    const sibling = next && next.nodeType === 1 ? next : null;
    if (!sibling || getComputedStyle(sibling).display !== 'inline') return;
    if (el.tagName === 'A') el.style.marginRight = '0';
    if (sibling.tagName === 'A') sibling.style.marginLeft = '0';
    el.after(document.createTextNode(' '));
  });
}

function prepareLineReveal(scope) {
  if (typeof SplitText === "undefined" || typeof ScrollTrigger === "undefined") return [];
  spaceInlineRuns(scope);

  // Rich text ([data-line-reveal-children], e.g. the legal pages' CMS body)
  // reveals block by block: each paragraph, heading and list item gets its
  // own line split and its own trigger, instead of splitting one huge node.
  const richBlocks = [...(scope || document).querySelectorAll('[data-line-reveal-children]')]
    .flatMap(rich => [...rich.children].flatMap(child => (/^(UL|OL)$/.test(child.tagName) ? [...child.children] : [child])))
    .filter(block => block.textContent.trim());
  const richSet = new Set(richBlocks);
  const defaultStart = el => el.getAttribute('data-line-reveal-start') || (richSet.has(el) ? 'top 90%' : 'top 85%');
  // [data-decade-text] is the exception: the decade panels split and reveal it
  // themselves (initDecadeTimelinePanels), and its panel is display:none until
  // shown, so a trigger here would fire on a zero-height box.
  const targets = [...(scope || document).querySelectorAll('[data-line-reveal]:not([data-decade-text])'), ...richBlocks];
  const prepared = [];
  // b147 — INLINE [data-line-reveal] pieces (display:inline, e.g. the "Send
  // your CV to / email link / and we'll get back to you" run on Contact,
  // which flows as one sentence) can't be SplitText'd: SplitText wraps every
  // line in a block-level <div>, which breaks each piece onto its own line —
  // looks right in the Designer (no JS) but stacks on the published site.
  // Transforms don't apply to inline boxes either. So the whole run is
  // revealed as one unit instead: its nearest non-inline ancestor gets the
  // same rise + fade, once, and the inline children are left untouched.
  const inlineUnits = new Map();
  targets.forEach(el => {
    // List items reveal as one unit: the bullet marker belongs to the <li>,
    // not to its split lines, so it would otherwise sit there while the text
    // animates.
    if (el.tagName === 'LI') {
      if (!inlineUnits.has(el)) inlineUnits.set(el, defaultStart(el));
      return;
    }
    if (getComputedStyle(el).display === 'inline') {
      let unit = el.parentElement;
      while (unit && getComputedStyle(unit).display === 'inline') unit = unit.parentElement;
      if (unit && !inlineUnits.has(unit)) {
        inlineUnits.set(unit, el.getAttribute('data-line-reveal-start') || 'top 85%');
      }
      return;
    }
    // b115 — same treatment as the display-heading reveal now: plain
    // rise + blur + opacity fade (DISPLAY_LARGE_ANIM), unmasked. Was
    // yPercent 120->0 inside a `mask: "lines"` wrapper.
    const split = new SplitText(el, { type: "lines" });
    gsap.set(split.lines, {
      opacity: 0,
      y: `${DISPLAY_LARGE_ANIM.travelEm}em`,
    });

    // Per-element override — e.g. footer links set data-line-reveal-start="top 100%"
    // so they trigger right as they reach the viewport, instead of the
    // page-wide default of "top 90%".
    const start = defaultStart(el);

    // The hero's own intro paragraph ([data-line-reveal] living inside the
    // hero's .section__hero__content) is tagged with that section here IF
    // a title group actually claimed it (heroTitleGroups, populated moments
    // earlier by prepareDisplayLargeReveal — see that map's own comment).
    // A tagged entry skips getting its own ScrollTrigger below;
    // activateDisplayLargeReveal fires it directly instead, in the same
    // callback as the title's own reveal.
    //
    // Matching also requires the element to sit inside that hero's
    // specific introWrap (the FIRST .hero__secondary__content__wrap in the
    // section) — .section__hero__content is actually the whole page's
    // outer wrapping section on every inner page, not something scoped to
    // just the hero, so without this narrower check every [data-line-reveal]
    // anywhere on the page (not just the hero's intro) would get swept in.
    // See prepareDisplayLargeReveal's own comment for the full story.
    const heroAncestor = el.closest('.section__hero__content');
    const heroGroup = heroAncestor ? heroTitleGroups.get(heroAncestor) : null;
    const heroSection = (heroGroup && heroGroup.introWrap && heroGroup.introWrap.contains(el)) ? heroAncestor : null;

    prepared.push({ split, start, trigger: el, heroSection, underline: holdUnderline(el) });
  });
  inlineUnits.forEach((start, unit) => {
    gsap.set(unit, { opacity: 0, y: `${DISPLAY_LARGE_ANIM.travelEm}em` });
    prepared.push({ split: null, unit, start, trigger: unit, heroSection: null, underline: holdUnderline(unit) });
  });
  return prepared;
}

// Still used by the synced hero-paragraph block below and the separate
// roll-in reveal further down the file — [data-line-reveal]'s own tween
// now uses DISPLAY_LARGE_ANIM instead (see activateLineReveal).
const LINE_REVEAL_DURATION = 1.9;
const LINE_REVEAL_STAGGER = 0.05;

function activateLineReveal(prepared) {
  (prepared || []).forEach(({ split, unit, start, trigger, heroSection, underline }) => {
    // An entry tagged with heroSection is fired by activateDisplayLargeReveal
    // instead (in the same callback as the title's own reveal), so it must
    // NOT also get its own trigger here — that would double-animate it.
    if (heroSection) return;
    ScrollTrigger.create({
      trigger: trigger,
      start: start,
      once: true,
      onEnter: () => {
        // b147 — an inline run is revealed as one unit (see prepareLineReveal).
        if (unit) {
          gsap.to(unit, { opacity: 1, y: 0, duration: DISPLAY_LARGE_ANIM.duration, delay: entryWaitDelay(), ease: DISPLAY_LARGE_ANIM.ease, onStart: () => releaseUnderline(underline) });
          return;
        }
        // b115 — same animation as the display-heading reveal (DISPLAY_LARGE_ANIM):
        // was yPercent 0, LINE_REVEAL_DURATION/"expo.out"/LINE_REVEAL_STAGGER.
        gsap.to(split.lines, {
          opacity: 1,
          y: 0,
          duration: DISPLAY_LARGE_ANIM.duration,
          delay: entryWaitDelay(),
          ease: DISPLAY_LARGE_ANIM.ease,
          stagger: { each: DISPLAY_LARGE_ANIM.stagger, from: "start" },
          onStart: () => releaseUnderline(underline)
        });
      }
    });
  });
}

let navTextSplits = [];

// Menu logo fade-out when the menu closes.
const SECONDARY_LOGO_FADE = 0.3;

function buildNavTimeline({ tileFill, navUl, navBottom, navLogoText, navLogo, navLogoSecondary, navLinkEls, navLinkSplits, topSecondarySplits, bottomSecondarySplits, closeIcon, menuLabel, onReady, onLinkReady }) {
  // Main link chars roll up into place on open, masked by the same
  // wrapper the hover roll effect uses. Local CHAR_TRAVEL/CHAR_EASE so
  // they don't also affect display-large's reveal, which shares
  // NAV_CHAR_ANIM.
  const CHAR_TRAVEL = 100;
  const CHAR_DURATION = NAV_CHAR_ANIM.duration;
  const CHAR_STAGGER = NAV_CHAR_ANIM.stagger;
  const CHAR_EASE = WH_EASE;
  const LINKS_START = 0.4;     // when the first link's characters start (after the top logo text)

  const linkChars = navLinkSplits.flatMap(split => split.chars);
  gsap.set(linkChars, {
    yPercent: CHAR_TRAVEL
  });

  const topLines = topSecondarySplits.flatMap(s => s.lines);
  const bottomLines = bottomSecondarySplits.flatMap(s => s.lines);
  gsap.set([...topLines, ...bottomLines], { yPercent: 100 });
  // Same starting state as the page transition's logo bounce-in.
  // The secondary logo is a Lottie in newer builds of the nav: it draws
  // itself in as part of the open animation. Without one it keeps the old
  // bounce.
  const secondaryHasLottie = !!(navLogoSecondary && navLogoSecondary.querySelector('[data-animation-type="lottie"]'));
  const resetSecondaryLogo = () => {
    const anim = getLottieIn(navLogoSecondary);
    if (!anim) return;
    anim.loop = false;
    anim.goToAndStop(0, true);
  };
  if (navLogoSecondary) {
    if (secondaryHasLottie) {
      gsap.set(navLogoSecondary, { autoAlpha: 0 });
      Webflow.push(resetSecondaryLogo);
    } else {
      gsap.set(navLogoSecondary, { autoAlpha: 0, y: 16, scale: 0.7 });
    }
  }
  if (closeIcon) gsap.set(closeIcon, { autoAlpha: 0, y: 16, scale: 0.7 });

  const tl = gsap.timeline({ paused: true });

  tl.set([navUl, navBottom, navLogoText].filter(Boolean), { autoAlpha: 1 }, 0);

  // "Menu" label fades out as soon as the panel opens (the top-bar logo is
  // handled separately in openNav/closeNav, so a page transition can keep it
  // hidden and replay its Lottie instead).
  if (menuLabel) {
    tl.to(menuLabel, { autoAlpha: 0, duration: 0.3, ease: WH_EASE }, 0);
  }

  // Explicit starting scale — Webflow's Transform panel can leave stray
  // scale/rotate CSS that GSAP would otherwise read instead of `transform`.
  gsap.set(tileFill, { scaleY: 0, transformOrigin: "top" });

  // Same panel-reveal mechanic as the page transition, just faster.
  tl.to(tileFill, {
    scaleY: 1,
    duration: 1,
    ease: WH_EASE
  }, 0);

  // Main links — one .to() per link (not one flattened array) so each
  // link's own finish time can be computed and its pointer-events
  // re-enabled right then, rather than waiting on the whole group.
  // b154 — each link rises as one line (all its chars together, no per-char
  // stagger); links stagger one after another like the other line reveals.
  const LINK_STAGGER = 0.08;
  const LINK_DURATION = 0.8;
  navLinkSplits.forEach((split, i) => {
    const chars = split.chars;
    const startTime = LINKS_START + i * LINK_STAGGER;

    tl.to(chars, {
      yPercent: 0,
      duration: LINK_DURATION,
      ease: CHAR_EASE
    }, startTime);

    const finishTime = startTime + LINK_DURATION;
    const linkEl = navLinkEls && navLinkEls[i];
    if (linkEl) {
      // Plain DOM write, not tl.set() — a timeline-tracked property gets
      // re-asserted on reverse and would undo closeNav()'s pointer-events
      // reset.
      tl.call(() => { if (onLinkReady) onLinkReady(linkEl); }, null, finishTime);
    }
  });

  // Marks when the whole link group is done (dimming, secondary elements).
  const linksGroupEnd = LINKS_START + Math.max(0, navLinkSplits.length - 1) * LINK_STAGGER + LINK_DURATION;
  tl.addLabel("linksDone", linksGroupEnd);
  tl.call(() => { if (onReady) onReady(); }, null, "linksDone");

  // Secondary logo mark — bounces in over the tail of the main links.
  if (navLogoSecondary && secondaryHasLottie) {
    tl.call(() => {
      // Closing is handled with the bottom links, below. Only if the menu is
      // closed before that point does this catch the logo still showing.
      if (tl.reversed()) {
        if (!gsap.isTweening(navLogoSecondary) && gsap.getProperty(navLogoSecondary, 'autoAlpha') > 0) {
          gsap.to(navLogoSecondary, { autoAlpha: 0, duration: SECONDARY_LOGO_FADE, ease: WH_EASE, onComplete: resetSecondaryLogo });
        }
        return;
      }

      // Opening. The menu is display:none until it opens, so Webflow may not
      // have created this Lottie yet — wait (briefly) for it to load.
      gsap.killTweensOf(navLogoSecondary);
      gsap.set(navLogoSecondary, { autoAlpha: 1 });
      const started = performance.now();
      const tryPlay = () => {
        if (tl.reversed() || tl.progress() === 0) return;
        const anim = getLottieIn(navLogoSecondary);
        if (anim && anim.isLoaded) {
          anim.loop = false;
          anim.setDirection(1);
          anim.goToAndPlay(0, true);
        } else if (performance.now() - started < 3000) {
          requestAnimationFrame(tryPlay);
        }
      };
      tryPlay();
    }, null, "linksDone-=0.8");
  } else if (navLogoSecondary) {
    tl.to(navLogoSecondary, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.7,
      ease: WH_EASE
    }, "linksDone-=0.8");
  }

  // Opens top to bottom: the top logo text first, then the links (above),
  // then the secondary logo, then the bottom bar left to right.
  tl.to(topLines, {
    yPercent: 0,
    duration: 0.7,
    ease: WH_EASE,
    stagger: 0.05
  }, 0.1);

  const bottomTween = tl.to(bottomLines, {
    yPercent: 0,
    duration: 0.7,
    ease: WH_EASE,
    stagger: 0.12 // left to right across the bar
  }, "linksDone-=0.3");

  // On close the menu logo fades out as the bottom links roll away: this
  // call sits at the end of their tween, which the reverse reaches first.
  if (navLogoSecondary && secondaryHasLottie) {
    tl.call(() => {
      if (!tl.reversed()) return;
      gsap.to(navLogoSecondary, {
        autoAlpha: 0,
        duration: SECONDARY_LOGO_FADE,
        ease: WH_EASE,
        overwrite: 'auto',
        onComplete: resetSecondaryLogo
      });
    }, null, bottomTween.startTime() + bottomTween.duration());
  }

  // X icon — same bounce as the secondary logo. Folded into this
  // timeline so open/close both handle it via play()/reverse().
  if (closeIcon) {
    tl.set(closeIcon, { display: "block" }, 1);
    tl.to(closeIcon, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.7,
      ease: WH_EASE
    }, 1);
  }

  // Diagnostic only — logs per-char state for every link once the open
  // animation completes, so a link stuck at its hidden yPercent:100 state
  // shows up directly in the console.
  tl.eventCallback("onComplete", () => {
    const report = navLinkSplits.map((split, i) => {
      const linkEl = navLinkEls && navLinkEls[i];
      const chars = split.chars;
      return {
        i,
        cls: linkEl ? linkEl.className : '(no linkEl)',
        firstCharTransform: chars[0] ? chars[0].style.transform : null,
        lastCharTransform: chars.length ? chars[chars.length - 1].style.transform : null
      };
    });
  });

  return tl;
}

// Per-link hover-in config, keyed to each link's unique class. Shared
// with buildNavTimeline's reveal, so Escapes' text-swap uses the same
// recipe.
const NAV_CHAR_ANIM = {
  travel: 50,
  blur: 10,
  duration: 0.7,
  stagger: 0.012,
  ease: WH_EASE
};

// Delay before the underline grows in on hover — shorter than the roll
// effect, so it starts early rather than waiting for the text to finish.
const NAV_UNDERLINE_DELAY = 0.1;

// Nav's own underline thickness/timing (thicker than the site's default
// [data-underline-link] CSS rule, which everything else still uses).
const UNDERLINE_HEIGHT = '0.05em';
const UNDERLINE_DURATION = 0.735;

const NAV_LINK_HOVER_CONFIG = {
  'is--our_story': {
    bg: COLORS.kiwiSkin,
    color: COLORS.kanukaPink
  },
  'is--our_approach': {
    bg: COLORS.forest,
    color: COLORS.spring
  },
  'is--orchads': {
    bg: COLORS.leaf,
    color: COLORS.spring
  },
  'is--packhouse': {
    bg: COLORS.stone,
    color: COLORS.deepLake
  },
  'is--escapes': {
    bg: COLORS.deepLake,
    color: COLORS.kanukaPink
  },
  'is--contact': {
    bg: COLORS.kanukaPink,
    color: COLORS.deepLake
  }
};

function initNavLinkHoverEffects(dimCloseIcon, undimCloseIcon, isSettled, navLinkEls, navLinkSplits) {
  const navEl = document.querySelector('[data-navigation-status]');
  if (!navEl) return;

  const tileFill = navEl.querySelector('.nav__tile-fill');
  const navUlEl = navEl.querySelector('.nav__ul');
  if (!tileFill || !navUlEl) return;

  // The rounded "cap" at the bottom of the tile is its own separate
  // element (.nav__tile-fill > .nav__tile-cap > .nav__tile-circle) with its
  // own background-color, bound in the Designer to a fixed color variable —
  // so it needs tracking and tweening alongside tileFill wherever its
  // backgroundColor changes below, or it stays stuck on that default color.
  // An inline gsap-set style wins over the variable-bound class value.
  // Guarded with `tileCircle &&` below in case the element is ever removed.
  const tileCircle = navEl.querySelector('.nav__tile-circle');
  // b153 — menu panel slides in with a straight bottom edge: hide the curved cap.
  const tileCap = navEl.querySelector('.nav__tile-cap');
  if (tileCap) tileCap.style.display = 'none';

  // Text + bottom logo mark + close icon all share the same color tween.
  const colorTargets = [
    ...navEl.querySelectorAll('.nav__link'),
    ...navEl.querySelectorAll('.nav__text-secondary'),
    ...navEl.querySelectorAll('.nav__logo-secondary'),
    ...navEl.querySelectorAll('.nav__button__close'),
    ...navEl.querySelectorAll('.nav__image-caption')
  ];

  const defaultBg = getComputedStyle(tileFill).backgroundColor;
  // b142 — read each target's NON-current colour. This runs once at first
  // load; if that load was a page like Our Approach, its own nav link carries
  // Webflow's w--current / aria-current styling (kiwiSkin) and that tinted
  // colour was being stored as the link's "default" for the whole session —
  // so after navigating away, the Approach link stayed kiwiSkin in the menu
  // instead of going back to forest. Temporarily drop the current-page
  // markers (and any inline colour / transition) while measuring.
  const readDefaultColor = el => {
    const hadCurrentClass = el.classList.contains('w--current');
    const ariaCurrent = el.getAttribute('aria-current');
    const prevColor = el.style.color;
    const prevTransition = el.style.transition;
    if (hadCurrentClass) el.classList.remove('w--current');
    if (ariaCurrent !== null) el.removeAttribute('aria-current');
    el.style.transition = 'none';
    el.style.color = '';
    const c = getComputedStyle(el).color;
    el.style.color = prevColor;
    el.style.transition = prevTransition;
    if (hadCurrentClass) el.classList.add('w--current');
    if (ariaCurrent !== null) el.setAttribute('aria-current', ariaCurrent);
    return c;
  };
  const defaultColors = colorTargets.map(readDefaultColor);

  // The nav's RESTING colors (shown when nothing is hovered) follow the
  // current page's own link config — e.g. opening the menu on Packhouse
  // rests on Packhouse's stone bg / configured text color, the same as
  // hovering that link would show. Mutable — recomputed on every page
  // enter by updateNavRestingColors() below, since the "current page"
  // changes across a persistent nav's lifetime even though this whole
  // setup function only ever runs once.
  let restBg = defaultBg;
  let restColor = null; // null = no page-specific override; use each target's own defaultColors[i]

  // Reuse the char splits already built in buildNavTimeline.
  const originalSplitByLink = new Map();
  if (navLinkEls && navLinkSplits) {
    navLinkEls.forEach((el, i) => {
      if (el && navLinkSplits[i]) originalSplitByLink.set(el, navLinkSplits[i]);
    });
  }

  const linkConfigs = new Map();
  navUlEl.querySelectorAll('.nav__li').forEach(li => {
    const link = li.querySelector('.nav__link');
    if (!link) return;

    const configKey = Object.keys(NAV_LINK_HOVER_CONFIG).find(cls => link.classList.contains(cls));
    const config = configKey ? NAV_LINK_HOVER_CONFIG[configKey] : null;
    if (!config) return;

    const image = li.querySelector('.nav__image');
    if (image) {
      // Masked at rest, reveals bottom-to-top on hover.
      gsap.set(image, { clipPath: 'inset(100% 0% 0% 0%)', scale: 1.05 });
    }

    // Optional caption under the image (e.g. Escapes) — words slide up
    // on hover, same line-mask technique as the top/bottom secondary text.
    const caption = li.querySelector('.nav__image-caption');
    let captionSplit = null;
    if (caption && typeof SplitText !== "undefined") {
      captionSplit = new SplitText(caption, { type: "lines", mask: "lines" });
      gsap.set(captionSplit.lines, { yPercent: 110 });
    }

    // Escapes' alt text ("Coming Soon") rolls in over the link text on hover.
    // The alt element itself stays hidden and only supplies the words; a
    // masked, absolutely positioned copy styled like the main text does the
    // rolling so the link keeps its original width.
    const altEl = link.querySelector('.nav__link-text-alt');
    if (altEl) gsap.set(altEl, { display: 'none' });
    let swap = null;
    const origSplit = originalSplitByLink.get(link);
    const mainText = link.querySelector('.nav__link-text:not(.nav__link-text-alt)');
    if (altEl && origSplit && mainText && typeof SplitText !== "undefined") {
      const cs = getComputedStyle(mainText);
      const altCopy = document.createElement('span');
      altCopy.setAttribute('aria-hidden', 'true');
      altCopy.textContent = altEl.textContent.trim();
      altCopy.style.cssText =
        'position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;' +
        `font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};` +
        `letter-spacing:${cs.letterSpacing};line-height:${cs.lineHeight};text-transform:${cs.textTransform};`;
      if (getComputedStyle(link).position === 'static') link.style.position = 'relative';
      link.appendChild(altCopy);
      const altSplit = new SplitText(altCopy, { type: 'lines', mask: 'lines', reduceWhiteSpace: false });
      gsap.set(altSplit.lines, { yPercent: 110 });
      // Centre the copy over the main text (measured on hover, layout can change).
      const place = () => {
        const linkBox = link.getBoundingClientRect();
        const mainBox = mainText.getBoundingClientRect();
        const altBox = altCopy.getBoundingClientRect();
        altCopy.style.left = `${mainBox.left - linkBox.left + (mainBox.width - altBox.width) / 2}px`;
        altCopy.style.top = `${mainBox.top - linkBox.top + (mainBox.height - altBox.height) / 2}px`;
      };
      swap = { origLines: origSplit.lines, altLines: altSplit.lines, place, active: false };
    }

    // GSAP-driven underline, replacing [data-underline-link]'s CSS
    // pseudo-element for these links (GSAP can't tween ::before/::after
    // directly).
    // Escapes swaps to "Coming Soon" instead of underlining.
    let underline = null;
    if (!swap) {
      underline = document.createElement('span');
      underline.setAttribute('aria-hidden', 'true');
      underline.style.cssText =
        `position:absolute;bottom:-0.0625em;left:0;width:100%;height:max(${UNDERLINE_HEIGHT}, 1px);` +
        'background-color:currentColor;pointer-events:none;';
      if (getComputedStyle(link).position === 'static') link.style.position = 'relative';
      link.appendChild(underline);
      gsap.set(underline, { scaleX: 0, transformOrigin: 'right' });
    }

    linkConfigs.set(link, {
      config, image, caption, captionSplit, underline, swap
    });
  });

  let activeLink = null;
  let imageRevealTimer = null;

  function enter(link) {
    const entry = linkConfigs.get(link);
    if (!entry) return;
    activeLink = link;
    gsap.to(tileFill, { backgroundColor: entry.config.bg, duration: 0.6, ease: WH_EASE, overwrite: 'auto' });
    if (tileCircle) gsap.to(tileCircle, { backgroundColor: entry.config.bg, duration: 0.6, ease: WH_EASE, overwrite: 'auto' });
    gsap.to(colorTargets, { color: entry.config.color, duration: 0.6, ease: WH_EASE, overwrite: 'auto' });

    // Underline grows in.
    if (entry.underline) {
      gsap.killTweensOf(entry.underline);
      gsap.set(entry.underline, { transformOrigin: 'left' });
      gsap.to(entry.underline, {
        scaleX: 1,
        duration: UNDERLINE_DURATION,
        ease: WH_EASE,
        delay: NAV_UNDERLINE_DELAY,
        overwrite: 'auto'
      });
    }

    if (entry.swap) {
      const { origLines, altLines, place } = entry.swap;
      entry.swap.active = true;
      place();
      gsap.to(origLines, { yPercent: -110, duration: 0.6, ease: WH_EASE, overwrite: 'auto' });
      gsap.to(altLines, { yPercent: 0, duration: 0.6, ease: WH_EASE, delay: 0.05, overwrite: 'auto' });
    }

    // Hover-intent delay — a quick flick through links shouldn't start
    // the image reveal at all. Only plays if still active after the delay.
    clearTimeout(imageRevealTimer);
    if (entry.image) {
      imageRevealTimer = setTimeout(() => {
        if (activeLink !== link) return;
        gsap.killTweensOf(entry.image);
        gsap.to(entry.image, { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 0.8, ease: WH_EASE });
        if (entry.captionSplit) {
          gsap.to(entry.captionSplit.lines, {
            yPercent: 0,
            duration: 0.6,
            ease: WH_EASE,
            stagger: 0.04,
            overwrite: true
          });
        }
      }, 150);
    }

    dimCloseIcon();
  }

  function leave(link, opts) {
    const entry = linkConfigs.get(link);
    if (!entry) return;
    clearTimeout(imageRevealTimer);
    // b150 — keepColors: a menu-open page transition closes the menu in the
    // colours it's currently showing (e.g. the hovered link's bg). Reverting
    // to the resting colours here flashed the tile to the destination's
    // resting colour (yellow) the moment a link was clicked.
    if (!(opts && opts.keepColors)) {
      // Revert to the current page's resting colors (restBg/restColor, kept
      // up to date by updateNavRestingColors) rather than a fixed default.
      gsap.to(tileFill, { backgroundColor: restBg, duration: 0.5, ease: WH_EASE, overwrite: 'auto' });
      if (tileCircle) gsap.to(tileCircle, { backgroundColor: restBg, duration: 0.5, ease: WH_EASE, overwrite: 'auto' });
      colorTargets.forEach((el, i) => {
        gsap.to(el, { color: restColor || defaultColors[i], duration: 0.5, ease: WH_EASE, overwrite: 'auto' });
      });
    }
    if (entry.underline) {
      gsap.killTweensOf(entry.underline);
      // Origin snaps to right instantly, matching the CSS.
      gsap.set(entry.underline, { transformOrigin: 'right' });
      gsap.to(entry.underline, {
        scaleX: 0,
        duration: UNDERLINE_DURATION,
        ease: WH_EASE,
        overwrite: 'auto'
      });
    }
    if (entry.swap && entry.swap.active) {
      const { origLines, altLines } = entry.swap;
      entry.swap.active = false;
      gsap.to(altLines, { yPercent: 110, duration: 0.5, ease: WH_EASE, overwrite: 'auto' });
      gsap.to(origLines, { yPercent: 0, duration: 0.5, ease: WH_EASE, delay: 0.05, overwrite: 'auto' });
    }
    if (entry.image) {
      gsap.killTweensOf(entry.image);
      gsap.to(entry.image, { clipPath: 'inset(100% 0% 0% 0%)', scale: 1.05, duration: 0.5, ease: WH_EASE });
    }
    if (entry.captionSplit) {
      // Kill the staggered reveal first: its later words would otherwise
      // start after this tween and pull themselves back in.
      gsap.to(entry.captionSplit.lines, {
        yPercent: 110,
        duration: 0.4,
        ease: WH_EASE,
        stagger: 0.03,
        overwrite: true
      });
    }

    undimCloseIcon();
    if (activeLink === link) activeLink = null;
  }

  // Direct listeners per link (not delegated) — each link's preview
  // image sits outside its layout box with pointer-events:none, so
  // bubbling hit-testing could land on the wrong link.
  linkConfigs.forEach((entry, link) => {
    link.addEventListener('mouseenter', () => {
      if (isSettled && !isSettled(link)) return;
      // b132 — never start a hover while the menu is closing/closed.
      if (navEl.getAttribute('data-navigation-status') !== 'active') return;
      if (activeLink && activeLink !== link) leave(activeLink, { keepColors: true });
      enter(link);
    });
    link.addEventListener('mouseleave', () => {
      // Skip entirely while a Barba navigation is in flight (navigatingAway,
      // set in barba.hooks.before, cleared once closeNavForTransition
      // actually runs). disableNavLinkPointerEvents() sets pointer-events:none
      // on every link the instant a navigation starts, and the browser
      // fires a real mouseleave once it recomputes hit-testing for that —
      // letting leave() run here would revert this link's chars and hover
      // color to default while the menu is still visibly open, producing a
      // flash before the transition panel covers the screen. Everything
      // gets reset invisibly by closeNavForTransition() once the screen is
      // actually covered, so there's nothing to do here.
      if (navigatingAway) return;
      // Still needed for the ordinary case: nav closed via the close
      // button/background click/Escape sets data-navigation-status to
      // not-active synchronously in closeNav(), and a mouseleave that
      // arrives after that (same pointer-events:none mechanism) is
      // spurious — skip its roll the same way resetAllLinks's own
      // cleanup does, but still let the color settle back to default
      // since the menu really is closing in that case.
      // The colour theme stays on the last hovered link; it only changes when
      // another link is hovered, and resets to the page default once the menu
      // has closed (see closeNav / onReverseComplete).
      leave(link, { keepColors: true });
    });
  });

  // Closing the menu without a genuine mouseleave (close button, Escape,
  // background click) would otherwise leave the last-hovered link's
  // state stuck.
  function resetAllLinks(opts) {
    const keepColors = !!(opts && opts.keepColors);
    linkConfigs.forEach((entry, link) => leave(link, { keepColors }));
    activeLink = null;
  }

  // Recomputes restBg/restColor from whichever nav link points at the
  // CURRENT page (matched via the link's own .pathname against
  // location.pathname, independent of Barba's w--current/aria-current
  // class sync), then applies them immediately via gsap.set so the nav is
  // already showing the right resting colors whenever it's next opened.
  // Called once on load, and again on every Barba navigation (see
  // barba.hooks.afterEnter).
  function updateNavRestingColors() {
    let matchedConfig = null;
    linkConfigs.forEach((entry, link) => {
      if (matchedConfig) return;
      // Several nav links aren't built out as real pages yet and use a
      // plain "#" (or empty) placeholder href. A same-page/fragment href's
      // .pathname resolves to whatever page you're currently on, which
      // would otherwise false-match every placeholder against every page
      // — skip anything without a real href before comparing paths.
      const href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      if (link.pathname === window.location.pathname) {
        matchedConfig = entry.config;
      }
    });
    restBg = matchedConfig ? matchedConfig.bg : defaultBg;
    restColor = matchedConfig ? matchedConfig.color : null;
    // Don't stomp on an in-progress hover (activeLink set) — that tween
    // owns these properties right now and will itself revert to the new
    // restBg/restColor on its own next leave().
    if (activeLink) return;
    // b156 — kill in-flight revert tweens first: closeNavForTransition's
    // resetAllLinks() starts a 0.5s tween back to the OLD page's resting
    // colour (Home's yellow), which kept running after this gsap.set and
    // overwrote it, so the nav opened on the new page in the old colours.
    gsap.killTweensOf([tileFill, tileCircle].filter(Boolean), 'backgroundColor');
    gsap.killTweensOf(colorTargets, 'color');
    gsap.set(tileFill, { backgroundColor: restBg });
    if (tileCircle) gsap.set(tileCircle, { backgroundColor: restBg });
    colorTargets.forEach((el, i) => {
      gsap.set(el, { color: restColor || defaultColors[i] });
    });
  }
  updateNavRestingColors();

  return { resetAllLinks, linkConfigs, updateNavRestingColors };
}

function initNavButtonCursorClose(navEl) {
  const button = navEl.querySelector('.nav__button');
  const closeIcon = button ? button.querySelector('.nav__button__close') : null;

  // Opacity dim while a nav link is hovered.
  function dimCloseIcon() {
    if (closeIcon) gsap.to(closeIcon, { opacity: 0.4, duration: 0.25, ease: WH_EASE });
  }

  function undimCloseIcon() {
    if (closeIcon) gsap.to(closeIcon, { opacity: 1, duration: 0.25, ease: WH_EASE });
  }

  // Subtle scale-down on hover.
  if (button && closeIcon) {
    button.addEventListener('mouseenter', () => {
      gsap.to(closeIcon, { scale: 0.9, duration: 0.3, ease: WH_EASE });
    });
    button.addEventListener('mouseleave', () => {
      gsap.to(closeIcon, { scale: 1, duration: 0.3, ease: WH_EASE });
    });
  }

  return { dimCloseIcon, undimCloseIcon };
}

// -----------------------------------------
// NAV LOGO (Lottie)
// -----------------------------------------

// The logo is a Webflow Lottie in .nav__logo. Its fills follow currentColor
// (site head CSS), so the colour zones still tint it through .nav__logo's
// own colour. It draws itself in on load and again each time the bar
// returns on scroll up, then rests on frame 0 (blank) while hidden.
function getLottieIn(el) {
  const lottie = Webflow.require('lottie')?.lottie;
  if (!lottie || !el) return null;
  return lottie.getRegisteredAnimations().find(anim => el.contains(anim.wrapper)) || null;
}

function getNavLogoLottie() {
  return getLottieIn(document.querySelector('.logo__main__lottie'));
}

function resetNavLogo() {
  const anim = getNavLogoLottie();
  if (!anim) return;
  anim.loop = false;
  anim.goToAndStop(0, true);
}

let navLogoPlayStart = 0;
function playNavLogo() {
  navLogoPlayStart = performance.now();
  console.log('[logo] play', (new Error().stack || '').split('\n').slice(2, 5).join(' | '));
  const anim = getNavLogoLottie();
  if (!anim) return;
  anim.loop = false;
  anim.setDirection(1);
  anim.goToAndPlay(0, true);
}

// Shows the logo and draws it in from the start — the page transition's
// version of the intro.
function revealNavLogo() {
  const logo = document.querySelector('.nav__logo');
  if (!logo) return;
  gsap.set(logo, { autoAlpha: 1 });
  playNavLogo();
}

function finishNavLogo() {
  const anim = getNavLogoLottie();
  if (anim) anim.goToAndStop(anim.totalFrames - 1, true);
}

// -----------------------------------------
// NAV AUTO-HIDE ON SCROLL
// -----------------------------------------

// .nav__bar (logo + menu button) fades out on scroll down, back in on
// scroll up. Stays put near the very top of the page and while the
// full-screen menu is open. Set up once — nav lives outside the Barba
// container, so it persists across page transitions.
function initNavAutoHide() {
  if (!hasScrollTrigger) return;

  const navEl = document.querySelector('[data-navigation-status]');
  const navBar = document.querySelector('.nav__bar');
  if (!navEl || !navBar) return;

  // b106 — was a scrub: opacity tracked scroll distance 1:1 (fully faded
  // after exactly one bar-height of downward scroll), so it moved in
  // lockstep with the scrollbar rather than reading as an animation.
  // Replaced with a discrete in/out tween instead — direction alone
  // decides visibility, and each change of state plays one fixed-duration
  // fade, the same way the rest of the site's chrome animates.
  let visible = true;
  let lastScroll = 0;
  const SHOW_NEAR_TOP = 100; // always visible this close to the page top
  const DIRECTION_THRESHOLD = 5; // ignores sub-pixel/trackpad jitter

  // Read what is actually on screen rather than trusting the flag, which can
  // fall out of step with the bar's opacity.
  navBarIsVisible = () => {
    if (parseFloat(getComputedStyle(navBar).opacity) > 0.5) {
      visible = true;
      return true;
    }
    return false;
  };
  forceNavBarVisible = () => {
    console.log('[logo] forceNavBarVisible: bar fades in, Lottie replays');
    visible = true;
    navBar.style.pointerEvents = 'auto';
    gsap.to(navBar, { opacity: 1, duration: 0.4, ease: WH_EASE, overwrite: true });
    revealNavLogo();
  };

  function setVisible(next) {
    if (visible === next) return;
    visible = next;
    if (next) playNavLogo();
    gsap.to(navBar, {
      opacity: next ? 1 : 0,
      duration: 0.4,
      ease: WH_EASE,
      overwrite: true,
      onComplete: () => {
        navBar.style.pointerEvents = next ? 'auto' : 'none';
        if (!next) resetNavLogo();
      }
    });
  }

  ScrollTrigger.create({
    // Tagged so afterLeave's page-cleanup sweep (ScrollTrigger.getAll().
    // forEach(kill)) can skip it by id — this trigger is set up once, here,
    // guarded by onceFunctionsInitialized, and never recreated on later
    // transitions (nav lives outside the Barba container, so there's
    // nothing page-specific to re-set-up). Without the exclusion, the very
    // first transition's cleanup killed it along with every page-scoped
    // trigger, and nav auto-hide-on-scroll silently stopped working for
    // the rest of the session.
    id: 'nav-auto-hide',
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      const current = self.scroll();
      const delta = current - lastScroll;
      lastScroll = current;

      // Page transitions reset the scroll; the transition decides what the
      // logo does, not the scroll direction.
      if (navAutoHideSuppressed) return;

      // Full-screen menu open, or barely scrolled — always stay visible.
      if (navEl.getAttribute('data-navigation-status') === 'active' || current < SHOW_NEAR_TOP) {
        setVisible(true);
        return;
      }
      if (delta > DIRECTION_THRESHOLD) setVisible(false);
      else if (delta < -DIRECTION_THRESHOLD) setVisible(true);
    }
  });
}

function initFullScreenNavigation() {
  const navEl = document.querySelector('[data-navigation-status]');
  if (!navEl) return;

  const tileFill = navEl.querySelector('.nav__tile-fill');
  // .nav__tile is the whole overlay panel — set to display:none once
  // fully closed (see closeNav()/onReverseComplete) so links can't stay
  // hit-testable/visible after close, regardless of what else closed it.
  const navTile = navEl.querySelector('.nav__tile');
  const navUl = navEl.querySelector('.nav__ul');
  const navBottom = navEl.querySelector('.nav__bottom');
  const navLogoText = document.querySelector('.nav__logo-text');
  const navLogo = document.querySelector('.nav__logo');
  const navLogoSecondary = navBottom ? navBottom.querySelector('.nav__logo-secondary') : null;
  // Menu logo: presses in slightly on hover, back to full size on hover out.
  if (navLogoSecondary) {
    const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const press = scale => gsap.to(navLogoSecondary, { scale, duration: 0.4, ease: WH_EASE, overwrite: 'auto' });
    navLogoSecondary.addEventListener('mouseenter', () => { if (canHover()) press(0.95); });
    navLogoSecondary.addEventListener('mouseleave', () => press(1));
  }
  const navButton = navEl.querySelector('.nav__button');
  const closeIcon = navButton ? navButton.querySelector('.nav__button__close') : null;
  const menuLabel = navButton ? navButton.querySelector('.nav__button-label') : null;
  const navLinkTextEls = Array.from(navEl.querySelectorAll('.nav__link-text:not(.nav__link-text-alt)'));
  const navLinkEls = navLinkTextEls.map(el => el.closest('.nav__link'));

  const topSecondaryEls = navLogoText ? Array.from(navLogoText.querySelectorAll('.nav__text-secondary')) : [];
  const bottomSecondaryEls = navBottom
    ? Array.from(navBottom.querySelectorAll('.nav__links-secondary .nav__text-secondary'))
    : [];

  const navLinkSplits = typeof SplitText !== "undefined"
    ? navLinkTextEls.map(el => new SplitText(el, {
        type: "lines,words,chars",
        mask: "lines",
        charsClass: "nav-char",
        reduceWhiteSpace: false
      }))
    : [];

  const topSecondarySplits = typeof SplitText !== "undefined"
    ? topSecondaryEls.map(el => new SplitText(el, { type: "lines", mask: "lines" }))
    : [];

  const bottomSecondarySplits = typeof SplitText !== "undefined"
    ? bottomSecondaryEls.map(el => new SplitText(el, { type: "lines", mask: "lines" }))
    : [];

  // Each link only becomes hoverable once its own characters finish —
  // not the whole group — since the first link lands well before the last.
  let navSettled = false;
  const readyLinks = new Set();

  // No-op default so closeNav can close over the real function, assigned
  // further down by initNavLinkHoverEffects.
  let resetLinkHovers = () => {};

  navTimeline = buildNavTimeline({
    tileFill, navUl, navBottom, navLogoText, navLogo, navLogoSecondary,
    navLinkEls, navLinkSplits, topSecondarySplits, bottomSecondarySplits, closeIcon, menuLabel,
    onReady: () => { navSettled = true; },
    onLinkReady: (linkEl) => {
      readyLinks.add(linkEl);
      linkEl.style.pointerEvents = 'auto';
    }
  });

  let dimCloseIcon = () => {};
  let undimCloseIcon = () => {};
  try {
    ({ dimCloseIcon, undimCloseIcon } = initNavButtonCursorClose(navEl));
  } catch (err) {
    console.error('[nav] cursor-close init failed:', err);
  }

  // Opens at normal speed, closes faster (snappier exit than entrance).
  const OPEN_SPEED = 1;
  const CLOSE_SPEED = 1.6;

  function openNav() {
    navSettled = false;
    readyLinks.clear();
    if (navLinkEls) {
      navLinkEls.forEach(el => { if (el) el.style.pointerEvents = 'none'; });
    }
    if (navTile) navTile.style.display = '';
    // b132 — menu fully interactive again (closeNav makes the whole tile inert).
    if (navTile) navTile.style.pointerEvents = '';
    navEl.setAttribute('data-navigation-status', 'active');
    if (lenis && typeof lenis.stop === "function") lenis.stop();
    if (navLogo) gsap.to(navLogo, { autoAlpha: 0, duration: 0.3, ease: WH_EASE, overwrite: 'auto' });
    navTimeline.timeScale(OPEN_SPEED).play();
  }

  function closeNav(keepColors) {
    // keepColors === true only from closeNavAnimated (event listeners pass an Event).
    navSettled = false;
    readyLinks.clear();
    // Plain writes, not gsap.set — pointer-events isn't a tracked
    // timeline property, so this sticks immediately through the reverse.
    if (navLinkEls) {
      navLinkEls.forEach(el => { if (el) el.style.pointerEvents = 'none'; });
    }
    // b132 — whole menu inert while it closes, so a link can't be hovered
    // (or clicked) on the way out.
    if (navTile) navTile.style.pointerEvents = 'none';
    // Colours are left as they are while the menu closes, then snapped back
    // to the page's default theme once it's hidden (onReverseComplete).
    resetLinkHovers({ keepColors: true });
    navEl.setAttribute('data-navigation-status', 'not-active');
    // The menu logo fades shortly after the close starts, ahead of the rest.
    if (navLogoSecondary) {
      gsap.to(navLogoSecondary, {
        autoAlpha: 0,
        duration: 0.5,
        delay: 0.2,
        ease: WH_EASE,
        overwrite: 'auto',
        onComplete: () => {
          const anim = getLottieIn(navLogoSecondary);
          if (anim) { anim.loop = false; anim.goToAndStop(0, true); }
        }
      });
    }
    // A close for a page transition leaves the logo hidden; the incoming
    // page plays it in (see revealNavLogo).
    if (navLogo && keepColors !== true) {
      gsap.to(navLogo, {
        autoAlpha: 1,
        duration: 0.3,
        ease: WH_EASE,
        delay: Math.max(0, navTimeline.duration() / CLOSE_SPEED - 0.3),
        overwrite: 'auto'
      });
    }
    navTimeline.timeScale(CLOSE_SPEED).reverse();
  }

  // Lenis restarts and display:none only once the close has actually
  // finished — not set inside closeNav(), which would cut it off mid-flight.
  navTimeline.eventCallback("onReverseComplete", () => {
    if (navTile) navTile.style.display = 'none';
    updateNavRestingColors();
    if (lenis && typeof lenis.start === "function") lenis.start();
  });

  // b131 — promise-returning close used by the Barba transition.
  closeNavAnimated = () => new Promise(resolve => {
    if (navEl.getAttribute('data-navigation-status') !== 'active') return resolve();
    const prev = navTimeline.eventCallback('onReverseComplete');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      navTimeline.eventCallback('onReverseComplete', prev);
      resolve();
    };
    navTimeline.eventCallback('onReverseComplete', () => { if (prev) prev(); finish(); });
    closeNav(true);
    if (navTimeline.progress() === 0) finish();
    setTimeout(finish, 2500); // safety net
  });

  // Toggle Navigation
  document.querySelectorAll('[data-navigation-toggle="toggle"]').forEach(toggleBtn => {
    toggleBtn.addEventListener('click', () => {
      const isActive = navEl.getAttribute('data-navigation-status') === 'active';
      isActive ? closeNav() : openNav();
    });
  });

  // Close Navigation
  document.querySelectorAll('[data-navigation-toggle="close"]').forEach(closeBtn => {
    closeBtn.addEventListener('click', closeNav);
  });

  // Clicking the background itself (not a link) also closes the nav.
  if (tileFill) {
    tileFill.addEventListener('click', closeNav);
  }

  // Key ESC - Close Navigation
  document.addEventListener('keydown', e => {
    if (e.keyCode === 27 && navEl.getAttribute('data-navigation-status') === 'active') {
      closeNav();
    }
  });

  try {
    const hoverEffects = initNavLinkHoverEffects(dimCloseIcon, undimCloseIcon, (link) => readyLinks.has(link), navLinkEls, navLinkSplits);
    if (hoverEffects && hoverEffects.resetAllLinks) resetLinkHovers = hoverEffects.resetAllLinks;
    if (hoverEffects && hoverEffects.updateNavRestingColors) updateNavRestingColors = hoverEffects.updateNavRestingColors;
    // Diagnostic only — see .
    window.__navDebug = {
      navLinkEls, navLinkSplits, navTimeline,
      linkConfigs: hoverEffects && hoverEffects.linkConfigs
    };
  } catch (err) {
    console.error('[nav] link hover effects init failed:', err);
  }

  // Set only now — everything above needed the tile actually laid out
  // (display:none makes children measure as zero-size).
  if (navTile) navTile.style.display = 'none';

  // Split into an immediate half (just pointer-events, so nothing in the
  // still-visually-open menu can be interacted with mid-transition) and a
  // deferred half (the actual visual close — display:none, navTimeline/
  // char reset, hover-state cleanup). barba.hooks.before calls the
  // immediate half only; the deferred half is called from the leave
  // timeline's onComplete instead, once the transition panel has actually
  // covered the screen — see closeNavForTransition's comment.
  disableNavLinkPointerEvents = () => {
    if (navTile) navTile.style.pointerEvents = 'none';
    if (navLinkEls) {
      navLinkEls.forEach(el => { if (el) el.style.pointerEvents = 'none'; });
    }
  };
  forceResetNavLinks = () => {
    disableNavLinkPointerEvents();
    if (navTile) navTile.style.display = 'none';
    resetLinkHovers();
  };
}

// -----------------------------------------
// BUNNY BACKGROUND VIDEO — PERSISTENCE ("PARKING")
// -----------------------------------------

// A player tagged data-bunny-persist="true" (with a stable data-bunny-id)
// survives Barba transitions instead of being torn down and rebuilt from
// scratch on every visit. Two separate moments matter here, and the first
// attempt at this conflated them:
//
//   1. WARM it — force playback and permanently drop its own
//      IntersectionObserver — right at the very start of a transition
//      (barba.hooks.before), before anything else has moved. Left alone,
//      that observer sees the player's box do odd things mid-transition,
//      pauses it, and nothing is left watching afterwards to notice it
//      should resume — the observer was the only thing that would have
//      restarted it, and it's the thing most likely to misfire once the
//      element's being shuffled around the DOM.
//   2. MOVE it — out to the park host, or straight into a new page's
//      matching placeholder — only once the transition panel has fully
//      covered the screen (the leave timeline's onComplete, right next
//      to the existing current.remove()), never earlier. Reparenting it
//      while the outgoing hero is still visible means the user watches
//      the video vanish out of the page for a moment.
//
// Playback is always resumed explicitly wherever the player lands
// (resumePersistentPlayer), not left for the (now-disconnected)
// IntersectionObserver to notice on its own.
let bunnyParkHost = null;
const parkedBunnyPlayers = new Map(); // data-bunny-id -> player element

function getBunnyParkHost() {
  if (bunnyParkHost) return bunnyParkHost;

  // A real, Designer-authored element (.video-park) living in the Global
  // component — the same persistent-chrome component the nav and
  // transition panel live in, rendered as a sibling of .main-wrapper
  // (the actual data-barba="container" element) inside .page-wrapper.
  // Barba only ever swaps out .main-wrapper's contents, so anything
  // outside it — this element included — is untouched by every
  // transition and never needs to be created or reattached at runtime.
  //
  // This replaces an earlier version that built the park host as a bare
  // JS-created <div> appended to document.body. Functionally it was also
  // outside the Barba container, but being outside the site's own CSS
  // authorship meant the parked player's descendants could lose
  // inherited context (custom properties, cascade from ancestor
  // Webflow classes) that they get for free sitting inside real
  // Designer markup — a plausible source of the sizing/scale glitches
  // chased through several earlier builds. Landing in the genuine
  // .video-park element removes that variable entirely.
  var real = document.querySelector('.video-park');
  if (real) {
    bunnyParkHost = real;
    return bunnyParkHost;
  }

  // Defensive fallback only — shouldn't be hit once .video-park exists
  // in the Global component on every page.
  bunnyParkHost = document.createElement('div');
  bunnyParkHost.setAttribute('aria-hidden', 'true');
  bunnyParkHost.style.cssText =
    'position:fixed;top:0;left:0;width:100vw;height:100vh;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;';
  document.body.appendChild(bunnyParkHost);
  return bunnyParkHost;
}

// barba.hooks.before — cuts every persistent player loose from its own
// IntersectionObserver and makes sure it's actually playing, before the
// transition (and any reparenting) starts.
function warmBunnyPlayers(scope) {
  (scope || document).querySelectorAll('[data-bunny-persist="true"]').forEach(function(player) {
    if (player._io) { try { player._io.disconnect(); } catch(_) {} player._io = null; }
    resumePersistentPlayer(player);
  });
}

// A player parked out of view for a while can sit with video.paused ===
// false the entire time — the browser just freezes its actual frame
// decode while the element is offscreen/invisible (opacity:0 inside the
// park host), without ever calling .pause(). Because paused stays false,
// a plain `if (video.paused) video.play()` guard is a no-op here: there's
// nothing to "resume" as far as the browser is concerned, so decode stays
// frozen until the browser's own visibility heuristics decide on their
// own to un-throttle it — which in practice was only once the transition
// panel had fully cleared and the element was genuinely composited on
// screen. That showed up as the video sitting frozen on one frame for
// up to a second after it was already visible, only actually starting to
// move once the transition had fully gone away.
//
// Unconditionally cycling pause()/play() (regardless of the reported
// paused state) forces the browser to actually re-evaluate and resume
// decode right away, rather than waiting on it to notice by itself.
function nudgeVideoPlayback(video) {
  if (!video) return;
  try {
    video.pause();
    var p = video.play();
    if (p && typeof p.then === 'function') p.catch(function(){});
  } catch (_) {}
}

// Explicit resume + status sync — used both right after warming and
// right after every reparent, rather than trusting the (deliberately
// disconnected) IntersectionObserver to notice and restart playback.
//
// Forcing data-player-status to "playing" synchronously here used to hide
// the poster (.bunny-bg__placeholder, which fades on that status via CSS)
// before the browser had actually resumed rendering real frames — that
// gap showed as a flash of nothing between the poster disappearing and
// the video catching up. Now we only flip the status once we have real
// evidence of playback (a 'timeupdate' tick), with a short fallback
// timeout for browsers where that's slow to fire, so the poster keeps
// covering the player until there's an actual frame underneath it.
function resumePersistentPlayer(player) {
  var video = player.querySelector('video');
  if (!video) return;

  player.setAttribute('data-player-activated', 'true');

  var markPlaying = function() {
    player.setAttribute('data-player-status', 'playing');
  };

  nudgeVideoPlayback(video);

  video.addEventListener('timeupdate', markPlaying, { once: true });
  setTimeout(markPlaying, 250);
}

// Reparenting a <video> (moving it to a new DOM parent) rebuilds its
// compositing surface — the browser has to re-establish the paint/layer
// pipeline for it — which costs a handful of frames that render as
// nothing, or a stale/soft-looking frame, before a fresh sharp frame
// lands. Timing heuristics (waiting a bit, waiting for 'timeupdate')
// can't fully hide that gap. Instead, grab a still of exactly what the
// video looks like right before the move, and paper over the gap with
// that real frame until the browser confirms a genuinely new one has
// painted — ported from the same bridge used for Finlay Woods' hero
// video, which has no visible hiccup across a transition.
function captureBunnyFrame(player) {
  var video = player.querySelector('video');
  if (!video || !video.videoWidth) return null;
  try {
    var pRect = player.getBoundingClientRect();
    var c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c;
  } catch (_) {
    return null;
  }
}

// Lays the captured frame over the player and takes it down the moment a
// real frame has actually painted — via requestVideoFrameCallback where
// it's available, a double rAF otherwise, with a timeout backstop in
// case neither fires promptly.
//
// The captured still is painted as a CSS `background-image` on a plain
// div (via canvas.toDataURL()) rather than rendered as the `<canvas>`
// element itself sized with `object-fit: cover`. object-fit support on
// canvas is inconsistent — where it isn't honoured, a canvas stretches
// to `fill` its box instead of cropping, which is what was showing as
// "zoomed in": a 1280x720 capture stretched to fill a wider hero box
// distorts and reads as zoomed rather than cleanly cropped.
// `background-size: cover` is the well-supported CSS equivalent of the
// video's own object-fit: cover crop, so the bridge frame lines up with
// it exactly.
function attachBunnyFrameBridge(player, canvas, video) {
  var bridge = null;
  var revealed = false;
  var revealScheduledAt = performance.now();
  var reveal = function() {
    if (revealed) return;
    revealed = true;
    var revealRect = player.getBoundingClientRect();
    var liveVideo = video;
    player.setAttribute('data-player-status', 'playing');
    if (bridge && bridge.parentNode) bridge.parentNode.removeChild(bridge);
  };

  if (canvas) {
    var attachRect = player.getBoundingClientRect();
    var dataUrl;
    try {
      dataUrl = canvas.toDataURL();
    } catch (_) {
      dataUrl = null;
    }
    if (dataUrl) {
      bridge = document.createElement('div');
      bridge.setAttribute('aria-hidden', 'true');
      bridge.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;' +
        'background-image:url(' + dataUrl + ');background-size:cover;background-position:center;' +
        'z-index:2;pointer-events:none;';
      player.appendChild(bridge);
    }
  }

  if (video && 'requestVideoFrameCallback' in video) {
    video.requestVideoFrameCallback(reveal);
  } else {
    requestAnimationFrame(function() { requestAnimationFrame(reveal); });
  }

  setTimeout(reveal, 400);
}

// Resume + bridge for a player that just got moved (placeholder swap or
// park reclaim) — as opposed to resumePersistentPlayer, which is for a
// player that's staying put (the initial warm).
function resumeReparentedPlayer(player, capturedFrame) {
  var video = player.querySelector('video');
  player.setAttribute('data-player-activated', 'true');

  nudgeVideoPlayback(video);

  attachBunnyFrameBridge(player, capturedFrame, video);
}

// Called from the leave timeline's onComplete (screen already covered):
// hands each persistent player in the outgoing container straight to a
// matching placeholder in the incoming one if it has it, otherwise parks
// it out of the way until a later page wants it. Also reclaims, in this
// SAME callback, any persistent player that's already sitting in the
// park host and that the incoming page has a placeholder for — the
// Home → Orchards → Home case, where the video was never inside the
// page that's actually leaving on this leg.
//
// This mirrors Finlay Woods exactly: it parks and re-homes the video
// from one place, the leave timeline's onComplete, rather than splitting
// the re-home out into barba's beforeEnter hook. Finlay Woods' code has
// an explicit warning about that split, which is exactly the bug this
// fixes: with `sync: true` transitions (which this site also uses),
// beforeEnter fires in parallel with leave and isn't guaranteed to run
// only once the shutters/panel have actually finished covering the
// screen — so a player reclaimed there could still get caught mid-move
// while technically visible, which is what was showing as a flash of a
// stale, wrongly-scaled frame. Reclaiming here instead is safe on two
// counts: this callback only runs once the leave timeline has fully
// completed (panel confirmed closed), and `next` is still sitting at
// autoAlpha:0 at this point regardless (see runPageLeaveAnimation/
// runPageEnterAnimation), so the swap is invisible either way.
function reparentBunnyPlayers(current, next) {

  if (current) {
    current.querySelectorAll('[data-bunny-persist="true"][data-bunny-id]').forEach(function(player) {
      var id = player.getAttribute('data-bunny-id');
      if (!id) return;

      var placeholder = next
        ? next.querySelector('[data-bunny-background-init][data-bunny-id="' + id + '"]')
        : null;

      if (placeholder) {
        // Grab the frame before the move rebuilds the video's compositing
        // surface and blanks/blurs it for a beat.
        var frame = captureBunnyFrame(player);
        placeholder.replaceWith(player);
        resumeReparentedPlayer(player, frame);
      } else {
        // Parking doesn't need a bridge — the park host is already
        // invisible (opacity:0) — so just resume it in place.
        getBunnyParkHost().appendChild(player);
        parkedBunnyPlayers.set(id, player);
        resumePersistentPlayer(player);
      }
    });
  }

  if (next) {
    var reclaimCandidates = next.querySelectorAll('[data-bunny-persist="true"][data-bunny-background-init]');
    reclaimCandidates.forEach(function(placeholder) {
      var ok = reclaimParkedBunnyPlayer(placeholder);
    });
  }
}

// Pulls a parked player back out of the park host into a matching
// placeholder. Called from reparentBunnyPlayers (the leave timeline's
// onComplete — the normal path) and again, as a backstop, from
// initBunnyPlayerBackground during afterEnter in case anything ever
// leaves the park host unclaimed — by then it'll just find nothing left
// to do.
function reclaimParkedBunnyPlayer(placeholder) {
  var id = placeholder.getAttribute('data-bunny-id');
  if (!id) return false;
  var parked = parkedBunnyPlayers.get(id);
  if (!parked) return false;

  var frame = captureBunnyFrame(parked);

  placeholder.replaceWith(parked);
  parkedBunnyPlayers.delete(id);
  // A preloaded player was pinned to its best rendition while parked; hand
  // quality control back to adaptive bitrate now it's on screen. Anything
  // already buffered stays as it is.
  if (parked.hasAttribute('data-bunny-preload')) {
    parked.removeAttribute('data-bunny-preload');
    if (parked._hls) parked._hls.nextLevel = -1;
  }
  resumeReparentedPlayer(parked, frame);
  return true;
}

// Lowest rendition the background video is allowed to play.
const BG_MIN_HEIGHT = 480;
// Rendition the video starts on (the first one at least this tall, or the
// tallest there is). Adaptive bitrate takes over after the first segment.
const BG_START_HEIGHT = 720;
// A parked/preloaded video isn't on screen yet, so it loads at the best
// rendition up to this height instead of climbing from the minimum.
const BG_PRELOAD_MAX_HEIGHT = 1080;
// How much of the clip hls.js may hold, in seconds and bytes (the defaults
// are 30s / 60MB, which a longer or high-bitrate clip would hit).
const BG_BUFFER_SECONDS = 180;
const BG_BUFFER_BYTES = 250 * 1000 * 1000;

function initBunnyPlayerBackground(scope) {
  (scope || document).querySelectorAll('[data-bunny-background-init]').forEach(function(player) {
    // A persistent player parked from a previous page takes over this
    // placeholder instead of being reinitialized from scratch.
    if (player.getAttribute('data-bunny-persist') === 'true' && reclaimParkedBunnyPlayer(player)) {
      return;
    }

    // Guard against re-initializing across Barba transitions.
    if (player._bunnyInitialized) return;
    player._bunnyInitialized = true;

    var src = player.getAttribute('data-player-src');
    if (!src) return;

    var video = player.querySelector('video');
    if (!video) return;

    try { video.pause(); } catch(_) {}
    try { video.removeAttribute('src'); video.load(); } catch(_) {}

    // Attribute helpers
    function setStatus(s) {
      if (player.getAttribute('data-player-status') !== s) {
        player.setAttribute('data-player-status', s);
      }
    }
    function setActivated(v) { player.setAttribute('data-player-activated', v ? 'true' : 'false'); }
    if (!player.hasAttribute('data-player-activated')) setActivated(false);

    // Flags
    var lazyMode   = player.getAttribute('data-player-lazy'); // "true" | "false" (no meta)
    var isLazyTrue = lazyMode === 'true';
    var autoplay   = player.getAttribute('data-player-autoplay') === 'true';
    var initialMuted = player.getAttribute('data-player-muted') === 'true';

    // Used to suppress 'ready' flicker when user just pressed play in lazy modes
    var pendingPlay = false;

    // Autoplay forces muted + loop; IO will drive play/pause
    if (autoplay) { video.muted = true; video.loop = true; }
    else { video.muted = initialMuted; }

    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.playsInline = true;
    if (typeof video.disableRemotePlayback !== 'undefined') video.disableRemotePlayback = true;
    if (autoplay) video.autoplay = false;

    var canPlayNativeHls = !!video.canPlayType('application/vnd.apple.mpegurl');
    var preferNativeHls = canPlayNativeHls && 'ManagedMediaSource' in window;
    var canUseHlsJs = !!(window.Hls && Hls.isSupported()) && !preferNativeHls;

    // Attach media only once (for actual playback)
    var isAttached = false;
    var userInteracted = false;
    var lastPauseBy = ''; // 'io' | 'manual' | ''
    function attachMediaOnce() {
      if (isAttached) return;
      isAttached = true;

      if (player._hls) { try { player._hls.destroy(); } catch(_) {} player._hls = null; }

      if (preferNativeHls) {
        video.preload = isLazyTrue ? 'none' : 'auto';
        video.src = src;
        video.addEventListener('loadedmetadata', function() {
          readyIfIdle(player, pendingPlay);
        }, { once: true });
      } else if (canUseHlsJs) {
        // A short looping background fits entirely in the buffer: allow it to
        // load the whole clip, and keep the back buffer so the opening
        // segments aren't evicted (which makes a loop stall after a pass or
        // two, and means a return visit re-downloads them).
        var hls = new Hls({
          maxBufferLength: BG_BUFFER_SECONDS,
          maxMaxBufferLength: BG_BUFFER_SECONDS,
          maxBufferSize: BG_BUFFER_BYTES,
          backBufferLength: Infinity
        });
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, function() { hls.loadSource(src); });
        hls.on(Hls.Events.MANIFEST_PARSED, function() {
          // Never play below BG_MIN_HEIGHT. Chosen by height so it survives a
          // change to which renditions the library encodes.
          var minIdx = -1;
          for (var i = 0; i < hls.levels.length; i++) {
            if (hls.levels[i].height >= BG_MIN_HEIGHT) { minIdx = i; break; }
          }
          // Preloaded while parked behind another page: nobody is watching it
          // load, so fetch the best rendition straight away and keep it pinned
          // until the player is handed back (see reclaimParkedBunnyPlayer).
          if (player.hasAttribute('data-bunny-preload')) {
            var bestIdx = -1;
            for (var j = 0; j < hls.levels.length; j++) {
              if (hls.levels[j].height <= BG_PRELOAD_MAX_HEIGHT && (bestIdx < 0 || hls.levels[j].height >= hls.levels[bestIdx].height)) bestIdx = j;
            }
            if (bestIdx > -1) {
              hls.startLevel = bestIdx;
              hls.nextLevel = bestIdx;
              readyIfIdle(player, pendingPlay);
              return;
            }
          }
          if (minIdx > -1) {
            // Adaptive bitrate skips every level under this bitrate...
            hls.config.minAutoBitrate = hls.levels[minIdx].bitrate;
            // ...and the first segment is pinned to the start rendition, then
            // released so the player can still adapt. nextLevel switches ABR
            // off while set.
            var startIdx = minIdx;
            for (var k = 0; k < hls.levels.length; k++) {
              if (hls.levels[k].height >= BG_START_HEIGHT) { startIdx = k; break; }
              if (hls.levels[k].height > hls.levels[startIdx].height) startIdx = k;
            }
            hls.startLevel = startIdx;
            hls.nextLevel = startIdx;
            hls.once(Hls.Events.FRAG_BUFFERED, function() { hls.nextLevel = -1; });
          }
          readyIfIdle(player, pendingPlay);
        });
        player._hls = hls;
      } else {
        video.src = src;
      }
    }

    // Initialize based on lazy mode
    if (isLazyTrue) {
      video.preload = 'none';
    } else {
      attachMediaOnce();
    }

    // Toggle play/pause
    function togglePlay() {
      userInteracted = true;
      if (video.paused || video.ended) {
        if (isLazyTrue && !isAttached) attachMediaOnce();
        pendingPlay = true;
        lastPauseBy = '';
        setStatus('loading');
        safePlay(video);
      } else {
        lastPauseBy = 'manual';
        video.pause();
      }
    }

    // Toggle mute
    function toggleMute() {
      video.muted = !video.muted;
      player.setAttribute('data-player-muted', video.muted ? 'true' : 'false');
    }

    // Controls (delegated)
    player.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-player-control]');
      if (!btn || !player.contains(btn)) return;
      var type = btn.getAttribute('data-player-control');
      if (type === 'play' || type === 'pause' || type === 'playpause') togglePlay();
      else if (type === 'mute') toggleMute();
    });

    // Media event wiring
    video.addEventListener('play', function() { setActivated(true); setStatus('playing'); });
    video.addEventListener('playing', function() { pendingPlay = false; setStatus('playing'); });
    video.addEventListener('pause', function() { pendingPlay = false; setStatus('paused'); });
    video.addEventListener('waiting', function() { setStatus('loading'); });
    video.addEventListener('canplay', function() { readyIfIdle(player, pendingPlay); });
    video.addEventListener('ended', function() { pendingPlay = false; setStatus('paused'); setActivated(false); });

    // In-view auto play/pause (only when autoplay is true)
    if (autoplay) {
      if (player._io) { try { player._io.disconnect(); } catch(_) {} }
      var io = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          var inView = entry.isIntersecting && entry.intersectionRatio > 0;
          if (inView) {
            if (isLazyTrue && !isAttached) attachMediaOnce();
            if ((lastPauseBy === 'io') || (video.paused && lastPauseBy !== 'manual')) {
              setStatus('loading');
              if (video.paused) togglePlay();
              lastPauseBy = '';
            }
          } else {
            if (!video.paused && !video.ended) {
              lastPauseBy = 'io';
              video.pause();
            }
          }
        });
      }, { threshold: 0.1 });
      io.observe(player);
      player._io = io;
    }
  });

  // Helper: Ready status guard
  function readyIfIdle(player, pendingPlay) {
    if (!pendingPlay &&
        player.getAttribute('data-player-activated') !== 'true' &&
        player.getAttribute('data-player-status') === 'idle') {
      player.setAttribute('data-player-status', 'ready');
    }
  }

  // Helper: safe programmatic play
  function safePlay(video) {
    var p = video.play();
    if (p && typeof p.then === 'function') p.catch(function(){});
  }
}

// Tears down HLS.js instances and IntersectionObservers for players in
// scope, called on the outgoing page's container right after Barba
// removes it. Persistent players (data-bunny-persist="true") are already
// moved out by this point (see reparentBunnyPlayers, called from the
// leave timeline's onComplete) and so won't be found here — the guard
// below is just a defensive backstop in case that didn't happen.
function destroyBunnyPlayers(scope) {
  (scope || document).querySelectorAll('[data-bunny-background-init]').forEach(function(player) {
    if (player.getAttribute('data-bunny-persist') === 'true') return;
    if (player._hls) { try { player._hls.destroy(); } catch(_) {} player._hls = null; }
    if (player._io) { try { player._io.disconnect(); } catch(_) {} player._io = null; }
    var video = player.querySelector('video');
    if (video) { try { video.pause(); } catch(_) {} }
  });
}

// -----------------------------------------
// ANIMATED GRID OVERLAY
// -----------------------------------------

function initAnimatedGrid() {
  const grid = document.querySelector("[data-animated-grid]");
  const cols = document.querySelectorAll("[data-animated-grid-col]");
  const toggles = document.querySelectorAll("[data-animated-grid-toggle]");

  if (!grid || !cols.length) return;

  const storageKey = "animatedGridState";
  let isOpen = localStorage.getItem(storageKey) === "open";

  gsap.set(grid, { display: "block" });

  if (isOpen) {
    gsap.set(cols, { yPercent: 0 });
  } else {
    gsap.set(cols, { yPercent: 100 });
  }

  function openGrid() {
    isOpen = true;
    localStorage.setItem(storageKey, "open");

    gsap.fromTo(cols, {
      yPercent: 100,
    }, {
      yPercent: 0,
      duration: 1,
      ease: WH_EASE,
      stagger: { each: 0.03, from: "start" },
      overwrite: true
    });
  }

  function closeGrid() {
    isOpen = false;
    localStorage.setItem(storageKey, "closed");

    gsap.fromTo(cols, {
      yPercent: 0,
    }, {
      yPercent: -100,
      duration: 1,
      ease: WH_EASE,
      stagger: { each: 0.03, from: "start" },
      overwrite: true
    });
  }

  function toggleGrid() {
    if (isOpen) closeGrid();
    else openGrid();
  }

  function isTypingContext(e) {
    const el = e.target;
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
  }

  toggles.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleGrid();
    });
  });

  window.addEventListener("keydown", (e) => {
    if (isTypingContext(e)) return;
    if (!(e.shiftKey && (e.key || "").toLowerCase() === "g")) return;
    e.preventDefault();
    toggleGrid();
  });
}

// -----------------------------------------
// GLOBAL PARALLAX
// -----------------------------------------

let globalParallaxMM = null;

function initGlobalParallax(scope) {
  // Revert the previous page's context first, so transitions don't
  // stack up duplicate resize listeners/ScrollTriggers.
  if (globalParallaxMM) {
    globalParallaxMM.revert();
    globalParallaxMM = null;
  }

  const root = scope || document;
  const mm = gsap.matchMedia();
  globalParallaxMM = mm;

  mm.add({
    isMobile: '(max-width: 479px)',
    isMobileLandscape: '(max-width: 767px)',
    isTablet: '(max-width: 991px)',
    isDesktop: '(min-width: 992px)'
  }, (context) => {
    const { isMobile, isMobileLandscape, isTablet } = context.conditions;

    const ctx = gsap.context(() => {
      root.querySelectorAll('[data-parallax="trigger"]').forEach((trigger) => {
        // Gallery slides move only with the slider's own drag, not with page scroll.
        if (trigger.hasAttribute('data-parallax-inner')) return;
        const disable = trigger.getAttribute('data-parallax-disable');

        if (
          (disable === 'mobile' && isMobile) ||
          (disable === 'mobileLandscape' && isMobileLandscape) ||
          (disable === 'tablet' && isTablet)
        ) return;

        const target = trigger.querySelector('[data-parallax="target"]') || trigger;
        const direction = trigger.getAttribute('data-parallax-direction') || 'vertical';
        const horizontal = direction === 'horizontal';
        const prop = horizontal ? 'x' : 'y';

        const scrubAttr = trigger.getAttribute('data-parallax-scrub');
        const startAttr = trigger.getAttribute('data-parallax-start');
        const endAttr = trigger.getAttribute('data-parallax-end');

        const scrub = scrubAttr !== null ? parseFloat(scrubAttr) : true;

        // Default travel fits the image exactly: the target is taller than its
        // block (e.g. 110%), so the drift runs from the image's top edge
        // flush with the block's top to its bottom edge flush with the
        // block's bottom, showing the whole image and never exposing a gap.
        // Measured from layout (transform cleared) so it holds at any size.
        // data-parallax-start/-end (in % of the target) still override it.
        const fitTravel = () => {
          const previous = target.style.transform;
          target.style.transform = 'none';
          const t = target.getBoundingClientRect();
          const b = trigger.getBoundingClientRect();
          target.style.transform = previous;
          const size = horizontal ? t.width : t.height;
          const box = horizontal ? b.width : b.height;
          const offset = horizontal ? t.left - b.left : t.top - b.top;
          return { from: -offset, to: box - size - offset };
        };
        const startVal = startAttr !== null ? () => (parseFloat(startAttr) / 100) * (horizontal ? target.offsetWidth : target.offsetHeight) : () => fitTravel().from;
        const endVal = endAttr !== null ? () => (parseFloat(endAttr) / 100) * (horizontal ? target.offsetWidth : target.offsetHeight) : () => fitTravel().to;

        const scrollStart = `clamp(${trigger.getAttribute('data-parallax-scroll-start') || 'top bottom'})`;
        const scrollEnd = `clamp(${trigger.getAttribute('data-parallax-scroll-end') || 'bottom top'})`;

        // b118 — scale now scrubs continuously alongside yPercent/xPercent,
        // same scrollTrigger, same progress — a steady zoom-out tied to
        // scroll position, not just a one-off at entrance (that's
        // prepareImageReveal/activateImageReveal's job: the rise+blur+fade,
        // which still fires once; scale moved out of there to avoid two
        // tweens fighting over the same property on the same element).
        const scaleStartAttr = trigger.getAttribute('data-parallax-scale-start');
        const scaleEndAttr = trigger.getAttribute('data-parallax-scale-end');
        const scaleStart = scaleStartAttr !== null ? parseFloat(scaleStartAttr) : 1;
        const scaleEnd = scaleEndAttr !== null ? parseFloat(scaleEndAttr) : 1;

        gsap.fromTo(target, {
          [prop]: startVal,
          scale: scaleStart
        }, {
          [prop]: endVal,
          scale: scaleEnd,
          ease: 'none',
          scrollTrigger: {
            trigger,
            start: scrollStart,
            end: scrollEnd,
            scrub,
            invalidateOnRefresh: true
          }
        });
      });
    });

    return () => ctx.revert();
  });
}

// -----------------------------------------
// DISPLAY-LARGE / DISPLAY-MEDIUM SCROLL REVEAL
// -----------------------------------------

// b110/b111/b112/b113/b114 — standardized to a plain rise + blur + opacity
// fade (move up 0.5em, blur(BLUR_PX) -> blur(0), opacity 0 -> 1), per LINE,
// unmasked (b114 dropped the `mask: "lines"` overflow-hidden wrapper —
// was per word in b111, chars with a rotateY flip before that). Kept
// separate from NAV_CHAR_ANIM so changing one doesn't affect the other.
// Covers both .text-display-large and .text-display-medium. b112 —
// quicker: travel halved to 0.5em, duration cut from 1.2s to 0.7s, stagger
// tightened from 0.025 to 0.018.
const DISPLAY_LARGE_ANIM = {
  travelEm: 0.5,
  // b129 — rise for the big hero headings only (they're 144-160px, so 0.5em = 72-80px, far more than body text). Before b128 the hero's rise was converted too early on a fresh load and came out ~1px, so refresh looked subtle while Barba showed the full 0.5em. Tune this one number.
  headingTravelEm: 0.2,
  headingStagger: 0.12, // between heading lines, so two-line titles land one after the other
  blurPx: 0, // b134 — blur removed from all text/image/sticker reveals (no filter is applied any more)
  duration: 0.7,
  stagger: 0.05,
  ease: WH_EASE
};

// Same prepare/activate split as prepareLineReveal/activateLineReveal, and
// for the same reason — see that comment.
//
// Orchards/Packhouse (and any similar page) split a single heading across
// TWO separate .text-display-large/-medium elements, one per line, each
// wrapped in its own .display__title__line inside a shared
// .hero__secondary__title__wrap. Every line sharing that wrapper is
// grouped into a single ScrollTrigger (triggered off the wrapper itself,
// so it fires based on where the whole heading sits, not just the first
// line) driving one continuous stagger across every line in DOM
// order — otherwise each line would only start once it individually
// crossed the viewport threshold, reading as two unrelated reveals
// instead of one heading. A heading with no such wrapper still gets its
// own group of one, triggered off itself.
const DISPLAY_LARGE_GROUP_SELECTOR = '.hero__secondary__title__wrap';

function prepareDisplayLargeReveal(scope) {
  if (typeof SplitText === "undefined" || typeof ScrollTrigger === "undefined") {
    heroTitleGroups = new Map();
    return [];
  }

  const targets = (scope || document).querySelectorAll('.text-display-large, .text-display-medium');
  const groups = [];
  const groupByWrap = new Map();

  targets.forEach(el => {
    // b114 — no line mask: animates whole lines directly, unclipped (the
    // rise+blur+opacity fade reads fine without the overflow-hidden mask,
    // and it let the blur get clipped at the mask edge).
    const split = new SplitText(el, {
      type: "lines",
      reduceWhiteSpace: false
    });
    gsap.set(split.lines, {
      opacity: 0,
      y: `${DISPLAY_LARGE_ANIM.headingTravelEm}em`,
    });

    const wrap = el.closest(DISPLAY_LARGE_GROUP_SELECTOR);
    if (wrap) {
      let group = groupByWrap.get(wrap);
      if (!group) {
        group = { trigger: wrap, splits: [] };
        groupByWrap.set(wrap, group);
        groups.push(group);
      }
      group.splits.push(split);
    } else {
      groups.push({ trigger: el, splits: [split] });
    }
  });

  // Record which .section__hero__content each group belongs to (null if
  // none), and index groups that DO belong to one in heroTitleGroups so
  // prepareLineReveal (called right after this) can tell whether the
  // hero's own intro paragraph should be tagged for activateDisplayLargeReveal
  // to fire. Rebuilt from scratch on every navigation — stale entries from
  // the previous page must not leak forward.
  //
  // .section__hero__content isn't actually scoped to just the hero — on
  // Orchards/Packhouse/Our Story it's the single outer <section id="about">
  // wrapping the entire page's content, since it's the shared Webflow class
  // used for section padding, not a "this is the hero" marker. Also record
  // introWrap — the FIRST .hero__secondary__content__wrap inside the hero
  // section, which is always the true intro block — so prepareLineReveal
  // can scope its match down to just that wrap instead of the whole
  // page-wide section (without this, every [data-line-reveal] anywhere on
  // the page gets swept into firing early alongside the title).
  heroTitleGroups = new Map();
  groups.forEach(group => {
    const heroSection = group.trigger.closest && group.trigger.closest('.section__hero__content');
    group.heroSection = heroSection || null;

    const introWrap = heroSection ? heroSection.querySelector('.hero__secondary__content__wrap') : null;
    group.introWrap = introWrap || null;

    if (heroSection) heroTitleGroups.set(heroSection, group);
  });

  return groups;
}

// linePrepared: the array prepareLineReveal returned (pendingLineReveals),
// passed through so a group whose heroSection was claimed by one of its
// entries (see prepareLineReveal/activateLineReveal) can fire that entry's
// own reveal right here — in the very same onEnter callback as the
// title's — rather than trusting two independently-created ScrollTriggers
// to fire on the same tick, which isn't guaranteed.
// b160 — trigger point 90% → 85%.
function activateDisplayLargeReveal(prepared, linePrepared) {
  (prepared || []).forEach(({ trigger, splits, heroSection }) => {
    ScrollTrigger.create({
      trigger: trigger,
      start: "top 85%",
      once: true,
      onEnter: () => {
        const allLines = splits.flatMap(s => s.lines);
        // b113 — plain rise + blur + opacity fade, per line (see DISPLAY_LARGE_ANIM).
        // b128 — fromTo with the rise re-measured NOW, instead of a plain .to()
        // from whatever y prepareDisplayLargeReveal baked in earlier. That y
        // was converted from em to px while the page was still being set up
        // behind the transition panel (next position:fixed, mid-swap); on a
        // Barba navigation the font-size it measured could differ from the
        // final, settled layout, so the start offset came out bigger than on
        // a fresh load (where everything's already settled when it's
        // prepared) — headings rose in from too far down. Lines are still
        // opacity 0 here, so re-setting their start offset is invisible.
        const preparedY = allLines.length ? gsap.getProperty(allLines[0], 'y') : 0;
        const titleTween = gsap.fromTo(allLines, {
          opacity: 0,
          y: (i, el) => parseFloat(getComputedStyle(el).fontSize) * DISPLAY_LARGE_ANIM.headingTravelEm,
        }, {
          opacity: 1,
          y: 0,
          duration: DISPLAY_LARGE_ANIM.duration,
          ease: DISPLAY_LARGE_ANIM.ease,
          stagger: { each: DISPLAY_LARGE_ANIM.headingStagger, from: "start" }
        });

        // The hero's intro paragraph follows the heading lines (and the
        // image, when the page has one) instead of starting with them.
        if (heroSection && linePrepared) {
          linePrepared.forEach(entry => {
            if (entry.heroSection !== heroSection) return;
            gsap.to(entry.split.lines, {
              opacity: 1,
              y: 0,
              duration: DISPLAY_LARGE_ANIM.duration,
              delay: entryFollowDelay(allLines.length) + (entryHasImages ? ENTRY_TEXT_AFTER_IMAGE : 0),
              ease: DISPLAY_LARGE_ANIM.ease,
              stagger: { each: DISPLAY_LARGE_ANIM.stagger, from: "start" },
              onStart: () => releaseUnderline(entry.underline)
            });
          });
        }
      }
    });
  });
}

// -----------------------------------------
// HORIZONTAL RULE REVEAL
// -----------------------------------------

// b143 — every .horizontal-rule (the 1px bg-coloured divs, e.g. between
// Contact's form fields) draws in from 0 width to full width, left to right,
// once, as it scrolls into view. scaleX (not width) so it's GPU-cheap and
// doesn't reflow; same prepare (hidden, behind the transition) /
// activate (ScrollTrigger, at "pageReady") split as the other reveals.
const RULE_REVEAL = { duration: 1, ease: WH_EASE };

function prepareRuleReveal(scope) {
  if (typeof ScrollTrigger === "undefined") return [];
  const rules = Array.from((scope || document).querySelectorAll('.horizontal-rule'));
  if (rules.length) gsap.set(rules, { scaleX: 0, transformOrigin: 'left center' });
  return rules;
}

function activateRuleReveal(rules) {
  (rules || []).forEach(el => {
    ScrollTrigger.create({
      trigger: el,
      start: 'top 92%',
      once: true,
      onEnter: () => gsap.to(el, { scaleX: 1, duration: RULE_REVEAL.duration, ease: RULE_REVEAL.ease })
    });
  });
}

// -----------------------------------------
// STICKER POP-IN REVEAL
// -----------------------------------------

// b120 — switched from the bounce/scale pop (faded/dropped/scaled down,
// then bounced up) to the site's standard rise + blur + opacity reveal —
// same treatment as the display headings and the parallax images, so all
// three scroll-ins read as one consistent motif. Reuses IMAGE_REVEAL_RISE_REM
// and DISPLAY_LARGE_ANIM's blur/duration/ease rather than its own numbers.

// Every sticker wrapper on the site (hero__sticker, what-we-do__item__
// sticker, cta__sticker-1..6, and any future one) contains exactly one
// icon with this class — .sticker__svg normally, .sticker__sv on one
// instance (a stray typo'd class in the Designer; matched here too rather
// than fixed there, since fixing it wouldn't be a JS change). Targeting
// the icon itself (not its wrapper) keeps this independent of whatever
// the wrapper's own class happens to be.
const STICKER_SELECTOR = '.sticker__svg, .sticker__sv';

// Same prepare/activate split as the other scroll reveals, and for the
// same reason — see prepareLineReveal's comment.
function prepareStickerReveal(scope) {
  if (typeof ScrollTrigger === "undefined") return [];

  const targets = (scope || document).querySelectorAll(STICKER_SELECTOR);
  const prepared = [];
  targets.forEach(el => {
    gsap.set(el, {
      opacity: 0,
      y: `${IMAGE_REVEAL_RISE_REM}rem`,
    });
    prepared.push({ el });
  });
  return prepared;
}

function activateStickerReveal(prepared) {
  (prepared || []).forEach(({ el }) => {
    ScrollTrigger.create({
      trigger: el,
      start: 'top 90%',
      once: true,
      onEnter: () => {
        gsap.to(el, {
          opacity: 1,
          y: 0,
          duration: DISPLAY_LARGE_ANIM.duration,
          delay: entryStickerDelay(),
          ease: DISPLAY_LARGE_ANIM.ease
        });
      }
    });
  });
}

// -----------------------------------------
// IMAGE SCROLL REVEAL
// -----------------------------------------

// b117/b118 — every [data-parallax="trigger"] image gets a one-time
// scroll-in reveal on top of its existing continuous parallax drift (see
// GLOBAL PARALLAX above): same rise + blur + opacity treatment as the
// display headings (DISPLAY_LARGE_ANIM). This is a separate tween from the
// parallax scrub — that one drives yPercent/scale continuously as the page
// scrolls; this one drives y/opacity/filter once, as the image enters the
// viewport. GSAP tracks yPercent and y (both translateY) independently and
// composites them on the same transform, so the two never fight each
// other. b118 — the zoom (scale 1.05 -> 1) moved into initGlobalParallax's
// own scrubbed tween instead of firing here once: the user wanted it tied
// to scroll position throughout, the same way the yPercent drift is, not
// just resolved on entrance. Keeping it here too would have meant two
// tweens racing for "scale" on the same element. Same prepare/activate
// split as the other scroll reveals, and for the same reason — see
// prepareLineReveal's comment.
//
// b119 — the rise wasn't visible: DISPLAY_LARGE_ANIM.travelEm (0.5em) is
// sized against a HEADING's own (large) font-size, which is what makes it
// read clearly on text. .image__wrap has no font-size of its own — it
// inherits whatever's ambient on the page — so the same "em" value could
// resolve to only a few px on an image, nowhere near what it is on a
// heading. Using rem (root font-size, not the element's inherited one)
// instead keeps this predictable regardless of where the image sits.
const IMAGE_REVEAL_RISE_REM = 1;

function prepareImageReveal(scope) {
  if (typeof ScrollTrigger === "undefined") return [];

  // b148 — also the Contact page's map (.contact__map): same
  // rise + fade-in as the images, without any parallax (it isn't a
  // [data-parallax] element, so initGlobalParallax leaves it alone).
  // b149 — and every .btn, so buttons reveal the same way.
  // Images no longer reveal on entry (no fade, no rise); only the map and
  // buttons do. Images keep their scrubbed parallax drift.
  const targets = (scope || document).querySelectorAll('.contact__map, .btn');
  const prepared = [];
  targets.forEach(trigger => {
    const el = trigger.querySelector('[data-parallax="target"]') || trigger;
    gsap.set(el, { opacity: 0, y: `${IMAGE_REVEAL_RISE_REM}rem` });
    prepared.push({ el, trigger });
  });
  return prepared;
}

// After a page transition the headings rise in first and the images below
// them follow: images already in view when the page appears are held
// hidden, then fade in once the headings are under way.
const ENTRY_FOLLOW_GAP = 0.3; // seconds after the last heading line starts
const ENTRY_TEXT_AFTER_IMAGE = 0.15; // extra wait for the intro text when an image leads
let entryHasImages = false;

// When whatever follows the headings should start, measured from the moment
// the headings do: after the last of their lines has begun.
function entryFollowDelay(lineCount) {
  return Math.max(0, lineCount - 1) * DISPLAY_LARGE_ANIM.headingStagger + ENTRY_FOLLOW_GAP;
}

// For a short window while a page appears, any text reveal that fires on its
// own (e.g. the paragraph under the main heading) waits for the hero heading
// lines to finish starting, rather than animating alongside them.
let entryHeadingLines = 0;
let entryWindowUntil = 0;

function openEntryWindow(displayPrepared) {
  entryHeadingLines = Math.max(0, ...(displayPrepared || []).filter(p => p.heroSection).map(p => p.splits.flatMap(sp => sp.lines).length));
  entryWindowUntil = performance.now() + 600;
}

// Stickers in view on entry arrive last: after the heading and the text that
// follows it.
const ENTRY_STICKER_GAP = 0.4;
function entryStickerDelay() {
  return performance.now() < entryWindowUntil
    ? entryFollowDelay(entryHeadingLines) + ENTRY_STICKER_GAP + (entryHasImages ? ENTRY_TEXT_AFTER_IMAGE : 0)
    : 0;
}

function entryWaitDelay() {
  return entryHeadingLines && performance.now() < entryWindowUntil ? entryFollowDelay(entryHeadingLines) : 0;
}
const ENTRY_IMAGE_FADE = 0.9;

function prepareEntryImages(scope) {
  const held = [];
  scope.querySelectorAll('[data-parallax="trigger"]').forEach(trigger => {
    if (trigger.hasAttribute('data-parallax-inner')) return; // gallery slides appear as they are
    const rect = trigger.getBoundingClientRect();
    if (rect.top > window.innerHeight * 0.9 || rect.bottom < 0) return;
    const el = trigger.querySelector('[data-parallax="target"]') || trigger;
    gsap.set(el, { opacity: 0 });
    held.push(el);
  });
  return held;
}

function revealEntryImages(held, headingLines) {
  entryHasImages = !!(held && held.length);
  if (!entryHasImages) return;
  gsap.to(held, {
    opacity: 1,
    duration: ENTRY_IMAGE_FADE,
    delay: 0.15 + entryFollowDelay(headingLines),
    ease: WH_EASE,
    stagger: 0.1,
    clearProps: 'opacity'
  });
}

function revealImage(el) {
  gsap.to(el, {
    opacity: 1,
    y: 0,
    duration: DISPLAY_LARGE_ANIM.duration,
    ease: DISPLAY_LARGE_ANIM.ease
  });
}

function activateImageReveal(prepared) {
  (prepared || []).forEach(({ el, trigger }) => {
    ScrollTrigger.create({
      trigger: trigger,
      start: 'top 90%',
      once: true,
      onEnter: () => revealImage(el)
    });
  });
}

// -----------------------------------------
// HERO ABOUT-SCROLL PARALLAX
// -----------------------------------------

// As .section__about scrolls up to flush with the viewport top, the hero
// moves up 50vh and its overlay fades to 50% opacity, scrubbed to scroll.
// The overlay is a child of the hero, so it only needs its own opacity
// tween — it inherits the hero's y movement automatically. Giving it its
// own y on top of that would double its apparent scroll distance.
let heroAboutParallaxMM = null;

function initHeroAboutParallax(scope) {
  if (!hasScrollTrigger) return;

  // Revert the previous page's trigger (and its media query) first.
  if (heroAboutParallaxMM) {
    heroAboutParallaxMM.revert();
    heroAboutParallaxMM = null;
  }

  const root = scope || document;
  const trigger = root.querySelector('.section__about');
  const hero = root.querySelector('.home_hero__section');
  const overlay = root.querySelector('.home__hero__overlay');
  if (!trigger || (!hero && !overlay)) return;

  // The hero only moves up on tablet and above; mobile landscape and below
  // keep it fixed in place and just fade the overlay.
  heroAboutParallaxMM = gsap.matchMedia();
  heroAboutParallaxMM.add({ moves: '(min-width: 768px)', always: '(min-width: 0px)' }, (ctx) => {
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: trigger,
        start: 'top bottom',
        end: 'top top',
        scrub: true
      }
    });

    if (hero && ctx.conditions.moves) {
      tl.fromTo(hero, { y: '0vh' }, { y: '-50vh', ease: 'none' }, 0);
    }
    if (overlay) {
      tl.fromTo(overlay, { opacity: 0 }, { opacity: 0.5, ease: 'none' }, 0);
    }
  });
}

// -----------------------------------------
// FIRST-LOAD REVEAL
// -----------------------------------------

// Character reveal — opacity + rise + rotateY flip. Shared default
// recipe; DISPLAY_LARGE_ANIM uses the same shape with its own timing.
const LOAD_TEXT_REVEAL = {
  duration: 0.7,
  ease: WH_EASE,
  stagger: 0.05,
  travel: 60,   // yPercent
  rotate: 90    // degrees
};

// Line-masked reveal — same recipe as initLineReveal, but callable
// directly rather than tied to a ScrollTrigger.
const LOAD_LINE_REVEAL = {
  duration: 1.2,
  ease: WH_EASE,
  stagger: 0.02
};

// Reusable character-by-character reveal. Pass `timeline`+`position` to
// insert into an existing gsap.timeline; otherwise plays immediately
// (optionally after `delay`). Returns { split, tween }.
function revealCharsIn(el, opts) {
  if (typeof SplitText === "undefined" || !el) return null;
  const o = Object.assign({
    duration: LOAD_TEXT_REVEAL.duration,
    ease: LOAD_TEXT_REVEAL.ease,
    stagger: LOAD_TEXT_REVEAL.stagger,
    travel: LOAD_TEXT_REVEAL.travel,
    rotate: LOAD_TEXT_REVEAL.rotate,
    delay: 0,
    timeline: null,
    position: 0
  }, opts || {});

  const split = new SplitText(el, { type: 'words,chars', reduceWhiteSpace: false });
  gsap.set(split.chars, {
    autoAlpha: 0,
    yPercent: o.travel,
    rotateY: o.rotate,
    transformPerspective: 600
  });

  const vars = {
    autoAlpha: 1,
    yPercent: 0,
    rotateY: 0,
    duration: o.duration,
    ease: o.ease,
    stagger: o.stagger
  };

  let tween;
  if (o.timeline) {
    tween = o.timeline.to(split.chars, vars, o.position);
  } else {
    vars.delay = o.delay;
    tween = gsap.to(split.chars, vars);
  }

  return { split, tween };
}

// Reusable line-masked reveal — same options as revealCharsIn above.
function revealLinesIn(el, opts) {
  if (typeof SplitText === "undefined" || !el) return null;
  const o = Object.assign({
    duration: LOAD_LINE_REVEAL.duration,
    ease: LOAD_LINE_REVEAL.ease,
    stagger: LOAD_LINE_REVEAL.stagger,
    delay: 0,
    timeline: null,
    position: 0
  }, opts || {});

  const split = new SplitText(el, { type: 'lines', mask: 'lines' });
  gsap.set(split.lines, { yPercent: 100 });

  const vars = {
    yPercent: 0,
    duration: o.duration,
    ease: o.ease,
    stagger: o.stagger
  };

  let tween;
  if (o.timeline) {
    tween = o.timeline.to(split.lines, vars, o.position);
  } else {
    vars.delay = o.delay;
    tween = gsap.to(split.lines, vars);
  }

  return { split, tween };
}

// Matches the nav's own open-menu character reveal (chars-up, masked by
// SplitText's built-in line mask) — same travel/duration/stagger/ease as
// buildNavTimeline's nav links.
const NAV_OPEN_ROLL = {
  travel: 100,
  duration: NAV_CHAR_ANIM.duration,
  stagger: NAV_CHAR_ANIM.stagger,
  ease: WH_EASE
};

function revealCharsRollIn(el, opts) {
  if (typeof SplitText === "undefined" || !el) return null;
  const o = Object.assign({
    travel: NAV_OPEN_ROLL.travel,
    duration: NAV_OPEN_ROLL.duration,
    stagger: NAV_OPEN_ROLL.stagger,
    ease: NAV_OPEN_ROLL.ease,
    delay: 0,
    timeline: null,
    position: 0
  }, opts || {});

  const split = new SplitText(el, { type: 'lines,chars', mask: 'lines', reduceWhiteSpace: false });
  gsap.set(split.chars, { yPercent: o.travel });

  const vars = {
    yPercent: 0,
    duration: o.duration,
    ease: o.ease,
    stagger: { each: o.stagger, from: 'start' }
  };

  let tween;
  if (o.timeline) {
    tween = o.timeline.to(split.chars, vars, o.position);
  } else {
    vars.delay = o.delay;
    tween = gsap.to(split.chars, vars);
  }

  return { split, tween };
}

// Home's hero intro — wordmark Lottie, menu label roll-in, logo Lottie. Originally cold-load only (via playOnceAnimation), never
// replayed on returning to Home via a Barba transition. To play it again
// on return without a flash of fully-visible static text first, it's
// split into two steps:
//
//   1. prepareLoadReveal — hide the wordmark, SplitText the menu text and set
//      everything to its hidden starting state. Safe to run any time,
//      including well before the page is visible — called from the leave
//      timeline's onComplete (screen still fully covered by the
//      transition panel), same moment as the nav-color/bunny-video resets.
//   2. playLoadReveal — the actual roll-in/bounce-in tweens, using the
//      state prepareLoadReveal already set up. Called once the page is
//      about to actually be shown (the enter timeline's "startEnter"
//      label), so the reveal itself is what the user watches, not
//      something that's already finished playing off-screen.
//
// A true first load has no covered-transition window to hide behind, so
// prepareOnceAnimation and playOnceAnimation call them either side of the preloader.
// .nav__button-label lives in the persistent Global component (outside the
// Barba container, never swapped between pages), but prepareLoadReveal
// below SplitTexts it fresh every time Home is entered. Without reverting
// the previous split first, the second+ visit calls `new SplitText()` on
// markup that's ALREADY wrapped in a previous split's line/char spans —
// SplitText re-splits its own output, producing garbage nested chars and
// throwing on some inputs. Tracked here so prepareLoadReveal can revert
// it before re-splitting.
let activeMenuLabelSplit = null;

// How far through the wordmark Lottie the menu label and logo begin (0-1).
const HERO_CHROME_START = 0.1;

function prepareLoadReveal(scope, opts) {
  const root = scope || document;
  // b139 — on a Barba navigation the logo + menu label stay put (no hide /
  // re-roll); only a true first load plays their intro. Colour changes
  // between pages still animate (see resetPersistentNavColor).
  const withChrome = !opts || opts.chrome !== false;

  // Persistent chrome — outside the Barba container, queried from document.
  const logo = withChrome ? document.querySelector('.nav__logo') : null;
  const menuLabel = withChrome ? document.querySelector('.nav__button-label') : null;
  const wordmark = root.querySelector('.hero__wordmark__lottie');

  // Pages without a hero wordmark still get the logo + menu label intro on a
  // first load; Barba navigations (no chrome) have nothing to prepare.
  if (!wordmark && !withChrome) return null;

  const HERO_ROLL = { duration: 0.9, stagger: 0.04, ease: WH_EASE };

  // Hidden until the Lottie is ready to play from its first frame.
  if (wordmark) gsap.set(wordmark, { autoAlpha: 0 });

  let menuChars = null;
  if (menuLabel && typeof SplitText !== "undefined") {
    // Revert any split left over from a previous visit to this page (see
    // activeMenuLabelSplit comment above) before re-splitting the same
    // persistent node.
    if (activeMenuLabelSplit) {
      activeMenuLabelSplit.revert();
      activeMenuLabelSplit = null;
    }
    const menuSplit = new SplitText(menuLabel, { type: 'lines,chars', mask: 'lines', reduceWhiteSpace: false });
    activeMenuLabelSplit = menuSplit;
    menuChars = menuSplit.chars;
    gsap.set(menuChars, { yPercent: NAV_OPEN_ROLL.travel });
  }

  if (logo) {
    gsap.set(logo, { autoAlpha: 0 });
    resetNavLogo();
  }

  return { wordmark, HERO_ROLL, menuChars, logo };
}

function playLoadReveal(state) {
  if (!state) return;
  const { wordmark, HERO_ROLL, menuChars, logo } = state;

  Webflow.push(() => {
    const anim = wordmark ? getLottieIn(wordmark) : null;

    const start = () => {
      if (wordmark) gsap.set(wordmark, { autoAlpha: 1 });
      let duration = 0;
      if (anim) {
        anim.loop = false;
        anim.setDirection(1);
        anim.goToAndPlay(0, true);
        duration = anim.getDuration();
      }

      // Menu label and logo start part-way through the wordmark.
      const chromeDelay = wordmark ? duration * HERO_CHROME_START : 0.15;

      if (menuChars) {
        gsap.to(menuChars, {
          yPercent: 0,
          duration: HERO_ROLL.duration,
          ease: HERO_ROLL.ease,
          stagger: { each: HERO_ROLL.stagger, from: 'start' },
          delay: chromeDelay
        });
      }

      if (logo) {
        gsap.delayedCall(chromeDelay, () => {
          gsap.set(logo, { autoAlpha: 1 });
          playNavLogo();
        });
      }
    };

    if (!wordmark || !anim || anim.isLoaded) start();
    else anim.addEventListener('DOMLoaded', start);
  });
}

// -----------------------------------------
// SCROLL COLOR ZONES (home content + nav)
// -----------------------------------------

// As each [data-color-zone] section scrolls into view, tween
// .home__content__main and the persistent nav (logo + menu label) to
// that zone's bg/text colors. Zones use data attributes rather than
// class names so a Designer rename can't silently break this (bit us
// once already with .section-white -> .section__white).
const COLOR_ZONES = [
  { zone: 'white', bg: COLORS.hallWhite, text: COLORS.kiwiSkin },
  { zone: 'kiwiskin', bg: COLORS.kiwiSkin, text: COLORS.kanukaPink },
  { zone: 'stone', bg: COLORS.stone, text: COLORS.kiwiSkin },
  {
    zone: 'forest', bg: COLORS.forest, text: COLORS.spring,
    // Buttons inside this zone get their own resting colors, not just
    // the surrounding bg/text — a default btn look reads poorly against
    // forest's dark bg.
    btn: { bg: COLORS.spring, text: COLORS.forest }
  }
];
// Zone colour change speed (bg, text, nav, zone buttons).
const COLOR_ZONE_DURATION = 0.6;
let colorZoneSTs = [];

function initColorZones(scope) {
  colorZoneSTs.forEach(st => st.kill());
  colorZoneSTs = [];

  if (!hasScrollTrigger) return;

  const root = scope || document;
  const target = document.querySelector('[data-color-zone-target]');
  if (!target) return;

  // Persistent nav chrome — queried from document, not scoped to the page.
  const navLogo = document.querySelector('.nav__logo');
  const menuLabel = document.querySelector('.nav__button-label');
  const navTargets = [navLogo, menuLabel].filter(Boolean);

  // Captured before any zone tween runs, so scrolling back up above the
  // first zone (into the hero) has a true resting state to revert to.
  const defaultBg = getComputedStyle(target).backgroundColor;
  const defaultText = getComputedStyle(target).color;

  // Nav's resting (hero) color normally just follows whatever the CSS
  // cascade gives it, but a page can override that explicitly via
  // data-nav-default-color="<COLORS key>" on the [data-color-zone-target]
  // element — e.g. Orchards' light hero needs a dark logo/menu label,
  // unlike Home's dark video hero which relies on the CSS default.
  const navDefaultOverrideKey = target.getAttribute('data-nav-default-color');
  const navDefaultOverride = navDefaultOverrideKey ? COLORS[navDefaultOverrideKey] : null;
  // b135 — .nav__logo / .nav__button-label have `transition: all` in
  // Webflow. Arriving from a page that had tinted them (e.g. Our Approach's
  // light green), resetPersistentNavColor clears the inline color moments
  // before this runs, so a plain getComputedStyle() here read the colour
  // MID-TRANSITION (still light green) and stored it as the "default" — the
  // hero's resting nav colour then came back light green instead of white.
  // Read the true CSS colour with the transition suspended and any inline
  // colour set aside.
  const readRestingColor = el => {
    const prevTransition = el.style.transition;
    const prevColor = el.style.color;
    el.style.transition = 'none';
    el.style.color = '';
    const c = getComputedStyle(el).color;
    el.style.color = prevColor;
    el.style.transition = prevTransition;
    return c;
  };
  const defaultNavColors = navTargets.map(el => navDefaultOverride || readRestingColor(el));

  // Apply an override immediately — otherwise it wouldn't take effect
  // until the first scroll-back-into-hero event.
  if (navDefaultOverride && navTargets.length) {
    gsap.set(navTargets, { color: navDefaultOverride });
  }

  const revertToDefault = () => {
    gsap.to(target, { backgroundColor: defaultBg, color: defaultText, duration: COLOR_ZONE_DURATION, ease: WH_EASE, overwrite: 'auto' });
    navTargets.forEach((el, i) => {
      gsap.to(el, { color: defaultNavColors[i], duration: COLOR_ZONE_DURATION, ease: WH_EASE, overwrite: 'auto' });
    });
  };

  COLOR_ZONES.forEach(({ zone, bg, text, btn }, index) => {
    const trigger = root.querySelector(`[data-color-zone="${zone}"]`);
    if (!trigger) return;

    const setZone = () => {
      gsap.to(target, { backgroundColor: bg, color: text, duration: COLOR_ZONE_DURATION, ease: WH_EASE, overwrite: 'auto' });
      if (navTargets.length) gsap.to(navTargets, { color: text, duration: COLOR_ZONE_DURATION, ease: WH_EASE, overwrite: 'auto' });

      // Retint any buttons that live inside this zone's own section —
      // updates their resting colors (not just a one-off tween) so a
      // later hover-out lands back on the zone's colors.
      if (btn) {
        trigger.querySelectorAll('.btn').forEach(btnEl => {
          const middle = btnEl.querySelector('.btn__middle');
          const caps = btnEl.querySelectorAll('.btn__cap-svg');
          if (!middle) return;
          btnEl._restBg = btn.bg;
          btnEl._restText = btn.text;
          gsap.to(middle, { backgroundColor: btn.bg, color: btn.text, duration: COLOR_ZONE_DURATION, ease: WH_EASE, overwrite: 'auto' });
          if (caps.length) gsap.to(caps, { color: btn.bg, duration: COLOR_ZONE_DURATION, ease: WH_EASE, overwrite: 'auto' });
        });
      }
    };

    const stVars = {
      trigger: trigger,
      start: 'top 25%',
      end: 'bottom 50%',
      onEnter: setZone,
      onEnterBack: setZone
      // No onLeave/onLeaveBack revert here: zones sit side by side, so
      // leaving one downward always means entering the next, which sets
      // its own colors. Reverting here would just fight that.
    };

    // Only the topmost zone (COLOR_ZONES[0], i.e. "white") reverts to the
    // true default when scrolled back above it — that's the boundary
    // into the hero, which isn't itself a color zone.
    if (index === 0) stVars.onLeaveBack = revertToDefault;

    colorZoneSTs.push(ScrollTrigger.create(stVars));
  });
}

// -----------------------------------------
// BUTTON HOVER / FOCUS
// -----------------------------------------

// Every .btn (the scallop-shaped Enquire button) gets the same
// hover/focus feedback, bound once per element. The caps are inline
// SVGs with fill="currentColor" — tweening the cap's `color` smoothly
// animates the SVG fill, since GSAP can't tween SVG fill directly.
const HOVER_BG = COLORS.kanukaPink;
const HOVER_TEXT = COLORS.kiwiSkin;

// Roll-hover text, same mechanic as the nav links: original line rolls
// up out of view while an identical clone rolls up into place from
// below, masked by an overflow:hidden wrapper.
function buildRollPairs(textNode) {
  if (typeof SplitText === "undefined" || !textNode) return null;

  const label = textNode.textContent.trim();
  textNode.textContent = '';

  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-block;overflow:hidden;position:relative;vertical-align:top;';
  textNode.parentNode.insertBefore(wrap, textNode);
  // textNode's own content already moved into origEl/cloneEl below — it's
  // now an empty leftover. Left in place it becomes a second flex child
  // of .btn__middle alongside wrap, which is exactly what threw off the
  // caps/middle vertical alignment (that box was sized for a single child).
  textNode.remove();

  const origEl = document.createElement('span');
  origEl.style.cssText = 'display:block;';
  origEl.textContent = label;
  wrap.appendChild(origEl);

  const cloneEl = document.createElement('span');
  cloneEl.setAttribute('aria-hidden', 'true');
  cloneEl.style.cssText = 'display:block;white-space:nowrap;';
  cloneEl.textContent = label;
  wrap.appendChild(cloneEl);

  // Measure both in normal flow before pulling them out of it.
  const width = Math.max(origEl.getBoundingClientRect().width, cloneEl.getBoundingClientRect().width);
  const height = origEl.getBoundingClientRect().height;
  wrap.style.width = width + 'px';
  wrap.style.height = height + 'px';

  origEl.style.cssText += 'position:absolute;top:0;left:0;';
  cloneEl.style.cssText += 'position:absolute;top:0;left:0;';

  // b126 — rolls as one whole line (orig up/out, clone up/in), no per-char
  // split or stagger. The clone starts pushed down 100%; enter/leave in
  // initButtonHoverFocus tween both elements directly.
  gsap.set(cloneEl, { yPercent: 100 });

  return { orig: origEl, clone: cloneEl };
}

function initButtonHoverFocus(scope) {
  const root = scope || document;
  root.querySelectorAll('.btn').forEach(btn => {
    if (btn._btnHoverBound) return;
    btn._btnHoverBound = true;

    const caps = btn.querySelectorAll('.btn__cap-svg');
    const middle = btn.querySelector('.btn__middle');
    if (!caps.length || !middle) return;

    // Resting-state colors, kept mutable on the element itself (not a
    // local const) — initColorZones retints a zone's buttons (e.g. the
    // forest section) by updating these, so hover-out lands back on the
    // zone's colors instead of the page-load default.
    btn._restBg = getComputedStyle(middle).backgroundColor;
    btn._restText = getComputedStyle(middle).color;

    // Roll-hover setup — built once from whatever text is currently in
    // .btn__middle (e.g. "Enquire").
    let rollPairs = null;
    try {
      // Wrap the label in its own span first, so buildRollPairs' markup
      // swap stays scoped to the text and doesn't touch .btn__middle's
      // own flex/centering styles.
      const label = document.createElement('span');
      label.textContent = middle.textContent;
      middle.textContent = '';
      middle.appendChild(label);
      rollPairs = buildRollPairs(label);
    } catch (err) {
      console.error('[btn] roll-hover text init failed:', err);
    }

    const enter = () => {
      gsap.to(caps, { color: HOVER_BG, duration: 0.3, ease: WH_EASE, overwrite: 'auto' });
      gsap.to(middle, { backgroundColor: HOVER_BG, color: HOVER_TEXT, duration: 0.3, ease: WH_EASE, overwrite: 'auto' });
      if (rollPairs) {
        gsap.to(rollPairs.orig, { yPercent: -100, duration: 0.65, ease: WH_EASE, overwrite: true });
        gsap.to(rollPairs.clone, { yPercent: 0, duration: 0.65, ease: WH_EASE, overwrite: true });
      }
    };
    const leave = () => {
      gsap.to(caps, { color: btn._restBg, duration: 0.3, ease: WH_EASE, overwrite: 'auto' });
      gsap.to(middle, { backgroundColor: btn._restBg, color: btn._restText, duration: 0.3, ease: WH_EASE, overwrite: 'auto' });
      if (rollPairs) {
        gsap.to(rollPairs.orig, { yPercent: 0, duration: 0.65, ease: WH_EASE, overwrite: true });
        gsap.to(rollPairs.clone, { yPercent: 100, duration: 0.65, ease: WH_EASE, overwrite: true });
      }
    };

    btn.addEventListener('mouseenter', enter);
    btn.addEventListener('mouseleave', leave);
    // focus/blur cover keyboard navigation.
    btn.addEventListener('focus', enter);
    btn.addEventListener('blur', leave);
  });
}

// -----------------------------------------
// PARALLAX IMAGE SLIDER (Smooothy) — Our Story
// -----------------------------------------
// Osmo Supply resource, wired into Barba instead of its own standalone
// DOMContentLoaded listener. [data-parallax-init]/-slider/-inner/-amount/
// -snap/-infinite/-lerp are the resource's own attributes, untouched — see
// the resource doc for what each does.
//
// Smooothy attaches its own drag/resize/rAF-driven listeners per instance
// (Core class exposes destroy() to clean those up — see
// https://github.com/vallafederico/smooothy), and the onUpdate callback
// here is additionally pushed onto the shared gsap.ticker. Neither tears
// itself down when Barba swaps the container out, so without explicit
// cleanup a Smooothy instance from a page navigated away from would keep
// its ticker callback running forever, and revisiting the same page would
// stack duplicate instances — same "clear previous, rebuild" shape as
// initColorZones' colorZoneSTs.
let activeParallaxSliders = [];

function destroyParallaxImageSliders() {
  activeParallaxSliders.forEach(({ slider, tick, teardown }) => {
    gsap.ticker.remove(tick);
    if (teardown) teardown();
    if (slider && typeof slider.destroy === 'function') slider.destroy();
  });
  activeParallaxSliders = [];
}

// b100 — decade timeline sync (Our Story). Each slide carries its own
// .text__slider__date label, bound in Webflow to that slide's Date
// reference's own Name (e.g. "1980's") — decadeKeys below reads that text
// and slugifies it (lowercase, punctuation stripped) to match each
// .slider__timeline__item's domId, which is bound to that same decade's
// own Slug (e.g. "1980s"). So the slider (Timeline collection) and the
// description list (Timeline Decades collection), otherwise unrelated in
// the DOM, stay matched via a visible CMS value rather than a hidden id
// or JS-side content duplication. Which slide counts as "active" is
// decided in initParallaxImageSlider's own per-frame tick, by comparing
// each slide's live getBoundingClientRect() against the slider's own
// center — not by Smooothy's internal parallaxValues, which were never a
// reliable signal here (this instance's data-parallax-amount is 0, so
// that value has no visible effect to have ever been exercised through).
// Resting state for the decade description lines (matches [data-line-reveal]).
const DECADE_HIDDEN = { opacity: 0, y: `${DISPLAY_LARGE_ANIM.travelEm}em` };

function initDecadeTimelinePanels(scope, decadeKeys) {
  if (typeof SplitText === "undefined" || !decadeKeys.some(Boolean)) return null;

  const panels = new Map();
  (scope || document).querySelectorAll('.slider__timeline__item').forEach(item => {
    const textEl = item.querySelector('[data-decade-text]');
    if (!item.id || !textEl) return;
    const split = new SplitText(textEl, { type: "lines" });
    gsap.set(split.lines, DECADE_HIDDEN);
    gsap.set(item, { display: 'none' });
    panels.set(item.id, { item, split });
  });
  if (!panels.size) return null;

  // The list is as tall as the tallest panel, so switching decades never
  // shifts the layout below it. Each panel is shown briefly to measure it,
  // and the fit is redone when the list's width changes (text reflows) and
  // once fonts have loaded.
  const list = [...panels.values()][0].item.parentElement;
  const fitListHeight = () => {
    if (!list.isConnected) return;
    list.style.minHeight = '';
    let tallest = 0;
    panels.forEach(({ item }) => {
      const display = item.style.display;
      item.style.display = '';
      tallest = Math.max(tallest, item.offsetHeight);
      item.style.display = display;
    });
    list.style.minHeight = `${tallest}px`;
  };
  fitListHeight();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitListHeight);
  if (typeof ResizeObserver !== 'undefined') {
    let lastWidth = list.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (!list.isConnected) return observer.disconnect();
      if (list.offsetWidth === lastWidth) return;
      lastWidth = list.offsetWidth;
      fitListHeight();
    });
    observer.observe(list);
  }

  // b107 — the exit half of the transition (below) runs quicker than the
  // site-standard LINE_REVEAL_DURATION/STAGGER used for the roll-in, since
  // it's a brief "get out of the way" beat rather than a second reveal.
  const DECADE_OUT_DURATION = 0.5;
  const DECADE_OUT_STAGGER = 0.03;

  let activeId = null;
  // b105 — the previously-showing panel now animates its lines out before
  // the next one animates in, instead of both moves happening at once.
  // transitionTl holds whichever out-then-in sequence is currently
  // running, so a fast scroll through several decades (calling
  // showDecade again before the last sequence finished) can cleanly kill
  // it and reset every panel except the new target back to its resting
  // hidden state, rather than leaving one stuck half-revealed.
  let transitionTl = null;
  return {
    panels,
    showDecade(id) {
      if (!id) return;
      if (id === activeId) return;
      if (!panels.has(id)) {
        return;
      }

      if (transitionTl) transitionTl.kill();

      const prevId = activeId;
      const prev = prevId ? panels.get(prevId) : null;
      const next = panels.get(id);
      activeId = id;

      // Any panel other than the outgoing and incoming ones (there
      // shouldn't normally be one, but an interrupted transition can
      // leave one mid-flight) is snapped straight back to resting/hidden.
      panels.forEach((panel, panelId) => {
        if (panelId === id || panelId === prevId) return;
        gsap.killTweensOf(panel.split.lines);
        gsap.set(panel.split.lines, DECADE_HIDDEN);
        gsap.set(panel.item, { display: 'none' });
      });

      transitionTl = gsap.timeline({ onComplete: () => { transitionTl = null; } });

      if (prev) {
        // b107 — out moves down (yPercent 120, the same resting/hidden
        // position the "in" reveal starts from) instead of further up and
        // off-screen, and runs much quicker than the in-reveal — it's a
        // brief exit, not a second full reveal, so it shouldn't cost as
        // much time as the roll-in does.
        transitionTl
          .to(prev.split.lines, {
            ...DECADE_HIDDEN,
            duration: DECADE_OUT_DURATION,
            ease: WH_EASE,
            stagger: { each: DECADE_OUT_STAGGER, from: "start" }
          })
          .set(prev.item, { display: 'none' });
      }

      // ...then next's lines reveal in, same roll as before.
      transitionTl
        .set(next.item, { display: '' })
        .to(next.split.lines, {
          opacity: 1,
          y: 0,
          duration: DISPLAY_LARGE_ANIM.duration,
          ease: DISPLAY_LARGE_ANIM.ease,
          stagger: { each: DISPLAY_LARGE_ANIM.stagger, from: "start" }
        });
    }
  };
}

// b101 — decade stickers (Our Story). Each slide carries all six decade
// stickers stacked directly on top of each other in the markup
// (.slider__stickers__wrap > .slider__timeline__sticker.is__<decade>, e.g.
// is__1980), all visible by default. Only the slide that STARTS a new
// decade run should show a sticker — its own — every other slide
// (including later slides within the same decade) shows none. decadeKeys
// is already computed per slide by initParallaxImageSlider (see the
// comment above initDecadeTimelinePanels); sticker class names drop the
// trailing "s" that decadeKeys carries for the round-decade values
// ("1980s" -> "1980"), so that's converted here. Slide order never
// changes at runtime, so this only needs to run once, on init.
function initSliderStickers(slides, decadeKeys) {
  const seenDecades = new Set();
  slides.forEach((slide, i) => {
    const wrap = slide.querySelector('.slider__stickers__wrap');
    if (!wrap) return;
    const key = decadeKeys[i];
    const stickerKey = key ? key.replace(/^(\d{4})s$/, '$1') : null;
    const isFirstOfDecade = !!key && !seenDecades.has(key);
    if (key) seenDecades.add(key);
    [...wrap.children].forEach((sticker) => {
      const show = isFirstOfDecade && sticker.classList.contains(`is__${stickerKey}`);
      sticker.style.display = show ? '' : 'none';
    });
  });
}

// Gallery slides (Our Story) are a fixed height; each slide's width follows
// its image's own proportions, so landscape, square and portrait photos all
// sit at their natural shape. The ratio comes from the image's real
// dimensions (its width/height attributes until it has loaded, then its
// natural size) and is applied as the slide's aspect-ratio; the CSS keeps
// the height fixed and a 3/2 fallback until then.
function sliderImageRatio(img) {
  const w = img.naturalWidth || parseFloat(img.getAttribute('width'));
  const h = img.naturalHeight || parseFloat(img.getAttribute('height'));
  return w && h ? w / h : 0;
}

// Slide widths are set outright from each picture's ratio and the fixed
// height, rather than left to auto: on phones an auto width could settle
// before the ratio did (or grow to a long caption), leaving a gap after the
// image. Called on every measure so a resize or rotation re-fits them.
function fitSliderWidths(slides) {
  slides.forEach((slide) => {
    const inner = slide.querySelector('.parallax-slider__item-inner');
    const ratio = inner && parseFloat(inner.dataset.ratio);
    if (!ratio) return;
    const width = `${inner.offsetHeight * ratio}px`;
    inner.style.width = width;
    slide.style.width = width;
  });
}

function initSliderImageFormats(slides, onChange) {
  slides.forEach((slide) => {
    const inner = slide.querySelector('.parallax-slider__item-inner');
    const img = slide.querySelector('.parallax-slider__item-img');
    if (!inner || !img) return;
    // Lazy images would pop in (and re-measure the slider) mid-drag; load
    // the whole gallery up front instead.
    img.loading = 'eager';
    const apply = () => {
      const ratio = sliderImageRatio(img);
      if (!ratio) return;
      const value = ratio.toFixed(4);
      if (inner.style.aspectRatio === value) return;
      inner.style.aspectRatio = value;
      inner.dataset.ratio = value;
      if (onChange) onChange();
    };
    apply();
    if (!img.complete) img.addEventListener('load', apply, { once: true });
  });
}

function initParallaxImageSlider(scope) {
  if (typeof Smooothy === "undefined") return;

  // Belt-and-suspenders — destroyParallaxImageSliders' own call site in
  // runPageLeaveAnimation handles normal teardown; this guards against
  // running twice for the same live page without an intervening navigation.
  destroyParallaxImageSliders();

  (scope || document).querySelectorAll("[data-parallax-init]").forEach((root) => {
    // The smooothy list
    const wrapper = root.querySelector("[data-parallax-slider]");
    if (!wrapper) return;

    // One parallax layer per slide (optional)
    const slides = [...wrapper.children];
    const parallaxItems = slides.map((slide) => slide.querySelector("[data-parallax-inner]"));

    // b100 — index-aligned with parallaxItems/slides above; see this
    // function's own comment above initDecadeTimelinePanels for what
    // .text__slider__date actually holds and why it's slugified.
    const decadeKeys = slides.map((slide) => {
      const dateEl = slide.querySelector('.text__slider__date');
      const text = dateEl ? dateEl.textContent.trim() : '';
      return text ? text.toLowerCase().replace(/[^a-z0-9]/g, '') : null;
    });
    const decadeTimeline = initDecadeTimelinePanels(scope, decadeKeys);
    initSliderStickers(slides, decadeKeys);
    let slider = null; // assigned below; slide widths changing re-measures it
    initSliderImageFormats(slides, () => { if (slider) slider.resize(); });
    let decadeTickCount = 0;

    // Parallax amount
    const amountAttr = wrapper.getAttribute("data-parallax-amount");
    const amount = amountAttr !== null ? parseFloat(amountAttr) : 12;

    // Snap to a slide
    const snap = wrapper.getAttribute("data-parallax-snap") !== "false";

    // Loop
    const infinite = wrapper.getAttribute("data-parallax-infinite") !== "false";

    // Slide smoothing
    const lerpAttr = wrapper.getAttribute("data-parallax-lerp");
    const lerp = lerpAttr !== null ? parseFloat(lerpAttr) : 0.3;

    const maxOffset = 25;

    // Slides differ in width (each follows its image's proportions), so a
    // non-infinite slider runs Smooothy in variableWidth mode. Every slide is
    // then translated by the same amount and keeps its natural place in the
    // flex row; what Smooothy needs from us is where each slide really
    // starts. Its own measure ignores the margin between slides and centres
    // the active slide in the wrapper, so after every measure the geometry is
    // replaced with the real layout: slide starts from offsetLeft, and each
    // slide counted as wrapper-wide so snapping lands its left edge on the
    // text column, as it always has.
    const variableWidth = !infinite;
    const syncSlideGeometry = (core) => {
      if (!variableWidth || !slides.length) return;
      fitSliderWidths(slides);
      const first = slides[0].offsetLeft;
      const offsets = slides.map((slide) => slide.offsetLeft - first);
      core.itemOffsets = offsets;
      core.itemWidths = slides.map(() => core.viewport.wrapperWidth);
      core.viewport.totalWidth = offsets[offsets.length - 1] + slides[slides.length - 1].offsetWidth;
      core.maxScroll = -offsets[offsets.length - 1];
    };

    // A re-measure (lazy images settling the slide widths as the gallery
    // nears the viewport, a window resize) makes Smooothy re-target the
    // wrong slide, which plays as the whole gallery sliding in. The next
    // frame puts the slider straight back on the slide it was resting on.
    let snapAfterResize = false;
    let settledIndex = 0;
    let pressScale = 1; // see the drag block; read by onUpdate below
    let beforeResize = { current: 0, target: 0 };

    slider = new Smooothy(wrapper, {
      infinite,
      snap,
      variableWidth,
      lerpFactor: lerp,
      onResize: (core) => {
        syncSlideGeometry(core);
        // onResize runs before Smooothy re-targets, so this is still the
        // live position.
        beforeResize = { current: core.current, target: core.target };
        snapAfterResize = true;
      },
      onUpdate: ({ parallaxValues }) => {
        parallaxItems.forEach((item, i) => {
          if (!item) return;
          const offset = gsap.utils.clamp(-maxOffset, maxOffset, parallaxValues[i] * amount);
          // The same element is counter-scaled while a slide is held (see the
          // drag block), so both live in this one transform string.
          item.style.transform = `translateX(${offset}%) scale(${1 / pressScale})`;
        });
      },
    });
    syncSlideGeometry(slider);

    // Drag feel. Smooothy only advances a slide once it has been dragged past
    // the halfway point, which on slides this wide means a long drag (worse
    // still with a thumb on a phone). So a release is judged on intent
    // instead: a short drag or a flick moves exactly one slide in that
    // direction, from the slide the drag began on. Runs after Smooothy's own
    // release handling, so it has the last word on the target.
    const sliderTeardowns = [];
    if (variableWidth) {
      wrapper.style.touchAction = 'pan-y'; // vertical page scroll stays native; horizontal belongs to the slider
      const DRAG_DISTANCE = 36; // px
      const FLICK_SPEED = 0.35; // px per ms
      // Held slides close in like a mask: the frame narrows while the picture
      // inside is counter-scaled so it holds still, and the settle is
      // per-frame exponential (closer to 1 is slower), same as the Finlay
      // Woods gallery.
      const PRESS_SCALE = 0.95;
      const PRESS_SETTLE = 0.955; // per 60fps frame
      const pressItems = slides
        .map((slide) => ({
          frame: slide.querySelector('.parallax-slider__item-inner'),
          caption: slide.querySelector('.image__caption__wrap')
        }))
        .filter((item) => item.frame);
      let pressTarget = 1;
      const pressTick = (time, delta) => {
        if (pressScale === pressTarget) return;
        pressScale += (pressTarget - pressScale) * (1 - Math.pow(PRESS_SETTLE, delta / 16.667));
        if (Math.abs(pressTarget - pressScale) < 0.0005) pressScale = pressTarget;
        pressItems.forEach(({ frame, caption }) => {
          gsap.set(frame, { scale: pressScale });
          // Captions track the frame's left and bottom edges as it closes in.
          if (caption) {
            gsap.set(caption, {
              x: (frame.offsetWidth * (1 - pressScale)) / 2,
              y: -(frame.offsetHeight * (1 - pressScale)) / 2
            });
          }
        });
      };
      gsap.ticker.add(pressTick);
      let drag = null;
      const point = (e) => (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
      const begin = (e) => {
        drag = { x: point(e).clientX, t: performance.now(), slide: slider.currentSlide };
        pressTarget = PRESS_SCALE;
      };
      const finish = (e) => {
        if (!drag) return;
        const dx = point(e).clientX - drag.x;
        const speed = Math.abs(dx) / Math.max(1, performance.now() - drag.t);
        const from = drag.slide;
        drag = null;
        pressTarget = 1;
        if (Math.abs(dx) < DRAG_DISTANCE && speed < FLICK_SPEED) {
          slider.goToIndex(from);
        } else {
          slider.goToIndex(from + (dx < 0 ? 1 : -1));
        }
      };
      wrapper.addEventListener('mousedown', begin);
      wrapper.addEventListener('touchstart', begin, { passive: true });
      window.addEventListener('mouseup', finish);
      window.addEventListener('touchend', finish);
      window.addEventListener('touchcancel', finish);
      sliderTeardowns.push(() => {
        gsap.ticker.remove(pressTick);
        window.removeEventListener('mouseup', finish);
        window.removeEventListener('touchend', finish);
        window.removeEventListener('touchcancel', finish);
      });
    }

    // Smooothy's own internal "last update" timestamp starts at 0, not the
    // moment the instance is created — so its very first update() call
    // (whenever that ends up being, which can be long after page load for
    // a slider this far down the page) computes an enormous deltaTime and
    // jumps almost all the way to `target` in a single frame instead of
    // animating smoothly. init() resets that timestamp to now, so the
    // first real update() behaves like any other frame.
    slider.current = slider.target;
    slider.init();

    // Same fix as above, but for every time the slider becomes visible
    // again after a stretch of being invisible (scrolled past, then back
    // to). isVisible is a plain public field Smooothy updates from its own
    // IntersectionObserver, polled here without touching its internals.
    // The decade description waits until its own spot scrolls into view (85%,
    // like [data-line-reveal]), then reveals the same way; after that it switches with the slides.
    let decadeLive = false;
    const decadeTrigger = decadeTimeline && hasScrollTrigger
      ? ScrollTrigger.create({ trigger: root.querySelector('.slider__timeline__list') || (scope || document).querySelector('.slider__timeline__list') || wrapper, start: 'top 85%', once: true, onEnter: () => { decadeLive = true; } })
      : null;
    if (decadeTimeline && !decadeTrigger) decadeLive = true;
    sliderTeardowns.push(() => decadeTrigger && decadeTrigger.kill());

    let wasVisible = slider.isVisible;
    const tick = () => {
      if (slider.isVisible && !wasVisible) {
        // Land on the target outright: current can be stale from the
        // geometry sync, and lerping out of it plays as the whole
        // gallery sliding in from the left.
        slider.current = slider.target;
        slider.init();
      }
      wasVisible = slider.isVisible;
      if (snapAfterResize) {
        snapAfterResize = false;
        if (slider.isDragging) {
          // Mid-drag the finger owns the position: undo the re-target only.
          slider.current = beforeResize.current;
          slider.target = beforeResize.target;
        } else {
          const rest = gsap.utils.clamp(slider.maxScroll, 0, -slider.itemOffsets[settledIndex]);
          slider.current = rest;
          slider.target = rest;
        }
      } else {
        // Nearest slide to where the slider is headed, by our own offsets;
        // Smooothy's currentSlide measures against wrapper-wide slides and
        // reads one ahead.
        let nearest = 0;
        slider.itemOffsets.forEach((offset, i) => {
          if (Math.abs(offset + slider.target) < Math.abs(slider.itemOffsets[nearest] + slider.target)) nearest = i;
        });
        settledIndex = nearest;
      }
      slider.update();

      // b100 — real geometry, not Smooothy internals: whichever slide's
      // own center sits closest to the slider's own horizontal center is
      // "active", checked fresh every frame.
      if (decadeTimeline) {
        const wrapperRect = wrapper.getBoundingClientRect();
        const wrapperCenter = wrapperRect.left + wrapperRect.width / 2;
        let bestIndex = -1, bestDist = Infinity;
        slides.forEach((slide, i) => {
          if (!decadeKeys[i]) return;
          const rect = slide.getBoundingClientRect();
          const center = rect.left + rect.width / 2;
          const dist = Math.abs(center - wrapperCenter);
          if (dist < bestDist) { bestDist = dist; bestIndex = i; }
        });
        // Diagnostic only — logs every ~30th tick so the console isn't
        // flooded, to confirm the geometry and decadeKeys line up while
        // dragging the slider.
        decadeTickCount++;
        if (decadeTickCount % 30 === 0) {
        }
        if (decadeLive && bestIndex !== -1) decadeTimeline.showDecade(decadeKeys[bestIndex]);
      }
    };
    gsap.ticker.add(tick);
    activeParallaxSliders.push({ slider, tick, teardown: () => sliderTeardowns.forEach((fn) => fn()) });
  });
}