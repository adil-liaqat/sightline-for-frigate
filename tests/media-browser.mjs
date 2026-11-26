import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mediaNavigationMethods } from '../src/card/media/navigation.js';
import { isMultiviewPlaybackContext } from '../src/card/ui/playback-layout.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const ux=read('src/card/multiview/media-browser.js');
const layout=read('src/card/ui/playback-layout.js');
const controller=read('src/card/playback/event-controller.js');

assert.match(ux,/isClipBrowser[\s\S]*?_mediaQueryBounds\(now\)/,'Multiview Clips must use the media-browser time range for every camera');
assert.match(ux,/if\(isClipBrowser\)request\.has_clip=true/,'Multiview Clips background queries must request retained clips');
assert.match(ux,/if\(isClipBrowser&&this\._galleryMode==='clips'\)this\._renderGallery\(\)/,'All-camera clip loading must refresh the Clips gallery');
assert.match(ux,/for\(const config of \(this\._config\?\.cameras\|\|\[\]\)\)/,'Multiview camera filters must be seeded from every configured camera');
assert.match(ux,/await this\._loadAllCamsBackground\(\)/,'Opening Multiview Clips must wait for the aggregate camera load before final paint');

assert.match(layout,/grid-template-columns/,'Desktop grid clip playback must override the responsive workstation columns');
assert.match(layout,/setProperty\('display','none','important'\)/,'Desktop grid clip playback must hide secondary panes with important priority');
assert.match(layout,/playback-fullcard/,'Full-card recorded playback must have an explicit state marker');
assert.match(layout,/playbackColumnHeight/,'Full-card playback must save and clear the synchronized Multiview column height');
assert.match(layout,/setProperty\('display','block','important'\)/,'Full-card playback must collapse the workstation CSS grid to one block-level feed');
assert.match(layout,/camSwitcher/,'Full-card playback must hide and restore the unused Multiview camera switcher');
assert.match(layout,/min-height/,'Playback return button should use compact sizing');
assert.match(layout,/min-height:30px/,'Playback return button should be reduced from the v1.1.0 size');

// A clip selected from the media browser must always use workspace-level
// playback. Multiview is restored by the playback-return policy; the selected
// camera tile is never used as the clip's playback target.
{
  let opened=null;
  let gridOpened=null;
  const card={dataset:{ev:'clip-event-1'}};
  const target={closest(selector){return selector==='[data-ev]'?card:null;}};
  const ctx={
    _viewMode:'grid',
    _open:id=>{opened=id;},
    _openInGridSlot:id=>{gridOpened=id;}
  };
  mediaNavigationMethods._click.call(ctx,{target,stopPropagation(){}});
  assert.equal(opened,'clip-event-1','Multiview Clips must open in the full playback workspace');
  assert.equal(gridOpened,null,'Multiview Clips must not replace only the matching camera tile');
}

assert.match(controller,/if\(ev\.has_clip\) return this\._showClip\(ev\)/,'Timeline event clips must use the same full playback pipeline');
// Wide workstation reconciliation can leave the state flag stale while the
// Multiview grid is still visibly mounted beside the Clips browser. Playback
// must follow the visible player, not only `_viewMode`.
{
  const grid={style:{display:''},children:[{}],querySelector:()=>({})};
  const cardNode={classList:{contains:()=>false}};
  const ctx={_viewMode:'single'};
  assert.equal(isMultiviewPlaybackContext(ctx,{card:cardNode,grid}),true,'visible mounted Multiview must trigger full-player playback even with stale view state');

  grid.style.display='none';
  assert.equal(isMultiviewPlaybackContext(ctx,{card:cardNode,grid}),false,'a hidden stale grid must not force Multiview playback');
}

assert.match(layout,/isMultiviewPlaybackContext\(this,workspace\)/,'Full playback must derive its return target from the rendered Multiview context');

console.log('Media browser and desktop playback regression test passed.');

