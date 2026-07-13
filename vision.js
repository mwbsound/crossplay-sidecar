/* Crossplay screenshot parser. Pure pixel work on RGBA data — no dependencies.
   Calibrated against iPhone screenshots of the NYT Crossplay app (light mode).
   Templates for letters and value digits are harvested from real screenshots
   and injected as TEMPLATES_B64 at build time. */

const V_N = 15;
const COLORS = {
  plain:  [239, 238, 236],
  tan:    [240, 232, 206],   // 2L
  blue2w: [220, 236, 255],   // 2W
  lilac:  [233, 216, 235],   // 3W
  green:  [225, 230, 210],   // 3L
  navyB:  [77, 117, 191],    // board tile
  navyR:  [52, 82, 141],     // rack tile
};
const BOARDISH = ['plain', 'tan', 'blue2w', 'lilac', 'green'];

function classifyPx(r, g, b) {
  let best = null, bd = 1e9;
  for (const name of Object.keys(COLORS)) {
    const c = COLORS[name];
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return bd <= 26 * 26 ? best : null;
}

function makePx(data, w, h) {
  return (x, y) => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
}

/* ------------------------------------------------------------- geometry */

function findBoard(data, w, h) {
  const px = makePx(data, w, h);
  const step = 3;
  const rowHits = new Float32Array(h);
  for (let y = 0; y < h; y += step) {
    let hits = 0, tot = 0;
    for (let x = 0; x < w; x += step) {
      const c = classifyPx(...px(x, y));
      tot++;
      if (c && (BOARDISH.includes(c) || c === 'navyB')) hits++;
    }
    rowHits[y] = hits / tot;
  }
  // longest band of board-looking rows, tolerating thin white grid lines
  let best = null, start = -1, lastGood = -1e9;
  const close = () => {
    if (start >= 0 && (!best || lastGood - start > best[1] - best[0])) {
      best = [start, lastGood];
    }
  };
  for (let y = 0; y < h; y += step) {
    if (rowHits[y] > 0.55) {
      if (y - lastGood > 18) { close(); start = y; }
      lastGood = y;
    }
  }
  close();
  if (!best || best[1] - best[0] < h * 0.2) throw new Error('board not found');
  let [by0, by1] = best;
  // x extent within the band
  const colHits = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let hits = 0, tot = 0;
    for (let y = by0; y <= by1; y += 4) {
      const c = classifyPx(...px(x, y));
      tot++;
      if (c && (BOARDISH.includes(c) || c === 'navyB')) hits++;
    }
    colHits[x] = hits / tot;
  }
  const solid = (x) => colHits[x] >= 0.5 && colHits[x + 1] >= 0.5 && colHits[x + 2] >= 0.5;
  const solidR = (x) => colHits[x] >= 0.5 && colHits[x - 1] >= 0.5 && colHits[x - 2] >= 0.5;
  let bx0 = 0, bx1 = w - 1;
  while (bx0 < w - 2 && !solid(bx0)) bx0++;
  while (bx1 > 2 && !solidR(bx1)) bx1--;
  // refine top/bottom with finer scan
  const inRow = (y) => {
    let hits = 0, tot = 0;
    for (let x = bx0; x <= bx1; x += 4) {
      const c = classifyPx(...px(x, y));
      tot++;
      if (c && (BOARDISH.includes(c) || c === 'navyB')) hits++;
    }
    return hits / tot > 0.55;
  };
  while (by0 > 0 && inRow(by0 - 1)) by0--;
  while (by1 < h - 1 && inRow(by1 + 1)) by1++;
  let cellH = (by1 - by0 + 1) / V_N;
  let cellW = (bx1 - bx0 + 1) / V_N;
  if (Math.abs(cellW - cellH) > cellH * 0.04) { cellW = cellH; bx1 = Math.round(bx0 + cellH * V_N) - 1; }
  return { bx0, by0, bx1, by1, cellW, cellH };
}

function cellRect(geom, r, c) {
  return {
    x0: Math.round(geom.bx0 + c * geom.cellW),
    y0: Math.round(geom.by0 + r * geom.cellH),
    x1: Math.round(geom.bx0 + (c + 1) * geom.cellW) - 1,
    y1: Math.round(geom.by0 + (r + 1) * geom.cellH) - 1,
  };
}

/* ----------------------------------------------------- glyph extraction */

function brightMask(data, w, rect) {
  const mw = rect.x1 - rect.x0 + 1, mh = rect.y1 - rect.y0 + 1;
  const m = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = ((rect.y0 + y) * w + rect.x0 + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 190 && g > 190 && b > 190) m[y * mw + x] = 1;
    }
  }
  return { m, mw, mh };
}

