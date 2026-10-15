/* ──────────────────────────────────────────────
   MAGIC IN WHITE — interaction layer
   GSAP + ScrollTrigger + Lenis, no build step.
   ────────────────────────────────────────────── */
(() => {
'use strict';

const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE = matchMedia('(hover:hover) and (pointer:fine)').matches;
const SMALL = () => innerWidth < 720;

gsap.registerPlugin(ScrollTrigger);

/* ═════════ SMOOTH SCROLL ═════════ */
const lenis = new Lenis({ lerp: .09, wheelMultiplier: .95, smoothWheel: !REDUCED });
lenis.stop();
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add(t => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);

/* ═════════ TEXT SPLITTING ═════════ */
function splitWords(el, chars = false) {
  const walk = node => {
    [...node.childNodes].forEach(n => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(tok => {
          if (!tok) return;
          if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(' ')); return; }
          const w = document.createElement('span'); w.className = 'w';
          const inner = document.createElement('span'); inner.className = 'ws';
          if (chars) {
            w.style.whiteSpace = 'nowrap'; w.style.overflow = 'visible'; w.style.paddingBottom = '0'; w.style.marginBottom = '0';
            [...tok].forEach(c => {
              const m = document.createElement('span'); m.className = 'ch-mask';
              const s = document.createElement('span'); s.className = 'ch'; s.textContent = c;
              m.appendChild(s); w.appendChild(m);
            });
            w.dataset.chars = '1';
          } else { inner.textContent = tok; w.appendChild(inner); }
          frag.appendChild(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) walk(n);
    });
  };
  const label = el.textContent.trim();
  el.setAttribute('aria-label', label);
  walk(el);
  $$('.w, .ch-mask', el).forEach(x => x.setAttribute('aria-hidden', 'true'));
  return chars ? $$('.ch', el) : $$('.ws', el);
}

/* ═════════ LENTICULAR ENGINE ═════════
   Each .lenti is cut into N vertical slats. Every slat is a two-faced
   3D card: front = image A, back = image B (or flat colour). Slat angle is
   the sum of a "reveal" flip (staggered, driven by scroll-in) and a
   "turn" flip (staggered, driven by pointer / hover / scroll scrub). */
const lentis = [];
const _pre = {};
const preload = url => _pre[url] || (_pre[url] = new Promise(res => { const im = new Image(); im.onload = im.onerror = () => res(); im.src = url; }));
class Lenti {
  constructor(el) {
    this.el = el;
    this.mode = el.dataset.mode || 'none';
    const base = +el.dataset.slats || 14;
    this.n = Math.max(6, Math.round(base * (SMALL() ? .62 : 1)));
    this.show = 0; this.showT = 0;   // reveal   0 = hidden → 1 = shown
    this.turn = 0; this.turnT = 0;   // turn     0 = image A → 1 = image B
    this.SR = .85; this.ST = this.mode === 'pointer' ? .55 : .7;
    this.visible = false; this.dirty = true;
    this.build();
    this.bind();
    lentis.push(this);
  }
  build() {
    const { el, n } = this;
    const a = el.dataset.a, b = el.dataset.b, bc = el.dataset.bcolor || '#0A0626';
    const label = el.getAttribute('data-alt') || '';
    el.setAttribute('role', 'img'); if (label) el.setAttribute('aria-label', label);
    el.style.setProperty('--n', n);
    this.strips = [];
    const mk = src => src ? `<img src="${src}" alt="" decoding="async" draggable="false">` : '';
    let html = '';
    for (let i = 0; i < n; i++) {
      html += `<div class="lenti__s" style="--i:${i}"><div class="lenti__f">${mk(a)}</div><div class="lenti__b" style="--bc:${bc}">${mk(b)}</div></div>`;
    }
    el.innerHTML = html;
    this.strips = $$('.lenti__s', el);
    this.ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      el.style.setProperty('--w', w + 'px');
      el.style.setProperty('--sw', (w / n) + 'px');
    });
    this.ro.observe(el);
    this.io = new IntersectionObserver(e => { this.visible = e[0].isIntersecting; if (this.visible) this.dirty = true; }, { rootMargin: '15% 0px' });
    this.io.observe(el);
    this.render();
  }
  bind() {
    const { el, mode } = this;
    if (FINE) {
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        el.style.perspectiveOrigin = `${px * 100}% 50%`;
        if (mode === 'pointer') this.turnT = clamp((px - .12) / .76);
      });
      if (mode === 'hover') {
        el.addEventListener('pointerenter', () => this.turnT = 1);
        el.addEventListener('pointerleave', () => this.turnT = 0);
      }
      if (mode === 'pointer') el.addEventListener('pointerleave', () => this.turnT = 0);
    } else if (mode === 'pointer') {
      // touch: turn the poster as it travels through the viewport
      ScrollTrigger.create({ trigger: el, start: 'top 75%', end: 'bottom 30%', scrub: true,
        onUpdate: s => { this.turnT = clamp(s.progress * 1.3); } });
    }
    if (mode === 'scroll') {
      ScrollTrigger.create({ trigger: el, start: 'top 88%', end: 'bottom 22%', scrub: true,
        onUpdate: s => { this.turnT = clamp(s.progress * 1.25 - .05); } });
    }
  }
  async setImage(url) {   // flip to a new picture: decode it on the hidden face first, then turn
    const id = this._swap = (this._swap || 0) + 1;
    await preload(url);
    if (id !== this._swap) return;
    const toBack = this.turnT < .5;
    const imgs = $$(toBack ? '.lenti__b img' : '.lenti__f img', this.el);
    imgs.forEach(im => { im.src = url; });
    await Promise.all(imgs.map(im => im.decode ? im.decode().catch(() => {}) : null));
    if (id !== this._swap) return;
    this.turnT = toBack ? 1 : 0;
  }
  async setBoth(url) {    // swap picture on both faces without animating (resolves once painted-ready)
    this._swap = (this._swap || 0) + 1;
    await preload(url);
    const imgs = $$('img', this.el);
    imgs.forEach(im => { im.src = url; });
    await Promise.all(imgs.map(im => im.decode ? im.decode().catch(() => {}) : null));
    this.turn = this.turnT = 0; this.dirty = true;
  }
  reveal(delay = 0, dur = 1.8) {
    gsap.to(this, { showT: 1, duration: dur, delay, ease: 'power1.inOut', onUpdate: () => this.dirty = true });
  }
  tick(dt) {
    const ds = this.showT - this.show, dtn = this.turnT - this.turn;
    if (Math.abs(ds) > 1e-4) { this.show = this.showT; this.dirty = true; }
    if (Math.abs(dtn) > 5e-4) { this.turn += dtn * (1 - Math.pow(.0009, dt)); this.dirty = true; }
    else if (dtn) { this.turn = this.turnT; this.dirty = true; }
    if (this.dirty && this.visible) { this.render(); this.dirty = false; }
  }
  render() {
    const { n, strips, show, turn, SR, ST } = this;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const r = clamp(show * (1 + SR) - t * SR);
      const k = clamp(turn * (1 + ST) - t * ST);
      const ang = -180 * (1 - easeIO(r)) + 180 * easeIO(k);
      const s = strips[i];
      s.style.transform = `rotateY(${ang.toFixed(2)}deg)`;
      s.style.setProperty('--sh', (Math.abs(Math.sin(ang * Math.PI / 180)) * .5).toFixed(3));
    }
  }
}
gsap.ticker.add((_, dtMs) => { const dt = Math.min(dtMs / 1000, .05); lentis.forEach(l => l.tick(dt)); });