// Reviews tab: "Mark all" marks only what the filters show, after a confirming second tap.
{
  const { actionMethods } = await import('../src/card/actions.js');
  const calls = [], toasts = [], rendered = [];
  const label = { textContent: '' };
  const btn = { hidden: true, attrs: {}, classes: new Set(), querySelector: () => label, setAttribute(k, v) { this.attrs[k] = v; }, classList: { toggle: (c, on) => (on ? btn.classes.add(c) : btn.classes.delete(c)) } };
  const reviews = [
    { id: 'a', camera: 'gate', has_been_reviewed: false }, { id: 'b', camera: 'gate', has_been_reviewed: false },
    { id: 'c', camera: 'gate', has_been_reviewed: true }, { id: 'd', camera: 'garage', has_been_reviewed: false },
  ];
  const card = {
    ...Object.fromEntries(['_visibleUnreviewed', '_onMarkAllVisible', '_syncMarkAllButton', '_markVisibleReviewed'].map(k => [k, actionMethods[k]])),
    _galleryMode: 'reviews', _reviews: reviews, _filterMediaReviews: list => list.filter(r => r.camera === 'gate'),
    shadowRoot: { querySelector: () => btn }, _cc: () => ({ clientId: 'frigate' }),
    _hass: { callWS: async m => { calls.push(m); } }, _toast: m => toasts.push(m), _renderList() { rendered.push(1); card._syncMarkAllButton(); },
  };
  card._syncMarkAllButton();
  assert.equal(btn.hidden, false, 'Mark all is shown while the filtered Reviews list has unreviewed items');
  assert.equal(label.textContent, 'Mark all (2)', 'The button counts only the reviews the filters show');
  card._onMarkAllVisible();
  assert.equal(calls.length, 0, 'The first tap only arms the button');
  assert.equal(label.textContent, 'Confirm · 2', 'The armed button asks for confirmation with the count');
  assert.ok(btn.classes.has('armed'), 'The armed button is styled as armed');
  await card._onMarkAllVisible();
  assert.equal(calls.length, 1, 'The second tap marks the reviews');
  assert.deepEqual(calls[0], { type: 'frigate/reviews/viewed', instance_id: 'frigate', ids: ['a', 'b'], viewed: true }, 'Only unreviewed reviews shown by the filters are sent');
  assert.deepEqual(reviews.map(r => r.has_been_reviewed), [true, true, true, false], 'Reviews hidden by a filter stay unreviewed');
  assert.match(toasts[0], /Marked 2 reviews as reviewed/, 'A toast reports how many were marked');
  assert.equal(btn.hidden, true, 'The button disappears once nothing is left to mark');
  // a filter change between the two taps asks again instead of marking another set
  const more = [{ id: 'x', camera: 'gate', has_been_reviewed: false }, { id: 'y', camera: 'gate', has_been_reviewed: false }];
  card._reviews = more; card._markAllArmed = false; card._onMarkAllVisible();
  card._reviews = more.concat([{ id: 'z', camera: 'gate', has_been_reviewed: false }]); card._onMarkAllVisible();
  assert.equal(calls.length, 1, 'Changing what is shown between taps re-arms instead of marking');
  clearTimeout(card._markAllArmT);
}

// timeline.show_on_mobile hides the timeline on phone-width cards only; timeline.enabled hides it everywhere.
{
  const { responsiveUxMethods } = await import('../src/card/responsive-ux.js');
  const on = (timeline, width) => responsiveUxMethods._timelineOn.call({ _config: { timeline }, _cardWidth: width });
  assert.equal(on({ enabled: true, show_on_mobile: true }, 390), true, 'Timeline shows on a phone by default');
  assert.equal(on({ enabled: true, show_on_mobile: false }, 390), false, 'show_on_mobile:false hides it on a phone');
  assert.equal(on({ enabled: true, show_on_mobile: false }, 419), false, 'Phone width ends below 420px');
  assert.equal(on({ enabled: true, show_on_mobile: false }, 420), true, 'A 420px card is not a phone');
  assert.equal(on({ enabled: true, show_on_mobile: false }, 1200), true, 'show_on_mobile:false keeps the timeline on desktop');
  assert.equal(on({ enabled: false, show_on_mobile: true }, 1200), false, 'enabled:false hides it everywhere');
}
// Clips, reviews and recordings play in a box of their own video's shape (aspect_ratio: auto), not the live camera's.
{
  const { layoutMethods } = await import('../src/card/layout.js');
  const video = (w, h) => ({ tagName: 'VIDEO', videoWidth: w, videoHeight: h, addEventListener() {} });
  const mk = (aspect, viewerDisplay, media) => {
    const applied = [];
    const viewer = { style: { display: viewerDisplay }, querySelector: () => null };
    const card = {
      _config: { aspect_ratio: aspect }, _playbackAspect: null, shadowRoot: { querySelector: (s) => (s === '#viewer' ? viewer : null) },
      _findVideo: () => media, _applyCardStyle: () => applied.push(card._playbackAspect),
      _syncPlaybackAspect: layoutMethods._syncPlaybackAspect, _playbackMediaAspect: layoutMethods._playbackMediaAspect,
    };
    return { card, applied };
  };
  let t = mk('auto', 'block', video(1280, 960));
  t.card._syncPlaybackAspect();
  assert.equal(t.card._playbackAspect, '1280/960', 'While a clip plays, the box takes the clip\'s own shape');
  assert.equal(t.applied.length, 1, 'The layout is refreshed once');
  t.card._syncPlaybackAspect();
  assert.equal(t.applied.length, 1, 'Nothing changes, nothing is refreshed');
  t = mk('auto', 'block', video(0, 0));
  t.card._syncPlaybackAspect();
  assert.equal(t.card._playbackAspect, null, 'Before the video has a size the live shape stays');
  t = mk('auto', 'none', video(1280, 960));
  t.card._playbackAspect = '1280/960';
  t.card._syncPlaybackAspect();
  assert.equal(t.card._playbackAspect, null, 'When playback ends the box goes back to the live shape');
  t = mk('16:9', 'block', video(1280, 960));
  t.card._syncPlaybackAspect();
  assert.equal(t.card._playbackAspect, null, 'A fixed aspect_ratio is never overridden');
}

