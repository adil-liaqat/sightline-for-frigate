import { test, expect } from '@playwright/test';
test.beforeEach(async ({page})=>{page.previewErrors=[];page.on('pageerror',error=>page.previewErrors.push(error.message));});
test.afterEach(async ({page})=>{expect(page.previewErrors,'Unhandled browser errors').toEqual([]);});
const card = page => page.locator('sightline-card');
const clipRows = page => card(page).locator('.media-gallery-grid [data-ev]');
async function ready(page, query='') {
  await page.goto('/'+query);
  await expect(card(page).locator('.media-gallery-head .section-label')).toHaveText('Clips');
}
async function playback(page) {
  const video=card(page).locator('#viewer video');
  await expect(video).toBeVisible();
  await expect.poll(()=>video.evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(2);
  return video;
}
test('production bundle loads with local data and decodes live video',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const external=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5173'))external.push(r.url());});
  await ready(page);
  await expect(clipRows(page)).toHaveCount(8);
  const video=card(page).locator('ha-camera-stream video');
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(0.1);
  await expect(card(page).locator('#tl-track')).toBeVisible();
  expect(errors).toEqual([]);expect(external).toEqual([]);
});
test('clip uses real HLS decoding and native seeking events',async({page})=>{
  await ready(page);await clipRows(page).first().click();
  const video=await playback(page);
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(0.1);
  await video.evaluate(v=>{v.pause();window.seekEvents=0;v.addEventListener('seeked',()=>window.seekEvents++);v.currentTime=8;});
  await expect.poll(()=>page.evaluate(()=>window.seekEvents)).toBeGreaterThan(0);
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThanOrEqual(8);
  expect(await video.evaluate(v=>v.error)).toBeNull();
});
test('favorites and review actions persist through API reloads',async({page})=>{
  await ready(page);
  await clipRows(page).first().locator('[data-fav]').click();
  await expect.poll(()=>page.evaluate(()=>window.preview.mock.fixtures.events[0].retain_indefinitely)).toBe(true);
  await page.evaluate(()=>window.preview.card._loadWindow(true));
  await expect.poll(()=>page.evaluate(()=>window.preview.card._events.find(ev=>ev.id==='front_door-0').retain_indefinitely)).toBe(true);
  await card(page).locator('[data-gallery-tab="reviews"]').click();
  const mark=card(page).locator('.media-gallery-grid [data-mark]').first();
  const id=await mark.locator('..').getAttribute('data-review-id');
  await mark.click();
  await expect.poll(()=>page.evaluate(id=>window.preview.mock.fixtures.reviews.find(r=>r.id===id)?.has_been_reviewed,id)).toBe(true);
  await page.evaluate(()=>window.preview.card._loadReviews());
  await expect(card(page).locator(`[data-review-id="${id}"] [data-mark]`)).toHaveCount(0);
});
test('hourly recording playback seeks using a real media element',async({page})=>{
  await ready(page);
  await card(page).locator('[data-gallery-tab="recordings"]').click();
  // Use a completed hour; the current hour may have less than 12s of media.
  const row=card(page).locator('.media-gallery-grid [data-rs]').nth(1);
  await expect(row).toBeVisible();await row.click();
  const video=await playback(page);
  await expect.poll(()=>page.evaluate(()=>window.preview.card._playbackSession?.pendingSeek)).toBeNull();
  await video.evaluate(v=>{v.pause();v.currentTime=12;});
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThanOrEqual(12);
  expect(await video.evaluate(v=>v.error)).toBeNull();
});
test('empty library, offline retained media, and slow loading are usable',async({page})=>{
  await ready(page,'?scenario=empty');
  await expect(clipRows(page)).toHaveCount(0);await expect(card(page).getByText('No clips match')).toBeVisible();
  await page.getByRole('combobox',{name:/Scenario/}).selectOption('offline');
  await expect(clipRows(page)).toHaveCount(8);await clipRows(page).first().click();await playback(page);
  await page.getByRole('combobox',{name:/Scenario/}).selectOption('slow');
  await expect(clipRows(page)).toHaveCount(8);
});
test('mobile and light theme render the real card without page overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await ready(page,'?viewport=mobile&theme=light');
  await expect(clipRows(page)).toHaveCount(8);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(card(page).locator('[data-gallery-tab="reviews"]')).toBeVisible();
  await page.screenshot({path:test.info().outputPath('mobile-light.png'),fullPage:true});
});
test('multiview, filters, reset, and subscription refresh use mock HA',async({page})=>{
  await ready(page,'?cameras=3');await expect(clipRows(page)).toHaveCount(24);
  await expect(card(page).locator('ha-camera-stream')).toHaveCount(4); // base + three grid players
  await card(page).locator('#media-filter-btn').click();
  await expect(card(page).locator('#media-filter-panel')).toHaveClass(/open/);
  await card(page).locator('[data-mf="label"][data-mv="dog"]').click();
  await expect(clipRows(page)).toHaveCount(6);
  await card(page).locator('#media-filter-reset').click();await expect(clipRows(page)).toHaveCount(24);
  const before=await page.evaluate(()=>window.preview.mock.requests.filter(p=>p.type==='frigate/events/get').length);
  await page.getByRole('button',{name:'Simulate event'}).click();
  await expect.poll(()=>page.evaluate(()=>window.preview.mock.requests.filter(p=>p.type==='frigate/events/get').length)).toBeGreaterThan(before);
  await page.getByRole('button',{name:'Reset fixtures'}).click();await expect(clipRows(page)).toHaveCount(24);
});
test('media range requests and recording gaps have real server contracts',async({request})=>{
  const response=await request.get('/dev/media/front_door.mp4',{headers:{Range:'bytes=0-31'}});
  expect(response.status()).toBe(206);expect((await response.body()).length).toBe(32);
  expect((await request.get('/dev/media/front_door.mp4',{headers:{Range:'bytes=999999999-'}})).status()).toBe(416);
  expect((await request.get('/.git/config')).status()).toBe(404);
  const {now}=await (await request.get('/dev/bootstrap')).json();
  const hour=Math.floor((now-3600)/3600)*3600;
  const playlist=await (await request.get(`/api/frigate/demo/vod/front_door/start/${hour}/end/${hour+3600}/index.m3u8`)).text();
  const duration=[...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum,m)=>sum+Number(m[1]),0);
  expect(duration).toBe(3540);
});
test('Reviews Mark all asks for confirmation and marks only what the filters show',async({page})=>{
  await ready(page);
  await card(page).locator('[data-gallery-tab="reviews"]').click();
  const btn=card(page).locator('#media-mark-all');
  await expect(btn).toBeVisible();
  const unreviewed=()=>page.evaluate(()=>window.preview.mock.fixtures.reviews.filter(r=>!r.has_been_reviewed).length);
  const total=await unreviewed();
  const shown=await card(page).locator('.media-gallery-grid [data-mark]').count();
  expect(shown).toBeGreaterThan(0);
  await expect(btn).toContainText(`Mark all (${shown})`);
  await btn.click();
  await expect(btn).toContainText(`Confirm · ${shown}`);
  expect(await unreviewed()).toBe(total);
  await btn.click();
  await expect.poll(unreviewed).toBe(total-shown);
  await expect(btn).toBeHidden();
  await expect(card(page).locator('.media-gallery-grid [data-mark]')).toHaveCount(0);
});
test('a clip that has another shape than the live camera plays in a box of its own shape',async({page})=>{
  await ready(page);
  // the preview card has a fixed 16:9 box; the behaviour is for aspect_ratio: auto (the default), so mount a card with that
  await page.evaluate(async()=>{
    const mock=window.preview.mock, host=document.querySelector('sightline-card').parentElement, el=document.createElement('sightline-card');
    el.setConfig({type:'custom:sightline-card',cameras:[{entity:'camera.front_door',name:'Front Door'}],default_tab:'clips',stream_type:'hls'});
    host.replaceChildren(el);el.hass=mock.hass;window.__auto=el;
  });
  await expect.poll(()=>page.evaluate(()=>!!window.__auto.shadowRoot.querySelector('.media-gallery-grid [data-ev]'))).toBe(true);
  await page.evaluate(()=>window.__auto.shadowRoot.querySelector('.media-gallery-grid [data-ev]').click());
  await expect.poll(()=>page.evaluate(()=>!!window.__auto._findVideo(window.__auto.shadowRoot.querySelector('#viewer')))).toBe(true);
  const liveShape=await page.evaluate(()=>window.__auto.shadowRoot.querySelector('.card').style.getPropertyValue('--stream-ar'));
  // the clip's video is 4:3 (the mock clips are 16:9 and the preview browser cannot report another size, so state it)
  await page.evaluate(()=>{
    const v=window.__auto._findVideo(window.__auto.shadowRoot.querySelector('#viewer'));
    Object.defineProperty(v,'videoWidth',{value:1440,configurable:true});Object.defineProperty(v,'videoHeight',{value:1080,configurable:true});
    v.dispatchEvent(new Event('resize'));
  });
  await expect.poll(()=>page.evaluate(()=>window.__auto.shadowRoot.querySelector('.card').style.getPropertyValue('--stream-ar'))).toBe('1440/1080');
  expect(await page.evaluate(()=>window.__auto.shadowRoot.querySelector('#eng-wrap').style.getPropertyValue('aspect-ratio'))).toBe('1440 / 1080');
  // back to live: the box returns to the live camera's shape
  await page.evaluate(()=>window.__auto._showLive());
  await expect.poll(()=>page.evaluate(()=>window.__auto.shadowRoot.querySelector('.card').style.getPropertyValue('--stream-ar'))).toBe(liveShape);
});
test('video_fit fills the player box with a clip and is left alone for live',async({page})=>{
  await ready(page);
  await page.evaluate(async()=>{
    const mock=window.preview.mock, host=document.querySelector('sightline-card').parentElement, el=document.createElement('sightline-card');
    el.setConfig({type:'custom:sightline-card',cameras:[{entity:'camera.front_door',name:'Front Door'}],default_tab:'clips',stream_type:'hls',aspect_ratio:'16:9',video_fit:'fill'});
    host.replaceChildren(el);el.hass=mock.hass;window.__fit=el;
  });
  await expect.poll(()=>page.evaluate(()=>!!window.__fit.shadowRoot.querySelector('.media-gallery-grid [data-ev]'))).toBe(true);
  expect(await page.evaluate(()=>window.__fit.shadowRoot.querySelector('.card').style.getPropertyValue('--video-fit'))).toBe('fill');
  await page.evaluate(()=>window.__fit.shadowRoot.querySelector('.media-gallery-grid [data-ev]').click());
  await expect.poll(()=>page.evaluate(()=>{const p=window.__fit.shadowRoot.querySelector('#viewer ha-hls-player');return p?p.fitMode:null;})).toBe('fill');
});

