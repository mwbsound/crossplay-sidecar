/* Crossplay move engine — JavaScript port of crossplay.py.
   Works in the browser and in node (for tests). */

const N = 15;
const CENTER_R = 7, CENTER_C = 7;
const RACK_SIZE = 7;
const SWEEP_BONUS = 40;
const CENTER_DOUBLES_WORD = false; // unverified; see README

const TILE_VALUES = {
  '?': 0,
  A: 1, E: 1, I: 1, N: 1, O: 1, R: 1, S: 1, T: 1,
  D: 2, L: 2, U: 2,
  C: 3, H: 3, M: 3, P: 3,
  B: 4, F: 4, G: 4, Y: 4,
  W: 5, K: 6, V: 6, X: 8,
  J: 10, Q: 10, Z: 10,
};

const TILE_COUNTS = {
  '?': 3, A: 9, E: 12, I: 8, N: 5, O: 8, R: 6, S: 5, T: 6,
  D: 4, L: 4, U: 3, C: 2, H: 3, M: 2, P: 2,
  B: 2, F: 2, G: 3, Y: 2, W: 2, K: 1, V: 2, X: 1,
  J: 1, Q: 1, Z: 1,
};

// Words valid in NWL2023 (Crossplay's list) but missing from ENABLE.
const EXTRA_WORDS = (
  'QI QIS ZA ZAS ZEN ZENS EW OK OKS HIJAB HIJABS EMOJI EMOJIS ' +
  'SELFIE SELFIES BLOG BLOGS VLOG VLOGS'
).split(' ');

function buildPremiums() {
  const top = {
    '0,0': 'TL', '0,3': 'TW', '0,7': 'DL', '0,11': 'TW', '0,14': 'TL',
    '1,1': 'DW', '1,6': 'TL', '1,8': 'TL', '1,13': 'DW',
    '2,4': 'DL', '2,10': 'DL',
    '3,0': 'TW', '3,3': 'DL', '3,7': 'DW', '3,11': 'DL', '3,14': 'TW',
    '4,2': 'DL', '4,5': 'TL', '4,9': 'TL', '4,12': 'DL',
    '5,4': 'TL', '5,7': 'DL', '5,10': 'TL',
    '6,1': 'TL', '6,13': 'TL',
    '7,0': 'DL', '7,3': 'DW', '7,5': 'DL', '7,9': 'DL', '7,11': 'DW', '7,14': 'DL',
  };
  const prem = Object.assign({}, top);
  for (const key of Object.keys(top)) {
    const [r, c] = key.split(',').map(Number);
    prem[`${14 - r},${c}`] = top[key];
  }
  return prem;
}
const PREMIUMS = buildPremiums();

function squareMultipliers(r, c) {
  if (r === CENTER_R && c === CENTER_C) return CENTER_DOUBLES_WORD ? [1, 2] : [1, 1];
  const p = PREMIUMS[`${r},${c}`];
  if (p === 'DL') return [2, 1];
  if (p === 'TL') return [3, 1];
  if (p === 'DW') return [1, 2];
  if (p === 'TW') return [1, 3];
  return [1, 1];
}

/* ------------------------------------------------------------ dictionary */

function buildLexicon(wordListText, userExtras, userBlacklist) {
  const words = new Set();
  const add = (txt) => {
    for (const raw of String(txt || '').toUpperCase().split(/[^A-Z]+/)) {
      if (raw.length >= 2 && raw.length <= N) words.add(raw);
    }
  };
  add(wordListText);
  for (const w of EXTRA_WORDS) words.add(w);
  add(userExtras);
  const black = new Set();
  for (const raw of String(userBlacklist || '').toUpperCase().split(/[^A-Z]+/)) {
    if (raw) black.add(raw);
  }
  const root = { ch: {}, end: false };
  for (const w of words) {
    if (black.has(w)) continue;
    let node = root;
    for (const L of w) {
      node = node.ch[L] || (node.ch[L] = { ch: {}, end: false });
    }
    node.end = true;
  }
  const isWord = (w) => words.has(w) && !black.has(w);
  return { root, isWord, size: words.size - [...black].filter((w) => words.has(w)).length };
}

/* ----------------------------------------------------------------- board */

// grid: 15x15 array of '' or 'A'-'Z'; blanks: Set of 'r,c'
function emptyGrid() {
  return Array.from({ length: N }, () => Array(N).fill(''));
}