// video_fit: a clip's picture fills the player box the way the configuration says.
{
  const { mediaSourceMethods } = await import('../src/card/playback/media-source.js');
  const makeEl = () => ({ setAttribute() {} });
  globalThis.document = globalThis.document || {};
  const prevCreate = globalThis.document.createElement;
  globalThis.document.createElement = makeEl;
  const mk = (fit) => ({ _hass: {}, _config: { video_fit: fit }, _absoluteHaMediaUrl: (u) => u });
  const player = (fit) => mediaSourceMethods._createHlsPlayer.call(mk(fit), '/api/x.m3u8');
  assert.equal(player('fill').fitMode, 'fill', 'fill stretches the clip to the player box');
  assert.equal(player('cover').fitMode, 'cover', 'cover crops the clip to the player box');
  assert.equal(player('contain').fitMode, undefined, 'contain is the player\'s own default');
  assert.equal(player(undefined).fitMode, undefined, 'Without video_fit nothing changes');
  globalThis.document.createElement = prevCreate;
}

// Overlapping clips: groups, chains, and the clock a group plays on.
{
  const { groupOverlappingClips, togetherClipState } = await import('../src/card/media/overlap.js');
  const clip = (id, camera, start, end, extra = {}) => ({ id, camera, start_time: start, end_time: end, has_clip: true, label: 'person', ...extra });
  const ids = items => items.map(x => x.group ? 'G[' + x.events.map(e => e.id).join(',') + ']' : x.ev.id);
  // newest first, like the Clips list
  const list = [clip('d', 'garden', 1500, 1520), clip('c', 'garden', 1018, 1032), clip('b', 'driveway', 1010, 1040), clip('a', 'front', 1000, 1025), clip('z', 'front', 100, 120)];
  const out = groupOverlappingClips(list, { now: 2000 });
  assert.deepEqual(ids(out), ['d', 'G[a,b,c]', 'z'], 'Overlapping clips of different cameras become one group at the place of the newest member; the rest stay single');
  const g = out[1];
  assert.equal(g.start, 1000, 'A group starts with its earliest clip');
  assert.equal(g.end, 1040, 'A group ends with its latest clip');
  assert.deepEqual(ids(groupOverlappingClips([clip('a', 'front', 1000, 1010), clip('b', 'front', 1005, 1020)], { now: 2000 })), ['a', 'b'], 'Two clips of the same camera are not grouped');
  assert.deepEqual(ids(groupOverlappingClips([clip('b', 'driveway', 1008, 1030), clip('a', 'front', 1000, 1010)], { now: 2000 })), ['b', 'a'], 'Two seconds in common is not an overlap (the minimum is three)');
  assert.deepEqual(ids(groupOverlappingClips([clip('b', 'driveway', 1007, 1030), clip('a', 'front', 1000, 1010)], { now: 2000 })), ['G[a,b]'], 'Three seconds in common is an overlap');
  // a chain: A overlaps B, B overlaps C, A and C do not overlap each other
  const chain = groupOverlappingClips([clip('c', 'garden', 1030, 1060), clip('b', 'driveway', 1010, 1040), clip('a', 'front', 1000, 1015)], { now: 2000 });
  assert.deepEqual(ids(chain), ['G[a,b,c]'], 'Overlap chains into one group');
  assert.deepEqual(ids(groupOverlappingClips([clip('a', 'front', 1000, 1025, { has_clip: false }), clip('b', 'driveway', 1010, 1040)], { now: 2000 })), ['a', 'b'], 'A snapshot-only event has no video and is never grouped');
  assert.deepEqual(ids(groupOverlappingClips([clip('a', 'front', 1000, null), clip('b', 'driveway', 1500, 1520)], { now: 1600 })), ['G[a,b]'], 'A clip that is still running lasts until now');
  assert.deepEqual(groupOverlappingClips([], {}), [], 'No clips, no items');
  // the shared clock
  const e = clip('a', 'front', 1000, 1025);
  assert.equal(togetherClipState(990, e).state, 'before', 'Before its start a clip waits');
  assert.equal(togetherClipState(1010, e).rel, 10, 'During a clip the position is the time since its start');
  assert.equal(togetherClipState(1030, e).state, 'after', 'After its end a clip is finished');
  assert.equal(togetherClipState(1030, e, 40).state, 'playing', 'The loaded video length wins over the event times');
}

