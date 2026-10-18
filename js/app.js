(function () {
  'use strict';

  const S = window.Sudoku;
  const $ = (id) => document.getElementById(id);

  const DIFFS = {
    easy: { label: 'Easy', blurb: 'Relaxed — plenty of clues' },
    medium: { label: 'Medium', blurb: 'Fewer clues, still straightforward' },
    hard: { label: 'Hard', blurb: 'Needs pairs & pointing tricks' },
    expert: { label: 'Expert', blurb: 'Minimal clues, deep logic' },
  };
  const MAX_MISTAKES = 3;
  const MAX_HINTS = 3;
  const SAVE_KEY = 'sudoku.current.v1';
  const HISTORY_KEY = 'sudoku.history.v1';
  const BOX_NAMES = ['top-left', 'top-middle', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-middle', 'bottom-right'];

  // localStorage can throw (private mode, blocked storage) — the game must still work.
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  const sameHouse = (a, b) => S.row(a) === S.row(b) || S.col(a) === S.col(b) || S.box(a) === S.box(b);

  // ---------- Shared board rendering ----------

  function createBoard(el, onSelect) {
    const cells = [];
    for (let i = 0; i < 81; i++) {
      const c = document.createElement('div');
      const r = S.row(i), k = S.col(i);
      const base = ['cell'];
      if (k === 2 || k === 5) base.push('br');
      if (r === 2 || r === 5) base.push('bb');
      if (k === 8) base.push('c8');
      if (r === 8) base.push('r8');
      c.dataset.base = base.join(' ');
      c.className = c.dataset.base;
      c.addEventListener('pointerdown', (e) => { e.preventDefault(); onSelect(i); });
      el.appendChild(c);
      cells.push(c);
    }
    return cells;
  }

  function paintCell(el, value, notes, classes) {
    el.className = el.dataset.base + (classes.length ? ' ' + classes.join(' ') : '');
    if (value) {
      el.textContent = value;
    } else if (notes) {
      let html = '<div class="notes">';
      for (let d = 1; d <= 9; d++) html += `<span>${notes & S.bit(d) ? d : ''}</span>`;
      el.innerHTML = html + '</div>';
    } else {
      el.textContent = '';
    }
  }

  function buildNumpad(el, onDigit, withErase) {
    const buttons = [];
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.className = 'num';
      b.innerHTML = `${d}<small></small>`;
      b.addEventListener('click', () => onDigit(d));
      el.appendChild(b);
      buttons.push(b);
    }
    if (withErase) {
      const b = document.createElement('button');
      b.className = 'num erase';
      b.textContent = '⌫';
      b.setAttribute('aria-label', 'Erase');
      b.addEventListener('click', withErase);
      el.appendChild(b);
    }
    return buttons;
  }

  // ---------- Modal & toast ----------

  let modalOpen = false;
  let modalDismiss = null;

  function openModal(title, bodyHtml, actions, onDismiss) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    const box = $('modal-actions');
    box.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.cls || '');
      b.innerHTML = a.label;
      b.addEventListener('click', () => { closeModal(); a.onClick?.(); });
      box.appendChild(b);
    }
    modalDismiss = onDismiss || null;
    modalOpen = true;
    $('modal').classList.remove('hidden');
    syncClock();
  }

  function closeModal() {
    modalOpen = false;
    modalDismiss = null;
    $('modal').classList.add('hidden');
    syncClock();
  }

  $('modal').addEventListener('pointerdown', (e) => {
    if (e.target === $('modal') && modalDismiss) { const fn = modalDismiss; closeModal(); fn(); }
  });

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  // ======================================================================
  // PLAY
  // ======================================================================

  let game = null; // persisted: { difficulty, puzzle, solution, board, notes, mistakes, hintsUsed, elapsed, status, moved }
  let selected = -1;
  let notesMode = false;
  let undoStack = [];
  let activeHint = null; // { kind, cell, digit, unit?, pre, stage: 0 = nudge, 1 = exact cell }
  let manualPause = false;
  let loading = false;
  let currentView = 'play';
  let runningSince = null;
  let popCell = -1;

  const playCells = createBoard($('board'), (i) => {
    if (!game || manualPause) return;
    selected = i;
    renderPlay();
  });
  const playPad = buildNumpad($('numpad'), (d) => enterDigit(d));

  // ---------- Clock ----------

  function elapsed() {
    if (!game) return 0;
    return game.elapsed + (runningSince != null ? performance.now() - runningSince : 0);
  }

  // The clock only runs while you can actually see and play the board.
  function syncClock() {
    const run = game && game.status === 'playing' && !manualPause && !loading && !modalOpen
      && !document.hidden && currentView === 'play';
    if (run && runningSince == null) runningSince = performance.now();
    if (!run && runningSince != null) {
      game.elapsed += performance.now() - runningSince;
      runningSince = null;
    }
  }

  let lastAutoSave = 0;
  setInterval(() => {
    $('timer').textContent = fmtTime(elapsed());
    if (runningSince != null && Date.now() - lastAutoSave > 5000) save();
  }, 250);

  function save() {
    if (!game) return;
    lastAutoSave = Date.now();
    if (game.status !== 'playing') { store.remove(SAVE_KEY); return; }
    store.set(SAVE_KEY, { ...game, elapsed: elapsed() });
  }

  // ---------- Game lifecycle ----------

  function startNewGame(difficulty) {
    recordUnfinished();
    loading = true;
    syncClock();
    $('loading-overlay').classList.remove('hidden');
    // Let the overlay paint before the (blocking) generator runs.
    setTimeout(() => {
      const p = S.generate(difficulty);
      game = {
        difficulty,
        puzzle: p.puzzle,
        solution: p.solution,
        board: p.puzzle.slice(),
        notes: new Array(81).fill(0),
        mistakes: 0,
        hintsUsed: 0,
        elapsed: 0,
        status: 'playing',
        moved: false,
      };
      resetSession();
      loading = false;
      $('loading-overlay').classList.add('hidden');
      save();
      syncClock();
      renderPlay();
    }, 40);
  }

  function restartPuzzle() {
    Object.assign(game, {
      board: game.puzzle.slice(), notes: new Array(81).fill(0),
      mistakes: 0, hintsUsed: 0, elapsed: 0, status: 'playing', moved: false,
    });
    resetSession();
    save();
    syncClock();
    renderPlay();
  }

  function resetSession() {
    selected = -1;
    undoStack = [];
    activeHint = null;
    manualPause = false;
    runningSince = null;
  }

  // Starting a new game mid-way still counts as a game played.
  function recordUnfinished() {
    if (game && game.status === 'playing' && game.moved) {
      syncClock();
      addHistory('quit');
      game.status = 'quit';
      store.remove(SAVE_KEY);
    }
  }

  function playable() {
    return game && game.status === 'playing' && !manualPause && !loading;
  }

  function isLocked(i) {
    // Givens and correctly placed numbers can't be changed.
    return game.puzzle[i] !== 0 || (game.board[i] !== 0 && game.board[i] === game.solution[i]);
  }

  function pushUndo() {
    undoStack.push({ board: game.board.slice(), notes: game.notes.slice(), selected });
    if (undoStack.length > 300) undoStack.shift();
  }

  function placeCorrect(i, d) {
    game.board[i] = d;
    game.notes[i] = 0;
    for (const p of S.PEERS[i]) game.notes[p] &= ~S.bit(d);
    popCell = i;
    if (activeHint && activeHint.cell === i) activeHint = null;
  }

  function enterDigit(d) {
    if (!playable() || selected < 0 || isLocked(selected)) return;
    const i = selected;
    if (notesMode) {
      if (game.board[i]) return;
      pushUndo();
      game.notes[i] ^= S.bit(d);
    } else {
      if (game.board[i] === d) return;
      pushUndo();
      game.moved = true;
      if (d === game.solution[i]) {
        placeCorrect(i, d);
      } else {
        game.board[i] = d;
        game.notes[i] = 0;
        game.mistakes++;
        if (game.mistakes >= MAX_MISTAKES) return lose();
      }
      if (game.board.every((v, k) => v === game.solution[k])) return win();
    }
    save();
    renderPlay();
  }

  function erase() {
    if (!playable() || selected < 0 || isLocked(selected)) return;
    if (!game.board[selected] && !game.notes[selected]) return;
    pushUndo();
    game.board[selected] = 0;
    game.notes[selected] = 0;
    save();
    renderPlay();
  }

  function undo() {
    if (!playable() || !undoStack.length) return;
    const s = undoStack.pop();
    game.board = s.board;
    game.notes = s.notes;
    selected = s.selected;
    save();
    renderPlay();
  }

  function win() {
    game.status = 'won';
    syncClock();
    selected = -1;
    activeHint = null;
    const best = bestTime(game.difficulty);
    const time = elapsed();
    addHistory('won');
    save();
    renderPlay();
    const isBest = best == null || time < best;
    openModal('Solved! 🎉', `
      ${isBest ? `<p>New best time for ${DIFFS[game.difficulty].label}!</p>` : ''}
      <div class="result-grid">
        <div><span>Time</span><b>${fmtTime(time)}</b></div>
        <div><span>Difficulty</span><b>${DIFFS[game.difficulty].label}</b></div>
        <div><span>Hints used</span><b>${game.hintsUsed}/${MAX_HINTS}</b></div>
        <div><span>Mistakes</span><b>${game.mistakes}/${MAX_MISTAKES}</b></div>
      </div>`,
    [{ label: 'New game', cls: 'primary', onClick: chooseDifficulty }, { label: 'Close' }], () => {});
  }

  function lose() {
    game.status = 'lost';
    syncClock();
    activeHint = null;
    addHistory('lost');
    save();
    renderPlay();
    openModal('Game over', `<p>You made ${MAX_MISTAKES} mistakes. Want another go?</p>`, [
      { label: 'New game', cls: 'primary', onClick: chooseDifficulty },
      { label: 'Restart this puzzle', onClick: restartPuzzle },
    ]);
  }

  function chooseDifficulty() {
    const inProgress = game && game.status === 'playing' && game.moved;
    const actions = Object.entries(DIFFS).map(([key, d]) => ({
      label: `<span>${d.label}</span><small>${d.blurb}</small>`,
      cls: 'diff-option',
      onClick: () => startNewGame(key),
    }));
    const canCancel = !!game;
    if (canCancel) actions.push({ label: 'Cancel' });
    openModal('New game', inProgress
      ? '<p>Pick a difficulty. Your current game will be saved to history as unfinished.</p>'
      : '<p>Pick a difficulty.</p>', actions, canCancel ? () => {} : null);
  }

  function setPaused(p) {
    if (!game || game.status !== 'playing') return;
    manualPause = p;
    syncClock();
    save();
    renderPlay();
  }

  // ---------- Hints ----------

  const cellName = (i) => `row ${S.row(i) + 1}, column ${S.col(i) + 1}`;
  const unitName = (u) => (u.type === 'box' ? `the ${BOX_NAMES[u.n]} box` : `${u.type === 'row' ? 'row' : 'column'} ${u.n + 1}`);

  function stepText(e) {
    if (e.kind === 'pointing') {
      return `In ${unitName(e.box)}, the ${e.digit} can only sit in ${unitName(e.line)} — so no other cell in ${unitName(e.line)} can be ${e.digit}.`;
    }
    if (e.kind === 'claiming') {
      return `In ${unitName(e.line)}, the ${e.digit} can only sit inside ${unitName(e.box)} — so no other cell in that box can be ${e.digit}.`;
    }
    return `In ${unitName(e.unit)}, two cells can only be ${e.digits[0]} or ${e.digits[1]} — so nothing else in ${unitName(e.unit)} can use those numbers.`;
  }

  function hintText(h) {
    if (h.kind === 'reveal') {
      return `This spot needs a technique beyond basic logic, so here's a free answer: ${cellName(h.cell)} is <b>${h.digit}</b>.`;
    }
    const pre = h.pre.length ? h.pre.map(stepText).join(' ') + ' ' : '';
    if (h.stage === 0) {
      return h.kind === 'hidden'
        ? `${pre}Look at <b>${unitName(h.unit)}</b>. Where can the <b>${h.digit}</b> go?`
        : `${pre}Look at <b>${unitName({ type: 'box', n: S.box(h.cell) })}</b>. One of its empty cells has only one possible number once you check its row and column.`;
    }
    if (h.kind === 'hidden') {
      const blockers = { box: 'row or column', row: 'column or box', col: 'row or box' }[h.unit.type];
      return `${pre}The ${h.digit} is missing from ${unitName(h.unit)}, and every other empty cell there is blocked by a ${h.digit} in the same ${blockers}. So <b>${cellName(h.cell)}</b> must be <b>${h.digit}</b>.`;
    }
    return pre
      ? `${pre}With that, <b>${cellName(h.cell)}</b> has only one option left: <b>${h.digit}</b>.`
      : `The row, column and box of <b>${cellName(h.cell)}</b> already contain every number except <b>${h.digit}</b>. So it must be <b>${h.digit}</b>.`;
  }

  function hintArea(h) {
    if (!h || h.kind === 'reveal') return new Set();
    const area = new Set(h.kind === 'hidden' ? h.unit.cells : S.BOXES[S.box(h.cell)]);
    if (h.stage === 1 && h.kind === 'naked') {
      S.ROWS[S.row(h.cell)].forEach((i) => area.add(i));
      S.COLS[S.col(h.cell)].forEach((i) => area.add(i));
    }
    return area;
  }

  function requestHint() {
    if (!playable()) return;
    if (activeHint) { renderPlay(); return; }
    if (game.hintsUsed >= MAX_HINTS) { toast(`No hints left — ${MAX_HINTS} per game`); return; }

    // Reason only from correct entries; red cells are treated as empty.
    const grid = game.board.map((v, i) => (v === game.solution[i] ? v : 0));
    const h = S.hint(grid);
    if (h) {
      activeHint = { ...h, stage: 0 };
    } else {
      const open = grid.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      const cell = open.includes(selected) ? selected : open[Math.floor(Math.random() * open.length)];
      activeHint = { kind: 'reveal', cell, digit: game.solution[cell], pre: [], stage: 1 };
      selected = cell;
    }
    game.hintsUsed++;
    save();
    renderPlay();
  }

  $('hint-show').addEventListener('click', () => {
    if (!activeHint) return;
    activeHint.stage = 1;
    selected = activeHint.cell;
    renderPlay();
  });
  $('hint-fill').addEventListener('click', () => {
    if (!activeHint || !playable()) return;
    pushUndo();
    game.moved = true;
    selected = activeHint.cell;
    placeCorrect(activeHint.cell, activeHint.digit);
    if (game.board.every((v, k) => v === game.solution[k])) return win();
    save();
    renderPlay();
  });
  $('hint-close').addEventListener('click', () => { activeHint = null; renderPlay(); });

  // ---------- Render ----------

  function renderPlay() {
    if (!game) return;
    const selVal = selected >= 0 ? game.board[selected] : 0;
    const area = hintArea(activeHint);
    const target = activeHint && activeHint.stage === 1 ? activeHint.cell : -1;
    const counts = new Array(10).fill(0);

    for (let i = 0; i < 81; i++) {
      const v = game.board[i];
      const cls = [];
      if (game.puzzle[i]) cls.push('given');
      else if (v) cls.push('user');
      if (v && v !== game.solution[i]) cls.push('wrong');
      else if (v) counts[v]++;

      if (i === target) cls.push('hint-target');
      else if (i === selected) cls.push('selected');
      else if (area.has(i)) cls.push('hint-area');
      else if (selVal && v === selVal) cls.push('same');
      else if (selected >= 0 && sameHouse(i, selected)) cls.push('peer');
      if (i === popCell) cls.push('pop');
      paintCell(playCells[i], v, game.notes[i], cls);
    }
    popCell = -1;

    playPad.forEach((b, k) => {
      const left = 9 - counts[k + 1];
      b.classList.toggle('done', left <= 0);
      b.querySelector('small').textContent = left;
    });

    $('difficulty-label').textContent = DIFFS[game.difficulty].label;
    $('mistakes').textContent = game.mistakes;
    $('mistakes').parentElement.classList.toggle('danger', game.mistakes >= MAX_MISTAKES - 1);
    const left = MAX_HINTS - game.hintsUsed;
    $('hint-count').textContent = left;
    $('hint-count').classList.toggle('empty', left === 0);
    $('notes-btn').classList.toggle('on', notesMode);
    $('notes-state').textContent = notesMode ? 'on' : 'off';
    $('pause-overlay').classList.toggle('hidden', !manualPause);
    $('pause-btn').innerHTML = manualPause
      ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg>';
    $('timer').textContent = fmtTime(elapsed());

    const showHint = !!activeHint && game.status === 'playing';
    $('hint-panel').classList.toggle('hidden', !showHint);
    if (showHint) {
      const wrong = game.board.some((v, i) => v && v !== game.solution[i]);
      $('hint-text').innerHTML = hintText(activeHint)
        + (wrong ? ' <span class="muted">(Tip: clear the red cells — they’re wrong.)</span>' : '');
      $('hint-show').classList.toggle('hidden', activeHint.stage === 1);
    }
  }

  $('undo-btn').addEventListener('click', undo);
  $('erase-btn').addEventListener('click', erase);
  $('notes-btn').addEventListener('click', () => { notesMode = !notesMode; renderPlay(); });
  $('hint-btn').addEventListener('click', requestHint);
  $('pause-btn').addEventListener('click', () => setPaused(!manualPause));
  $('resume-btn').addEventListener('click', () => setPaused(false));
  $('new-game-btn').addEventListener('click', chooseDifficulty);

  // ======================================================================
  // SOLVER
  // ======================================================================

  const solver = { grid: new Array(81).fill(0), filled: new Set(), selected: -1, target: -1 };
  const solverCells = createBoard($('solver-board'), (i) => { solver.selected = i; renderSolver(); });
  buildNumpad($('solver-numpad'), (d) => solverInput(d), () => solverInput(0));

  function solverMsg(html, isError) {
    $('solver-msg').innerHTML = `<p>${html}</p>`;
    $('solver-msg').classList.toggle('error', !!isError);
  }

  function solverInput(d) {
    const i = solver.selected;
    if (i < 0) return;
    // Any edit invalidates what the solver filled in.
    for (const k of solver.filled) solver.grid[k] = 0;
    solver.filled.clear();
    solver.target = -1;
    solver.grid[i] = d;
    renderSolver();
  }

  function renderSolver() {
    const bad = S.conflicts(solver.grid);
    const selVal = solver.selected >= 0 ? solver.grid[solver.selected] : 0;
    for (let i = 0; i < 81; i++) {
      const v = solver.grid[i];
      const cls = [];
      if (v) cls.push(solver.filled.has(i) ? 'user' : 'given');
      if (bad.has(i)) cls.push('wrong');
      if (i === solver.target) cls.push('hint-target');
      else if (i === solver.selected) cls.push('selected');
      else if (selVal && v === selVal) cls.push('same');
      else if (solver.selected >= 0 && sameHouse(i, solver.selected)) cls.push('peer');
      paintCell(solverCells[i], v, 0, cls);
    }
  }

  function solverReady() {
    if (!solver.grid.some((v) => v)) { solverMsg('Enter some numbers first.', true); return false; }
    if (!S.isValidGrid(solver.grid)) { solverMsg('Some numbers clash (shown in red). Fix them first.', true); return false; }
    return true;
  }

  $('solver-solve').addEventListener('click', () => {
    if (!solverReady()) return;
    const r = S.solve(solver.grid, 2);
    if (!r.count) { solverMsg('This puzzle has no solution.', true); return; }
    for (let i = 0; i < 81; i++) {
      if (!solver.grid[i]) { solver.grid[i] = r.solution[i]; solver.filled.add(i); }
    }
    solver.target = -1;
    solverMsg(r.count > 1
      ? 'Solved — but this puzzle has <b>more than one</b> solution, so this is just one of them.'
      : 'Solved! This puzzle has exactly one solution.');
    renderSolver();
  });

  $('solver-step').addEventListener('click', () => {
    if (!solverReady()) return;
    if (solver.grid.every((v) => v)) { solverMsg('The grid is already full.'); return; }
    const h = S.hint(solver.grid);
    if (!h) {
      const r = S.solve(solver.grid, 1);
      solverMsg(r.count
        ? 'No simple logical step from here — it needs advanced techniques. Press <b>Solve</b> to finish it.'
        : 'This puzzle has no solution.', !r.count);
      return;
    }
    solver.grid[h.cell] = h.digit;
    solver.filled.add(h.cell);
    solver.target = h.cell;
    solver.selected = -1;
    solverMsg(hintText({ ...h, stage: 1 }));
    renderSolver();
  });

  $('solver-clear').addEventListener('click', () => {
    solver.grid.fill(0);
    solver.filled.clear();
    solver.selected = -1;
    solver.target = -1;
    solverMsg('Tap a cell and enter the numbers from your puzzle.');
    renderSolver();
  });

  // ======================================================================
  // HISTORY
  // ======================================================================

  function addHistory(result) {
    const list = store.get(HISTORY_KEY, []);
    list.unshift({
      date: Date.now(),
      difficulty: game.difficulty,
      result,
      time: Math.round(elapsed()),
      hints: game.hintsUsed,
      mistakes: game.mistakes,
    });
    store.set(HISTORY_KEY, list.slice(0, 500));
  }

  function bestTime(difficulty) {
    const times = store.get(HISTORY_KEY, [])
      .filter((g) => g.result === 'won' && g.difficulty === difficulty)
      .map((g) => g.time);
    return times.length ? Math.min(...times) : null;
  }

  const RESULT_LABEL = { won: 'Solved', lost: 'Lost', quit: 'Unfinished' };

  function renderHistory() {
    const list = store.get(HISTORY_KEY, []);
    $('stats').innerHTML = Object.entries(DIFFS).map(([key, d]) => {
      const games = list.filter((g) => g.difficulty === key);
      const won = games.filter((g) => g.result === 'won').length;
      const best = bestTime(key);
      return `<div class="stat"><h3>${d.label}</h3>
        <div class="big">${best != null ? fmtTime(best) : '—'}</div>
        <div class="small">best · ${won}/${games.length} solved</div></div>`;
    }).join('');

    $('history-body').innerHTML = list.map((g) => {
      const date = new Date(g.date);
      const when = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return `<tr><td>${when}</td><td>${DIFFS[g.difficulty]?.label ?? g.difficulty}</td>
        <td class="result-${g.result}">${RESULT_LABEL[g.result] ?? g.result}</td>
        <td class="num-col">${fmtTime(g.time)}</td><td class="num-col">${g.hints}</td></tr>`;
    }).join('');
    $('history-empty').classList.toggle('hidden', list.length > 0);
    document.querySelector('.table-wrap').classList.toggle('hidden', !list.length);
    $('clear-history').classList.toggle('hidden', !list.length);
  }

  $('clear-history').addEventListener('click', () => {
    openModal('Clear history?', '<p>This deletes all recorded games and best times on this device.</p>', [
      { label: 'Clear history', cls: 'primary', onClick: () => { store.remove(HISTORY_KEY); renderHistory(); } },
      { label: 'Cancel' },
    ], () => {});
  });

  // ======================================================================
  // NAVIGATION, KEYBOARD, LIFECYCLE
  // ======================================================================

  function showView(view) {
    currentView = view;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
    if (view === 'history') renderHistory();
    if (view === 'solver') renderSolver();
    if (view === 'play') renderPlay();
    syncClock();
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

  function moveSelection(cur, key) {
    if (cur < 0) return 0;
    const r = S.row(cur), c = S.col(cur);
    if (key === 'ArrowUp') return ((r + 8) % 9) * 9 + c;
    if (key === 'ArrowDown') return ((r + 1) % 9) * 9 + c;
    if (key === 'ArrowLeft') return r * 9 + (c + 8) % 9;
    return r * 9 + (c + 1) % 9;
  }

  document.addEventListener('keydown', (e) => {
    if (modalOpen) {
      if (e.key === 'Escape' && modalDismiss) { const fn = modalDismiss; closeModal(); fn(); }
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      if (e.key.toLowerCase() === 'z' && currentView === 'play') { e.preventDefault(); undo(); }
      return;
    }
    const digit = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
    const isErase = e.key === 'Backspace' || e.key === 'Delete' || e.key === '0';
    const isArrow = e.key.startsWith('Arrow');

    if (currentView === 'play') {
      if (!game) return;
      if (isArrow) { e.preventDefault(); if (!manualPause) { selected = moveSelection(selected, e.key); renderPlay(); } }
      else if (digit) enterDigit(digit);
      else if (isErase) erase();
      else if (e.key === 'n' || e.key === 'N') { notesMode = !notesMode; renderPlay(); }
      else if (e.key === 'h' || e.key === 'H') requestHint();
      else if (e.key === 'p' || e.key === 'P' || e.key === ' ') { e.preventDefault(); setPaused(!manualPause); }
    } else if (currentView === 'solver') {
      if (isArrow) { e.preventDefault(); solver.selected = moveSelection(solver.selected, e.key); renderSolver(); }
      else if (digit) solverInput(digit);
      else if (isErase) solverInput(0);
    }
  });

  document.addEventListener('visibilitychange', () => { syncClock(); save(); });
  window.addEventListener('pagehide', save);

  // Restore an in-progress game, or ask for a difficulty on first launch.
  const saved = store.get(SAVE_KEY, null);
  if (saved && saved.status === 'playing' && Array.isArray(saved.board) && saved.board.length === 81) {
    game = saved;
    syncClock();
    renderPlay();
  } else {
    renderSolver();
    chooseDifficulty();
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