/* ═════════ PRELOADER ═════════ */
function buildSlats(host, n) {
  host.innerHTML = '<i></i>'.repeat(n);
  return $$('i', host);
}

/* ═════════ PAGE TRANSITIONS ═════════ */
const NAVKEY = 'miw-nav';
function buildWipe(covered) {
  const w = document.createElement('div'); w.className = 'wipe';
  w.innerHTML = '<i></i>'.repeat(SMALL() ? 6 : 12); document.body.appendChild(w);
  const sl = $$('i', w); gsap.set(sl, { scaleY: covered ? 1 : 0, transformOrigin: covered ? '50% 0%' : '50% 100%' });
  return { w, sl };
}
function uncover() {
  const { w, sl } = buildWipe(true);
  document.documentElement.classList.remove('is-arriving');
  gsap.to(sl, { scaleY: 0, duration: .6, stagger: { each: .04, from: 'center' }, ease: 'power3.inOut', onComplete: () => w.remove() });
}
function coverAndGo(url) {
  const { w, sl } = buildWipe(false); w.style.pointerEvents = 'all';
  gsap.to(sl, { scaleY: 1, duration: .55, stagger: { each: .04, from: 'center' }, ease: 'power3.inOut',
    onComplete: () => { try { sessionStorage.setItem(NAVKEY, '1'); } catch (e) {} location.href = url; } });
}
addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
function goHash() {
  const h = location.hash; if (!h || h.length < 2) return;
  const t = $(h); t && lenis.scrollTo(t, { immediate: true, force: true });
}