// Together player: every clip follows the shared clock (seek, play, pause, sound, buffering, lazy loading).
{
  const { togetherMethods } = await import('../src/card/media/together.js');
  const node = () => ({ hidden: false, textContent: '', innerHTML: '', style: {}, classList: { toggle() {} } });
  const mkVideo = (duration) => ({ readyState: 4, duration, currentTime: 0, paused: true, muted: true, playbackRate: 1, seeking: false, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } });
  const ev = (id, start, end) => ({ id, camera: id, start_time: start, end_time: end });
  const tile = (e, video, load = 'ready') => ({ ev: e, video, load, lastSeek: 0, key: '', el: { classList: { toggle() {} }, querySelector: () => node() } });
  const front = tile(ev('front', 1000, 1025), mkVideo(25)), drive = tile(ev('drive', 1010, 1040), mkVideo(30)), garden = tile(ev('garden', 1018, 1032), mkVideo(14));
  const tg = { t: 1020, playing: true, waiting: false, waitMs: 0, muted: false, blocked: false, sel: 'drive', events: [front.ev, drive.ev, garden.ev], tiles: new Map([['front', front], ['drive', drive], ['garden', garden]]) };
  const card = { _tg: tg, _time: (t) => String(t), _togetherPaintTile: togetherMethods._togetherPaintTile, _mediaCameraDisplay: (c) => c, shadowRoot: { querySelector: () => null } };
  const sync = (force, ms) => togetherMethods._togetherSync.call(card, force, ms);
  sync(true);
  assert.equal(front.video.currentTime, 20, 'A clip is seeked to the shared time minus its own start');
  assert.equal(drive.video.currentTime, 10, 'Every clip is seeked against the same clock');
  assert.equal(garden.video.currentTime, 2, 'A clip that started later is seeked to its own position');
  assert.ok(!front.video.paused && !drive.video.paused && !garden.video.paused, 'All clips play while the clock runs');
  assert.deepEqual([front.video.muted, drive.video.muted, garden.video.muted], [true, false, true], 'Only the chosen camera has sound');
  // the mute button silences every clip, and unmuting brings the chosen camera's sound back
  tg.muted = true; sync(false);
  assert.deepEqual([front.video.muted, drive.video.muted, garden.video.muted], [true, true, true], 'Muted: no clip has sound');
  tg.muted = false; sync(false);
  assert.deepEqual([front.video.muted, drive.video.muted, garden.video.muted], [true, false, true], 'Unmuted: only the chosen camera has sound again');
  // a small gap is closed with the playback speed, never with a seek
  front.video.currentTime = 19.5; front.lastSeek = 0; sync(false);
  assert.equal(front.video.currentTime, 19.5, 'A half-second gap is not seeked');
  assert.equal(front.video.playbackRate, 1.08, 'A stream a little behind speeds up');
  front.video.currentTime = 20.6; sync(false);
  assert.equal(front.video.playbackRate, 0.92, 'A stream a little ahead slows down');
  front.video.currentTime = 20.1; sync(false);
  assert.equal(front.video.playbackRate, 1, 'Back in step, the speed returns to normal');
  // a big gap is fixed with one seek, and not again within the cooldown
  front.video.currentTime = 15; front.lastSeek = 0; sync(false);
  assert.equal(front.video.currentTime, 20, 'A gap over 1.5 s is fixed with a seek');
  front.video.currentTime = 15; sync(false);
  assert.equal(front.video.currentTime, 15, 'It does not seek again straight away (a seek on HLS has to fetch segments)');
  front.lastSeek = 0;
  // a clip that has not started yet waits, one that has ended stops
  tg.t = 1005; sync(true);
  assert.ok(drive.video.paused && garden.video.paused, 'Clips that have not started stay paused');
  assert.ok(!front.video.paused, 'A running clip keeps playing');
  tg.t = 1036; sync(true);
  assert.ok(front.video.paused && garden.video.paused, 'Clips that have ended are paused');
  assert.ok(!drive.video.paused, 'A clip still running keeps playing');
  // buffering: the clock waits for a stream that is not ready, and pauses the others meanwhile
  tg.t = 1020; drive.video.readyState = 1; sync(true, 250);
  assert.equal(tg.waiting, true, 'The clock waits while a clip whose turn it is has not buffered');
  assert.ok(front.video.paused, 'The other clips hold while the clock waits');
  assert.ok(!drive.video.paused, 'The stream that is not ready is asked to play, which is what makes it load');
  drive.video.readyState = 4; sync(false, 250);
  assert.equal(tg.waiting, false, 'The clock goes on once the stream is ready');
  assert.ok(!front.video.paused, 'Clips play again when the wait is over');
  drive.video.readyState = 1; tg.waitMs = 0; for (let i = 0; i < 40; i++) sync(false, 250);
  assert.equal(tg.waiting, false, 'The clock never waits for a stuck stream longer than eight seconds');
  drive.video.readyState = 4; sync(false, 250);
  // a browser that refuses to start the video asks for a tap instead of waiting forever
  const refused = tile(ev('r', 1000, 1030), mkVideo(30));
  refused.video.play = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  const tgR = { t: 1010, playing: true, waiting: false, waitMs: 0, muted: true, blocked: false, sel: 'r', events: [refused.ev], tiles: new Map([['r', refused]]) };
  togetherMethods._togetherSync.call({ _tg: tgR, _time: card._time, _togetherPaintTile: card._togetherPaintTile, _mediaCameraDisplay: card._mediaCameraDisplay, _togetherPaintPlay() {}, shadowRoot: card.shadowRoot }, true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(tgR.blocked, true, 'A refused autoplay is noticed');
  assert.equal(tgR.playing, false, 'The clock stops and waits for the person to press play');
  // paused clock pauses everything
  tg.t = 1020; tg.playing = false; sync(true);
  assert.ok(front.video.paused && drive.video.paused && garden.video.paused, 'Pausing the clock pauses every clip');
  // streams are opened lazily, shortly before a clip's turn
  const opened = [];
  const lazy = { _tg: null, _time: card._time, _togetherPaintTile: card._togetherPaintTile, _mediaCameraDisplay: card._mediaCameraDisplay, shadowRoot: card.shadowRoot, _togetherLoadTile: (_, t) => opened.push(t.ev.id) };
  const a = tile(ev('a', 1000, 1030), null, 'idle'), b = tile(ev('b', 1020, 1050), null, 'idle'), c = tile(ev('c', 1040, 1070), null, 'idle');
  lazy._tg = { t: 1000, playing: true, waiting: false, waitMs: 0, sel: 'a', events: [a.ev, b.ev, c.ev], tiles: new Map([['a', a], ['b', b], ['c', c]]) };
  togetherMethods._togetherSync.call(lazy, false);
  assert.deepEqual(opened, ['a'], 'At the start only the clip in play is opened');
  lazy._tg.t = 1016; opened.length = 0; a.load = 'ready'; togetherMethods._togetherSync.call(lazy, false);
  assert.deepEqual(opened, ['b'], 'A clip is opened five seconds before its turn');
}

