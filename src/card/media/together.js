/**
 * Overlapping clips, part 2: the grouped card in the Clips list and the
 * "Together" player that plays every clip of a group against one shared clock.
 *
 * The grouping rules live in overlap.js (pure). This module owns the DOM:
 * the group card, the full-card player, the shared clock and the per-clip
 * video elements. Methods are composed onto SightlineCard.prototype.
 */
import { cap } from '../../helpers.js';
import { TOGETHER_STYLES } from '../../styles/together.js';
import { groupOverlappingClips, overlapClipEnd, togetherClipState } from './overlap.js';

const TOGETHER_MAX_TILES = 4;
// A stream that is only a little behind is nudged with the playback speed; a big gap is fixed with one seek, and never
// more often than every few seconds (a seek on HLS has to fetch segments, so seeking again and again makes it worse).
const TOGETHER_NUDGE_SECONDS = 0.35;
const TOGETHER_SEEK_SECONDS = 1.5;
const TOGETHER_SEEK_COOLDOWN_MS = 3000;
const TOGETHER_PRELOAD_SECONDS = 5; // a clip's stream is opened this long before its turn, not at the start
const TOGETHER_SYNC_MS = 250;
const TOGETHER_MAX_WAIT_MS = 8000; // the clock never waits for a stuck stream longer than this

const TG_ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>';
const TG_ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
const TG_ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const TG_ICON_SOUND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>';
const TG_ICON_MUTED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
const TG_ICON_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

/**
 * Home Assistant's video player gets its settings (config, API, connection) from Home Assistant's root element through
 * Lit "context" requests, which travel up the DOM. A player mounted on document.body is outside that tree, so its requests
 * never arrive and it fails after fetching the playlist. This hands each request on from the card, which is inside it.
 */
export function togetherBridgeContext(host, source) {
  host.addEventListener('context-request', (e) => {
    if (!e || !e.context || typeof e.callback !== 'function') return;
    e.stopPropagation();
    const forwarded = new Event('context-request', { bubbles: true, composed: true });
    forwarded.context = e.context;
    forwarded.callback = e.callback;
    forwarded.subscribe = e.subscribe;
    if (e.contextTarget) forwarded.contextTarget = e.contextTarget;
    source.dispatchEvent(forwarded);
  });
}

const tgEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tgMmss = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export const togetherMethods = {
  // ---------- the Clips list ----------

  /** Overlapping clips off (media.group_overlapping_clips: false) keeps the plain list. */
  _groupOverlapsEnabled() {
    return this._config?.media?.group_overlapping_clips !== false;
  },

  /**
   * In a single-camera view the Clips list holds only that camera's clips, so the other cameras' clips are fetched
   * (once a minute at most) to find overlaps. They are shown only inside a group, never as a card of their own.
   */
  _ensureOverlapCandidates() {
    const cameras = this._config?.cameras || [];
    if (cameras.length < 2 || typeof this._mediaQueryBounds !== 'function') return;
    const now = Math.floor(Date.now() / 1000);
    const bounds = this._mediaQueryBounds(now);
    const after = Math.max(0, Math.floor(Number(bounds?.start) || 0));
    const before = Math.max(after + 1, Math.floor(Number(bounds?.end) || now));
    const key = `${this._activeCam?.entity}:${after}:${before}`;
    const cache = this._ovCache;
    if (cache && cache.key === key && Date.now() - cache.at < 60000) return;
    if (this._ovLoading === key) return;
    this._ovLoading = key;
    const others = cameras.filter((c) => {
      const cc = this._camCache?.[c.entity];
      return c.entity !== this._activeCam?.entity && cc?.discovered && cc.clientId && cc.cam;
    });
    Promise.all(others.map(async (c) => {
      const cc = this._camCache[c.entity];
      try {
        const ev = await this._ws({ type: 'frigate/events/get', instance_id: cc.clientId, cameras: [cc.cam], after, before, limit: 500, has_clip: true });
        return Array.isArray(ev) ? ev : [];
      } catch (_) { return []; }
    })).then((lists) => {
      if (this._ovLoading !== key) return;
      this._ovLoading = '';
      this._ovCache = { key, at: Date.now(), events: lists.flat() };
      if (this._galleryMode === 'clips' && this._eventsMode !== 'all') this._renderGallery();
    });
  },

  /** The cards of the Clips list: a group card for each set of overlapping clips, a normal card for every other clip. */
  _clipsListHTML(events) {
    this._tgGroups = new Map();
    const row = (ev) => this._eventCardHTML(ev, false);
    // newer cards group the list by day; keep that when it is there
    const byDay = (items, ts, html) => (typeof this._galleryGroupByDay === 'function' ? this._galleryGroupByDay(items, ts, html) : items.map(html).join(''));
    if (!this._groupOverlapsEnabled()) return byDay(events, (ev) => ev.start_time, row);
    // one camera in view: look at the other cameras' clips too
    let candidates = events;
    const shown = new Set(events);
    if (this._eventsMode !== 'all' && (this._config?.cameras?.length || 0) > 1) {
      this._ensureOverlapCandidates();
      const known = new Set(events.map((ev) => String(ev.id)));
      const others = this._filterMediaEvents((this._ovCache?.events || []).filter((ev) => !known.has(String(ev.id))));
      candidates = events.concat(others).sort((a, b) => Number(b.start_time) - Number(a.start_time));
    }
    // a group needs at least one clip the list is showing; clips of other cameras appear only inside a group
    const items = groupOverlappingClips(candidates).filter((item) => (item.group ? item.events.some((ev) => shown.has(ev)) : shown.has(item.ev)));
    for (const item of items) if (item.group) this._tgGroups.set(item.id, item);
    // a group sits at the day and place of its newest clip
    return byDay(items, (item) => (item.group ? Math.max(...item.events.map((ev) => Number(ev.start_time))) : item.ev.start_time),
      (item) => (item.group ? this._overlapGroupHTML(item) : row(item.ev)));
  },

  _overlapGroupHTML(g) {
    const open = this._tgOpenGroups?.has(g.id);
    const labels = [...new Set(g.events.map((ev) => cap(ev.label || '')))].filter(Boolean);
    const people = [...new Set(g.events.map((ev) => ev.sub_label).filter(Boolean))];
    const title = labels.join(' · ') + (people.length ? ` · ${people.join(', ')}` : '');
    const cameras = new Set(g.events.map((ev) => ev.camera));
    const seconds = Math.max(1, Math.round(g.end - g.start));
    const firstPerCamera = [];
    const seen = new Set();
    for (const ev of g.events) if (!seen.has(ev.camera)) { seen.add(ev.camera); firstPerCamera.push(ev); }
    const strip = firstPerCamera.slice(0, TOGETHER_MAX_TILES).map((ev) => {
      const url = this._mediaForEvent(ev, 'thumbnail.jpg');
      return `<div class="ovg-t"><img src="${tgEsc(url)}" data-frigate-thumb="1" data-thumb-src="${tgEsc(url)}" loading="lazy" alt=""><span>${tgEsc(this._mediaCameraDisplay(ev.camera))}</span></div>`;
    }).join('');
    return `<div class="ovg${open ? ' open' : ''}" data-ovg="${tgEsc(g.id)}">
      <div class="ovg-top"><div><b>${tgEsc(title)}</b><small>${cameras.size} cameras · ${this._time(g.start)} – ${this._time(g.end)} · ${seconds} s</small></div><span class="ovg-badge">Together</span></div>
      <div class="ovg-strip" style="--n:${Math.min(firstPerCamera.length, TOGETHER_MAX_TILES)}">${strip}</div>
      <div class="ovg-acts"><button type="button" class="ovg-watch" data-together="${tgEsc(g.id)}">${TG_ICON_PLAY}<span>Watch together</span></button><button type="button" class="ovg-more" data-ovg-toggle="${tgEsc(g.id)}" aria-expanded="${open ? 'true' : 'false'}">${g.events.length} clips ${TG_ICON_CHEVRON}</button></div>
      <div class="ovg-inner">${g.events.slice().sort((a, b) => b.start_time - a.start_time).map((ev) => this._eventCardHTML(ev, false)).join('')}</div>
    </div>`;
  },

  _toggleOverlapGroup(id) {
    this._tgOpenGroups = this._tgOpenGroups || new Set();
    if (this._tgOpenGroups.has(id)) this._tgOpenGroups.delete(id); else this._tgOpenGroups.add(id);
    const card = [...this.shadowRoot.querySelectorAll('.ovg')].find((el) => el.dataset.ovg === id);
    if (!card) return;
    card.classList.toggle('open', this._tgOpenGroups.has(id));
    card.querySelector('.ovg-more')?.setAttribute('aria-expanded', this._tgOpenGroups.has(id) ? 'true' : 'false');
  },

  // ---------- the Together player ----------

  async _openTogether(id) {
    const g = this._tgGroups?.get(id);
    const card = this.shadowRoot.querySelector('.card');
    if (!g || !card) return;
    this._closeTogether();
    // At most four players at once: phones decode only a few streams. Keep the longest clips.
    const longest = g.events.slice().sort((a, b) => (overlapClipEnd(b) - b.start_time) - (overlapClipEnd(a) - a.start_time));
    const events = longest.slice(0, TOGETHER_MAX_TILES).sort((a, b) => a.start_time - b.start_time);
    const start = Math.min(...events.map((ev) => Number(ev.start_time)));
    const end = Math.max(...events.map((ev) => overlapClipEnd(ev)));
    const narrow = card.classList.contains('mobile');
    const tg = this._tg = {
      id, events, total: g.events.length, start, end, t: start, playing: true, last: performance.now(), lastSync: 0, waiting: false, waitMs: 0, raf: 0,
      mode: narrow ? 'focus' : 'grid', narrow, muted: true, blocked: false, sel: events[0].id, tiles: new Map(), seq: (this._tgSeq = (this._tgSeq || 0) + 1),
    };
    const cameras = new Set(events.map((ev) => ev.camera)).size;
    const labels = [...new Set(events.map((ev) => cap(ev.label || '')))].filter(Boolean).join(' · ');
    const root = document.createElement('div');
    root.className = 'together';
    root.id = 'together';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Clips from several cameras, played together');
    root.tabIndex = -1;
    root.innerHTML = `<div class="tg-head"><div class="tg-title"><b>${tgEsc(labels)}</b><span>${cameras} cameras · ${this._time(start)} – ${this._time(end)}${g.events.length > events.length ? ` · showing ${events.length} of ${g.events.length}` : ''}</span></div>
        <div class="tg-modes" role="group" aria-label="Layout"><button type="button" data-tg-mode="grid">Grid</button><button type="button" data-tg-mode="focus">Focus</button></div>
        <button type="button" class="tg-close" data-tg-close aria-label="Close">${TG_ICON_CLOSE}</button></div>
      <div class="tg-stage" id="tg-stage">${events.map((ev) => `<div class="tg-tile" data-tg-tile="${tgEsc(ev.id)}" tabindex="0" role="button" aria-label="${tgEsc(this._mediaCameraDisplay(ev.camera))}: play sound from this camera">
          <div class="tg-media"></div><span class="tg-nm">${tgEsc(this._mediaCameraDisplay(ev.camera))}</span><span class="tg-lb">${tgEsc(cap(ev.label || ''))}</span><span class="tg-snd">${TG_ICON_SOUND}</span>
          <div class="tg-off" hidden></div><div class="tg-ld">Loading…</div></div>`).join('')}</div>
      <div class="tg-ctl"><div class="tg-row"><button type="button" class="tg-play" data-tg-play aria-label="Pause">${TG_ICON_PAUSE}</button><span class="tg-time" id="tg-time"></span>
        <div class="tg-scrub"><div class="tg-segs">${events.map((ev) => { const a = (Number(ev.start_time) - start) / (end - start) * 100, w = (overlapClipEnd(ev) - Number(ev.start_time)) / (end - start) * 100; return `<div class="tg-seg"><i style="left:${a.toFixed(2)}%;width:${Math.max(1, w).toFixed(2)}%"></i></div>`; }).join('')}</div>
          <div class="tg-head-line" id="tg-headline"></div><input type="range" id="tg-range" min="${start}" max="${end}" step="0.1" value="${start}" aria-label="Shared position"></div>
        <button type="button" class="tg-mute" data-tg-mute aria-label="Mute" aria-pressed="false">${TG_ICON_SOUND}</button></div>
        <div class="tg-sound" id="tg-sound"></div></div>`;
    tg.root = root;
    if (narrow) {
      // Phones: mount the player on document.body in a root of its own. Inside the card, a transformed or clipped ancestor
      // can move a "fixed" sheet, hide its close button, and let the page behind keep scrolling.
      const host = document.createElement('div');
      host.setAttribute('data-sightline-together', '');
      togetherBridgeContext(host, this); // before any player is added: a player asks for its settings when it is connected
      const scope = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `:host{all:initial}.card{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}${TOGETHER_STYLES}`;
      const wrap = document.createElement('div');
      wrap.className = `card mobile together-open${card.classList.contains('theme-light') ? ' theme-light' : ''}`;
      wrap.appendChild(root);
      scope.append(style, wrap);
      document.body.appendChild(host);
      tg.host = host;
      tg.bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else {
      card.classList.add('together-open');
      card.appendChild(root);
    }
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-tg-close]')) return this._closeTogether();
      const mode = e.target.closest('[data-tg-mode]'); if (mode) { tg.mode = mode.dataset.tgMode; return this._togetherPaintLayout(); }
      const tile = e.target.closest('[data-tg-tile]');
      if (tile) {
        tg.sel = tile.dataset.tgTile;
        tg.muted = false; // sound starts only when asked for: the tap is the user gesture iPhone requires
        return this._togetherPaintLayout();
      }
      if (e.target.closest('[data-tg-play]')) return this._togetherToggle();
      if (e.target.closest('[data-tg-mute]')) return this._togetherToggleMute();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this._closeTogether(); return; }
      if (e.key === 'Enter' || e.key === ' ') {
        const tile = e.target.closest?.('[data-tg-tile]');
        if (tile) { e.preventDefault(); tg.sel = tile.dataset.tgTile; this._togetherPaintLayout(); }
      }
    });
    root.querySelector('#tg-range').addEventListener('input', (e) => { tg.t = Number(e.target.value); tg.waitMs = 0; this._togetherSync(true); this._togetherPaintTime(); });
    for (const ev of events) {
      const el = [...root.querySelectorAll('[data-tg-tile]')].find((n) => n.dataset.tgTile === String(ev.id));
      tg.tiles.set(String(ev.id), { ev, el, load: 'idle', player: null, video: null, key: '', bindTimer: 0, lastSeek: 0 });
    }
    this._togetherPaintLayout();
    this._togetherLoop(tg);
    root.querySelector('.tg-close')?.focus({ preventScroll: true });
    // wide cards: bring the player to the top of the screen, so the clips and the controls are in view together (phones get a full-screen sheet)
    if (!narrow) { try { root.scrollIntoView({ block: 'start' }); } catch (_) { /* older browsers */ } }
  },

  _closeTogether() {
    const tg = this._tg;
    this._tg = null;
    if (tg) {
      cancelAnimationFrame(tg.raf);
      for (const tile of tg.tiles.values()) {
        clearInterval(tile.bindTimer);
        try { tile.video?.pause(); } catch (_) { /* the element is going away */ }
        tile.player?.remove?.();
      }
    }
    if (tg) {
      tg.host?.remove();
      tg.root?.remove();
      if (tg.host) document.body.style.overflow = tg.bodyOverflow || '';
    }
    this.shadowRoot?.querySelector?.('.card')?.classList.remove('together-open');
  },

  /** Open one clip's stream. Called when the clip's turn is near, so only the clips in play are being streamed. */
  async _togetherLoadTile(tg, tile) {
    if (tile.load !== 'idle') return;
    tile.load = 'loading';
    const { ev, el } = tile;
    let url = null;
    try { url = await this._togetherResolveClip(ev); } catch (_) { url = null; }
    if (this._tg !== tg) return; // closed or replaced while resolving
    if (!url) { tile.load = 'failed'; el.querySelector('.tg-ld').textContent = 'Clip not available'; return; }
    const player = this._createHlsPlayer(url, { controls: false, muted: true, autoplay: false });
    player.classList.add('tg-player');
    tile.player = player;
    el.querySelector('.tg-media').appendChild(player);
    let tries = 0;
    tile.bindTimer = setInterval(() => {
      const video = this._findVideo(player);
      if (!video) { if (++tries > 60) { clearInterval(tile.bindTimer); tile.load = 'failed'; el.querySelector('.tg-ld').textContent = 'Clip not available'; } return; }
      clearInterval(tile.bindTimer);
      tile.video = video;
      tile.load = 'ready';
      video.muted = String(ev.id) !== String(tg.sel); video.playsInline = true; video.controls = false; video.loop = false;
      // the clip's picture fills the tile the way video_fit says (set on the <video> itself, whatever the player's own styles do)
      const fit = this._config?.video_fit;
      if (fit && fit !== 'contain') video.style.setProperty('object-fit', fit, 'important');
      const ready = () => { el.querySelector('.tg-ld').hidden = true; if (this._tg === tg) tg.dirty = true; };
      for (const name of ['loadedmetadata', 'canplay', 'playing', 'seeked']) video.addEventListener(name, ready);
      if (video.readyState >= 1) ready();
    }, 200);
  },

  /** The clip's video URL, asked of the Frigate instance that owns the clip's camera. */
  async _togetherResolveClip(ev) {
    const owner = (this._config?.cameras || []).map((c) => this._camCache?.[c.entity]).find((cc) => cc && String(cc.cam) === String(ev.camera));
    if (owner?.clientId) {
      const url = await this._resolveMediaContentId(`media-source://frigate/${owner.clientId}/event/clips/${owner.cam}/${ev.id}`);
      if (url) return url;
    }
    return this._resolveFrigateMedia(ev, 'clip');
  },

  /** The shared clock. It runs every frame, but the clips are only checked a few times a second, and the clock waits while a stream buffers. */
  _togetherLoop(tg) {
    const step = (now) => {
      if (this._tg !== tg) return;
      const dt = Math.min(0.25, Math.max(0, (now - tg.last) / 1000));
      tg.last = now;
      if (tg.playing && !tg.waiting) {
        tg.t = Math.min(tg.end, tg.t + dt);
        if (tg.t >= tg.end) { tg.playing = false; this._togetherPaintPlay(); tg.dirty = true; }
      }
      if (tg.dirty || now - tg.lastSync >= TOGETHER_SYNC_MS) {
        const elapsed = tg.lastSync ? now - tg.lastSync : TOGETHER_SYNC_MS;
        tg.lastSync = now; tg.dirty = false;
        this._togetherSync(false, elapsed);
        this._togetherPaintTime();
      }
      tg.raf = requestAnimationFrame(step);
    };
    tg.raf = requestAnimationFrame(step);
  },

  _togetherToggle() {
    const tg = this._tg; if (!tg) return;
    if (!tg.playing && tg.t >= tg.end) tg.t = tg.start; // replay from the beginning
    tg.playing = !tg.playing;
    tg.blocked = false;
    tg.last = performance.now();
    this._togetherSync(true);
    this._togetherPaintPlay();
  },

  /**
   * Put every clip where the shared clock says it should be.
   * @param {boolean} force seek every clip (the person scrubbed, or pressed play after a stop)
   * @param {number} [elapsed] ms since the last check, used to time how long the clock has been waiting
   */
  _togetherSync(force, elapsed = 0) {
    const tg = this._tg; if (!tg) return;
    const now = Date.now();
    const states = [];
    let waiting = false;
    for (const tile of tg.tiles.values()) {
      const video = tile.video;
      const duration = video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
      const st = togetherClipState(tg.t, tile.ev, duration);
      states.push([tile, st]);
      // open the stream shortly before the clip's turn (or at once when its turn has come)
      if (tile.load === 'idle' && (st.state === 'playing' || (st.state === 'before' && -st.rel <= TOGETHER_PRELOAD_SECONDS)) && this._togetherLoadTile) this._togetherLoadTile(tg, tile);
      // a clip whose turn it is but whose stream is not ready yet makes the clock wait for it
      if (st.state === 'playing' && tile.load !== 'failed' && (!video || video.readyState < 3 || video.seeking)) {
        if (!waiting) tg.waitInfo = `${this._mediaCameraDisplay(tile.ev.camera)}: ${tile.load === 'loading' && !video ? 'opening the stream' : video ? `loading (state ${video.readyState})` : 'starting the player'}`;
        waiting = true;
      }
    }
    tg.waitMs = waiting ? tg.waitMs + elapsed : 0;
    tg.waiting = waiting && tg.waitMs < TOGETHER_MAX_WAIT_MS;
    const run = tg.playing && !tg.waiting;
    for (const [tile, st] of states) {
      const video = tile.video;
      if (video) { const mute = tg.muted || String(tile.ev.id) !== String(tg.sel); if (video.muted !== mute) video.muted = mute; }
      if (st.state === 'playing' && video && video.readyState >= 1) {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
        const wanted = Math.max(0, duration ? Math.min(st.rel, duration - 0.05) : st.rel);
        const current = Number(video.currentTime);
        const drift = Number.isFinite(current) ? current - wanted : Infinity;
        if (force || !Number.isFinite(current) || (Math.abs(drift) > TOGETHER_SEEK_SECONDS && !video.seeking && now - tile.lastSeek > TOGETHER_SEEK_COOLDOWN_MS)) {
          tile.lastSeek = now;
          try { video.currentTime = wanted; } catch (_) { /* not seekable yet */ }
          if (video.playbackRate !== 1) video.playbackRate = 1;
        } else if (run && Math.abs(drift) > TOGETHER_NUDGE_SECONDS) {
          video.playbackRate = drift < 0 ? 1.08 : 0.92; // a little behind: speed up; a little ahead: slow down
        } else if (video.playbackRate !== 1) video.playbackRate = 1;
        // while the clock waits, the stream that is not ready is asked to play (that is what makes it load); the others hold
        const loading = tg.waiting && tg.playing && video.readyState < 3;
        if (run || loading) {
          if (video.paused) {
            try {
              const p = video.play();
              // the browser refused to start the video on its own (iPhone does this in Low Power Mode, for example): stop the clock and ask for a tap
              if (p?.catch) p.catch((err) => { if (err?.name === 'NotAllowedError' && this._tg === tg && !tg.blocked) { tg.blocked = true; tg.playing = false; this._togetherPaintPlay(); } });
            } catch (_) { /* autoplay refused */ }
          }
        }
        else if (!video.paused) video.pause();
      } else if (video && !video.paused) video.pause();
      this._togetherPaintTile(tile, st);
    }
    const ctl = tg.root?.querySelector?.('#tg-sound');
    if (ctl) { const sel = tg.events.find((ev) => String(ev.id) === String(tg.sel)); const text = tg.blocked ? 'Tap play to start the video' : `${tg.muted ? 'Muted · tap a camera or the speaker for sound' : `Sound: ${sel ? this._mediaCameraDisplay(sel.camera) : ''}`}${tg.waiting ? (tg.waitMs > 3000 && tg.waitInfo ? ` · Waiting for ${tg.waitInfo}` : ' · Buffering…') : ''}`; if (ctl.textContent !== text) ctl.textContent = text; }
  },

  _togetherPaintTile(tile, st) {
    const key = st.state === 'before' ? `before:${Math.ceil(-st.rel)}` : st.state;
    if (key === tile.key) return;
    tile.key = key;
    const off = tile.el.querySelector('.tg-off');
    const loading = tile.el.querySelector('.tg-ld');
    if (loading) loading.style.visibility = st.state === 'playing' ? '' : 'hidden'; // the countdown or "ended" note replaces "Loading…"
    tile.el.classList.toggle('idle', st.state !== 'playing');
    if (st.state === 'playing') { off.hidden = true; off.textContent = ''; return; }
    off.hidden = false;
    off.innerHTML = st.state === 'before'
      ? `<b>Starts in ${Math.ceil(-st.rel)} s</b><span>${tgEsc(this._time(tile.ev.start_time))}</span>`
      : `<b>Clip ended ${tgEsc(this._time(st.end))}</b><span>Nothing recorded after this</span>`;
  },

  _togetherPaintTime() {
    const tg = this._tg; if (!tg) return;
    const root = tg.root; if (!root) return;
    // a few pixels of rounding must not turn the tile area into a scroller that traps the mouse wheel
    const stage = root.querySelector('#tg-stage');
    if (stage) stage.classList.toggle('scrolls', stage.scrollHeight - stage.clientHeight > 12);
    root.querySelector('#tg-time').textContent = `${tgMmss(tg.t - tg.start)} / ${tgMmss(tg.end - tg.start)}`;
    const range = root.querySelector('#tg-range');
    if (range && root.getRootNode().activeElement !== range) range.value = String(tg.t);
    const head = root.querySelector('#tg-headline');
    if (head) head.style.left = `${((tg.t - tg.start) / Math.max(1, tg.end - tg.start) * 100).toFixed(2)}%`;
  },

  /** The mute button: silences every clip, and a second tap brings the chosen camera's sound back. */
  _togetherToggleMute() {
    const tg = this._tg; if (!tg) return;
    tg.muted = !tg.muted;
    this._togetherPaintMute();
    this._togetherSync(false);
  },

  _togetherPaintMute() {
    const tg = this._tg; if (!tg) return;
    const root = tg.root; if (!root) return;
    const btn = root.querySelector('[data-tg-mute]');
    if (btn) { btn.innerHTML = tg.muted ? TG_ICON_MUTED : TG_ICON_SOUND; btn.setAttribute('aria-pressed', tg.muted ? 'true' : 'false'); btn.setAttribute('aria-label', tg.muted ? 'Unmute' : 'Mute'); btn.classList.toggle('on', tg.muted); }
    root.querySelectorAll('.tg-snd').forEach((el) => { el.innerHTML = tg.muted ? TG_ICON_MUTED : TG_ICON_SOUND; });
  },

  _togetherPaintPlay() {
    const tg = this._tg; if (!tg) return;
    const btn = tg.root?.querySelector('[data-tg-play]');
    if (!btn) return;
    btn.innerHTML = tg.playing ? TG_ICON_PAUSE : TG_ICON_PLAY;
    btn.setAttribute('aria-label', tg.playing ? 'Pause' : 'Play');
  },

  _togetherPaintLayout() {
    const tg = this._tg; if (!tg) return;
    const root = tg.root; if (!root) return;
    const stage = root.querySelector('#tg-stage');
    stage.className = `tg-stage ${tg.mode}${tg.mode === 'focus' && !tg.narrow ? ' wide' : ''}`;
    stage.style.setProperty('--others', String(Math.max(1, tg.events.length - 1)));
    root.querySelectorAll('[data-tg-mode]').forEach((b) => { const on = b.dataset.tgMode === tg.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    root.querySelectorAll('[data-tg-tile]').forEach((el) => el.classList.toggle('sel', el.dataset.tgTile === String(tg.sel)));
    const sel = tg.events.find((ev) => String(ev.id) === String(tg.sel));
    const sound = root.querySelector('#tg-sound');
    if (sound && sel) sound.textContent = tg.muted ? 'Muted · tap a camera or the speaker for sound' : `Sound: ${this._mediaCameraDisplay(sel.camera)}`;
    this._togetherPaintPlay();
    this._togetherPaintMute();
    this._togetherSync(false);
  },
};