function runPreloader() {
  let arriving = false, seen = false;
  try { arriving = !!sessionStorage.getItem(NAVKEY); sessionStorage.removeItem(NAVKEY); seen = !!sessionStorage.getItem('miw-seen'); } catch (e) {}
  const isHome = !!$('#heroLenti');
  if (arriving || (!isHome && seen)) {          // coming from another page → no full preloader, just the slat reveal
    $('#preloader').remove(); document.body.classList.remove('is-loading'); lenis.start();
    if (arriving) uncover();
    goHash();
    gsap.delayedCall(arriving ? .3 : 0, heroIntro);
    return;
  }
  try { sessionStorage.setItem('miw-seen', '1'); } catch (e) {}
  const pre = $('#preloader');
  const slats = buildSlats($('#plSlats'), SMALL() ? 8 : 16);
  const lines = $$('#plLines i');
  const count = $('#plCount');
  const logo = $('.pl-logo');
  const state = { v: 0 };
  const paint = () => {
    count.textContent = String(Math.round(state.v)).padStart(3, '0');
    lines.forEach((l, i) => gsap.set(l, { scaleX: clamp(state.v / 100 * lines.length - i) }));
  };

  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  const heroImg = new Promise(res => {
    const src = $('#heroLenti')?.dataset.a; if (!src) return res();
    const im = new Image(); im.onload = im.onerror = res; im.src = src;
  });
  const assetsReady = Promise.race([Promise.all([fontsReady, heroImg]), new Promise(r => setTimeout(r, 6000))]);

  const tl = gsap.timeline();
  tl.to(logo, { clipPath: 'inset(0% 0 0 0)', duration: 1.3, ease: 'power4.inOut' }, .15)
    .to(state, { v: 88, duration: 2.1, ease: 'power2.inOut', onUpdate: paint }, 0);

  Promise.all([assetsReady, new Promise(r => setTimeout(r, REDUCED ? 300 : 2300))]).then(() => {
    gsap.to(state, { v: 100, duration: .5, ease: 'power2.out', onUpdate: paint, onComplete: exit });
  });

  function exit() {
    const out = gsap.timeline({ onComplete: () => { pre.remove(); document.body.classList.remove('is-loading'); lenis.start(); goHash(); } });
    out.to('.pl-count, .pl-foot .mono', { yPercent: 120, duration: .7, ease: 'power3.in', stagger: .05 }, 0)
       .to(logo, { yPercent: -18, scale: 1.08, opacity: 0, duration: .8, ease: 'power3.in' }, .05)
       .to('.pl-lines', { opacity: 0, duration: .4 }, 0)
       .to(slats, { rotationY: 90, duration: 1.05, ease: 'power3.inOut', stagger: { each: .045, from: 'center' } }, .45)
       .add(heroIntro, .75);
  }
}