function parseBoard(text) {
  const rows = text.split('\n').map((s) => s.trim()).filter(Boolean);
  if (rows.length !== N) throw new Error(`expected ${N} rows, got ${rows.length}`);
  const grid = emptyGrid();
  const blanks = new Set();
  rows.forEach((ln, r) => {
    const cells = ln.includes(' ') ? ln.split(/\s+/) : ln.split('');
    if (cells.length !== N) throw new Error(`row ${r + 1} has ${cells.length} cells`);
    cells.forEach((ch, c) => {
      if ('.-_'.includes(ch)) return;
      if (!/^[a-zA-Z]$/.test(ch)) throw new Error(`bad cell "${ch}" in row ${r + 1}`);
      grid[r][c] = ch.toUpperCase();
      if (ch === ch.toLowerCase()) blanks.add(`${r},${c}`);
    });
  });
  return { grid, blanks };
}

function boardToText(grid, blanks) {
  return grid.map((row, r) =>
    row.map((ch, c) => (ch ? (blanks.has(`${r},${c}`) ? ch.toLowerCase() : ch) : '.')).join('')
  ).join('\n');
}

/* ------------------------------------------------------------- move gen */

function generateMoves(grid, blanks, rackStr, lex) {
  const rack = {};
  for (const t of rackStr.toUpperCase().replace(/[^A-Z?]/g, '')) {
    rack[t] = (rack[t] || 0) + 1;
  }
  const out = new Map();
  genDirection(grid, blanks, rack, lex, out, false);
  const tgrid = emptyGrid();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) tgrid[r][c] = grid[c][r];
  const tblanks = new Set([...blanks].map((k) => k.split(',').reverse().join(',')));
  genDirection(tgrid, tblanks, rack, lex, out, true);
  const moves = [...out.values()];
  moves.sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1));
  return moves;
}

function genDirection(grid, blanks, rack, lex, out, transposed) {
  const root = lex.root;
  let hasTiles = false;
  for (let r = 0; r < N && !hasTiles; r++) {
    for (let c = 0; c < N; c++) if (grid[r][c]) { hasTiles = true; break; }
  }

  const anchors = new Set();
  if (!hasTiles) {
    anchors.add(`${CENTER_R},${CENTER_C}`);
  } else {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (grid[r][c]) continue;
        if ((r > 0 && grid[r - 1][c]) || (r < N - 1 && grid[r + 1][c]) ||
            (c > 0 && grid[r][c - 1]) || (c < N - 1 && grid[r][c + 1])) {
          anchors.add(`${r},${c}`);
        }
      }
    }
  }

  // cross-checks (perpendicular words) per empty square
  const cross = new Map();
  for (let c = 0; c < N; c++) {
    for (let r = 0; r < N; r++) {
      if (grid[r][c]) continue;
      if (!((r > 0 && grid[r - 1][c]) || (r < N - 1 && grid[r + 1][c]))) continue;
      let rr = r - 1; const pre = [];
      while (rr >= 0 && grid[rr][c]) { pre.push(rr); rr--; }
      pre.reverse();
      rr = r + 1; const suf = [];
      while (rr < N && grid[rr][c]) { suf.push(rr); rr++; }
      const preS = pre.map((i) => grid[i][c]).join('');
      const sufS = suf.map((i) => grid[i][c]).join('');
      let base = 0;
      for (const i of pre.concat(suf)) {
        base += blanks.has(`${i},${c}`) ? 0 : TILE_VALUES[grid[i][c]];
      }
      const allowed = new Set();
      for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        if (lex.isWord(preS + L + sufS)) allowed.add(L);
      }
      cross.set(`${r},${c}`, { allowed, base, has: true });
    }
  }
  const crossAt = (r, c) => cross.get(`${r},${c}`) || { allowed: null, base: 0, has: false };
  const mult = (r, c) => (transposed ? squareMultipliers(c, r) : squareMultipliers(r, c));

  const record = (r, start, endIncl, left, rightPlaced) => {
    const placed = left.map((t, i) => [start + i, t[0], t[1]]).concat(rightPlaced);
    if (!placed.length) return;
    const pmap = new Map(placed.map(([c, L, b]) => [c, [L, b]]));
    let main = 0, wordMult = 1, crossTotal = 0;
    const chars = [];
    for (let c = start; c <= endIncl; c++) {
      if (pmap.has(c)) {
        const [L, isb] = pmap.get(c);
        const [lm, wm] = mult(r, c);
        const val = isb ? 0 : TILE_VALUES[L];
        main += val * lm;
        wordMult *= wm;
        const ci = crossAt(r, c);
        if (ci.has) crossTotal += (ci.base + val * lm) * wm;
        chars.push(isb ? L.toLowerCase() : L);
      } else {
        const L = grid[r][c];
        main += blanks.has(`${r},${c}`) ? 0 : TILE_VALUES[L];
        chars.push(blanks.has(`${r},${c}`) ? L.toLowerCase() : L);
      }
    }
    const word = chars.join('');
    if (!lex.isWord(word.toUpperCase())) return; // blacklist safety net
    let score = main * wordMult + crossTotal;
    if (placed.length === RACK_SIZE) score += SWEEP_BONUS;
    const placedReal = placed
      .map(([c, L, b]) => (transposed ? [c, r, L, b] : [r, c, L, b]))
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const mv = transposed
      ? { row: start, col: r, dir: 'V', word, placed: placedReal, score }
      : { row: r, col: start, dir: 'H', word, placed: placedReal, score };
    const key = placedReal.map((p) => p.join(':')).join('|');
    const prev = out.get(key);
    if (!prev || mv.score > prev.score) out.set(key, mv);
  };

  const extendRight = (r, col, node, start, left, rightPlaced, anchor) => {
    const atEmpty = col >= N || !grid[r][col];
    if (atEmpty) {
      if (node.end && col > anchor && (left.length || rightPlaced.length)) {
        record(r, start, col - 1, left, rightPlaced);
      }
      if (col >= N) return;
      const ci = crossAt(r, col);
      for (const L of Object.keys(node.ch)) {
        if (ci.allowed && !ci.allowed.has(L)) continue;
        const child = node.ch[L];
        if (rack[L] > 0) {
          rack[L]--; rightPlaced.push([col, L, false]);
          extendRight(r, col + 1, child, start, left, rightPlaced, anchor);
          rightPlaced.pop(); rack[L]++;
        }
        if (rack['?'] > 0) {
          rack['?']--; rightPlaced.push([col, L, true]);
          extendRight(r, col + 1, child, start, left, rightPlaced, anchor);
          rightPlaced.pop(); rack['?']++;
        }
      }
    } else {
      const child = node.ch[grid[r][col]];
      if (child) extendRight(r, col + 1, child, start, left, rightPlaced, anchor);
    }
  };

  const leftPart = (r, node, limit, anchor, left) => {
    extendRight(r, anchor, node, anchor - left.length, left, [], anchor);
    if (limit > 0) {
      for (const L of Object.keys(node.ch)) {
        const child = node.ch[L];
        if (rack[L] > 0) {
          rack[L]--; left.push([L, false]);
          leftPart(r, child, limit - 1, anchor, left);
          left.pop(); rack[L]++;
        }
        if (rack['?'] > 0) {
          rack['?']--; left.push([L, true]);
          leftPart(r, child, limit - 1, anchor, left);
          left.pop(); rack['?']++;
        }
      }
    }
  };

  const totalTiles = Object.values(rack).reduce((a, b) => a + b, 0);
  if (!totalTiles) return;
  for (let r = 0; r < N; r++) {
    const rowAnchors = [];
    for (let c = 0; c < N; c++) if (anchors.has(`${r},${c}`)) rowAnchors.push(c);
    for (const cA of rowAnchors) {
      if (cA > 0 && grid[r][cA - 1]) {
        let s = cA - 1;
        while (s >= 0 && grid[r][s]) s--;
        s++;
        let node = root, ok = true;
        for (let cc = s; cc < cA; cc++) {
          node = node.ch[grid[r][cc]];
          if (!node) { ok = false; break; }
        }
        if (ok) extendRight(r, cA, node, s, [], [], cA);
      } else {
        let k = 0, cc = cA - 1;
        while (cc >= 0 && !grid[r][cc] && !anchors.has(`${r},${cc}`)) { k++; cc--; }
        leftPart(r, root, Math.min(k, totalTiles - 1), cA, []);
      }
    }
  }
}

