/**
 * Overlapping clips: find clips from different cameras that happened at the same time.
 *
 * Pure functions with no card state, so the rules are easy to test.
 *
 * Two clips overlap when they come from different cameras and share at least
 * `minOverlap` seconds. Overlap chains: A overlaps B and B overlaps C is one
 * group of three. Clips of one camera are never grouped with each other on
 * their own (the timeline already merges those), but they can join a group
 * through a clip of another camera.
 */

/** End of a clip in unix seconds; an event without an end (still running) lasts until `now`. */
export function overlapClipEnd(ev, now = Date.now() / 1000) {
  const start = Number(ev?.start_time);
  const end = Number(ev?.end_time);
  if (Number.isFinite(end) && end > start) return end;
  return Math.max(start + 1, now);
}

/**
 * @param {Array} events        clips in display order (newest first)
 * @param {object} [options]    { minOverlap: seconds (default 3), now: unix seconds }
 * @returns {Array} the same clips in the same order, where each group of overlapping clips
 *   is replaced (at the place of its first member) by { group: true, id, events, start, end }
 *   and every other clip stays { group: false, ev }.
 */
export function groupOverlappingClips(events, options = {}) {
  const minOverlap = Number.isFinite(options.minOverlap) ? options.minOverlap : 3;
  const now = Number.isFinite(options.now) ? options.now : Date.now() / 1000;
  const list = Array.isArray(events) ? events : [];
  // Only clips that can be played together: they need a video and a camera.
  const items = list
    .map((ev, index) => ({ ev, index, start: Number(ev?.start_time), end: overlapClipEnd(ev, now) }))
    .filter((x) => x.ev && x.ev.has_clip && x.ev.camera && Number.isFinite(x.start));
  const byStart = items.slice().sort((a, b) => a.start - b.start);
  const parent = new Map(byStart.map((x) => [x, x]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (let i = 0; i < byStart.length; i++) {
    for (let j = i + 1; j < byStart.length; j++) {
      const a = byStart[i], b = byStart[j];
      if (b.start > a.end - minOverlap) break; // sorted by start: no later clip can overlap `a` enough
      if (a.ev.camera === b.ev.camera) continue;
      if (Math.min(a.end, b.end) - b.start >= minOverlap) parent.set(find(a), find(b));
    }
  }
  const comps = new Map();
  for (const x of items) { const r = find(x); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(x); }
  const groupOf = new Map(); // clip -> group
  for (const members of comps.values()) {
    if (members.length < 2 || new Set(members.map((m) => m.ev.camera)).size < 2) continue;
    members.sort((a, b) => a.start - b.start);
    const id = 'ovg-' + members.map((m) => String(m.ev.id)).sort().join('|');
    const g = { group: true, id, events: members.map((m) => m.ev), start: members[0].start, end: Math.max(...members.map((m) => m.end)) };
    for (const m of members) groupOf.set(m.ev, g);
  }
  const out = [];
  const placed = new Set();
  for (const ev of list) {
    const g = groupOf.get(ev);
    if (!g) { out.push({ group: false, ev }); continue; }
    if (placed.has(g)) continue; // the group already stands where its first member was
    placed.add(g);
    out.push(g);
  }
  return out;
}

/**
 * Where a clip stands against the shared clock.
 * @param {number} t shared time (unix seconds), @param {object} ev the clip,
 * @param {number} [videoDuration] the loaded video's real length, when known
 * @returns {{state:'before'|'playing'|'after', rel:number, end:number}} rel = seconds into the clip
 */
export function togetherClipState(t, ev, videoDuration, now = Date.now() / 1000) {
  const start = Number(ev.start_time);
  const end = Number.isFinite(videoDuration) && videoDuration > 0 ? start + videoDuration : overlapClipEnd(ev, now);
  const rel = t - start;
  if (rel < 0) return { state: 'before', rel, end };
  if (t > end) return { state: 'after', rel, end };
  return { state: 'playing', rel, end };
}
