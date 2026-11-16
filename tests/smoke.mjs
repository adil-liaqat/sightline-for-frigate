import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = fs.readFileSync(path.join(root, 'dist', 'sightline-for-frigate.js'), 'utf8');

class FakeHTMLElement { attachShadow() { return {}; } }
const registry = new Map();
const context = {
  HTMLElement: FakeHTMLElement,
  customElements: { get: (name) => registry.get(name), define: (name, ctor) => registry.set(name, ctor) },
  window: { customCards: [] },
  console: { info() {}, log() {}, warn() {}, error() {} },
  Map, Set, Date, Intl, URL, URLSearchParams, AbortController,
  CustomEvent: class {}, navigator: {}, document: { createElement: () => ({}) },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: clearTimeout
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(bundle, context, { filename: 'sightline-for-frigate.js' });

assert.ok(registry.has('sightline-card'), 'card custom element was not registered');
assert.ok(registry.has('sightline-card-editor'), 'editor custom element was not registered');
assert.equal(context.window.customCards.length, 1);
assert.equal(context.window.customCards[0].type, 'sightline-card');

const Card = registry.get('sightline-card');
const card = new Card();
assert.equal(typeof card.setConfig, 'function');
assert.equal(typeof card._renderTimeline, 'function');
assert.equal(typeof card._showRecording, 'function');
assert.equal(typeof card._enterDownloadRangePicker, 'function');
assert.equal(typeof card._applyInitialMediaState, 'function');
assert.equal(typeof card._setGalleryMode, 'function');
assert.equal(typeof card._openInGridSlot, 'function');

card._renderShell = () => {};
card._setupMicrophoneDetection = () => {};
card.setConfig({ cameras:[{entity:'camera.test'}], default_tab:'clips', autoplay_latest_clip:true, timeline:{thumbnail_size:64} });
assert.equal(card._config.default_tab, 'clips');
assert.equal(card._config.autoplay_latest_clip, true);
assert.equal(card._config.timeline.thumbnail_size, 64);
card.setConfig({ cameras:[{entity:'camera.test'}], default_tab:'clips', hidden_tabs:['clips'] });
assert.equal(card._config.default_tab, 'live', 'hidden startup tab must fall back to Live');

const startup = new Card();
startup._config = { default_tab:'clips', autoplay_latest_clip:true };
startup._eventsMode = 'camera';
startup._events = [
  {id:'old',has_clip:true,start_time:100},
  {id:'snapshot-only',has_clip:false,start_time:300},
  {id:'new',has_clip:true,start_time:200}
];
startup._setGalleryMode = async (tab) => { startup._galleryMode=tab; startup._tab=tab; };
startup._filterMediaEvents = (events) => events;
startup._showClip = async (ev) => { startup._autoplayed=ev.id; };
await startup._applyInitialMediaState();
assert.equal(startup._autoplayed, 'new');
startup._autoplayed='unchanged';
await startup._applyInitialMediaState();
assert.equal(startup._autoplayed, 'unchanged', 'startup state must not replay twice');

// Timeline ruler: labels must not overlap on long horizontal spans.
{
  const track={classList:{contains:(c)=>c==='horizontal'},clientWidth:1900,clientHeight:150};
  const step12h=card._timelineScaleStep(12*3600,track);
  assert.ok((step12h/(12*3600))*1900>=92,`12h horizontal ticks too dense: ${step12h}s`);
  assert.equal(step12h,3600,'12h on a 1900px timeline uses hourly labels');
  assert.equal(card._timelineScaleStep(900,track),60,'short spans keep minute ticks');
  assert.equal(card._timelineScaleStep(12*3600,null),1800,'without a measured track the zoom table applies');
  const vtrack={classList:{contains:()=>false},clientWidth:300,clientHeight:600};
  assert.equal(card._timelineScaleStep(3600,vtrack),300,'vertical gutter keeps 5-minute ticks at 1h');
}

// The playback Back button is icon-only; its label lives in title/aria-label.
{
  const src=fs.readFileSync(path.join(root,'src/card/live/view.js'),'utf8');
  assert.match(src,/class="scb-back" data-playback-back title="\$\{backLabel\}" aria-label="\$\{backLabel\}">\$\{ICONS\.back\}<\/button>/,'Back button renders only its icon');
}

// Selecting a clip scrolls the Clips list to it and marks it Playing.
{
  const rv = new Card();
  const mkEl=(cls,top)=>({cls:new Set(cls),html:'',children:[],classList:{add(c){this._s.add(c);},remove(c){this._s.delete(c);},contains(c){return this._s.has(c);},_s:null},getBoundingClientRect:()=>({top,bottom:top+80,height:80})});
  const row=mkEl(['ec'],900); row.classList._s=row.cls;
  const thumb={html:'',querySelector:()=>null,insertAdjacentHTML(_,h){this.html+=h;}};
  let scrolled=null;
  const grid={scrollTop:0,clientHeight:400,getBoundingClientRect:()=>({top:100,bottom:500}),querySelector:(sel)=>sel.startsWith('.ec[data-ev="ev7"]')?row:null,querySelectorAll:()=>[],scrollTo(o){scrolled=o;}};
  row.closest=()=>grid; row.querySelector=()=>thumb; row.contains=()=>false;
  rv.shadowRoot={querySelector:(sel)=>sel==='.media-gallery-grid'?grid:null};
  rv._galleryMode='clips'; rv._playing={id:'ev7'};
  rv._mediaQueryBounds=()=>({start:0,end:Number.MAX_SAFE_INTEGER});
  await rv._revealPlayingInGallery({id:'ev7',start_time:1000});
  assert.ok(row.cls.has('playing'),'the selected clip row is marked playing');
  assert.match(thumb.html,/Playing/);
  assert.ok(scrolled && scrolled.top>0,'the list scrolls to an off-screen clip');

  // A clip outside the list's range switches the list to that clip's day.
  const old = new Card();
  old.shadowRoot={querySelector:()=>null};
  old._galleryMode='clips'; old._playing={id:'x'};
  old._mediaFilter={date:'all'};
  old._mediaQueryBounds=()=>({start:2e9,end:2e9+86400});
  let loaded=0; old._loadWindow=async()=>{ loaded++; }; old._renderGallery=()=>{};
  const ts=Math.floor(new Date(2026,10,13,8,10,34).getTime()/1000);
  await old._revealPlayingInGallery({id:'x',start_time:ts});
  assert.equal(old._mediaFilter.date,'2026-11-13');
  assert.equal(loaded,1,'the list reloads for that day');
}

// Scrolling the timeline onto a clip reveals it without changing the list date.
{
  const sc = new Card();
  sc._galleryMode='clips';
  sc._events=[{id:'a',has_clip:true,start_time:100,end_time:120},{id:'b',has_clip:true,start_time:110,end_time:130},{id:'c',has_clip:false,start_time:110,end_time:200}];
  const seen=[]; sc._revealPlayingInGallery=(ev,opts)=>seen.push([ev.id,opts.switchDate]);
  sc._revealGalleryAtTime(115);
  assert.deepEqual(seen,[['b',false]],'the newest clip under the playhead, without a date switch');
  sc._revealGalleryAtTime(170);
  assert.equal(seen.length,1,'a time with no clip reveals nothing');
}

// The toast never intercepts presses meant for the download-range handles.
assert.match(bundle, /#toast\{pointer-events:none !important;\}/);

console.log('Smoke test passed.');
