/**
 * CSS of the grouped Clips card and the Together player.
 *
 * Kept in its own module because it is used twice: inside the card's shadow root (the Clips list card, and the
 * player on wide cards) and inside the player's own root on phones, where the player is mounted on document.body so
 * that it is a real full-screen sheet (no ancestor of the card can move or clip it, or scroll the page behind it).
 */
export const TOGETHER_STYLES = `
/* ─────────────────────────────────────────────────────────────
   Overlapping clips: the grouped Clips card and the Together player.
   ───────────────────────────────────────────────────────────── */
.card .ovg{display:flex;flex-direction:column;gap:10px;margin:0 0 8px;padding:10px;border-radius:14px;background:#1c1c1e;border:1px solid rgba(10,132,255,.45);color:#f5f5f7;}
.card .ovg-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;}
.card .ovg-top b{display:block;font-size:14px;font-weight:650;}
.card .ovg-top small{color:#a1a1a6;font-size:12px;}
.card .ovg-badge{font-size:11px;font-weight:600;color:#0a84ff;background:rgba(10,132,255,.16);border-radius:999px;padding:2px 9px;white-space:nowrap;}
.card .ovg-strip{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:6px;}
.card .ovg-t{position:relative;aspect-ratio:16/10;border-radius:8px;overflow:hidden;background:#000;}
.card .ovg-t img{width:100%;height:100%;object-fit:cover;display:block;}
.card .ovg-t span{position:absolute;left:4px;bottom:4px;max-width:calc(100% - 8px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;background:rgba(0,0,0,.7);border-radius:5px;padding:0 6px;color:#fff;}
.card .ovg-acts{display:flex;gap:8px;align-items:center;}
.card .ovg-watch{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px;border-radius:10px;border:0;background:#0a84ff;color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;}
.card .ovg-watch svg{width:14px;height:14px;}
.card .ovg-more{margin-left:auto;display:inline-flex;align-items:center;gap:4px;background:none;border:0;color:#a1a1a6;font:inherit;font-size:12px;cursor:pointer;padding:4px;}
.card .ovg-more svg{width:14px;height:14px;transition:transform .15s;}
.card .ovg.open .ovg-more svg{transform:rotate(180deg);}
.card .ovg-inner{display:none;flex-direction:column;gap:6px;}
.card .ovg.open .ovg-inner{display:flex;}
.card .ovg-watch:focus-visible,.card .ovg-more:focus-visible,.card .tg-close:focus-visible,.card .tg-modes button:focus-visible,.card .tg-play:focus-visible,.card .tg-tile:focus-visible{outline:2px solid #0a84ff;outline-offset:2px;}

.card.together-open{position:relative;}
.card .together{position:absolute;inset:0;max-height:100vh;max-height:100dvh;z-index:40;display:flex;flex-direction:column;gap:10px;padding:12px;background:#0b0b0d;color:#f5f5f7;overflow:hidden;box-sizing:border-box;}
.card .tg-head{display:flex;align-items:center;gap:10px;}
.card .tg-title{flex:1;min-width:0;}
.card .tg-title b{display:block;font-size:15px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.card .tg-title span{font-size:12px;color:#a1a1a6;}
.card .tg-modes{display:flex;gap:6px;}
.card .tg-modes button{height:28px;padding:0 12px;border-radius:14px;border:0;background:#2c2c2e;color:#f5f5f7;font:inherit;font-size:12px;cursor:pointer;}
.card .tg-modes button.on{background:#0a84ff;color:#fff;}
.card .tg-close{width:34px;height:34px;flex:0 0 auto;border-radius:50%;border:0;background:#2c2c2e;color:#f5f5f7;display:grid;place-items:center;cursor:pointer;}
.card .tg-close svg{width:16px;height:16px;}
/* the stage takes the room left above the controls and scrolls inside itself, so it can never run over the timeline bar */
.card .tg-stage{display:grid;gap:8px;align-content:start;flex:1 1 0;min-height:0;overflow:hidden;}
/* the tile area scrolls only when the tiles really do not fit (set from the script); otherwise the mouse wheel goes on to the page */
.card .tg-stage.scrolls{overflow-x:hidden;overflow-y:auto;}
/* the phone sheet has no card around it to set this: borders and padding must count inside the width */
.card .together,.card .together *{box-sizing:border-box;}
.card .tg-stage.grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));}
.card .tg-stage.focus{grid-template-columns:repeat(var(--others,1),minmax(0,1fr));}
.card .tg-stage.focus .tg-tile.sel{grid-column:1/-1;order:-1;}
/* when there are more clips than fit, the chosen clip stays in view and only the others scroll under it */
.card .tg-stage.focus .tg-tile.sel{position:sticky;top:0;z-index:2;}
.card .tg-stage.focus.wide{grid-template-columns:minmax(0,2fr) minmax(0,1fr);grid-template-rows:repeat(var(--others,1),auto);align-content:start;}
/* every tile keeps its own 16:9 box (a tall box would stretch the picture); the small ones stack at the top of the right column */
/* Grid rows measure 16:9 boxes (aspect-ratio or padding) too short and the tiles run into each other, so the script sets each height
   (--tg-small-h and --tg-big-h, in pixels, from the stage width): the small tiles are one third wide, the chosen one two thirds. */
.card .tg-stage.focus.wide .tg-tile{aspect-ratio:auto;height:var(--tg-small-h,auto);min-height:0;align-self:start;}
.card .tg-stage.focus.wide .tg-tile.sel{height:var(--tg-big-h,auto);}
.card .tg-stage.focus.wide .tg-tile.sel{grid-column:1;grid-row:1/-1;order:0;}
.card .tg-stage.focus.wide .tg-tile:not(.sel){grid-column:2;}
.card .tg-tile{position:relative;border-radius:10px;overflow:hidden;background:#000;aspect-ratio:16/9;cursor:pointer;border:2px solid transparent;min-width:0;}
.card .tg-tile.sel{border-color:#0a84ff;}
.card .tg-media,.card .tg-player{position:absolute;inset:0;display:block;width:100%;height:100%;}
.card .tg-nm{position:absolute;left:6px;top:6px;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600;background:rgba(0,0,0,.65);border-radius:7px;padding:2px 8px;z-index:2;}
.card .tg-lb{position:absolute;right:6px;top:6px;font-size:11px;font-weight:600;background:rgba(10,132,255,.9);border-radius:7px;padding:2px 8px;z-index:2;}
.card .tg-snd{position:absolute;right:6px;bottom:6px;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.65);display:none;place-items:center;z-index:2;}
.card .tg-tile.sel .tg-snd{display:grid;}
.card .tg-snd svg{width:13px;height:13px;}
.card .tg-off{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px;text-align:center;font-size:12px;color:#a1a1a6;background:rgba(8,8,10,.82);}
.card .tg-off[hidden]{display:none;}
.card .tg-off b{color:#f5f5f7;font-size:13px;}
.card .tg-ld{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;font-size:12px;color:#a1a1a6;background:#000;}
.card .tg-ld[hidden]{display:none;}
.card .tg-ctl{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:12px;background:#161618;border:1px solid rgba(255,255,255,.08);}
.card .tg-row{display:flex;align-items:center;gap:10px;}
.card .tg-play{width:36px;height:36px;flex:0 0 auto;border-radius:50%;border:0;background:#f5f5f7;color:#000;display:grid;place-items:center;cursor:pointer;}
.card .tg-play svg{width:16px;height:16px;}
.card .tg-mute{width:36px;height:36px;flex:0 0 auto;border-radius:50%;border:0;background:#2c2c2e;color:#f5f5f7;display:grid;place-items:center;cursor:pointer;}
.card .tg-mute.on{background:#ff453a;color:#fff;}
.card .tg-mute svg{width:17px;height:17px;}
.card .tg-mute:focus-visible{outline:2px solid #0a84ff;outline-offset:2px;}
.card.theme-light .tg-mute{background:#e5e5ea;color:#1d1d1f;}
.card .tg-time{display:flex;flex-direction:column;align-items:flex-start;line-height:1.2;font-variant-numeric:tabular-nums;white-space:nowrap;}
.card .tg-time b{font-size:12px;font-weight:600;color:#f5f5f7;}
.card .tg-time small{font-size:10px;color:#a1a1a6;}
.card .tg-ticks{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;font-size:10px;line-height:1;color:#a1a1a6;font-variant-numeric:tabular-nums;pointer-events:none;}
.card.mobile .tg-tick-mid{display:none;}
.card .tg-scrub{position:relative;flex:1 1 auto;height:48px;min-width:80px;}
.card .tg-segs{position:absolute;left:0;right:0;top:4px;display:flex;flex-direction:column;gap:3px;pointer-events:none;}
.card .tg-seg{height:5px;position:relative;border-radius:3px;background:rgba(255,255,255,.07);}
.card .tg-seg i{position:absolute;top:0;bottom:0;border-radius:3px;background:#0a84ff;}
.card .tg-head-line{position:absolute;top:0;bottom:14px;width:2px;background:#fff;border-radius:1px;pointer-events:none;transition:left .25s linear;box-shadow:0 0 0 2px rgba(0,0,0,.5);}
.card .tg-scrub input{position:absolute;left:0;right:0;top:0;bottom:14px;width:100%;height:calc(100% - 14px);margin:0;opacity:0;cursor:pointer;}
.card .tg-sound{font-size:11px;color:#a1a1a6;}
/* Phones: a full-screen sheet over the page (the same way live fullscreen works on iPhone), tiles centred between the header and the controls. */
.card.mobile.together-open .together{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;max-height:none;z-index:2147483000;border-radius:0;overflow:hidden;
  padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));}
.card.mobile .tg-stage{align-content:center;overscroll-behavior:contain;}
/* Focus on a phone: the small tiles are about 95px wide, so their note is cut down to one short line and the label chips make room for the camera name. */
.card.mobile .tg-stage.focus .tg-tile:not(.sel) .tg-off{padding:4px;gap:0;font-size:10px;line-height:1.2;}
.card.mobile .tg-stage.focus .tg-tile:not(.sel) .tg-off b{font-size:11px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.card.mobile .tg-stage.focus .tg-tile:not(.sel) .tg-off span{display:none;}
.card.mobile .tg-stage.focus .tg-tile:not(.sel) .tg-lb,.card.mobile .tg-stage.focus .tg-tile:not(.sel) .tg-snd{display:none;}
.card.mobile .tg-stage.focus .tg-tile:not(.sel) .tg-nm{max-width:calc(100% - 12px);font-size:10px;padding:1px 6px;}
.card.mobile .tg-stage.focus .tg-tile:not(.sel) .tg-ld{font-size:10px;}
/* Safari squeezes the rows of a grid with a fixed height and lets 16:9 tiles run into each other; stacking the tiles in a column cannot do that.
   The first and last tile's auto margins centre the stack when it fits and let it scroll from the top when it does not. */
.card.mobile .tg-stage.grid{display:flex;flex-direction:column;align-content:normal;}
.card.mobile .tg-stage.grid .tg-tile{flex:0 0 auto;width:100%;}
.card.mobile .tg-stage.grid .tg-tile:first-child{margin-top:auto;}
.card.mobile .tg-stage.grid .tg-tile:last-child{margin-bottom:auto;}
.card.theme-light .together{background:#f2f2f7;color:#1d1d1f;}
.card.theme-light .tg-title span,.card.theme-light .tg-sound,.card.theme-light .tg-time small,.card.theme-light .tg-ticks{color:#6e6e73;}
.card.theme-light .tg-time b{color:#1d1d1f;}
.card.theme-light .tg-modes button,.card.theme-light .tg-close{background:#e5e5ea;color:#1d1d1f;}
.card.theme-light .tg-modes button.on{background:#0a84ff;color:#fff;}
.card.theme-light .tg-ctl{background:#fff;border-color:rgba(0,0,0,.08);}
.card.theme-light .tg-play{background:#1d1d1f;color:#fff;}
.card.theme-light .ovg{background:#fff;color:#1d1d1f;}
.card.theme-light .ovg-top small,.card.theme-light .ovg-more{color:#6e6e73;}
`;