function components({ m, mw, mh }) {
  const seen = new Uint8Array(mw * mh);
  const comps = [];
  for (let i = 0; i < mw * mh; i++) {
    if (!m[i] || seen[i]) continue;
    const stack = [i], pix = [];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      pix.push(j);
      const x = j % mw, y = (j / mw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue;
        const k = ny * mw + nx;
        if (m[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    let x0 = mw, x1 = 0, y0 = mh, y1 = 0;
    for (const j of pix) {
      const x = j % mw, y = (j / mw) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    comps.push({ pix: new Set(pix), n: pix.length, x0, x1, y0, y1, mw });
  }
  return comps;
}

const T = 24; // template grid
function normalizeComp(comps, mw) {
  // comps: one or more components rendered together on a T x T grid
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (const c of comps) {
    x0 = Math.min(x0, c.x0); x1 = Math.max(x1, c.x1);
    y0 = Math.min(y0, c.y0); y1 = Math.max(y1, c.y1);
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const scale = (T - 4) / Math.max(bw, bh);
  const ox = (T - bw * scale) / 2, oy = (T - bh * scale) / 2;
  const grid = new Uint8Array(T * T);
  const inAny = (x, y) => comps.some((c) => c.pix.has(y * mw + x));
  for (let ty = 0; ty < T; ty++) {
    for (let tx = 0; tx < T; tx++) {
      const sx = Math.round(x0 + (tx - ox) / scale);
      const sy = Math.round(y0 + (ty - oy) / scale);
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && inAny(sx, sy)) {
        grid[ty * T + tx] = 1;
      }
    }
  }
  return { grid, aspect: bh / bw };
}

function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < T * T; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) uni++;
  }
  return uni ? inter / uni : 0;
}

function matchTemplates(norm, templates) {
  let best = null, bestScore = -1, second = -1;
  for (const key of Object.keys(templates)) {
    const t = templates[key];
    if (Math.abs(Math.log(norm.aspect / t.aspect)) > 0.75) continue;
    const s = iou(norm.grid, t.grid);
    if (s > bestScore) { second = bestScore; bestScore = s; best = key; }
    else if (s > second) second = s;
  }
  return { key: best, score: bestScore, margin: bestScore - second };
}

/* ------------------------------------------------------------ main parse */

function parseScreenshot(data, w, h, templates) {
  const warnings = [];
  const geom = findBoard(data, w, h);
  const px = makePx(data, w, h);
  const grid = Array.from({ length: V_N }, () => Array(V_N).fill(''));
  const blanks = new Set();

  for (let r = 0; r < V_N; r++) {
    for (let c = 0; c < V_N; c++) {
      const rect = cellRect(geom, r, c);
      // vote on the central patch
      const cx0 = rect.x0 + ((rect.x1 - rect.x0) * 0.3) | 0;
      const cx1 = rect.x0 + ((rect.x1 - rect.x0) * 0.7) | 0;
      const cy0 = rect.y0 + ((rect.y1 - rect.y0) * 0.3) | 0;
      const cy1 = rect.y0 + ((rect.y1 - rect.y0) * 0.7) | 0;
      const votes = {};
      for (let y = cy0; y <= cy1; y += 2) {
        for (let x = cx0; x <= cx1; x += 2) {
          const cl = classifyPx(...px(x, y));
          if (cl) votes[cl] = (votes[cl] || 0) + 1;
        }
      }
      const navy = votes.navyB || 0;
      const tot = Object.values(votes).reduce((a, b) => a + b, 0) || 1;
      if (navy / tot < 0.3) continue; // empty or premium square

      // it's a tile: read the letter
      const bm = brightMask(data, w, rect);
      const comps = components(bm).filter((k) => k.n > 8);
      if (!comps.length) { warnings.push(`no glyph at r${r + 1}c${c + 1}`); continue; }
      comps.sort((a, b) => b.n - a.n);
      const letterComp = comps[0];
      const norm = normalizeComp([letterComp], bm.mw);
      const m = matchTemplates(norm, templates.letters);
      if (!m.key || m.score < 0.45) {
        warnings.push(`unreadable letter at r${r + 1}c${c + 1}`);
        continue;
      }
      grid[r][c] = m.key;

      // blank check: match the value superscript in the top-right corner
      const cw = bm.mw, ch = bm.mh;
      const corner = comps.filter((k) => k !== letterComp &&
        k.n < 0.05 * cw * ch &&
        (k.x0 + k.x1) / 2 > cw * 0.5 && (k.y0 + k.y1) / 2 < ch * 0.42);
      if (corner.length) {
        const dn = normalizeComp(corner, bm.mw);
        const dm = matchTemplates(dn, templates.values);
        if (dm.key === '0' && dm.score > 0.5) blanks.add(`${r},${c}`);
      }
    }
  }

  const rack = parseRack(data, w, h, geom, templates, warnings);
  return { grid, blanks, rack, warnings, geom };
}

function findRackGeom(data, w, h, geom) {
  const px = makePx(data, w, h);
  const isNavyR = (x, y) => classifyPx(...px(x, y)) === 'navyR';
  let ry0 = -1, ry1 = -1;
  for (let y = geom.by1 + ((geom.cellH * 0.5) | 0); y < h; y += 2) {
    let hits = 0;
    for (let x = 0; x < w; x += 4) if (isNavyR(x, y)) hits++;
    const frac = hits / (w / 4);
    if (frac > 0.3 && ry0 < 0) ry0 = y;
    if (frac > 0.3) ry1 = y;
    if (frac < 0.05 && ry0 > 0 && y > ry1 + 20) break;
  }
  if (ry0 < 0) return null;
  const colNavy = [];
  for (let x = 0; x < w; x++) {
    let hits = 0;
    for (let y = ry0; y <= ry1; y += 3) if (isNavyR(x, y)) hits++;
    colNavy.push(hits / ((ry1 - ry0) / 3 + 1) > 0.35);
  }
  const raw = [];
  let s = -1;
  for (let x = 0; x <= w; x++) {
    if (x < w && colNavy[x]) { if (s < 0) s = x; }
    else if (s >= 0) { raw.push([s, x - 1]); s = -1; }
  }
  // merge fragments split by wide white glyphs, then drop slivers
  const spans = [];
  for (const sp of raw) {
    if (spans.length && sp[0] - spans[spans.length - 1][1] <= 12) {
      spans[spans.length - 1][1] = sp[1];
    } else spans.push(sp.slice());
  }
  const tiles = spans.filter(([a, b]) => b - a > (ry1 - ry0) * 0.4);
  return { ry0, ry1, spans: tiles };
}

function parseRack(data, w, h, geom, templates, warnings) {
  const rg = findRackGeom(data, w, h, geom);
  if (!rg) { warnings.push('rack not found'); return ''; }
  const { ry0, ry1, spans } = rg;
  let rack = '';
  for (const [sx0, sx1] of spans.slice(0, 7)) {
    const bm = brightMask(data, w, { x0: sx0, y0: ry0, x1: sx1, y1: ry1 });
    const comps = components(bm).filter((k) => k.n > 8).sort((a, b) => b.n - a.n);
    const tall = comps.filter((k) => (k.y1 - k.y0 + 1) > (ry1 - ry0) * 0.38);
    if (!tall.length) { rack += '?'; continue; } // blank rack tile: only the 0
    const m = matchTemplates(normalizeComp([tall[0]], bm.mw), templates.letters);
    if (!m.key || m.score < 0.45) { warnings.push('unreadable rack tile'); rack += '?'; }
    else rack += m.key;
  }
  return rack;
}

/* ------------------------------------------------- template (de)serialize */

function packTemplates(t) {
  const enc = (obj) => {
    const out = {};
    for (const k of Object.keys(obj)) {
      const bytes = new Uint8Array(Math.ceil(T * T / 8));
      obj[k].grid.forEach((v, i) => { if (v) bytes[i >> 3] |= 1 << (i & 7); });
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      const b64 = (typeof btoa !== 'undefined') ? btoa(bin)
        : Buffer.from(bin, 'binary').toString('base64');
      out[k] = { a: +obj[k].aspect.toFixed(3), d: b64 };
    }
    return out;
  };
  return JSON.stringify({ letters: enc(t.letters), values: enc(t.values) });
}

function unpackTemplates(json) {
  const raw = JSON.parse(json);
  const dec = (obj) => {
    const out = {};
    for (const k of Object.keys(obj)) {
      const bin = (typeof atob !== 'undefined') ? atob(obj[k].d)
        : Buffer.from(obj[k].d, 'base64').toString('binary');
      const grid = new Uint8Array(T * T);
      for (let i = 0; i < T * T; i++) {
        if (bin.charCodeAt(i >> 3) & (1 << (i & 7))) grid[i] = 1;
      }
      out[k] = { grid, aspect: obj[k].a };
    }
    return out;
  };
  return { letters: dec(raw.letters), values: dec(raw.values) };
}

const CrossplayVision = {
  COLORS, T, classifyPx, findBoard, cellRect, brightMask, components,
  normalizeComp, matchTemplates, parseScreenshot, packTemplates, unpackTemplates,
  findRackGeom,
};
if (typeof module !== 'undefined' && module.exports) module.exports = CrossplayVision;
if (typeof window !== 'undefined') window.CrossplayVision = CrossplayVision;