/* ═════════ HERO INTRO ═════════ */
function heroIntro() {
  const title = $('.hero__title'); if (!title) return;
  const words = splitWords(title);
  gsap.set(words, { yPercent: 115, rotate: 5 });
  gsap.timeline({ defaults: { ease: 'power4.out' } })
    .to(words, { yPercent: 0, rotate: 0, duration: 1.3, stagger: .075 }, 0)
    .fromTo('.header', { yPercent: -100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.1 }, .3)
    ;
  if ($('.hero__lede')) gsap.fromTo('.hero__lede', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 1.1, delay: .9, ease: 'power4.out' });
  const hero = lentis.find(l => l.el.id === 'heroLenti');
  hero && hero.reveal(.5, 2.2);
}

/* ═════════ INIT: SPLITS, REVEALS ═════════ */
function initText() {
  // headings: slide up from mask
  $$('[data-split]').forEach(el => {
    if (el.classList.contains('hero__title')) return;
    const chars = el.dataset.split === 'chars';
    const parts = splitWords(el, chars);
    gsap.set(parts, { yPercent: 115 });
    ScrollTrigger.create({
      trigger: el, start: 'top 88%', once: true,
      onEnter: () => gsap.to(parts, { yPercent: 0, duration: chars ? 1.1 : 1.2, stagger: chars ? .035 : .06, ease: 'power4.out' })
    });
  });
  // generic fade-ups
  $$('[data-reveal]').forEach(el => {
    if (el.closest('.hero')) return;
    gsap.set(el, { y: 36, opacity: 0 });
    ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true,
      onEnter: () => gsap.to(el, { y: 0, opacity: 1, duration: 1.2, ease: 'power3.out' }) });
  });
  // reading-progress paragraphs
  $$('[data-scrub]').forEach(p => {
    const words = [];
    const walk = n => [...n.childNodes].forEach(c => {
      if (c.nodeType === 3) {
        const f = document.createDocumentFragment();
        c.textContent.split(/(\s+)/).forEach(t => {
          if (!t) return;
          if (/^\s+$/.test(t)) { f.appendChild(document.createTextNode(' ')); return; }
          const s = document.createElement('span'); s.className = 'sw'; s.textContent = t; words.push(s); f.appendChild(s);
        });
        c.replaceWith(f);
      } else walk(c);
    });
    walk(p);
    gsap.to(words, { opacity: 1, ease: 'none', stagger: .5,
      scrollTrigger: { trigger: p, start: 'top 82%', end: 'bottom 55%', scrub: .4 } });
  });
  // buttons: text roll
  $$('.btn__t').forEach(t => {
    const txt = t.textContent;
    t.removeAttribute('data-text');
    t.innerHTML = `<span class="a">${txt}</span><span class="b" aria-hidden="true">${txt}</span>`;
  });
}

/* ═════════ LENTICULAR INSTANCES & SCROLL-IN ═════════ */
function initLenti() {
  $$('.lenti').forEach(el => new Lenti(el));
  lentis.forEach(l => {
    if (l.el.id === 'heroLenti' || l.el.closest('.quote') || l.el.closest('.menu') || l.el.closest('.mdl')) return;
    ScrollTrigger.create({ trigger: l.el, start: 'top 86%', once: true, onEnter: () => l.reveal(0, 1.7) });
  });
}

/* ═════════ WORK TILES ═════════ */
function initTiles() {
  $$('.tile').forEach((tile, i) => {
    // build per-letter title
    const ttl = $('.tile__ttl', tile);
    const chars = splitWords(ttl, true);
    gsap.set(chars, { yPercent: 115 });
    ttl.removeAttribute('aria-label');
    const lenti = $('.lenti', tile);
    if (FINE) {
      lenti.addEventListener('pointerenter', () => gsap.to(chars, { yPercent: 0, duration: .8, ease: 'power4.out', stagger: .03, overwrite: true }));
      lenti.addEventListener('pointerleave', () => gsap.to(chars, { yPercent: 115, duration: .45, ease: 'power3.in', stagger: .012, overwrite: true }));
    }
    // light parallax, alternating direction/speed
    if (!REDUCED && innerWidth > 820) {
      const amp = [0, 26, 0, 26, 0, 26, 0, 26, 0][i];
      if (!amp) return;
      gsap.fromTo(tile, { y: amp }, { y: -amp, ease: 'none',
        scrollTrigger: { trigger: tile, start: 'top bottom', end: 'bottom top', scrub: .6 } });
    }
  });
}

