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
});

let lenis = null;
let nextPage = document;
let onceFunctionsInitialized = false;
let navTimeline = null;
// b83 — true from the moment a Barba navigation starts (barba.hooks.
// before) until closeNavForTransition() has actually run (leave
// timeline's onComplete, screen covered). While true, a link's
// mouseleave is suppressed entirely (see initNavLinkHoverEffects) so its
// hover color doesn't revert to the default while the menu is still
// visually open — see closeNavForTransition's comment for the fuller
// picture; this is the same "keep it visually frozen until actually
// hidden" idea b81 applied to the char roll, now applied to color too.
let navigatingAway = false;
// Instant (non-animated) version of closeNav(), assigned inside
// initFullScreenNavigation. forceResetNavLinks (the full visual close)
// is now called from the leave timeline's onComplete, once the screen is
// actually covered (b81 — see that callback's comment); barba.hooks.
// before calls only disableNavLinkPointerEvents immediately.
let forceResetNavLinks = () => {};
let disableNavLinkPointerEvents = () => {};

// b81 — the actual visual nav close for an in-flight navigation, now
// called from the leave timeline's onComplete (screen fully covered)
// instead of from barba.hooks.before (screen not covered yet). Pulls
// together everything the old hooks.before block used to do
// synchronously: flip the status attribute so CSS treats it as closed,
// pause/reset navTimeline, force-hide the tile, reset hover state, and
// the belt-and-suspenders char reset.
function closeNavForTransition() {
  const navStatusEl = document.querySelector('[data-navigation-status]');
  if (navStatusEl) {
    navStatusEl.setAttribute('data-navigation-status', 'not-active');
  }
  navDebugSnapshot('closeNavForTransition:start (before pause)');
  if (navTimeline) {
    navTimeline.pause(0);
  }
  forceResetNavLinks();
  hardResetNavChars();
  navDebugSnapshot('closeNavForTransition:end (after pause + forceResetNavLinks + hardResetNavChars)');
  navigatingAway = false;
}

const hasLenis = typeof window.Lenis !== "undefined";
const hasScrollTrigger = typeof window.ScrollTrigger !== "undefined";

const rmMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = rmMQ.matches;
rmMQ.addEventListener?.("change", e => (reducedMotion = e.matches));
rmMQ.addListener?.(e => (reducedMotion = e.matches));

const has = (s) => !!nextPage.querySelector(s);

let staggerDefault = 0.05;
let durationDefault = 0.6;

CustomEase.create("osmo", "0.625, 0.05, 0, 1");
gsap.defaults({ ease: "osmo", duration: durationDefault });

// -----------------------------------------
// Build tag
// -----------------------------------------
const BUILD = 'b83';
console.log('[build]', BUILD);

// Temporary diagnostic logging for the hero-video park/reclaim sequence —
// timestamped so the actual gap between "shutter closed" and "new frame
// visible" can be read straight out of the console on a real, focused tab
// (a backgrounded/automated tab throttles rAF and makes the timing here
// meaningless). Remove once the flash-on-return bug is confirmed fixed.
const bunnyLogStart = performance.now();
function bunnyLog() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift('[bunny-park] t=' + (performance.now() - bunnyLogStart).toFixed(0) + 'ms');
  console.log.apply(console, args);
}

// b78 — belt-and-suspenders hard reset, called right alongside
// forceResetNavLinks() in barba.hooks.before. navTimeline.pause(0) SHOULD
// already put every nav-char back to its hidden yPercent:100 (and
// forceResetNavLinks/resetAllLinks already force the hover-roll CLONE
// chars back to their own hidden yPercent:0 — see leave()'s skipRoll
// path), but this explicitly re-asserts both directly via gsap.set()
// rather than relying on the timeline's lazy/cached tween start-values,
// in case THAT'S what's letting the current page's own link render
// briefly visible on the very next openNav(). No-op in the normal case
// where pause(0) already did its job correctly.
function hardResetNavChars() {
  const dbg = window.__navDebug;
  if (!dbg) return;
  const allChars = (dbg.navLinkSplits || []).flatMap(s => s.chars);
  if (allChars.length) gsap.set(allChars, { yPercent: 100 });
  if (dbg.linkConfigs) {
    dbg.linkConfigs.forEach(entry => {
      if (entry.cloneChars) gsap.set(entry.cloneChars, { yPercent: 0 });
    });
  }
}

// Diagnostic only (b79) — b78's snapshots proved SOMETHING sets a nav
// link's .nav-char elements back to a fully-revealed inline transform
// between hooks.enter and hooks.afterEnter, while navTimeline itself sits
// at progress 0 the whole time (so it isn't navTimeline doing it). Rather
// than guess again at what that "something" is, watch the live nav DOM
// for style-attribute mutations and log a stack trace for each one, for a
// few seconds right after a navigation starts — the trace tells us
// exactly which function is responsible.
let navMutationObserver = null;
function watchNavCharMutations() {
  try {
    if (navMutationObserver) { navMutationObserver.disconnect(); navMutationObserver = null; }
    const navEl = document.querySelector('[data-navigation-status]');
    if (!navEl) return;
    navMutationObserver = new MutationObserver(mutations => {
      mutations.forEach(m => {
        const el = m.target;
        if (!(el instanceof Element) || !el.classList.contains('nav-char')) return;
        const linkEl = el.closest('.nav__link');
        bunnyLog('MUTATION on .nav-char — link:', linkEl ? linkEl.className : '(no link)',
          'newTransform:', el.style.transform,
          '\n' + (new Error('nav-char style mutation trace')).stack);
      });
    });
    navMutationObserver.observe(navEl, { subtree: true, attributes: true, attributeFilter: ['style'] });
    bunnyLog('watchNavCharMutations: observing started');
    setTimeout(() => {
      if (navMutationObserver) { navMutationObserver.disconnect(); navMutationObserver = null; bunnyLog('watchNavCharMutations: observing stopped (timeout)'); }
    }, 8000);
  } catch (err) {
    bunnyLog('watchNavCharMutations threw:', err && err.message);
  }
}