test('overlapping clips group into one card and play together on one clock',async({page})=>{
  await ready(page,'?cameras=3');
  // make the third event of each camera overlap: three cameras, eight seconds apart, twenty seconds long
  await page.evaluate(async()=>{
    const fx=window.preview.mock.fixtures;
    fx.events.filter(e=>/-1$/.test(e.id)).forEach(e=>{const c=['front_door','driveway','garden'].indexOf(e.camera);e.start_time=fx.now-240-c*8;e.end_time=e.start_time+20;});
    await window.preview.card._loadWindow(true);
    if(window.preview.card._loadAllCamsBackground) await window.preview.card._loadAllCamsBackground();
  });
  await card(page).locator('[data-gallery-tab="clips"]').click();
  const group=card(page).locator('.ovg');
  await expect(group).toHaveCount(1);
  await expect(group.locator('.ovg-strip .ovg-t')).toHaveCount(3);
  await expect(card(page).locator('.media-gallery-grid > .ec')).toHaveCount(21);
  await expect(group.locator('.ovg-inner')).toBeHidden();
  await group.locator('[data-ovg-toggle]').click();
  await expect(group.locator('.ovg-inner .ec')).toHaveCount(3);
  await group.locator('[data-ovg-toggle]').click();
  await group.locator('[data-together]').click();
  const together=card(page).locator('#together');
  await expect(together).toBeVisible();
  await expect(together.locator('.tg-tile')).toHaveCount(3);
  // when the tiles fit, the tile area is not a scroller (so the mouse wheel goes on to the page)
  await expect(together.locator('.tg-stage')).not.toHaveClass(/scrolls/);
  // it starts muted: iPhone only starts a video by itself when it is silent, and sound comes with a tap on a camera or the speaker
  await expect(together.locator('[data-tg-mute]')).toHaveAttribute('aria-pressed','true');
  await expect(together.locator('#tg-sound')).toHaveText(/^Muted/);
  // streams open lazily: only the clip in play at the start, the others when scrubbed to or close to their turn
  await expect(together.locator('.tg-player')).toHaveCount(1);
  await together.locator('#tg-range').evaluate(el=>{el.value=String(Number(el.min)+20);el.dispatchEvent(new Event('input',{bubbles:true}));});
  await expect(together.locator('#tg-time')).toHaveText(/^0:20 \//);
  await expect(together.locator('.tg-player')).toHaveCount(3);
  await together.locator('[data-tg-mode="focus"]').click();
  await expect(together.locator('.tg-stage')).toHaveClass(/focus/);
  await together.locator('.tg-tile').nth(1).click();
  await expect(together.locator('.tg-tile.sel')).toHaveCount(1);
  // tapping a camera above asked for its sound, so the speaker is now on; it toggles
  const mute=together.locator('[data-tg-mute]');
  await expect(mute).toHaveAttribute('aria-pressed','false');
  await expect(together.locator('#tg-sound')).toHaveText(/^Sound:/);
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed','true');
  await expect(together.locator('#tg-sound')).toHaveText(/^Muted/);
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('Escape');
  await expect(together).toHaveCount(0);
});
test('one camera in view still groups clips that overlap with the other cameras',async({page})=>{
  await ready(page);
  await page.evaluate(async()=>{
    const fx=window.preview.mock.fixtures, mock=window.preview.mock;
    fx.events.filter(e=>/-1$/.test(e.id)).forEach(e=>{const c=['front_door','driveway','garden'].indexOf(e.camera);e.start_time=fx.now-240-c*8;e.end_time=e.start_time+20;});
    const host=document.querySelector('sightline-card').parentElement, el=document.createElement('sightline-card');
    el.setConfig({type:'custom:sightline-card',cameras:['front_door','driveway','garden'].map(c=>({entity:'camera.'+c,name:c})),default_tab:'clips',default_view:'single'});
    host.replaceChildren(el);el.hass=mock.hass;
  });
  const group=card(page).locator('.ovg');
  await expect(group).toHaveCount(1);
  await expect(group.locator('.ovg-strip .ovg-t')).toHaveCount(3);
  await group.locator('[data-ovg-toggle]').click();
  await expect(group.locator('.ovg-inner .ec')).toHaveCount(3);
  // the other cameras' clips appear only inside the group
  expect(await card(page).locator('.media-gallery-grid > .ec [data-ev="driveway-1"]').count()).toBe(0);
});
test('on a phone the Together player is a full-screen sheet with its close button in view and the page locked behind it',async({page})=>{
  await page.setViewportSize({width:390,height:800});
  await ready(page);
  await page.evaluate(async()=>{
    const fx=window.preview.mock.fixtures, mock=window.preview.mock;
    fx.events.filter(e=>/-1$/.test(e.id)).forEach(e=>{const c=['front_door','driveway','garden'].indexOf(e.camera);e.start_time=fx.now-240-c*8;e.end_time=e.start_time+20;});
    const host=document.querySelector('sightline-card').parentElement, el=document.createElement('sightline-card');
    el.setConfig({type:'custom:sightline-card',cameras:['front_door','driveway','garden'].map(c=>({entity:'camera.'+c,name:c})),default_tab:'clips',default_view:'single'});
    host.replaceChildren(el);el.hass=mock.hass;
  });
  await card(page).locator('[data-together]').click();
  const sheet=page.locator('[data-sightline-together] #together');
  await expect(sheet).toBeVisible();
  // a player in the sheet asks for Home Assistant's settings: the request reaches the card's side of the page (here the document)
  const answered=await page.evaluate(()=>new Promise(resolve=>{
    document.addEventListener('context-request',e=>{if(e.context==='sightline-test'){e.stopPropagation();e.callback('from-home-assistant',()=>{});}},{once:true});
    const inside=document.querySelector('[data-sightline-together]').shadowRoot.querySelector('.tg-media');
    const ask=new Event('context-request',{bubbles:true,composed:true});
    ask.context='sightline-test';ask.subscribe=false;ask.callback=v=>resolve(v);
    inside.dispatchEvent(ask);
    setTimeout(()=>resolve('no answer'),1000);
  }));
  expect(answered).toBe('from-home-assistant');
  const box=await sheet.boundingBox();
  expect(box.x).toBe(0);expect(box.y).toBe(0);expect(box.width).toBe(390);expect(box.height).toBe(800);
  const close=page.locator('[data-sightline-together] [data-tg-close]');
  const cb=await close.boundingBox();
  expect(cb.y).toBeGreaterThanOrEqual(0);expect(cb.x+cb.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('hidden');
  // Focus on a phone: the note on a small tile that is not playing fits inside it
  await page.locator('[data-sightline-together] [data-tg-mode="focus"]').click();
  await page.locator('[data-sightline-together] #tg-range').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));});
  const fits=await page.evaluate(()=>{const r=document.querySelector('[data-sightline-together]').shadowRoot;return [...r.querySelectorAll('.tg-tile:not(.sel) .tg-off:not([hidden])')].map(o=>{const t=o.closest('.tg-tile').getBoundingClientRect(),b=o.querySelector('b').getBoundingClientRect();return b.height>0&&b.top>=t.top-1&&b.bottom<=t.bottom+1&&b.left>=t.left-1&&b.right<=t.right+1;});});
  expect(fits.length).toBeGreaterThan(0);
  expect(fits.every(Boolean)).toBe(true);
  // Grid on a phone: the tiles are stacked one under the other and never run into each other
  await page.locator('[data-sightline-together] [data-tg-mode="grid"]').click();
  const tops=await page.evaluate(()=>[...document.querySelector('[data-sightline-together]').shadowRoot.querySelectorAll('.tg-tile')].map(t=>{const b=t.getBoundingClientRect();return [b.top,b.bottom];}));
  expect(tops.length).toBeGreaterThan(1);
  for(let i=1;i<tops.length;i++) expect(tops[i][0]).toBeGreaterThanOrEqual(tops[i-1][1]);
  // and the tile area is not wider than the screen (no sideways scroll)
  const wide=await page.evaluate(()=>{const st=document.querySelector('[data-sightline-together]').shadowRoot.querySelector('#tg-stage');return st.scrollWidth-st.clientWidth;});
  expect(wide).toBeLessThanOrEqual(0);
  await close.click();
  await expect(page.locator('[data-sightline-together]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});