/* ═════════ CLIENT MARQUEE ═════════ */
function initMarquee() {
  const m = $('.marquee'); if (!m) return;
  const track = $('.marquee__track', m), ul = $('.logos', m);
  for (let i = 0; i < 2; i++) track.appendChild(ul.cloneNode(true));
  $$('.logos', track).slice(1).forEach(x => x.setAttribute('aria-hidden', 'true'));
  let x = 0, hover = 1, skew = 0;
  m.addEventListener('pointerenter', () => gsap.to({ v: hover }, { v: .25, duration: .8, onUpdate() { hover = this.targets()[0].v; } }));
  m.addEventListener('pointerleave', () => gsap.to({ v: hover }, { v: 1, duration: .8, onUpdate() { hover = this.targets()[0].v; } }));
  const setSkew = gsap.quickTo(track, 'skewX', { duration: .5, ease: 'power3' });
  gsap.ticker.add((_, dtMs) => {
    const dt = dtMs / 1000, w = ul.offsetWidth; if (!w) return;
    const v = REDUCED ? 0 : lenis.velocity || 0;
    x += (70 * hover + Math.abs(v) * 22) * dt;
    x = x % w;
    gsap.set(track, { x: -x });
    setSkew(clamp(v * -.35, -8, 8));
  });
}

/* ═════════ PRODUCT ═════════ */
function initProduct() {
  const box = $('#productVideo'); if (!box) return;
  const vid = $('video', box);
  gsap.to(box, { clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'none',
    scrollTrigger: { trigger: box, start: 'top 88%', end: 'top 12%', scrub: .5 } });
  gsap.to(vid, { scale: 1, ease: 'none',
    scrollTrigger: { trigger: box, start: 'top 88%', end: 'bottom 30%', scrub: .5 } });
  ScrollTrigger.create({ trigger: box, start: 'top 85%', end: 'bottom 10%',
    onToggle: s => { const p = s.isActive ? vid.play() : vid.pause(); p && p.catch && p.catch(() => {}); } });
}

/* ═════════ VOICES — auto-advance every 5s, click tabs to jump ═════════ */
function initVoices() {
  const stage = $('#vStage'); if (!stage) return;
  const DUR = 5;                                            // seconds per quote
  const slides = $$('.quote', stage).map(el => ({
    el, lenti: lentis.find(l => el.contains(l.el)),
    words: splitWords($('.quote__h', el)),
    body: $$('.quote__mark, .quote__p, .quote__by', el)
  }));
  const tabs = $$('.vtab'), bars = tabs.map(t => $('i', t));
  let i = 0, busy = false, elapsed = 0, hovering = false, inView = false, started = false;
  slides.forEach(s => { gsap.set(s.words, { yPercent: 115 }); gsap.set(s.body, { opacity: 0, y: 24 }); });
  const enter = s => {
    s.lenti.show = s.lenti.showT = 0; s.lenti.turn = s.lenti.turnT = 0; s.lenti.dirty = true;
    s.lenti.reveal(0, 1.3);
    gsap.to(s.words, { yPercent: 0, duration: 1.1, stagger: .05, ease: 'power4.out', delay: .1 });
    gsap.to(s.body, { opacity: 1, y: 0, duration: .9, stagger: .09, ease: 'power3.out', delay: .25 });
  };
  ScrollTrigger.create({ trigger: stage, start: 'top 80%', once: true, onEnter: () => { enter(slides[0]); started = true; } });
  new IntersectionObserver(e => inView = e[0].isIntersecting, { threshold: .35 }).observe(stage);
  const go = n => {
    n = (n + slides.length) % slides.length;
    elapsed = 0;
    if (busy || n === i) return; busy = true;
    const a = slides[i], b = slides[n];
    a.lenti.turnT = 1;                                      // slats flip to the orange back
    gsap.to(a.words, { yPercent: -115, duration: .55, stagger: .02, ease: 'power3.in' });
    gsap.to(a.body, { opacity: 0, y: -16, duration: .4, stagger: .03 });
    tabs.forEach((t, k) => { t.classList.toggle('is-active', k === n); t.setAttribute('aria-selected', k === n); });
    setTimeout(() => {
      a.el.classList.remove('is-active'); gsap.set(a.words, { yPercent: 115 }); gsap.set(a.body, { y: 24 });
      a.lenti.turn = a.lenti.turnT = 0;
      b.el.classList.add('is-active'); i = n;
      enter(b);
      setTimeout(() => { busy = false; elapsed = 0; }, 600);
    }, 650);
  };
  tabs.forEach((t, k) => t.addEventListener('click', () => go(k)));
  stage.addEventListener('pointerenter', () => hovering = true);
  stage.addEventListener('pointerleave', () => hovering = false);
  gsap.ticker.add((_, ms) => {
    bars.forEach((b, k) => { if (k !== i) b.style.transform = 'scaleX(0)'; });
    if (!started) return;
    if (!busy && inView && !hovering) elapsed += ms / 1000;
    bars[i].style.transform = `scaleX(${clamp(elapsed / DUR)})`;
    if (elapsed >= DUR && !busy) go(i + 1);
  });
  addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    if (!inView) return;
    go(i + (e.key === 'ArrowRight' ? 1 : -1));
  });
  let x0 = null;
  stage.addEventListener('pointerdown', e => { x0 = e.clientX; });
  addEventListener('pointerup', e => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1)); });
}

