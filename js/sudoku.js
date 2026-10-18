/*
 * Sudoku engine: solver, puzzle generator and a human-style hint finder.
 * Grids are flat arrays of 81 numbers (0 = empty), indexed row-major.
 * Candidates are bitmasks where bit d (1 << d) means "d is still possible".
 */
(function (global) {
  'use strict';

  const ALL = 0x3fe; // bits 1..9

  function row(i) { return (i / 9) | 0; }
  function col(i) { return i % 9; }
  function box(i) { return ((i / 27) | 0) * 3 + (((i % 9) / 3) | 0); }
  function bit(d) { return 1 << d; }

  function popcount(m) { let c = 0; while (m) { m &= m - 1; c++; } return c; }
  function digits(m) { const r = []; for (let d = 1; d <= 9; d++) if (m & bit(d)) r.push(d); return r; }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const ROWS = [], COLS = [], BOXES = [];
  for (let n = 0; n < 9; n++) { ROWS.push([]); COLS.push([]); BOXES.push([]); }
  for (let i = 0; i < 81; i++) { ROWS[row(i)].push(i); COLS[col(i)].push(i); BOXES[box(i)].push(i); }

  const PEERS = [];
  for (let i = 0; i < 81; i++) {
    const s = new Set([...ROWS[row(i)], ...COLS[col(i)], ...BOXES[box(i)]]);
    s.delete(i);
    PEERS.push([...s]);
  }

  const unit = (type) => (cells, n) => ({ type, n, cells });
  const BOX_UNITS = BOXES.map(unit('box'));
  const ROW_UNITS = ROWS.map(unit('row'));
  const COL_UNITS = COLS.map(unit('col'));
  const LINE_UNITS = [...ROW_UNITS, ...COL_UNITS];
  // Boxes first: "where does the 7 go in this box?" is the most natural human scan.
  const ALL_UNITS = [...BOX_UNITS, ...ROW_UNITS, ...COL_UNITS];

  function candMask(g, i) {
    let used = 0;
    for (const p of PEERS[i]) used |= bit(g[p]);
    return ALL & ~used;
  }

  /** True if no filled cell clashes with a peer. */
  function isValidGrid(g) {
    for (let i = 0; i < 81; i++) {
      if (!g[i]) continue;
      for (const p of PEERS[i]) if (g[p] === g[i]) return false;
    }
    return true;
  }

  /** Cells whose value clashes with a peer. */
  function conflicts(g) {
    const out = new Set();
    for (let i = 0; i < 81; i++) {
      if (!g[i]) continue;
      for (const p of PEERS[i]) if (g[p] === g[i]) { out.add(i); out.add(p); }
    }
    return out;
  }

  /** Backtracking solver (most-constrained cell first). Stops after `limit` solutions. */
  function solve(grid, limit = 2, randomize = false) {
    const g = grid.slice();
    let count = 0, solution = null;
    (function rec() {
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = candMask(g, i), n = popcount(m);
        if (n === 0) return false;
        if (n < bestN) { best = i; bestMask = m; bestN = n; if (n === 1) break; }
      }
      if (best < 0) {
        if (!solution) solution = g.slice();
        return ++count >= limit;
      }
      const ds = digits(bestMask);
      if (randomize) shuffle(ds);
      for (const d of ds) { g[best] = d; if (rec()) return true; }
      g[best] = 0;
      return false;
    })();
    return { count, solution };
  }

  // ---------- Logical techniques (shared by grading and hints) ----------

  function initCands(g) {
    const c = new Array(81).fill(0);
    for (let i = 0; i < 81; i++) if (!g[i]) c[i] = candMask(g, i);
    return c;
  }

  function place(g, c, i, d) {
    g[i] = d;
    c[i] = 0;
    for (const p of PEERS[i]) c[p] &= ~bit(d);
  }

  function findSingle(g, c) {
    for (const u of ALL_UNITS) {
      for (let d = 1; d <= 9; d++) {
        let spot = -1, n = 0, present = false;
        for (const i of u.cells) {
          if (g[i] === d) { present = true; break; }
          if (c[i] & bit(d)) { n++; spot = i; }
        }
        if (!present && n === 1) return { kind: 'hidden', cell: spot, digit: d, unit: u };
      }
    }
    for (let i = 0; i < 81; i++) {
      if (!g[i] && popcount(c[i]) === 1) return { kind: 'naked', cell: i, digit: digits(c[i])[0] };
    }
    return null;
  }

  function findElimination(c) {
    // Pointing: inside a box, a digit is confined to one row/column -> clear it from the rest of that line.
    for (const b of BOX_UNITS) {
      for (let d = 1; d <= 9; d++) {
        const cells = b.cells.filter((i) => c[i] & bit(d));
        if (cells.length < 2) continue;
        for (const [lineOf, units] of [[row, ROW_UNITS], [col, COL_UNITS]]) {
          const l = lineOf(cells[0]);
          if (!cells.every((i) => lineOf(i) === l)) continue;
          const line = units[l];
          const targets = line.cells.filter((i) => box(i) !== b.n && (c[i] & bit(d)));
          if (targets.length) return { kind: 'pointing', digit: d, box: b, line, cells, elim: targets, mask: bit(d) };
        }
      }
    }
    // Claiming: inside a row/column, a digit is confined to one box -> clear it from the rest of that box.
    for (const line of LINE_UNITS) {
      for (let d = 1; d <= 9; d++) {
        const cells = line.cells.filter((i) => c[i] & bit(d));
        if (cells.length < 2) continue;
        const b = box(cells[0]);
        if (!cells.every((i) => box(i) === b)) continue;
        const targets = BOXES[b].filter((i) => !line.cells.includes(i) && (c[i] & bit(d)));
        if (targets.length) return { kind: 'claiming', digit: d, box: BOX_UNITS[b], line, cells, elim: targets, mask: bit(d) };
      }
    }
    // Naked pair: two cells in a unit share the same two candidates -> nobody else in the unit can have them.
    for (const u of ALL_UNITS) {
      const twos = u.cells.filter((i) => popcount(c[i]) === 2);
      for (let a = 0; a < twos.length; a++) {
        for (let b = a + 1; b < twos.length; b++) {
          if (c[twos[a]] !== c[twos[b]]) continue;
          const mask = c[twos[a]];
          const targets = u.cells.filter((i) => i !== twos[a] && i !== twos[b] && (c[i] & mask));
          if (targets.length) return { kind: 'pair', unit: u, cells: [twos[a], twos[b]], digits: digits(mask), elim: targets, mask };
        }
      }
    }
    return null;
  }

  /** Solve with logic only. level 1 = singles, level 2 = + pointing/claiming/pairs. */
  function logicSolve(grid, level) {
    const g = grid.slice(), c = initCands(g);
    let advanced = false;
    for (;;) {
      const s = findSingle(g, c);
      if (s) { place(g, c, s.cell, s.digit); continue; }
      if (level < 2) break;
      const e = findElimination(c);
      if (!e) break;
      for (const i of e.elim) c[i] &= ~e.mask;
      advanced = true;
    }
    return { solved: g.every((v) => v), advanced };
  }

  /**
   * Next logical step for a (correct) partial grid. Returns the single to place plus
   * any eliminations that were needed to expose it, or null if logic runs out.
   */
  function hint(grid) {
    const g = grid.slice(), c = initCands(g);
    const pre = [];
    for (let guard = 0; guard < 300; guard++) {
      const s = findSingle(g, c);
      if (s) {
        // Keep only the eliminations that touched the cell/unit the single lives in.
        const relevant = pre.filter((e) => (s.kind === 'naked'
          ? e.elim.includes(s.cell)
          : (e.mask & bit(s.digit)) && e.elim.some((i) => s.unit.cells.includes(i))));
        return { ...s, pre: relevant.length ? relevant : pre.slice(-2) };
      }
      const e = findElimination(c);
      if (!e) return null;
      for (const i of e.elim) c[i] &= ~e.mask;
      pre.push(e);
    }
    return null;
  }

  // ---------- Generator ----------

  const LEVELS = {
    easy:   { givens: 38, logic: 1 },
    medium: { givens: 30, logic: 1 },
    hard:   { givens: 26, logic: 2, tough: true },
    expert: { givens: 23, logic: 0, tough: true }, // no logic constraint: may need techniques beyond the hint engine
  };

  function generate(difficulty, budgetMs = 1200) {
    const cfg = LEVELS[difficulty] || LEVELS.medium;
    const deadline = Date.now() + budgetMs;
    let best = null;
    do {
      const solution = solve(new Array(81).fill(0), 1, true).solution;
      const puzzle = solution.slice();
      let givens = 81;
      // Remove symmetric pairs so the puzzle has the classic look.
      for (const i of shuffle([...Array(41).keys()])) {
        if (givens <= cfg.givens) break;
        const j = 80 - i;
        const vi = puzzle[i], vj = puzzle[j];
        puzzle[i] = 0; puzzle[j] = 0;
        const ok = solve(puzzle, 2).count === 1 && (!cfg.logic || logicSolve(puzzle, cfg.logic).solved);
        if (ok) givens -= i === j ? 1 : 2;
        else { puzzle[i] = vi; puzzle[j] = vj; }
      }
      // "tough" levels want puzzles that basic singles alone can't crack.
      const tough = !logicSolve(puzzle, 1).solved;
      const score = (cfg.tough && tough ? 100 : 0) - givens;
      if (!best || score > best.score) best = { puzzle, solution, givens, score };
      if (givens <= cfg.givens && (!cfg.tough || tough)) break;
    } while (Date.now() < deadline);
    return best;
  }

  global.Sudoku = {
    row, col, box, digits, bit, ROWS, COLS, BOXES, PEERS, LEVELS,
    solve, isValidGrid, conflicts, logicSolve, hint, generate,
  };
})(typeof window !== 'undefined' ? window : this);