// Diagnostic only (b78) — snapshots exactly what the "current page" nav
// link's chars/clone look like at a handful of key moments around a Barba
// navigation, to pin down why its item still shows briefly-visible-then-
// flashes on the FIRST menu open after landing on a new page (but not the
// second). Reads straight off the live nav DOM (via classList / data
// tracked on window.__navDebug, set up by initFullScreenNavigation) rather
// than closing over any particular function's locals, so it can be called
// from anywhere (barba hooks, openNav, initBarbaNavUpdate).
function navDebugSnapshot(label) {
  try {
    const dbg = window.__navDebug;
    if (!dbg) { bunnyLog('navDebugSnapshot(' + label + '): __navDebug not ready yet'); return; }
    const report = dbg.navLinkEls.map((linkEl, i) => {
      if (!linkEl) return { i, cls: '(no linkEl)' };
      const split = dbg.navLinkSplits[i];
      const chars = split ? split.chars : [];
      const entry = dbg.linkConfigs ? dbg.linkConfigs.get(linkEl) : null;
      return {
        i,
        cls: linkEl.className,
        isCurrent: linkEl.classList.contains('w--current'),
        firstCharTransform: chars[0] ? chars[0].style.transform : null,
        lastCharTransform: chars.length ? chars[chars.length - 1].style.transform : null,
        cloneFirstTransform: entry && entry.cloneChars && entry.cloneChars[0] ? entry.cloneChars[0].style.transform : '(no cloneChars)',
        rollTweenActive: !!(entry && entry.rollTween && entry.rollTween.isActive())
      };
    });
    bunnyLog('navDebugSnapshot(' + label + ') navTimeline.progress=' + (dbg.navTimeline ? dbg.navTimeline.progress().toFixed(3) : 'n/a') + ':', JSON.stringify(report));
  } catch (err) {
    bunnyLog('navDebugSnapshot(' + label + ') threw:', err && err.message);
  }
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

function initOnceFunctions() {
  initLenis();
  if (onceFunctionsInitialized) return;
  onceFunctionsInitialized = true;

  // Nav and grid overlay live outside the Barba container, so check
  // document directly and only set them up once.
  if (document.querySelector('[data-navigation-toggle="toggle"]')) {
    initFullScreenNavigation();
  }

  if (document.querySelector('[data-animated-grid]')) {
    initAnimatedGrid();
  }

  if (document.querySelector('.nav__bar')) {
    initNavAutoHide();
  }
}

function initBeforeEnterFunctions(next) {
  nextPage = next || document;

  // Runs before the enter animation
  // if (has('[data-something]')) initSomething();
}

// .nav__logo / .nav__button-label live in the persistent Global component
// (outside the Barba container), so they're the exact same DOM nodes
// across every page. initColorZones() tweens their `color` inline as you
// scroll through a page's own colored sections — but it only runs on a
// page that actually has [data-color-zone] sections, so navigating to a
// page without them (e.g. Orchards → Home, if Home has none) left that
// inline color from the previous page stuck on the nav forever, since
// nothing ever cleared it.
//
// Originally this reset ran in initAfterEnterFunctions (barba.hooks.
// afterEnter), which only fires once the enter animation's whole promise
// resolves — well after the incoming page is already visible. That meant
// the nav would render in its stale, wrong color the instant the page
// faded in, then visibly snap to correct a beat later: a brown-then-white
// flash instead of no flash at all. Calling this from the leave timeline's
// onComplete instead — the same moment reparentBunnyPlayers/current.remove()
// already run, screen still fully covered by the transition panel — means
// the nav is already correct before anyone can see it.
function resetPersistentNavColor(next) {
  const navLogoEl = document.querySelector('.nav__logo');
  const menuLabelEl = document.querySelector('.nav__button-label');
  const navTargets = [navLogoEl, menuLabelEl].filter(Boolean);
  if (!navTargets.length) return;

  gsap.set(navTargets, { clearProps: 'color' });

  // If the incoming page defines its own resting override (see
  // initColorZones' own data-nav-default-color handling), apply it now
  // too, from the incoming container directly (already in the DOM by
  // this point, just not yet visible) rather than waiting for
  // initColorZones to run later in afterEnter.
  const target = next ? next.querySelector('[data-color-zone-target]') : null;
  const overrideKey = target ? target.getAttribute('data-nav-default-color') : null;
  const override = overrideKey ? COLORS[overrideKey] : null;
  if (override) {
    gsap.set(navTargets, { color: override });
  }
}

function initAfterEnterFunctions(next) {
  nextPage = next || document;

  // Runs after enter animation completes
  //
  // [data-line-reveal] and .text-display-large/medium are handled earlier
  // now — prepared (SplitText + hidden) from the leave timeline's
  // onComplete and activated (ScrollTriggers created) at the enter
  // timeline's "startEnter" label — see prepareLineReveal/activateLineReveal
  // and prepareDisplayLargeReveal/activateDisplayLargeReveal. Left out of
  // this function entirely for a real transition; runPageOnceAnimation
  // calls both halves together for the true first load, which has no
  // covered window to prepare behind.
  if (has('[data-bunny-background-init]')) initBunnyPlayerBackground(nextPage);
  if (has('[data-parallax="trigger"]')) initGlobalParallax(nextPage);
  if (has('.section__about')) initHeroAboutParallax(nextPage);
  if (has('.btn')) initButtonHoverFocus(nextPage);
  if (has('[data-color-zone]')) initColorZones(nextPage);


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

function runPageOnceAnimation(next) {
  const tl = gsap.timeline();

  tl.call(() => {
    resetPage(next);
  }, null, 0);

  tl.call(() => {
    // True first load has no covered-transition window to prepare behind
    // — page is visible from the start — so prepare and activate/play
    // together, same as a real transition's two halves normally split
    // across leave's onComplete and enter's "startEnter".
    playLoadReveal(prepareLoadReveal(next));
    activateLineReveal(prepareLineReveal(next));
    activateDisplayLargeReveal(prepareDisplayLargeReveal(next));
  }, null, 0);

  return tl;
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

function runPageLeaveAnimation(current, next) {
  const transitionWrap = document.querySelector("[data-transition-wrap]");
  const transitionPanel = transitionWrap.querySelector("[data-transition-panel]");
  const transitionPanelTop = transitionWrap.querySelector("[data-transition-panel-top]");
  const transitionPanelBottom = transitionWrap.querySelector("[data-transition-panel-bottom]");
  const transitionLogo = transitionWrap.querySelector("[data-transition-logo]");

  const tl = gsap.timeline({
    onComplete: () => {
      // Screen is fully covered by the transition panel at this point —
      // safe to hand off/park any persistent bunny players without the
      // user seeing them move.
      bunnyLog('leave timeline onComplete fired — shutter should be fully closed now');
      reparentBunnyPlayers(current, next);
      // b81 — nav is only actually closed here, now that the panel has
      // covered the screen (see barba.hooks.before's comment for why).
      // If the user navigated via a link/CTA that isn't the nav menu at
      // all, the menu was never open and this is a harmless no-op
      // (navTimeline pausing at/staying at 0).
      closeNavForTransition();
      navDebugSnapshot('leave.onComplete: before resetPersistentNavColor');
      resetPersistentNavColor(next);
      navDebugSnapshot('leave.onComplete: after resetPersistentNavColor');
      // Prepared here (hidden state only) while still covered; actually
      // played/activated later from runPageEnterAnimation's "startEnter"
      // label. Each guarded independently — one throwing (e.g. a stale
      // SplitText on a persistent nav element) must not skip the others,
      // or everything after it silently never gets its hidden/prepared
      // state and stays invisible for good.
      try {
        pendingLoadReveal = prepareLoadReveal(next);
      } catch (err) {
        bunnyLog('prepareLoadReveal threw — continuing anyway:', err && err.message);
        pendingLoadReveal = null;
      }
      navDebugSnapshot('leave.onComplete: after prepareLoadReveal');
      try {
        pendingLineReveals = prepareLineReveal(next);
      } catch (err) {
        bunnyLog('prepareLineReveal threw — continuing anyway:', err && err.message);
        pendingLineReveals = null;
      }
      navDebugSnapshot('leave.onComplete: after prepareLineReveal');
      try {
        pendingDisplayLargeReveals = prepareDisplayLargeReveal(next);
      } catch (err) {
        bunnyLog('prepareDisplayLargeReveal threw — continuing anyway:', err && err.message);
        pendingDisplayLargeReveals = null;
      }
      navDebugSnapshot('leave.onComplete: after prepareDisplayLargeReveal');
      current.remove();
      navDebugSnapshot('leave.onComplete: after current.remove()');
    }
  });

  if (reducedMotion) {
    // Immediate swap behavior if user prefers reduced motion
    return tl.set(current, { autoAlpha: 0 });
  }

  tl.set(transitionPanel, {
    autoAlpha: 1
  }, 0);

  tl.set(transitionPanelTop, {
    scaleY: 0,
    height: "15vw"
  }, 0);

  tl.set(transitionPanelBottom, {
    scaleY: 1,
    height: "20vw"
  }, 0);

  // Logo: fade + small rise + bouncy scale pop, as one unit.
  tl.set(transitionLogo, {
    autoAlpha: 0,
    y: 16,
    scale: 0.7
  }, 0);

  tl.set(next,{
    autoAlpha: 0
  }, 0);

  tl.fromTo(transitionPanel,{
    yPercent: 0
  },{
    yPercent: -100,
    duration: 1,
  }, 0);

  tl.fromTo(transitionPanelTop,{
    scaleY: 0
  },{
    scaleY: 1,
    duration: 1,
  }, "<");

  tl.to(transitionLogo, {
    autoAlpha: 1,
    y: 0,
    scale: 1,
    duration: 0.7,
    ease: "back.out(1.7)"
  }, "<+=0.4");

  tl.fromTo(current,{
    y: "0vh"
  },{
    y: "-15dvh",
    duration: 1,
  }, 0);
}

function runPageEnterAnimation(next){
  const transitionWrap = document.querySelector("[data-transition-wrap]");
  const transitionPanel = transitionWrap.querySelector("[data-transition-panel]");
  const transitionPanelBottom = transitionWrap.querySelector("[data-transition-panel-bottom]");
  const transitionLogo = transitionWrap.querySelector("[data-transition-logo]");

  const tl = gsap.timeline();

  if (reducedMotion) {
    // Immediate swap behavior if user prefers reduced motion — settle any
    // prepared hero intro straight to its finished state rather than
    // playing the roll-in.
    if (pendingLoadReveal) {
      const { allChars, menuChars, logo } = pendingLoadReveal;
      if (allChars.length) gsap.set(allChars, { yPercent: 0 });
      if (menuChars) gsap.set(menuChars, { yPercent: 0 });
      if (logo) gsap.set(logo, { autoAlpha: 1, y: 0, scale: 1 });
      pendingLoadReveal = null;
    }
    (pendingLineReveals || []).forEach(({ split }) => gsap.set(split.lines, { yPercent: 0 }));
    pendingLineReveals = null;
    (pendingDisplayLargeReveals || []).forEach(({ split }) => gsap.set(split.chars, { autoAlpha: 1, yPercent: 0, rotateY: 0 }));
    pendingDisplayLargeReveals = null;
    tl.set(next, { autoAlpha: 1 });
    tl.add("pageReady")
    tl.call(resetPage, [next], "pageReady");
    return new Promise(resolve => tl.call(resolve, null, "pageReady"));
  }

  // Hold so the bouncy logo has a beat to land before the reveal begins.
  tl.add("startEnter", 1.8);

  tl.call(() => {
    bunnyLog('enter timeline reaches startEnter — next page about to fade in (autoAlpha:1)');
    // Play the hero intro (prepared earlier, hidden, in the leave
    // timeline's onComplete) right as the page becomes visible, so the
    // roll-in is what's actually seen, not something already finished.
    // This one is safe to run here: it only drives immediate .to() tweens,
    // not ScrollTrigger, so it doesn't care that `next` is still
    // position:fixed at this point.
    // Guarded: a throw in here must not stop the rest of this GSAP
    // timeline (transitionPanel/logo tweens, and the later "pageReady"
    // scroll-reveal activation) from running.
    try {
      playLoadReveal(pendingLoadReveal);
    } catch (err) {
      bunnyLog('playLoadReveal threw — continuing anyway:', err && err.message);
    }
    pendingLoadReveal = null;
  }, null, "startEnter");

  tl.set(next, {
    autoAlpha: 1,
  }, "startEnter");

  tl.fromTo(transitionPanel, {
    yPercent: -100,
  },{
    yPercent: -200,
    duration: 1,
    overwrite: "auto",
    immediateRender: false
  }, "startEnter");

  tl.fromTo(transitionPanelBottom,{
    scaleY: 1
  },{
    scaleY: 0,
    duration: 1,
  }, "<");

  tl.set(transitionPanel, {
    autoAlpha: 0
  }, ">");

  tl.to(transitionLogo, {
    autoAlpha: 0,
    y: -16,
    scale: 0.7,
    duration: 0.5,
    ease: "back.in(1.7)"
  }, "startEnter-=0.2");

  tl.from(next, {
    y: "25dvh",
    duration: 1,
  }, "startEnter");

  tl.add("pageReady");
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
    bunnyLog('enter timeline reaches pageReady — activating scroll reveals, pendingLineReveals=', pendingLineReveals ? pendingLineReveals.length : pendingLineReveals, 'pendingDisplayLargeReveals=', pendingDisplayLargeReveals ? pendingDisplayLargeReveals.length : pendingDisplayLargeReveals);
    try {
      activateLineReveal(pendingLineReveals);
    } catch (err) {
      bunnyLog('activateLineReveal threw — continuing anyway:', err && err.message);
    }
    pendingLineReveals = null;
    try {
      activateDisplayLargeReveal(pendingDisplayLargeReveals);
    } catch (err) {
      bunnyLog('activateDisplayLargeReveal threw — continuing anyway:', err && err.message);
    }
    pendingDisplayLargeReveals = null;
  }, null, "pageReady");

  return new Promise(resolve => {
    tl.call(resolve, null, "pageReady");
  });
}


// -----------------------------------------
// BARBA HOOKS + INIT
// -----------------------------------------

document.addEventListener('DOMContentLoaded', function () {

barba.hooks.before(data => {
  // b81: leave the open menu visually in place through the leave
  // transition (data-navigation-status stays 'active', navTimeline and
  // the nav-char transforms untouched) instead of snapping it shut
  // instantly here. Closing it immediately — the old behavior — exposed
  // the outgoing page underneath for however long the transition panel
  // took to slide in and cover the screen, seen as a flash of the page's
  // own background between "menu just closed" and "panel has caught up".
  // The actual close (see closeNavForTransition, called from the leave
  // timeline's onComplete below) now happens only once the panel has
  // actually finished covering, so nothing underneath is ever exposed.
  //
  // Pointer-events are still disabled right away, though, so nothing in
  // the (still visually open) menu can be clicked/hovered again mid-transition.
  disableNavLinkPointerEvents();
  // b83 — also suppress the hover mouseleave's color revert for the same
  // reason: see navigatingAway's own comment and the mouseleave listener
  // in initNavLinkHoverEffects.
  navigatingAway = true;
  navDebugSnapshot('hooks.before:start (menu left open through the leave transition)');
  // watchNavCharMutations() removed from here (b80) — its per-frame
  // logging during the normal open/close char animation produced a
  // multi-MB console log with nothing new in it now that the actual
  // "flash on first open" root cause (the stray mouseleave in the roll-
  // hover listener) is confirmed fixed. Call it manually from the
  // console (window.__navDebugWatch = watchNavCharMutations) if a similar
  // mystery-mutation hunt is needed again.
  window.__navDebugWatch = watchNavCharMutations;

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
    bunnyLog('afterLeave: killing', toKill.length, 'stale ScrollTrigger(s) —', toKill.map(t => (t.trigger && (t.trigger.className || t.trigger.tagName)) || t.vars.id || 'unnamed'));
    toKill.forEach(trigger => trigger.kill());
  }
  // Container is already removed from the DOM, but still detached —
  // tear down its HLS.js/IntersectionObserver instances explicitly.
  if (data && data.current && data.current.container) {
    destroyBunnyPlayers(data.current.container);
  }
});

barba.hooks.enter(data => {
  navDebugSnapshot('hooks.enter:before initBarbaNavUpdate');
  initBarbaNavUpdate(data);
  navDebugSnapshot('hooks.enter:after initBarbaNavUpdate');
})

barba.hooks.afterEnter(data => {
  navDebugSnapshot('hooks.afterEnter:start');
  bunnyLog('afterEnter fired — about to run initAfterEnterFunctions + ScrollTrigger.refresh(), current ScrollTrigger count', (typeof ScrollTrigger !== 'undefined' ? ScrollTrigger.getAll().length : 'n/a'));
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

barba.init({
  debug: true, // Set to 'false' in production
  timeout: 7000,
  preventRunning: true,
  transitions: [
    {
      name: "default",
      sync: true,

      // First load
      async once(data) {
        initOnceFunctions();

        return runPageOnceAnimation(data.next.container);
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
    // Diagnostic only (b78) — confirms exactly which nodes get their class
    // attribute swapped here (and whether it's the .nav__link itself) and
    // whether that swap coincides with the "current link visible then
    // flashes" symptom seen only on the first menu-open after navigation.
    if (oldClassList !== newClassList) {
      bunnyLog('initBarbaNavUpdate: class sync on', curr.tagName, '-', JSON.stringify(oldClassList), '->', JSON.stringify(newClassList));
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
// Split the same way as Home's hero intro (see prepareLoadReveal/
// playLoadReveal) and for the same reason: this used to run entirely from
// barba.hooks.afterEnter, well after the incoming page was already
// visible — so a heading sat fully visible as plain static text for over
// a second, then abruptly snapped hidden and played its reveal. Splitting
// it lets the hidden state get set up while the page is still covered
// (prepareLineReveal, called from the leave timeline's onComplete) and
// only creates the ScrollTriggers that actually fire the reveal once the
// page is about to be shown (activateLineReveal, at "startEnter") — so an
// above-the-fold heading reveals right as it appears, instead of already
// finished or still fully visible and un-split.
function prepareLineReveal(scope) {
  if (typeof SplitText === "undefined" || typeof ScrollTrigger === "undefined") return [];

  const targets = (scope || document).querySelectorAll('[data-line-reveal]');
  const prepared = [];
  targets.forEach(el => {
    const split = new SplitText(el, { type: "lines", mask: "lines" });
    gsap.set(split.lines, { yPercent: 120 });

    // Per-element override — e.g. footer links set data-line-reveal-start="top 100%"
    // so they trigger right as they reach the viewport, instead of the
    // page-wide default of "top 90%".
    const start = el.getAttribute('data-line-reveal-start') || 'top 90%';
    prepared.push({ split, start, trigger: el });
  });
  return prepared;
}

function activateLineReveal(prepared) {
  bunnyLog('activateLineReveal: activating', (prepared || []).length, 'prepared reveal(s)');
  (prepared || []).forEach(({ split, start, trigger }) => {
    ScrollTrigger.create({
      trigger: trigger,
      start: start,
      once: true,
      onEnter: () => {
        bunnyLog('activateLineReveal: onEnter fired for', trigger.className || trigger.tagName);
        gsap.to(split.lines, {
          yPercent: 0,
          duration: 1.9,
          ease: "expo.out",
          stagger: { each: 0.05, from: "start" }
        });
      }
    });
  });
  bunnyLog('activateLineReveal: done, ScrollTrigger count now', (typeof ScrollTrigger !== 'undefined' ? ScrollTrigger.getAll().length : 'n/a'));
}

let navTextSplits = [];

function buildNavTimeline({ tileFill, navUl, navBottom, navLogoText, navLogo, navLogoSecondary, navLinkEls, navLinkSplits, topSecondarySplits, bottomSecondarySplits, closeIcon, menuLabel, onReady, onLinkReady }) {
  // Main link chars roll up into place on open, masked by the same
  // wrapper the hover roll effect uses. Local CHAR_TRAVEL/CHAR_EASE so
  // they don't also affect display-large's reveal, which shares
  // NAV_CHAR_ANIM.
  const CHAR_TRAVEL = 100;
  const CHAR_DURATION = NAV_CHAR_ANIM.duration;
  const CHAR_STAGGER = NAV_CHAR_ANIM.stagger;
  const CHAR_EASE = 'osmo';
  const LINKS_START = 0.25;    // when the first link's characters start

  const linkChars = navLinkSplits.flatMap(split => split.chars);
  gsap.set(linkChars, {
    yPercent: CHAR_TRAVEL
  });

  const topLines = topSecondarySplits.flatMap(s => s.lines);
  const bottomLines = bottomSecondarySplits.flatMap(s => s.lines);
  gsap.set([...topLines, ...bottomLines], { yPercent: 100 });
  // Same starting state as the page transition's logo bounce-in.
  if (navLogoSecondary) gsap.set(navLogoSecondary, { autoAlpha: 0, y: 16, scale: 0.7 });
  if (closeIcon) gsap.set(closeIcon, { autoAlpha: 0, y: 16, scale: 0.7 });

  const tl = gsap.timeline({ paused: true });

  tl.set([navUl, navBottom, navLogoText].filter(Boolean), { autoAlpha: 1 }, 0);

  // Top-bar logo and "Menu" label fade out as soon as the panel opens.
  if (navLogo) {
    tl.to(navLogo, { autoAlpha: 0, duration: 0.3, ease: "power2.out" }, 0);
  }

  if (menuLabel) {
    tl.to(menuLabel, { autoAlpha: 0, duration: 0.3, ease: "power2.in" }, 0);
  }

  // Explicit starting scale — Webflow's Transform panel can leave stray
  // scale/rotate CSS that GSAP would otherwise read instead of `transform`.
  gsap.set(tileFill, { scaleY: 0, transformOrigin: "top" });

  // Same panel-reveal mechanic as the page transition, just faster.
  tl.to(tileFill, {
    scaleY: 1,
    duration: 1,
    ease: "osmo"
  }, 0);

  // Main links — one .to() per link (not one flattened array) so each
  // link's own finish time can be computed and its pointer-events
  // re-enabled right then, rather than waiting on the whole group.
  let charOffset = 0;
  navLinkSplits.forEach((split, i) => {
    const chars = split.chars;
    const startTime = LINKS_START + charOffset * CHAR_STAGGER;

    const linkElForLog = navLinkEls && navLinkEls[i];
    bunnyLog('buildNavTimeline: link', i, linkElForLog ? linkElForLog.className : '(no linkEl)',
      'charCount=', chars.length, 'startTime=', startTime.toFixed(3),
      'stillInDom=', chars[0] ? document.body.contains(chars[0]) : 'n/a');

    tl.to(chars, {
      yPercent: 0,
      duration: CHAR_DURATION,
      ease: CHAR_EASE,
      stagger: { each: CHAR_STAGGER, from: "start" }
    }, startTime);

    const finishTime = startTime + Math.max(0, chars.length - 1) * CHAR_STAGGER + CHAR_DURATION;
    const linkEl = navLinkEls && navLinkEls[i];
    if (linkEl) {
      // Plain DOM write, not tl.set() — a timeline-tracked property gets
      // re-asserted on reverse and would undo closeNav()'s pointer-events
      // reset.
      tl.call(() => { if (onLinkReady) onLinkReady(linkEl); }, null, finishTime);
    }

    charOffset += chars.length;
  });

  // Marks when the whole link group is done (dimming, secondary elements).
  const linksGroupEnd = LINKS_START + charOffset * CHAR_STAGGER + CHAR_DURATION;
  tl.addLabel("linksDone", linksGroupEnd);
  tl.call(() => { if (onReady) onReady(); }, null, "linksDone");

  // Secondary logo mark — bounces in over the tail of the main links.
  if (navLogoSecondary) {
    tl.to(navLogoSecondary, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.7,
      ease: "back.out(1.7)"
    }, "linksDone-=0.3");
  }

  // Top logo text + bottom links, overlapping the secondary logo.
  tl.to(topLines, {
    yPercent: 0,
    duration: 0.7,
    ease: "power3.out",
    stagger: 0.05
  }, "linksDone-=0.15");

  tl.to(bottomLines, {
    yPercent: 0,
    duration: 0.7,
    ease: "power3.out",
    stagger: 0.05
  }, "linksDone-=0.15");

  // X icon — same bounce as the secondary logo. Folded into this
  // timeline so open/close both handle it via play()/reverse().
  if (closeIcon) {
    tl.set(closeIcon, { display: "block" }, 1);
    tl.to(closeIcon, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.7,
      ease: "back.out(1.7)"
    }, 1);
  }

  // Diagnostic only — confirms whether the whole open animation actually
  // reaches 100% each time it's played, and logs per-char state for every
  // link right at that moment so a link that silently never left its
  // hidden yPercent:100 state (reported: current page's own nav item
  // looks static while opening) shows up directly in the console.
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
    bunnyLog('navTimeline onComplete — per-link char state:', JSON.stringify(report));
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
  ease: "power3.out"
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

  // Roll-hover wraps below get an explicit pixel width baked in from a
  // getBoundingClientRect() measurement, taken once here at first page
  // load (this whole function only ever runs once, from
  // initFullScreenNavigation via initOnceFunctions). If the custom
  // webfont hasn't finished loading yet at that exact moment, the
  // measurement is taken against the fallback font's (narrower) metrics
  // — then the real font swaps in moments later, rendering wider, but
  // the wrap's cached width never gets updated, so the now-wider text
  // clips at both edges. Collected here so they can be re-measured once
  // the real fonts are confirmed ready, below.
  const rollWrapMeasurements = [];

  // Text + bottom logo mark + close icon all share the same color tween.
  const colorTargets = [
    ...navEl.querySelectorAll('.nav__link'),
    ...navEl.querySelectorAll('.nav__text-secondary'),
    ...navEl.querySelectorAll('.nav__logo-secondary'),
    ...navEl.querySelectorAll('.nav__button__close'),
    ...navEl.querySelectorAll('.nav__image-caption')
  ];

  const defaultBg = getComputedStyle(tileFill).backgroundColor;
  const defaultColors = colorTargets.map(el => getComputedStyle(el).color);

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
      captionSplit = new SplitText(caption, { type: "lines,words", mask: "lines" });
      gsap.set(captionSplit.words, { yPercent: 110 });
    }

    // Escapes' alt text ("Coming Soon") is only a source for the roll
    // clone below now — hide the original element so it doesn't sit
    // overlaid on "Escapes".
    const altEl = link.querySelector('.nav__link-text-alt');
    if (altEl) gsap.set(altEl, { display: 'none' });

    // GSAP-driven underline, replacing [data-underline-link]'s CSS
    // pseudo-element for these links (GSAP can't tween ::before/::after
    // directly). Skipped for Escapes — its roll clone already carries
    // the hover weight, and the underline read as redundant.
    let underline = null;
    if (!altEl) {
      underline = document.createElement('span');
      underline.setAttribute('aria-hidden', 'true');
      underline.style.cssText =
        `position:absolute;bottom:-0.0625em;left:0;width:100%;height:max(${UNDERLINE_HEIGHT}, 1px);` +
        'background-color:currentColor;pointer-events:none;';
      if (getComputedStyle(link).position === 'static') link.style.position = 'relative';
      link.appendChild(underline);
      gsap.set(underline, { scaleX: 0, transformOrigin: 'right' });
    }

    // Roll-hover clone: original line reused as-is (already split for
    // the menu-open reveal), only the clone is newly created — normally
    // a duplicate of the same text, but "Coming Soon" for Escapes.
    const linkTextEl = link.querySelector('.nav__link-text:not(.nav__link-text-alt)');
    const origSplit = originalSplitByLink.get(link);
    let rollPairs = null;
    let cloneChars = null;
    if (origSplit && linkTextEl && linkTextEl.parentNode) {
      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:inline-block;overflow:hidden;position:relative;vertical-align:top;';
      linkTextEl.parentNode.insertBefore(wrap, linkTextEl);
      wrap.appendChild(linkTextEl);   // normal flow for now, just to measure

      const cloneLabel = altEl ? altEl.textContent.trim() : linkTextEl.textContent;

      const cloneWrap = document.createElement('span');
      cloneWrap.setAttribute('aria-hidden', 'true');
      cloneWrap.style.cssText = 'white-space:nowrap;';
      cloneWrap.textContent = cloneLabel;
      wrap.appendChild(cloneWrap);   // also normal flow for now, just to measure

      // Explicit measured width (not CSS auto-sizing) — both lines are
      // centered independently via absolute positioning inside it.
      const origWidth = linkTextEl.getBoundingClientRect().width;
      const origHeight = linkTextEl.getBoundingClientRect().height;
      const cloneWidth = cloneWrap.getBoundingClientRect().width;
      wrap.style.width = Math.max(origWidth, cloneWidth) + 'px';
      // Height too — both lines go position:absolute below and would
      // otherwise contribute nothing to wrap's own height.
      wrap.style.height = origHeight + 'px';
      rollWrapMeasurements.push({ wrap, linkTextEl, cloneWrap });

      linkTextEl.style.cssText += 'position:absolute;top:0;left:50%;';
      gsap.set(linkTextEl, { xPercent: -50 });

      cloneWrap.style.cssText += 'position:absolute;top:0;left:50%;';

      // b82: the clone's chars used to come from a second, independent
      // SplitText({type:'chars'}) call on the same text. b80 tried
      // matching its reduceWhiteSpace option to the original split's —
      // that helped on some links ("Our Approach", Escapes/"Coming
      // Soon") but not others ("Our Story" -> "OU RSTORY"), which means
      // the real issue is SplitText's char-mode space handling itself
      // being inconsistent from link to link, not just that one option.
      // Rather than keep chasing SplitText's behavior, build the clone's
      // characters by hand — one <span> per character straight from the
      // known-correct source string, in guaranteed left-to-right order,
      // with a non-breaking space standing in for a literal space (a
      // lone space character in its own inline-block span is exactly
      // the kind of thing browsers can collapse to zero width). This
      // removes the second SplitText call — and its inconsistency —
      // entirely, uniformly for every nav link.
      cloneWrap.textContent = '';
      cloneChars = Array.from(cloneLabel).map(ch => {
        const charEl = document.createElement('span');
        charEl.className = 'nav-char';
        charEl.style.display = 'inline-block';
        charEl.textContent = ch === ' ' ? ' ' : ch;
        cloneWrap.appendChild(charEl);
        return charEl;
      });
      gsap.set(cloneWrap, { xPercent: -50, yPercent: 100 });

      // Diagnostic only (b80) — confirms whether the clone's char DOM
      // order is already wrong the instant it's built (a SplitText
      // whitespace-handling issue) vs. correct here and corrupted later
      // by something else. Logs the ACTUAL rendered reading order
      // (chars[].textContent joined) for both the clone and the
      // original, straight after the split.
      bunnyLog('roll-hover clone built for', link.className,
        '— cloneWrap.textContent=', JSON.stringify(cloneWrap.textContent),
        'cloneChars joined=', JSON.stringify(cloneChars.map(c => c.textContent).join('')),
        'origSplit.chars joined=', JSON.stringify(origSplit.chars.map(c => c.textContent).join('')));

      // Paired index-by-index up to the LONGER of the two (Escapes vs.
      // Coming Soon differ in length) so no extra clone chars are left
      // out of the animation.
      const maxLen = Math.max(origSplit.chars.length, cloneChars.length);
      const pairs = [];
      for (let i = 0; i < maxLen; i++) {
        if (origSplit.chars[i]) pairs.push(origSplit.chars[i]);
        if (cloneChars[i]) pairs.push(cloneChars[i]);
      }
      rollPairs = pairs;
    }

    linkConfigs.set(link, {
      config, image, caption, captionSplit, originalSplit: origSplit, underline, rollPairs,
      // Tracked separately from rollPairs (which mixes orig + clone chars)
      // so a skipped-roll close (see leave()'s skipRoll) can still force
      // just the clone back to its hidden position — see that comment for
      // why this is necessary even though navTimeline "owns" the reset.
      cloneChars
    });
  });

  // Re-measure once the real webfonts are confirmed loaded (see comment
  // where rollWrapMeasurements is declared above) — corrects any wrap
  // whose width was baked in against fallback-font metrics.
  if (rollWrapMeasurements.length && typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      rollWrapMeasurements.forEach(({ wrap, linkTextEl, cloneWrap }) => {
        const w = Math.max(linkTextEl.getBoundingClientRect().width, cloneWrap.getBoundingClientRect().width);
        const h = linkTextEl.getBoundingClientRect().height;
        if (w) wrap.style.width = w + 'px';
        if (h) wrap.style.height = h + 'px';
      });
    });
  }

  let activeLink = null;
  let imageRevealTimer = null;

  function enter(link) {
    const entry = linkConfigs.get(link);
    if (!entry) return;
    activeLink = link;
    // Diagnostic only (b80) — re-checks the clone's DOM reading order at
    // the actual moment of hover, to compare against the build-time log
    // and confirm whether it's still correct here (pointing at a later
    // corruption) or already wrong (pointing at the initial split/build).
    if (entry.cloneChars) {
      bunnyLog('enter() hover on', link.className,
        '— cloneChars joined=', JSON.stringify(entry.cloneChars.map(c => c.textContent).join('')));
    }
    gsap.to(tileFill, { backgroundColor: entry.config.bg, duration: 0.6, ease: 'power2.out', overwrite: 'auto' });
    gsap.to(colorTargets, { color: entry.config.color, duration: 0.6, ease: 'power2.out', overwrite: 'auto' });

    // Underline grows in, delayed to start once the char-shuffle's exit
    // phase has finished.
    if (entry.underline) {
      gsap.killTweensOf(entry.underline);
      gsap.set(entry.underline, { transformOrigin: 'left' });
      gsap.to(entry.underline, {
        scaleX: 1,
        duration: UNDERLINE_DURATION,
        ease: 'osmo',
        delay: NAV_UNDERLINE_DELAY,
        overwrite: 'auto'
      });
    }

    // Roll hover — original exits upward, clone rises into place below.
    // entry.rollPairs includes the SAME .nav-char elements the shared
    // navTimeline drives for the menu's own open/close reveal (origSplit
    // is the split already built for that reveal, reused here rather
    // than re-split). `overwrite: true` here used to kill whatever
    // tween currently owns yPercent on those elements — which, right
    // after the menu opens, IS navTimeline's own internal child tween
    // for this link's chars, not just a previous hover tween. Once
    // killed, navTimeline permanently loses control of those chars: its
    // own reveal can stall mid-flight, and closing the menu (which
    // deliberately skips re-running this same tween on close — see
    // leave()'s skipRoll — because navTimeline was supposed to still
    // own the reset) leaves the text stuck wherever the hover left it.
    // Fixed by only ever killing OUR OWN previous hover tween
    // (tracked per-entry) instead of a blanket overwrite, so this never
    // reaches into navTimeline's tweens.
    if (entry.rollPairs) {
      if (entry.rollTween) entry.rollTween.kill();
      entry.rollTween = gsap.to(entry.rollPairs, {
        yPercent: -100,
        stagger: { amount: 0.2 },
        duration: 0.65,
        ease: 'osmo',
        overwrite: false
      });
    }

    // Hover-intent delay — a quick flick through links shouldn't start
    // the image reveal at all. Only plays if still active after the delay.
    clearTimeout(imageRevealTimer);
    if (entry.image) {
      imageRevealTimer = setTimeout(() => {
        if (activeLink !== link) return;
        gsap.killTweensOf(entry.image);
        gsap.to(entry.image, { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 0.8, ease: 'power3.out' });
        if (entry.captionSplit) {
          gsap.to(entry.captionSplit.words, {
            yPercent: 0,
            duration: 0.6,
            ease: 'power3.out',
            stagger: 0.04
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
    gsap.to(tileFill, { backgroundColor: defaultBg, duration: 0.5, ease: 'power2.out', overwrite: 'auto' });
    colorTargets.forEach((el, i) => {
      gsap.to(el, { color: defaultColors[i], duration: 0.5, ease: 'power2.out', overwrite: 'auto' });
    });
    if (entry.underline) {
      gsap.killTweensOf(entry.underline);
      // Origin snaps to right instantly, matching the CSS.
      gsap.set(entry.underline, { transformOrigin: 'right' });
      gsap.to(entry.underline, {
        scaleX: 0,
        duration: UNDERLINE_DURATION,
        ease: 'osmo',
        overwrite: 'auto'
      });
    }
    // Skipped on menu close (opts.skipRoll, set by resetAllLinks below) —
    // navTimeline's own reverse() handles putting the ORIGINAL chars back
    // to hidden, so animating entry.rollPairs here would just be
    // unnecessary stacking on top of that (both use overwrite:false, see
    // enter()'s comment).
    //
    // BUT rollPairs also includes the CLONE chars (the roll-hover's
    // duplicate word, revealed on hover) — and navTimeline never touches
    // those at all; it only ever knew about the original SplitText chars.
    // If the menu closes via clicking the very link that's hovered (the
    // normal way someone navigates through the menu) there's no mouseleave
    // to run the real roll-out tween, so skipping it here left the clone
    // sitting fully revealed forever — the next time this same persistent
    // nav item's menu opens (e.g. after landing on the page just
    // navigated to), the clone is already visible before navTimeline's
    // reveal even starts, then the real char reveal plays underneath it —
    // exactly the "visible immediately, then flashes" symptom. Killing any
    // in-flight rollTween and force-resetting just the clone chars (not
    // animated — the menu is closing/covered anyway) fixes that without
    // touching what navTimeline already owns.
    if (entry.rollPairs) {
      if (opts && opts.skipRoll) {
        if (entry.rollTween) entry.rollTween.kill();
        if (entry.cloneChars) gsap.set(entry.cloneChars, { yPercent: 0 });
      } else {
        if (entry.rollTween) entry.rollTween.kill();
        entry.rollTween = gsap.to(entry.rollPairs, {
          yPercent: 0,
          stagger: { amount: 0.2, from: 'end' },
          duration: 0.65,
          ease: 'osmo',
          overwrite: false
        });
      }
    }
    if (entry.image) {
      gsap.killTweensOf(entry.image);
      gsap.to(entry.image, { clipPath: 'inset(100% 0% 0% 0%)', scale: 1.05, duration: 0.5, ease: 'power2.in' });
    }
    if (entry.captionSplit) {
      gsap.to(entry.captionSplit.words, {
        yPercent: 110,
        duration: 0.4,
        ease: 'power2.in',
        stagger: 0.03
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
      if (activeLink && activeLink !== link) leave(activeLink);
      enter(link);
    });
    link.addEventListener('mouseleave', () => {
      // b83: skip entirely while a Barba navigation is in flight
      // (navigatingAway, set in barba.hooks.before, cleared once
      // closeNavForTransition actually runs). disableNavLinkPointerEvents()
      // sets pointer-events:none on every link the instant a navigation
      // starts — and the browser fires a REAL mouseleave once it
      // recomputes hit-testing for that, same as it did for display:none
      // pre-b81 (see the b79 fix this replaces). Since b81 the menu stays
      // visually open (and data-navigation-status stays 'active') through
      // the whole leave transition, so the old `isNavActive` check below
      // no longer catches this case — letting leave() run here would
      // revert both this link's chars AND its hover color to default
      // WHILE the menu is still visibly showing them, producing a flash
      // (chars snapping back, color popping back to the default yellow)
      // before the transition panel ever covers the screen. Everything
      // gets reset anyway, invisibly, by closeNavForTransition() once the
      // screen is actually covered — so there's nothing to do here.
      if (navigatingAway) return;
      // Still needed for the ordinary case: nav closed via the close
      // button/background click/Escape sets data-navigation-status to
      // not-active synchronously in closeNav(), and a mouseleave that
      // arrives after that (same pointer-events:none mechanism) is
      // spurious — skip its roll the same way resetAllLinks's own
      // cleanup does, but still let the color settle back to default
      // since the menu really is closing in that case.
      const isNavActive = navEl.getAttribute('data-navigation-status') === 'active';
      leave(link, { skipRoll: !isNavActive });
    });
  });

  // Closing the menu without a genuine mouseleave (close button, Escape,
  // background click) would otherwise leave the last-hovered link's
  // state stuck. skipRoll:true — see leave()'s own note.
  function resetAllLinks() {
    linkConfigs.forEach((entry, link) => leave(link, { skipRoll: true }));
    activeLink = null;
  }

  // Diagnostic only (b78) — exposes linkConfigs (has rollTween/cloneChars
  // per link) so navDebugSnapshot() can inspect hover-roll state alongside
  // navTimeline's own char state.
  return { resetAllLinks, linkConfigs };
}

function initNavButtonCursorClose(navEl) {
  const button = navEl.querySelector('.nav__button');
  const closeIcon = button ? button.querySelector('.nav__button__close') : null;

  // Opacity dim while a nav link is hovered.
  function dimCloseIcon() {
    if (closeIcon) gsap.to(closeIcon, { opacity: 0.4, duration: 0.25, ease: 'power2.in' });
  }

  function undimCloseIcon() {
    if (closeIcon) gsap.to(closeIcon, { opacity: 1, duration: 0.25, ease: 'power2.out' });
  }

  // Subtle scale-down on hover.
  if (button && closeIcon) {
    button.addEventListener('mouseenter', () => {
      gsap.to(closeIcon, { scale: 0.9, duration: 0.3, ease: 'power2.out' });
    });
    button.addEventListener('mouseleave', () => {
      gsap.to(closeIcon, { scale: 1, duration: 0.3, ease: 'power2.out' });
    });
  }

  return { dimCloseIcon, undimCloseIcon };
}

// -----------------------------------------
// NAV AUTO-HIDE ON SCROLL
// -----------------------------------------

// .nav__bar (logo + menu button) slides up out of view on scroll down,
// back in on scroll up. Stays put near the very top of the page and
// while the full-screen menu is open. Set up once — nav lives outside
// the Barba container, so it persists across page transitions.
function initNavAutoHide() {
  if (!hasScrollTrigger) return;

  const navEl = document.querySelector('[data-navigation-status]');
  const navBar = document.querySelector('.nav__bar');
  if (!navEl || !navBar) return;

  let fade = 0; // 0 = fully visible, 1 = fully faded
  let lastScroll = 0;
  let fadeDistance = navBar.offsetHeight;
  window.addEventListener('resize', () => { fadeDistance = navBar.offsetHeight; });

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

      // Full-screen menu open, or barely scrolled — always stay visible.
      if (navEl.getAttribute('data-navigation-status') === 'active' || current < 100) {
        fade = 0;
      } else {
        // Tracks the scroll amount directly (1:1), not a separate
        // animation — fully faded after one bar-height of downward
        // scroll, fully back after the same going up.
        fade = gsap.utils.clamp(0, 1, fade + delta / fadeDistance);
      }

      gsap.set(navBar, { opacity: 1 - fade, pointerEvents: fade > 0.95 ? 'none' : 'auto' });
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
        type: "words,chars",
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
    navDebugSnapshot('openNav:start (before play)');
    navSettled = false;
    readyLinks.clear();
    if (navLinkEls) {
      navLinkEls.forEach(el => { if (el) el.style.pointerEvents = 'none'; });
    }
    if (navTile) navTile.style.display = '';
    navEl.setAttribute('data-navigation-status', 'active');
    if (lenis && typeof lenis.stop === "function") lenis.stop();
    navTimeline.timeScale(OPEN_SPEED).play();
  }

  function closeNav() {
    navSettled = false;
    readyLinks.clear();
    // Plain writes, not gsap.set — pointer-events isn't a tracked
    // timeline property, so this sticks immediately through the reverse.
    if (navLinkEls) {
      navLinkEls.forEach(el => { if (el) el.style.pointerEvents = 'none'; });
    }
    resetLinkHovers();
    navEl.setAttribute('data-navigation-status', 'not-active');
    navTimeline.timeScale(CLOSE_SPEED).reverse();
  }

  // Lenis restarts and display:none only once the close has actually
  // finished — not set inside closeNav(), which would cut it off mid-flight.
  navTimeline.eventCallback("onReverseComplete", () => {
    if (navTile) navTile.style.display = 'none';
    if (lenis && typeof lenis.start === "function") lenis.start();
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
    // Diagnostic only (b78) — see navDebugSnapshot().
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

  // b81: split into an immediate half (just pointer-events, so nothing
  // in the still-visually-open menu can be interacted with again mid-
  // transition) and a deferred half (the actual visual close — display:
  // none, navTimeline/char reset, hover-state cleanup). barba.hooks.
  // before calls the immediate half only; the deferred half is now
  // called from the leave timeline's onComplete instead, once the
  // transition panel has actually covered the screen — see that
  // callback's own comment for why.
  disableNavLinkPointerEvents = () => {
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
    bunnyLog('warmBunnyPlayers: warming', player.getAttribute('data-bunny-id'), 'at start of transition (barba.hooks.before)');
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
    bunnyLog('captureBunnyFrame:', player.getAttribute('data-bunny-id'),
      '— decoded video is', video.videoWidth + 'x' + video.videoHeight,
      '(readyState=' + video.readyState + '), player box is currently', Math.round(pRect.width) + 'x' + Math.round(pRect.height),
      '(needed pixels ~' + Math.round(pRect.width * (window.devicePixelRatio||1)) + 'x' + Math.round(pRect.height * (window.devicePixelRatio||1)) + ' at dpr=' + (window.devicePixelRatio||1) + ')');
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
    bunnyLog('attachBunnyFrameBridge: revealing', player.getAttribute('data-bunny-id'), '—', (performance.now() - revealScheduledAt).toFixed(0) + 'ms after the bridge was attached (had captured frame:', !!canvas, '). Player box at reveal:', Math.round(revealRect.width) + 'x' + Math.round(revealRect.height),
      liveVideo ? ('— live decoded video now ' + liveVideo.videoWidth + 'x' + liveVideo.videoHeight) : '');
    player.setAttribute('data-player-status', 'playing');
    if (bridge && bridge.parentNode) bridge.parentNode.removeChild(bridge);
  };

  if (canvas) {
    var attachRect = player.getBoundingClientRect();
    bunnyLog('attachBunnyFrameBridge: attaching bridge for', player.getAttribute('data-bunny-id'), '— captured canvas is', canvas.width + 'x' + canvas.height, 'player box at attach:', Math.round(attachRect.width) + 'x' + Math.round(attachRect.height));
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
  bunnyLog('reparentBunnyPlayers: current has',
    current ? current.querySelectorAll('[data-bunny-persist="true"][data-bunny-id]').length : 0,
    'persistent player(s) to hand off; parkedBunnyPlayers map currently holds', parkedBunnyPlayers.size, 'id(s):', Array.from(parkedBunnyPlayers.keys()));

  if (current) {
    current.querySelectorAll('[data-bunny-persist="true"][data-bunny-id]').forEach(function(player) {
      var id = player.getAttribute('data-bunny-id');
      if (!id) return;

      var placeholder = next
        ? next.querySelector('[data-bunny-background-init][data-bunny-id="' + id + '"]')
        : null;

      if (placeholder) {
        bunnyLog('reparentBunnyPlayers:', id, '— found matching placeholder in next, swapping directly (no park)');
        // Grab the frame before the move rebuilds the video's compositing
        // surface and blanks/blurs it for a beat.
        var frame = captureBunnyFrame(player);
        placeholder.replaceWith(player);
        resumeReparentedPlayer(player, frame);
      } else {
        bunnyLog('reparentBunnyPlayers:', id, '— no placeholder in next, parking to', getBunnyParkHost().className || '(unnamed park host)');
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
    bunnyLog('reparentBunnyPlayers: next has', reclaimCandidates.length, 'placeholder(s) that could be reclaimed');
    reclaimCandidates.forEach(function(placeholder) {
      var ok = reclaimParkedBunnyPlayer(placeholder);
      bunnyLog('reparentBunnyPlayers: reclaim attempt for', placeholder.getAttribute('data-bunny-id'), '→', ok ? 'reclaimed from park' : 'nothing parked under that id (left for initBunnyPlayerBackground to init fresh)');
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

  bunnyLog('reclaimParkedBunnyPlayer: pulling', id, 'out of the park host into its hero slot');
  var frame = captureBunnyFrame(parked);

  placeholder.replaceWith(parked);
  parkedBunnyPlayers.delete(id);
  resumeReparentedPlayer(parked, frame);
  return true;
}

function initBunnyPlayerBackground(scope) {
  bunnyLog('initBunnyPlayerBackground: running (afterEnter backstop) — checking', (scope || document).querySelectorAll('[data-bunny-background-init]').length, 'placeholder(s) in scope');
  (scope || document).querySelectorAll('[data-bunny-background-init]').forEach(function(player) {
    // A persistent player parked from a previous page takes over this
    // placeholder instead of being reinitialized from scratch.
    if (player.getAttribute('data-bunny-persist') === 'true' && reclaimParkedBunnyPlayer(player)) {
      bunnyLog('initBunnyPlayerBackground:', player.getAttribute('data-bunny-id'), 'was reclaimed here as a backstop — reparentBunnyPlayers did NOT already handle it. This means the leave-timeline reclaim was too early/late or missed this element.');
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
        var hls = new Hls({ maxBufferLength: 10 });
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, function() { hls.loadSource(src); });
        hls.on(Hls.Events.MANIFEST_PARSED, function() {
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
      ease: "expo.inOut",
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
      ease: "expo.inOut",
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
        const disable = trigger.getAttribute('data-parallax-disable');

        if (
          (disable === 'mobile' && isMobile) ||
          (disable === 'mobileLandscape' && isMobileLandscape) ||
          (disable === 'tablet' && isTablet)
        ) return;

        const target = trigger.querySelector('[data-parallax="target"]') || trigger;
        const direction = trigger.getAttribute('data-parallax-direction') || 'vertical';
        const prop = direction === 'horizontal' ? 'xPercent' : 'yPercent';

        const scrubAttr = trigger.getAttribute('data-parallax-scrub');
        const startAttr = trigger.getAttribute('data-parallax-start');
        const endAttr = trigger.getAttribute('data-parallax-end');

        const scrub = scrubAttr !== null ? parseFloat(scrubAttr) : true;
        const startVal = startAttr !== null ? parseFloat(startAttr) : 20;
        const endVal = endAttr !== null ? parseFloat(endAttr) : -20;

        const scrollStart = `clamp(${trigger.getAttribute('data-parallax-scroll-start') || 'top bottom'})`;
        const scrollEnd = `clamp(${trigger.getAttribute('data-parallax-scroll-end') || 'bottom top'})`;

        gsap.fromTo(target, {
          [prop]: startVal
        }, {
          [prop]: endVal,
          ease: 'none',
          scrollTrigger: {
            trigger,
            start: scrollStart,
            end: scrollEnd,
            scrub
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

// Same shape as the nav links' original character reveal (opacity + rise
// + rotateY flip), own timing — kept separate from NAV_CHAR_ANIM so
// changing one doesn't affect the other. Covers both .text-display-large
// and .text-display-medium.
const DISPLAY_LARGE_ANIM = {
  travel: 50,
  rotate: 90,
  duration: 1.2,
  stagger: 0.025,
  ease: 'power3.out'
};

// Same prepare/activate split as prepareLineReveal/activateLineReveal, and
// for the same reason — see that comment.
function prepareDisplayLargeReveal(scope) {
  if (typeof SplitText === "undefined" || typeof ScrollTrigger === "undefined") return [];

  const targets = (scope || document).querySelectorAll('.text-display-large, .text-display-medium');
  const prepared = [];
  targets.forEach(el => {
    const split = new SplitText(el, {
      type: "words,chars",
      reduceWhiteSpace: false
    });
    gsap.set(split.chars, {
      autoAlpha: 0,
      yPercent: DISPLAY_LARGE_ANIM.travel,
      rotateY: DISPLAY_LARGE_ANIM.rotate,
      transformPerspective: 600
    });
    prepared.push({ split, trigger: el });
  });
  return prepared;
}

function activateDisplayLargeReveal(prepared) {
  bunnyLog('activateDisplayLargeReveal: activating', (prepared || []).length, 'prepared reveal(s)');
  (prepared || []).forEach(({ split, trigger }) => {
    ScrollTrigger.create({
      trigger: trigger,
      start: "top 90%",
      once: true,
      onEnter: () => {
        bunnyLog('activateDisplayLargeReveal: onEnter fired for', trigger.className || trigger.tagName);
        gsap.to(split.chars, {
          autoAlpha: 1,
          yPercent: 0,
          rotateY: 0,
          duration: DISPLAY_LARGE_ANIM.duration,
          ease: DISPLAY_LARGE_ANIM.ease,
          stagger: { each: DISPLAY_LARGE_ANIM.stagger, from: "start" }
        });
      }
    });
  });
  bunnyLog('activateDisplayLargeReveal: done, ScrollTrigger count now', (typeof ScrollTrigger !== 'undefined' ? ScrollTrigger.getAll().length : 'n/a'));
}

// -----------------------------------------
// HERO ABOUT-SCROLL PARALLAX
// -----------------------------------------

// As .section__about scrolls up to flush with the viewport top, the hero
// moves up 50vh and its overlay fades to 50% opacity, scrubbed to scroll.
// The overlay is a child of the hero, so it only needs its own opacity
// tween — it inherits the hero's y movement automatically. Giving it its
// own y on top of that would double its apparent scroll distance.
let heroAboutParallaxST = null;

function initHeroAboutParallax(scope) {
  if (!hasScrollTrigger) return;

  // Kill the previous page's trigger first.
  if (heroAboutParallaxST) {
    heroAboutParallaxST.kill();
    heroAboutParallaxST = null;
  }

  const root = scope || document;
  const trigger = root.querySelector('.section__about');
  const hero = root.querySelector('.home_hero__section');
  const overlay = root.querySelector('.home__hero__overlay');
  if (!trigger || (!hero && !overlay)) return;

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: trigger,
      start: 'top bottom',
      end: 'top top',
      scrub: true
    }
  });
  heroAboutParallaxST = tl.scrollTrigger;

  if (hero) {
    tl.fromTo(hero, { y: '0vh' }, { y: '-50vh', ease: 'none' }, 0);
  }
  if (overlay) {
    tl.fromTo(overlay, { opacity: 0 }, { opacity: 0.5, ease: 'none' }, 0);
  }
}

// -----------------------------------------
// FIRST-LOAD REVEAL
// -----------------------------------------

// Character reveal — opacity + rise + rotateY flip. Shared default
// recipe; DISPLAY_LARGE_ANIM uses the same shape with its own timing.
const LOAD_TEXT_REVEAL = {
  duration: 0.7,
  ease: 'power3.out',
  stagger: 0.018,
  travel: 60,   // yPercent
  rotate: 90    // degrees
};

// Line-masked reveal — same recipe as initLineReveal, but callable
// directly rather than tied to a ScrollTrigger.
const LOAD_LINE_REVEAL = {
  duration: 1.2,
  ease: 'power1.out',
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
  ease: 'osmo'
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

// Home's hero intro — heading text roll-in, menu label roll-in, logo
// bounce-in. Originally cold-load only (via runPageOnceAnimation), never
// replayed on returning to Home via a Barba transition. To play it again
// on return without a flash of fully-visible static text first, it's
// split into two steps:
//
//   1. prepareLoadReveal — SplitText the heading/menu text and set
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
// runPageOnceAnimation just calls both back-to-back immediately.
// .nav__button-label lives in the persistent Global component (outside the
// Barba container, never swapped between pages), but prepareLoadReveal
// below SplitTexts it fresh every time Home is entered. Without reverting
// the previous split first, the second+ visit calls `new SplitText()` on
// markup that's ALREADY wrapped in a previous split's line/char spans —
// SplitText re-splits its own output, producing garbage nested chars and
// throwing on some inputs. Tracked here so prepareLoadReveal can revert
// it before re-splitting.
let activeMenuLabelSplit = null;

function prepareLoadReveal(scope) {
  const root = scope || document;

  // Persistent chrome — outside the Barba container, queried from document.
  const logo = document.querySelector('.nav__logo');
  const menuLabel = document.querySelector('.nav__button-label');
  const videoTexts = Array.from(root.querySelectorAll('.video-section__text'));

  // Nothing to reveal on this page — no intro to prepare or play.
  if (!videoTexts.length) return null;

  const HERO_ROLL = { duration: 0.9, stagger: 0.04, ease: 'osmo' };
  const START_DELAY = 0.15;

  // "WhitehalL" and the smaller "F.p." are separate DOM elements
  // (different size/line-height, so each needs its own SplitText), but
  // animated as one continuous stagger across both, so F.p. reads as the
  // last 4 characters of the large word rather than a second reveal.
  const largeEls = videoTexts.filter(el => !el.classList.contains('is-small'));
  const smallEls = videoTexts.filter(el => el.classList.contains('is-small'));

  // The site's line-height:1 leaves no room for "p"'s descender in a
  // mask — loosened here for the small text only, right before splitting.
  smallEls.forEach(el => { el.style.lineHeight = '1.2'; });

  // Logo/menu text are timed to finish when the LARGE heading finishes
  // (not the combined large+small total, since "F.p." keeps going after it).
  let largeFinishTime = START_DELAY;

  const largeChars = largeEls.flatMap(el => {
    const split = new SplitText(el, { type: 'lines,chars', mask: 'lines', reduceWhiteSpace: false });
    return split.chars;
  });
  if (largeChars.length) {
    largeFinishTime = START_DELAY + (largeChars.length - 1) * HERO_ROLL.stagger + HERO_ROLL.duration;
  }
  const smallChars = smallEls.flatMap(el => {
    const split = new SplitText(el, { type: 'lines,chars', mask: 'lines', reduceWhiteSpace: false });
    return split.chars;
  });

  // DOM order (large then small), one continuous stagger index.
  const allChars = [...largeChars, ...smallChars];
  if (allChars.length) gsap.set(allChars, { yPercent: 100 });

  // Logo/menu duration computed backward from largeFinishTime so all
  // three (heading, logo, menu text) land together.
  const menuCharCount = menuLabel ? (menuLabel.textContent || '').trim().length : 0;
  const chromeDuration = menuCharCount
    ? (menuCharCount - 1) * HERO_ROLL.stagger + HERO_ROLL.duration
    : 0.6;
  const chromeDelay = Math.max(0, largeFinishTime - chromeDuration);

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
    // Same bounce-in as the nav's secondary logo mark on menu open.
    gsap.set(logo, { autoAlpha: 0, y: 16, scale: 0.7 });
  }

  return { allChars, HERO_ROLL, START_DELAY, menuChars, chromeDuration, chromeDelay, logo };
}

function playLoadReveal(state) {
  if (!state) return;
  const { allChars, HERO_ROLL, START_DELAY, menuChars, chromeDuration, chromeDelay, logo } = state;

  if (allChars.length) {
    gsap.to(allChars, {
      yPercent: 0,
      duration: HERO_ROLL.duration,
      ease: HERO_ROLL.ease,
      stagger: { each: HERO_ROLL.stagger, from: 'start' },
      delay: START_DELAY
    });
  }

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
    gsap.to(logo, { autoAlpha: 1, y: 0, scale: 1, duration: chromeDuration, ease: 'back.out(1.7)', delay: chromeDelay });
  }
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
  const defaultNavColors = navTargets.map(el => navDefaultOverride || getComputedStyle(el).color);

  // Apply an override immediately — otherwise it wouldn't take effect
  // until the first scroll-back-into-hero event.
  if (navDefaultOverride && navTargets.length) {
    gsap.set(navTargets, { color: navDefaultOverride });
  }

  const revertToDefault = () => {
    gsap.to(target, { backgroundColor: defaultBg, color: defaultText, duration: 0.6, ease: 'power2.out', overwrite: 'auto' });
    navTargets.forEach((el, i) => {
      gsap.to(el, { color: defaultNavColors[i], duration: 0.6, ease: 'power2.out', overwrite: 'auto' });
    });
  };

  COLOR_ZONES.forEach(({ zone, bg, text, btn }, index) => {
    const trigger = root.querySelector(`[data-color-zone="${zone}"]`);
    if (!trigger) return;

    const setZone = () => {
      gsap.to(target, { backgroundColor: bg, color: text, duration: 0.6, ease: 'power2.out', overwrite: 'auto' });
      if (navTargets.length) gsap.to(navTargets, { color: text, duration: 0.6, ease: 'power2.out', overwrite: 'auto' });

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
          gsap.to(middle, { backgroundColor: btn.bg, color: btn.text, duration: 0.6, ease: 'power2.out', overwrite: 'auto' });
          if (caps.length) gsap.to(caps, { color: btn.bg, duration: 0.6, ease: 'power2.out', overwrite: 'auto' });
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

  const origChars = new SplitText(origEl, { type: 'chars' }).chars;
  const cloneChars = new SplitText(cloneEl, { type: 'chars' }).chars;
  // Offset the clone's CONTAINER, not the individual chars — same trick
  // the nav links use. With cloneEl pushed down 100% and its chars left
  // at their natural yPercent:0, the same -100/0 tween shared with the
  // orig chars below lands the clone exactly in place instead of
  // sliding it further off-screen.
  gsap.set(cloneEl, { yPercent: 100 });

  const maxLen = Math.max(origChars.length, cloneChars.length);
  const pairs = [];
  for (let i = 0; i < maxLen; i++) {
    if (origChars[i]) pairs.push(origChars[i]);
    if (cloneChars[i]) pairs.push(cloneChars[i]);
  }
  return pairs;
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
      gsap.to(caps, { color: HOVER_BG, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
      gsap.to(middle, { backgroundColor: HOVER_BG, color: HOVER_TEXT, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
      if (rollPairs) {
        gsap.to(rollPairs, { yPercent: -100, stagger: { amount: 0.2 }, duration: 0.65, ease: 'osmo', overwrite: true });
      }
    };
    const leave = () => {
      gsap.to(caps, { color: btn._restBg, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
      gsap.to(middle, { backgroundColor: btn._restBg, color: btn._restText, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
      if (rollPairs) {
        gsap.to(rollPairs, { yPercent: 0, stagger: { amount: 0.2, from: 'end' }, duration: 0.65, ease: 'osmo', overwrite: true });
      }
    };

    btn.addEventListener('mouseenter', enter);
    btn.addEventListener('mouseleave', leave);
    // focus/blur cover keyboard navigation.
    btn.addEventListener('focus', enter);
    btn.addEventListener('blur', leave);
  });
}