/* ═════════ TEAM ═════════ */
function initTeam() {
  const grid = $('#teamGrid'); if (!grid) return;
  const mdl = $('#mdl'), bg = $('.mdl__bg', mdl), header = $('#header');
  const lent = lentis.find(l => l.el.id === 'mdlLenti');
  const role = $('.mdl__role', mdl), name = $('.mdl__name', mdl), bio = $('.mdl__bio', mdl);
  const cards = $$('.member', grid);
  $$('.member').forEach(c => preload(c.dataset.photo));   // warm the big portraits so swaps never flash
  const data = cards.map(c => ({ name: c.dataset.name, role: c.dataset.role, photo: c.dataset.photo, bio: $('.member__bio', c).innerHTML }));
  cards.forEach((c, i) => { cards[i].tabIndex = 0; });
  gsap.from(cards, { y: 50, opacity: 0, duration: 1.1, stagger: .07, ease: 'power3.out', delay: 1.6,
    scrollTrigger: { trigger: grid, start: 'top 92%', once: true } });

  let cur = 0, isOpen = false, busy = false, words = [];
  const fill = k => {
    const d = data[k];
    role.textContent = d.role; name.textContent = d.name; bio.innerHTML = d.bio; bio.scrollTop = 0;
    words = splitWords(name);
    gsap.set(words, { yPercent: 115 }); gsap.set([role, ...bio.children], { opacity: 0, y: 20 });
  };
  const textIn = (delay = 0) => {
    gsap.to(words, { yPercent: 0, duration: 1, stagger: .06, ease: 'power4.out', delay });
    gsap.to([role, ...bio.children], { opacity: 1, y: 0, duration: .9, stagger: .08, ease: 'power3.out', delay: delay + .1 });
  };
  const open = k => {
    if (isOpen) return; isOpen = true; cur = k;
    mdl.classList.add('is-open'); mdl.setAttribute('aria-hidden', 'false');
    lenis.stop(); document.documentElement.classList.add('mdl-open');
    fill(k);
    lent.show = lent.showT = 0; lent.dirty = true; lent.el.style.visibility = 'hidden';
    gsap.fromTo(bg, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: .8, ease: 'power3.inOut' });
    lent.setBoth(data[k].photo).then(() => { lent.show = lent.showT = 0; lent.el.style.visibility = ''; lent.reveal(.25, 1.3); });
    textIn(.75);
    gsap.fromTo('.mdl__close, .mdl__nav', { opacity: 0 }, { opacity: 1, duration: .6, delay: .8 });
  };
  const close = () => {
    if (!isOpen || busy) return; busy = true;
    gsap.to([role, name, ...bio.children], { opacity: 0, duration: .25 });
    gsap.to('.mdl__close, .mdl__nav', { opacity: 0, duration: .25 });
    gsap.to(bg, { clipPath: 'inset(0% 0% 100% 0%)', duration: .75, ease: 'power3.inOut', delay: .1, onComplete: () => {
      mdl.classList.remove('is-open'); mdl.setAttribute('aria-hidden', 'true'); isOpen = false; busy = false;
      lenis.start(); document.documentElement.classList.remove('mdl-open'); cards[cur] && cards[cur].focus({ preventScroll: true });
    } });
  };
  const go = n => {
    if (!isOpen || busy) return; busy = true;
    n = (n + data.length) % data.length; cur = n;
    gsap.to(words, { yPercent: -115, duration: .45, stagger: .02, ease: 'power3.in' });
    gsap.to([role, ...bio.children], { opacity: 0, y: -14, duration: .35 });
    lent.setImage(data[n].photo);                       // slats turn to the next portrait
    setTimeout(() => { fill(n); textIn(0); setTimeout(() => busy = false, 450); }, 520);
  };
  cards.forEach((c, k) => {
    c.addEventListener('click', () => open(k));
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(k); } });
  });
  $('#mdlClose').addEventListener('click', close);
  $('#mdlNext').addEventListener('click', () => go(cur + 1));
  $('#mdlPrev').addEventListener('click', () => go(cur - 1));
  addEventListener('keydown', e => {
    if (!isOpen) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') go(cur + 1);
    if (e.key === 'ArrowLeft') go(cur - 1);
  });
}