/* --------------------------------------------------- words a move forms */

function wordsFormed(grid, blanks, move) {
  const g = grid.map((row) => row.slice());
  const bl = new Set(blanks);
  for (const [r, c, L, isb] of move.placed) {
    g[r][c] = L;
    if (isb) bl.add(`${r},${c}`);
  }
  const seen = new Set();
  const words = [];
  for (const [pr, pc] of move.placed.map((p) => [p[0], p[1]])) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      let r = pr, c = pc;
      while (r - dr >= 0 && c - dc >= 0 && g[r - dr][c - dc]) { r -= dr; c -= dc; }
      const key = `${r},${c},${dr}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const chars = [];
      while (r < N && c < N && g[r][c]) { chars.push(g[r][c]); r += dr; c += dc; }
      if (chars.length >= 2) words.push(chars.join(''));
    }
  }
  return words;
}

function notation(move) {
  const colLetter = String.fromCharCode(65 + move.col);
  return move.dir === 'H' ? `${move.row + 1}${colLetter}` : `${colLetter}${move.row + 1}`;
}

const CrossplaySolver = {
  N, TILE_VALUES, TILE_COUNTS, PREMIUMS, SWEEP_BONUS, EXTRA_WORDS,
  squareMultipliers, buildLexicon, emptyGrid, parseBoard, boardToText,
  generateMoves, wordsFormed, notation,
};

if (typeof module !== 'undefined' && module.exports) module.exports = CrossplaySolver;
if (typeof window !== 'undefined') window.CrossplaySolver = CrossplaySolver;
