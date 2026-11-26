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