/* ═════════ FOOTER ═════════ */
function initFooter() {
  gsap.to('#footerMark', { clipPath: 'inset(0 0 0% 0)', duration: 1.6, ease: 'power4.inOut',
    scrollTrigger: { trigger: '#footerMark', start: 'top 85%', once: true } });
  $('#toTop').addEventListener('click', e => { e.preventDefault(); lenis.scrollTo(0, { duration: 2, easing: t => 1 - Math.pow(1 - t, 4) }); });
}

/* ═════════ HEADER, PROGRESS ═════════ */
function initChrome() {
  const header = $('#header');
  $$('[data-theme]').forEach(sec => {
    ScrollTrigger.create({ trigger: sec, start: 'top 48px', end: 'bottom 48px',
      onToggle: s => { if (s.isActive) header.dataset.theme = sec.dataset.theme; } });
  });
  header.dataset.theme = 'light';
  let last = 0;
  lenis.on('scroll', ({ scroll }) => {
    header.classList.toggle('is-stuck', scroll > 60);
    if (!menuOpen) header.classList.toggle('is-hidden', scroll > last && scroll > 240);
    last = scroll;
  });
}

/* ═════════ MENU ═════════ */
let menuOpen = false;
function initMenu() {
  const menu = $('#menu'), burger = $('#burger'), header = $('#header');
  const slats = buildSlats($('#menuSlats'), SMALL() ? 6 : 12);
  const links = $$('.menu__links a');
  const side = $$('.menu__col, .svc-prev');
  gsap.set($$('.menu__links li'), { overflow: 'hidden' });
  gsap.set(links, { yPercent: 110 });
  gsap.set(side, { opacity: 0, y: 24 });
  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.inOut' },
    onReverseComplete: () => menu.classList.remove('is-open') });
  // stepped slat curtain; the content only starts once the last slat has landed
  tl.to(slats, { scaleY: 1, duration: .6, stagger: { each: .045, from: 'center' }, ease: 'power3.inOut' }, 0)
    .to(links, { yPercent: 0, duration: .85, stagger: .06, ease: 'power4.out' }, .85)
    .to(side, { opacity: 1, y: 0, duration: .7, stagger: .06, ease: 'power3.out' }, 1.0);
  // services index: hovering a service turns the lenticular preview to a new picture
  const prev = lentis.find(l => l.el.id === 'svcLenti');
  $$('#svcList li').forEach(li => { const im = new Image(); im.src = li.dataset.img; });
  $$('#svcList li').forEach(li => li.addEventListener('pointerenter', () => prev && prev.setImage(li.dataset.img)));
  const set = open => {
    menuOpen = open;
    if (open && prev) { prev.show = prev.showT = 0; prev.turn = prev.turnT = 0; prev.dirty = true; prev.reveal(1.05, 1.2); }
    burger.setAttribute('aria-expanded', open);
    menu.setAttribute('aria-hidden', !open);
    clearTimeout(set.t); set.t = setTimeout(() => header.classList.toggle('menu-open', open), open ? 820 : 260);
    header.classList.remove('is-hidden');
    if (open) { menu.classList.add('is-open'); lenis.stop(); tl.timeScale(1).play(); }
    else { lenis.start(); tl.timeScale(1.5).reverse(); }
  };
  burger.addEventListener('click', () => set(!menuOpen));
  addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen) set(false); });
  // anchors + page transitions
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]'); if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const href = a.getAttribute('href');
    if (href === '#') { e.preventDefault(); return; }
    if (/^(mailto:|tel:)/.test(href)) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin) return;
    const norm = p => p.replace(/index\.html$/, '').replace(/\/$/, '');
    e.preventDefault();
    if (norm(u.pathname) === norm(location.pathname)) {
      const t = (u.hash && u.hash !== '#top') ? $(u.hash) : 0; if (t === null) return;
      const go = () => lenis.scrollTo(t, { duration: 1.8, easing: x => x === 1 ? 1 : 1 - Math.pow(2, -10 * x), offset: 0 });
      if (menuOpen) { set(false); setTimeout(go, 350); } else go();
    } else coverAndGo(a.href);
  });
}

