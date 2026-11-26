/**
 * Clips, recordings, and reviews gallery rendering.
 *
 * Methods are composed onto SightlineCard.prototype; method names are kept
 * stable so existing card behavior and tests remain unchanged.
 */
import { ICONS } from '../../constants.js';
import { cap, camDisplayName, labelColor } from '../../helpers.js';

const CHECK_ICON='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';
const PLAY_ICON='<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"></path></svg>';

export const mediaGalleryMethods = {
/** "Today", "Yesterday", "Fri, Nov 14" (year added when not this year). */
_galleryDayLabel(ts) {
    const d=new Date(Number(ts)*1000);
    if(Number.isNaN(d.getTime())) return '';
    const key=(x)=>`${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
    const today=new Date(); const yesterday=new Date(); yesterday.setDate(today.getDate()-1);
    if(key(d)===key(today)) return 'Today';
    if(key(d)===key(yesterday)) return 'Yesterday';
    const opts={weekday:'short',month:'short',day:'numeric'};
    if(d.getFullYear()!==today.getFullYear()) opts.year='numeric';
    return d.toLocaleDateString([],opts);
  },

/** The gallery row for an event: its clip row, or the review that contains it. */
_galleryRowFor(id, tab=this._galleryMode) {
    const grid=this.shadowRoot?.querySelector?.('.media-gallery-grid');
    if(!grid) return null;
    const esc=(v)=>String(v).replace(/["\\]/g,'\\$&');
    if(tab==='clips') return grid.querySelector(`.ec[data-ev="${esc(id)}"]`);
    if(tab==='reviews') {
      const review=(this._reviews||[]).find(r=>(r?.data?.detections||[]).map(String).includes(String(id)));
      return review ? grid.querySelector(`.rev[data-review-id="${esc(review.id)}"]`) : null;
    }
    return null;
  },

/**
 * Selecting a clip anywhere (timeline, home item) marks it Playing in the
 * Clips/Reviews list and scrolls the list to it. A clip outside the list's
 * date range switches the list's date filter to that clip's day first.
 */
async _revealPlayingInGallery(ev, {switchDate=true}={}) {
    const tab=this._galleryMode;
    if(!ev || (tab!=='clips' && tab!=='reviews')) return;
    const seq=this._galleryRevealSeq=(this._galleryRevealSeq||0)+1;
    const id=String(ev.id);
    let row=this._galleryRowFor(id,tab);
    const st=Number(ev.start_time);
    if(!row && switchDate && Number.isFinite(st) && this._mediaFilter && this._mediaQueryBounds) {
      const b=this._mediaQueryBounds();
      if(st<b.start || st>=b.end) {
        const d=new Date(st*1000);
        this._mediaFilter.date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if(tab==='reviews') await this._loadReviews(); else await this._loadWindow(true);
        if(seq!==this._galleryRevealSeq || this._galleryMode!==tab || String(this._playing?.id??'')!==id) return;
        this._renderGallery();
        row=this._galleryRowFor(id,tab);
      }
    }
    if(!row) return;
    const grid=row.closest('.media-gallery-grid');
    grid?.querySelectorAll('.playing').forEach(el=>{ if(el!==row) el.classList.remove('playing'); });
    grid?.querySelectorAll('.ec-now').forEach(el=>{ if(!row.contains(el)) el.remove(); });
    row.classList.add('playing');
    const thumb=row.querySelector('.et,.rev-th');
    if(thumb && !thumb.querySelector('.ec-now')) thumb.insertAdjacentHTML('beforeend','<span class="ec-now">Playing</span>');
    if(!grid) return;
    const g=grid.getBoundingClientRect(), r=row.getBoundingClientRect();
    const header=grid.querySelector('.mg-day')?.getBoundingClientRect().height||0;
    if(r.top>=g.top+header && r.bottom<=g.bottom) return;
    const top=grid.scrollTop+(r.top-g.top)-Math.max(header,(grid.clientHeight-r.height)/2);
    grid.scrollTo?.({top:Math.max(0,top),behavior:'smooth'});
  },

/**
 * The timeline settled on a time (scroll, drag, wheel): reveal the clip under
 * the playhead in the list. Scrubbing never changes the list's date filter.
 */
_revealGalleryAtTime(ts) {
    const tab=this._galleryMode;
    if(tab!=='clips' && tab!=='reviews') return;
    const t=Number(ts); if(!Number.isFinite(t)) return;
    const pad=3;
    const source=(this._eventsMode==='all' && this._allDisplayEvents) ? this._allDisplayEvents() : (this._events||[]);
    let best=null;
    for(const ev of source) {
      if(!ev?.has_clip) continue;
      const st=Number(ev.start_time), en=Number(ev.end_time)||st;
      if(!(st-pad<=t && t<=en+pad)) continue;
      if(!best || st>Number(best.start_time)) best=ev;
    }
    if(best) this._revealPlayingInGallery(best,{switchDate:false});
  },

/** Render rows newest-first with a sticky day header whenever the day changes. */
_galleryGroupByDay(items, tsOf, rowHtml) {
    let last=null, html='';
    for(const item of items) {
      const label=this._galleryDayLabel(tsOf(item));
      if(label!==last){ html+=`<div class="mg-day" role="heading" aria-level="3">${label}</div>`; last=label; }
      html+=rowHtml(item);
    }
    return html;
  },

_renderGallery(force=false) {
    const gallery=this.shadowRoot.querySelector('#media-gallery'); if(!gallery || !this._galleryMode) return;
    // While a native date/time picker owns the screen, do not mutate any part
    // of the gallery. Clips/Recordings receive asynchronous _loadWindow()
    // updates that Reviews does not, and even changing sibling result rows or
    // ancestor height can make iOS dismiss the native picker although the
    // <input> itself survived. Queue one repaint and keep the DOM pixel-stable.
    if(this._mediaPickerActive && !force) {
      this._mediaPickerPendingGalleryRender=true;
      return;
    }
    this._mediaPickerPendingGalleryRender=false;
    const tab=this._galleryMode; let title=''; let content=''; let count=0;
    this._normalizeMediaFilterState();
    const activeFilters=this._mediaFilterActive();
    if(tab==='clips') {
      const events=[...this._filterMediaEvents(this._eventsMode==='all'?this._allDisplayEvents():this._events)].sort((a,b)=>Number(b.start_time)-Number(a.start_time)); title='Clips'; count=events.length;
      content=events.length ? this._galleryGroupByDay(events,ev=>ev.start_time,ev=>this._eventCardHTML(ev,false)) : this._emptyState(ICONS.clips,'No clips match','Try changing the filters');
    } else if(tab==='recordings') {
      const recs=this._filterMediaRecordings(this._recordingBrowse.length ? this._recordingBrowse : this._mergeRecs(this._recordings)).sort((a,b)=>b.start_time-a.start_time); title='Recordings'; count=recs.length;
      content=recs.length ? this._galleryGroupByDay(recs,r=>r.start_time,r=>{ const rs=Math.floor(r.start_time), re=Math.floor(r.end_time||Date.now()/1000); const d=Math.max(1,re-rs), mm=Math.floor(d/60), ss=d%60; return `<div class="rec" data-rs="${rs}" data-re="${re}"><div class="ric">${ICONS.recordings}</div><div class="rinf"><div class="rt">${this._time(r.start_time)} – ${this._time(r.end_time||Date.now()/1000)}</div><div class="rsub">${d>=3600?`${Math.floor(d/3600)}h ${Math.floor((d%3600)/60)}m`:`${mm?mm+'m ':''}${ss}s`}${r.events?' · '+r.events+(r.events===1?' event':' events'):''}</div></div><div class="rp" aria-hidden="true">${PLAY_ICON}</div></div>`; }) : this._emptyState(ICONS.recordings,'No recordings match','Try changing the filters');
    } else if(tab==='reviews') {
      const revs=this._filterMediaReviews(this._reviews).sort((a,b)=>b.start_time-a.start_time); title='Reviews'; count=revs.length;
      content=revs.length ? this._galleryGroupByDay(revs,r=>r.start_time,r=>{ const sev=r.severity==='alert'?'alert':'detection'; const objs=this._reviewLabelList(r).map(x=>this._filterDisplayName('label',x)).join(', '); const title=r.data?.metadata?.title||objs||cap(r.severity); const firstDet=(r.data?.detections&&r.data.detections[0])||''; const reviewed=r.has_been_reviewed; const reviewThumbUrl=firstDet?this._mediaForEvent({id:firstDet,camera:r.camera},'thumbnail.jpg'):''; const thumb=firstDet?`<div class="rev-th"><img src="${reviewThumbUrl}" data-frigate-thumb="1" data-thumb-src="${reviewThumbUrl}" loading="lazy"><div class="tph thumb-fallback" style="display:none">${ICONS.reviews}</div></div>`:`<div class="rev-th"><div class="tph thumb-fallback">${ICONS.reviews}</div></div>`; const firstLabel=this._reviewLabelList(r)[0]||''; const dur=Math.max(1,Math.round(Number(r.end_time||r.start_time)-Number(r.start_time))); const playing=firstDet&&String(this._playing?.id??'')===String(firstDet); return `<div class="rev ${sev}${reviewed?' reviewed':''}${playing?' playing':''}" data-review-id="${r.id}" ${firstDet?`data-review-open="${firstDet}"`:''} style="--ev-color:${labelColor(firstLabel)}"><div class="rev-sev ${sev}"></div>${playing?thumb.replace(/<\/div>$/,'<span class="ec-now">Playing</span></div>'):thumb}<div class="rev-inf"><div class="rev-t"><i class="ec-dot" aria-hidden="true"></i><span>${title}</span></div><div class="rev-m"><span class="rev-pill ${sev}">${cap(sev)}</span><span>${this._time(r.start_time)}</span><span>${dur}s</span>${reviewed?'<span class="rev-done">✓ Reviewed</span>':''}</div></div>${reviewed?'':`<button class="ico" data-mark title="Mark as reviewed" aria-label="Mark as reviewed">${CHECK_ICON}</button>`}</div>`; }) : this._emptyState(ICONS.reviews,'No reviews match','Try changing the filters');
    } else return;

    // IMPORTANT: never replace the filter panel merely because clips/recordings
    // refreshed in the background. Native iOS date/time pickers are attached to
    // the exact input DOM node; replacing the gallery used to destroy that node
    // and instantly dismiss the picker. Build the shell once, then update only
    // the header/count/results around the stable panel.
    let head=gallery.querySelector('.media-gallery-head');
    let panel=gallery.querySelector('#media-filter-panel');
    let grid=gallery.querySelector('.media-gallery-grid');
    if(!head || !panel || !grid) {
      gallery.innerHTML=`${this._mediaGalleryHeadHtml('','')}<div id="media-filter-panel" class="media-filter-panel"></div><div class="media-gallery-grid"></div>`;
      head=gallery.querySelector('.media-gallery-head');
      panel=gallery.querySelector('#media-filter-panel');
      grid=gallery.querySelector('.media-gallery-grid');
    }
    const label=head?.querySelector('.section-label'); if(label) label.textContent=title;
    const countEl=head?.querySelector('.media-gallery-count');
    if(countEl) { const noun={Clips:['clip','clips'],Recordings:['recording','recordings'],Reviews:['review','reviews']}[title]||['item','items']; countEl.textContent=`${count} ${count===1?noun[0]:noun[1]}`; }
    const filterBtn=head?.querySelector('#media-filter-btn'); if(filterBtn) filterBtn.classList.toggle('active',activeFilters);
    if(grid) grid.innerHTML=content;
    this._syncMarkAllButton?.();
    this._renderMediaFilter(force);
  },

// The gallery header: title and Filter on the left, result count and (Reviews only) Mark all on the right.
_mediaGalleryHeadHtml(title,count) {
    return `<div class="media-gallery-head"><div class="media-gallery-head-left"><span class="section-label">${title}</span><button id="media-filter-btn" class="media-gallery-filter-btn" title="Filter" aria-label="Filter">${ICONS.filter}<span>Filter</span></button></div><div class="media-gallery-head-right"><span class="media-gallery-count">${count}</span><button id="media-mark-all" class="media-gallery-filter-btn media-mark-all" type="button" hidden>${ICONS.checkAll}<span class="mark-all-label"></span></button></div></div>`;
  },

_mediaCameraDisplay(camera) {
    const key=String(camera||'');
    const cfg=this._config?.cameras?.find(c=>String(this._camCache[c.entity]?.cam||'')===key);
    return cfg ? (cfg.name||cap(camDisplayName(cfg))) : cap(key.replace(/_/g,' '));
  }
};