// Together player on a phone: the player's requests for Home Assistant's settings are handed on from the card.
{
  const { togetherBridgeContext } = await import('../src/card/media/together.js');
  const listeners = [];
  const host = { addEventListener: (name, fn) => listeners.push([name, fn]) };
  const received = [];
  const source = { dispatchEvent: (e) => { received.push(e); e.callback('VALUE', () => {}); return true; } };
  globalThis.Event = globalThis.Event || class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  togetherBridgeContext(host, source);
  assert.equal(listeners.length, 1, 'The bridge listens for context requests on the player host');
  assert.equal(listeners[0][0], 'context-request');
  let stopped = false, answer = null;
  listeners[0][1]({ context: 'config', callback: (v) => { answer = v; }, subscribe: true, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true, 'The original request stops at the host (nothing above it can answer)');
  assert.equal(received.length, 1, 'It is handed on from the card');
  assert.equal(received[0].context, 'config', 'The same context is asked for');
  assert.equal(received[0].subscribe, true, 'Subscriptions are kept');
  assert.equal(answer, 'VALUE', 'The answer goes straight back to the player');
  listeners[0][1]({ callback: () => {}, stopPropagation() { stopped = 'bad'; } });
  assert.equal(received.length, 1, 'Anything that is not a context request is ignored');
}