/* ═════════ CURSOR + MAGNETIC ═════════ */
function initCursor() {
  if (!FINE) return;
  document.documentElement.classList.add('has-cursor');
  const c = $('#cursor'), lbl = $('.cursor__label', c);
  const xTo = gsap.quickTo(c, 'x', { duration: .35, ease: 'power3' });
  const yTo = gsap.quickTo(c, 'y', { duration: .35, ease: 'power3' });
  addEventListener('pointermove', e => { xTo(e.clientX); yTo(e.clientY); }, { passive: true });
  addEventListener('pointerdown', () => c.classList.add('is-down'));
  addEventListener('pointerup', () => c.classList.remove('is-down'));
  document.addEventListener('pointerover', e => {
    const d = e.target.closest('[data-cursor]');
    const link = e.target.closest('a,button,[data-magnetic]');
    const text = d ? d.dataset.cursor : '';
    c.classList.toggle('has-label', !!text);
    if (text) lbl.textContent = text;
    c.classList.toggle('is-link', !!link && !text);
  });
  document.documentElement.addEventListener('pointerleave', () => gsap.to(c, { opacity: 0, duration: .2 }));
  document.documentElement.addEventListener('pointerenter', () => gsap.to(c, { opacity: 1, duration: .2 }));

  $$('[data-magnetic]').forEach(el => {
    const mx = gsap.quickTo(el, 'x', { duration: .6, ease: 'elastic.out(1,.5)' });
    const my = gsap.quickTo(el, 'y', { duration: .6, ease: 'elastic.out(1,.5)' });
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      mx((e.clientX - (r.left + r.width / 2)) * .32); my((e.clientY - (r.top + r.height / 2)) * .32);
    });
    el.addEventListener('pointerleave', () => { mx(0); my(0); });
  });
}

/* ═════════ BOOT ═════════ */
history.scrollRestoration = 'manual';
scrollTo(0, 0);
initLenti();
initText();
initTiles();
initMarquee();
initProduct();
initVoices();
initTeam();
initFooter();
initMenu();
initChrome();
initCursor();
runPreloader();
document.fonts && document.fonts.ready.then(() => ScrollTrigger.refresh());
addEventListener('load', () => ScrollTrigger.refresh());
})();
