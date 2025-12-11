$(function () {
  const $board = $('#board');
  const $status = $('#status');
  const $keypad = $('#keypad');
  let confettiCleanup = null;
  let shuffleInterval = null;
  let shuffleTimeout = null;
  let notesEnabled = false;
  let annotations = createAnnotations();
  const history = [];
  const MAX_HISTORY = 100;
  const $undoBtn = $('#btn-undo');
  const STORAGE_KEY = 'sudoku.current.v1';
  let isShuffling = false;
  let currentIndex = 0; // track focused cell index for keypad
  let isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  // ---- Storage helpers ----
  function canUseStorage(){
    try{
      const t='__t__';
      window.localStorage.setItem(t,'1');
      window.localStorage.removeItem(t);
      return true;
    }catch(_){return false;}
  }

  function annotationsToArray(src){
    return src.map(row => row.map(set => Array.from(set)));
  }

  function arrayToAnnotations(arr){
    try{
      return arr.map(row => row.map(list => new Set(Array.isArray(list)? list : [])));
    }catch(_){
      return createAnnotations();
    }
  }

  function snapshotToPlain(snap){
    return {
      board: snap.board.map(row => row.slice()),
      fixedMask: snap.fixedMask.map(row => row.slice()),
      annotations: annotationsToArray(snap.annotations)
    };
  }

  function plainToSnapshot(obj){
    if (!obj || !Array.isArray(obj.board) || !Array.isArray(obj.fixedMask)) return null;
    return {
      board: obj.board.map(row => row.map(n => Number(n) || 0)),
      fixedMask: obj.fixedMask.map(row => row.map(Boolean)),
      annotations: arrayToAnnotations(obj.annotations || [])
    };
  }

  function saveState(){
    if (!canUseStorage() || isShuffling) return;
    const snap = snapshot();
    // Serialize history (cap size to keep payload reasonable)
    const histCap = Math.min(history.length, MAX_HISTORY);
    const histStart = history.length - histCap;
    const histSlice = history.slice(histStart);
    const payload = {
      board: snap.board,
      fixedMask: snap.fixedMask,
      annotations: annotationsToArray(snap.annotations),
      notesEnabled: !!notesEnabled,
      difficulty: String($('#difficulty').val() || 'medium'),
      history: histSlice.map(s => snapshotToPlain(s)),
      savedAt: Date.now()
    };
    try{
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }catch(_){/* ignore quota */}
  }

  const saveStateDebounced = debounce(saveState, 200);

  function loadState(){
    if (!canUseStorage()) return null;
    try{
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Basic shape checks
      if (!Array.isArray(data.board) || data.board.length !== 9) return null;
      if (!Array.isArray(data.fixedMask) || data.fixedMask.length !== 9) return null;
      return data;
    }catch(_){
      return null;
    }
  }

  function clearSavedState(){
    if (!canUseStorage()) return;
    try{ window.localStorage.removeItem(STORAGE_KEY); }catch(_){}
  }

  function tryRestoreFromStorage(){
    const data = loadState();
    if (!data) return false;
    // difficulty
    if (data.difficulty) $('#difficulty').val(String(data.difficulty));
    // notes mode UI
    notesEnabled = !!data.notesEnabled;
    $('#btn-notes').attr('aria-pressed', String(notesEnabled));
    // board and fixed
    setBoard(data.board, data.fixedMask, { preserveAnnotations: true });
    // annotations
    annotations = arrayToAnnotations(data.annotations || []);
    renderAllNotes();
    // history (optional, backward compatible)
    if (Array.isArray(data.history)) {
      history.length = 0; // clear existing
      const capped = data.history.slice(-MAX_HISTORY);
      for (const h of capped) {
        const snap = plainToSnapshot(h);
        if (snap) history.push(snap);
      }
    }
    runValidation();
    setStatus('Restored saved game');
    updateUndoButton();
    return true;
  }

  function debounce(fn, wait){
    let t=null;
    return function(){
      const ctx=this, args=arguments;
      clearTimeout(t);
      t=setTimeout(()=>fn.apply(ctx,args), wait);
    };
  }

  // Build 9x9 grid of inputs
  function buildBoard() {
    $board.empty();
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const $cell = $('<div/>').addClass('cell');
        const $input = $('<input/>')
          .attr({ type: 'text', inputmode: 'numeric', maxlength: 1, 'aria-label': `Row ${r + 1} Col ${c + 1}` })
          .on('focus', function(){
            currentIndex = r * 9 + c;
          })
          .on('input', function () {
            const v = $(this).val().replace(/[^1-9]/g, '');
            $(this).val(v);
            toggleHasValue($cell, v);
            // Validate on every change
            runValidation();
            // Save current state (debounced) when user types
            if (!isShuffling) saveStateDebounced();
          })
          .on('keydown', function (e) {
            // Allow navigation with arrow keys
            const key = e.key;
            const index = r * 9 + c;
            // Notes mode handling
            if (notesEnabled) {
              if (/^[1-9]$/.test(key)) {
                pushHistory();
                e.preventDefault();
                toggleAnnotation(r, c, Number(key));
                renderCellNotes(r, c, $cell);
                saveStateDebounced();
                return;
              }
              if (key === 'Backspace' || key === 'Delete') {
                pushHistory();
                e.preventDefault();
                clearCellAnnotations(r, c);
                renderCellNotes(r, c, $cell);
                saveStateDebounced();
                return;
              }
            }
            // Normal mode: capture history before destructive keys
            if (!notesEnabled) {
              if (/^[1-9]$/.test(key) || key === 'Backspace' || key === 'Delete') {
                pushHistory();
              }
            }
            if (key === 'ArrowUp' && r > 0) focusIndex(index - 9);
            else if (key === 'ArrowDown' && r < 8) focusIndex(index + 9);
            else if (key === 'ArrowLeft' && c > 0) focusIndex(index - 1);
            else if (key === 'ArrowRight' && c < 8) focusIndex(index + 1);
          });
        if ((c + 1) % 3 === 0 && c !== 8) $cell.addClass('thick-right');
        if ((r + 1) % 3 === 0 && r !== 8) $cell.addClass('thick-bottom');
        const $notes = buildNotesElement();
        $cell.append($input, $notes);
        // Clicking anywhere in the cell focuses the input
        $cell.on('click', function(){ $input.trigger('focus'); });
        $board.append($cell);
      }
    }
    // On touch devices we rely on on-screen keypad: prevent OS keyboard
    updateReadonlyForMobile();
  }

  function toggleHasValue($cell, val) {
    $cell.toggleClass('has-value', !!val);
  }

  function buildNotesElement() {
    const $wrap = $('<div/>').addClass('notes').attr('aria-hidden', 'true');
    for (let i = 1; i <= 9; i++) {
      const $n = $('<span/>').addClass('note');
      $wrap.append($n);
    }
    return $wrap;
  }

  function createAnnotations() {
    return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => new Set()));
  }

  function toggleAnnotation(r, c, n) {
    const set = annotations[r][c];
    if (set.has(n)) set.delete(n); else set.add(n);
  }

  function clearCellAnnotations(r, c) {
    annotations[r][c].clear();
  }

  function clearAllAnnotations() {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) annotations[r][c].clear();
  }

  function renderCellNotes(r, c, $cell) {
    const set = annotations[r][c];
    const $notes = $cell.find('.notes');
    const $spans = $notes.find('.note');
    for (let i = 1; i <= 9; i++) {
      const idx = i - 1;
      $($spans[idx]).text(set.has(i) ? String(i) : '');
    }
  }

  function renderAllNotes() {
    const cells = $board.find('.cell');
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        renderCellNotes(r, c, $(cells[idx]));
      }
    }
  }

  function stopCelebration() {
    // remove spin
    $board.removeClass('spin');
    // remove confetti nodes
    if (typeof confettiCleanup === 'function') {
      confettiCleanup();
      confettiCleanup = null;
    }
    $('.confetti').remove();
  }

  function celebrateSolved() {
    // Spin the board briefly
    $board.addClass('spin');
    setTimeout(() => $board.removeClass('spin'), 1300);

    // Launch confetti
    confettiCleanup = launchConfetti(140, 1200);
  }

  function launchConfetti(count = 120, durationMs = 1200) {
    const colors = ['#fde047', '#f472b6', '#60a5fa', '#34d399', '#fca5a5', '#c084fc', '#22d3ee'];
    const created = [];
    const body = document.body;
    const start = Date.now();
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'confetti';
      const left = Math.random() * 100; // vw
      el.style.left = left + 'vw';
      el.style.background = colors[i % colors.length];
      el.style.transform = `translate3d(0,-10px,0)`;
      el.style.animation = `confettiFall ${0.9 + Math.random() * 0.8}s linear forwards`;
      el.style.setProperty('--x', (Math.random() * 60 - 30) + 'vw');
      el.style.borderRadius = (Math.random() > 0.5 ? '2px' : '50%');
      el.style.opacity = String(0.75 + Math.random() * 0.25);
      body.appendChild(el);
      created.push(el);
    }
    const timer = setTimeout(() => {
      created.forEach(n => n.remove());
    }, Math.max(800, durationMs - (Date.now() - start)));
    return function cleanup() {
      clearTimeout(timer);
      created.forEach(n => n.remove());
    };
  }

  function focusIndex(i) {
    const el = $board.find('input').get(i);
    if (el) el.focus();
  }

  function focusCurrent(){
    focusIndex(currentIndex);
  }

  function getBoard() {
    const nums = [];
    const inputs = $board.find('input');
    for (let r = 0; r < 9; r++) {
      const row = [];
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        const v = $(inputs[idx]).val();
        row.push(v ? Number(v) : 0);
      }
      nums.push(row);
    }
    return nums;
  }

  function applyValidation(mask) {
    const cells = $board.find('.cell');
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        const conflict = mask && mask[r] && mask[r][c];
        $(cells[idx]).toggleClass('conflict', !!conflict);
      }
    }
  }

  function validateBoard(board) {
    const mask = Array.from({ length: 9 }, () => Array(9).fill(false));
    let valid = true;
    // Rows
    for (let r = 0; r < 9; r++) {
      const map = new Map();
      for (let c = 0; c < 9; c++) {
        const v = board[r][c];
        if (!v) continue;
        const key = v;
        if (map.has(key)) {
          valid = false;
          mask[r][c] = true;
          for (const col of map.get(key)) mask[r][col] = true;
          map.get(key).push(c);
        } else {
          map.set(key, [c]);
        }
      }
    }
    // Columns
    for (let c = 0; c < 9; c++) {
      const map = new Map();
      for (let r = 0; r < 9; r++) {
        const v = board[r][c];
        if (!v) continue;
        const key = v;
        if (map.has(key)) {
          valid = false;
          mask[r][c] = true;
          for (const row of map.get(key)) mask[row][c] = true;
          map.get(key).push(r);
        } else {
          map.set(key, [r]);
        }
      }
    }
    // 3x3 boxes
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const map = new Map();
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const rr = br * 3 + r;
            const cc = bc * 3 + c;
            const v = board[rr][cc];
            if (!v) continue;
            if (map.has(v)) {
              valid = false;
              mask[rr][cc] = true;
              for (const [pr, pc] of map.get(v)) mask[pr][pc] = true;
              map.get(v).push([rr, cc]);
            } else {
              map.set(v, [[rr, cc]]);
            }
          }
        }
      }
    }
    return { valid, mask };
  }

  function runValidation() {
    const board = getBoard();
    const { valid, mask } = validateBoard(board);
    applyValidation(mask);
    if (!valid) setStatus('Conflicts found. Fix highlighted cells.', 'error');
    else setStatus('');
    return valid;
  }

  function setBoard(board, fixedMask, options) {
    const preserveAnnotations = options && options.preserveAnnotations;
    const inputs = $board.find('input');
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        const val = board[r][c] || '';
        const $inp = $(inputs[idx]);
        $inp.val(val ? String(val) : '');
        toggleHasValue($inp.closest('.cell'), val);
        const fixed = fixedMask ? fixedMask[r][c] : false;
        $inp.prop('disabled', !!fixed);
        $inp.closest('.cell').toggleClass('fixed', !!fixed);
      }
    }
    applyValidation(null);
    // By default, clear annotations whenever board is set unless preserving
    if (!preserveAnnotations) {
      clearAllAnnotations();
    }
    renderAllNotes();
    updateReadonlyForMobile();
  }

  function clearBoard() {
    const inputs = $board.find('input');
    inputs.each(function () {
      $(this).val('').prop('disabled', false).closest('.cell').removeClass('fixed').removeClass('has-value');
    });
    setStatus('');
    applyValidation(null);
    cancelShuffle();
    clearAllAnnotations();
    renderAllNotes();
    clearSavedState();
  }

  function setStatus(msg, type = 'info') {
    $status.text(msg);
    $status.removeClass('error ok');
    if (type === 'error') $status.addClass('error');
    if (type === 'ok') $status.addClass('ok');
  }

  async function generate() {
    stopCelebration();
    setStatus('Generating…');
    cancelShuffle();
    pushHistory();
    const difficulty = $('#difficulty').val();
    try {
      const res = await fetch(`/api/generate?difficulty=${encodeURIComponent(difficulty)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate');
      const puzzle = data.puzzle;
      const fixed = puzzle.map(row => row.map(v => v !== 0));
      await shuffleIn(puzzle, fixed, 850);
      setStatus('Puzzle generated', 'ok');
      saveState();
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  async function solve() {
    if (!runValidation()) return; // Block solving if invalid
    setStatus('Solving…');
    const board = getBoard();
    try {
      pushHistory();
      const res = await fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board })
      });
      const data = await res.json();
      if (res.status === 422) {
        setStatus('This puzzle cannot be solved from the current entries. Try Undo or adjust your numbers.', 'error');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Failed to solve');
      setBoard(data.solution);
      setStatus('Solved!', 'ok');
      celebrateSolved();
      clearAllAnnotations();
      renderAllNotes();
      saveState();
    } catch (e) {
      setStatus(e.message, 'error');
    }
  }

  function cancelShuffle() {
    if (shuffleInterval) { clearInterval(shuffleInterval); shuffleInterval = null; }
    if (shuffleTimeout) { clearTimeout(shuffleTimeout); shuffleTimeout = null; }
  }

  async function shuffleIn(puzzle, fixedMask, duration = 800) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setBoard(puzzle, fixedMask);
      return;
    }
    const inputs = $board.find('input');
    // Temporarily enable all during shuffle for visuals
    inputs.prop('disabled', true);
    const start = Date.now();
    const randomDigit = () => String(1 + Math.floor(Math.random() * 9));
    isShuffling = true;
    shuffleInterval = setInterval(() => {
      for (let i = 0; i < 81; i++) {
        const $inp = $(inputs[i]);
        // Cycle numbers even for blanks
        $inp.val(randomDigit());
      }
    }, 50);
    await new Promise((resolve) => {
      shuffleTimeout = setTimeout(() => {
        cancelShuffle();
        resolve();
      }, Math.max(200, duration - (Date.now() - start)));
    });
    setBoard(puzzle, fixedMask);
    isShuffling = false;
  }

  // ---- Keypad logic ----
  function updateReadonlyForMobile(){
    const inputs = $board.find('input');
    if (isTouchDevice) {
      inputs.attr('readonly', 'readonly');
    } else {
      inputs.removeAttr('readonly');
    }
  }

  function getRCFromIndex(idx){
    const r = Math.floor(idx / 9);
    const c = idx % 9;
    return [r,c];
  }

  function setCellValueAt(idx, value){
    if (isShuffling) return;
    const inputs = $board.find('input');
    const $inp = $(inputs.get(idx));
    if (!$inp.length) return;
    if ($inp.prop('disabled')) return; // fixed cell
    pushHistory();
    const v = (value && /^[1-9]$/.test(String(value))) ? String(value) : '';
    $inp.val(v);
    toggleHasValue($inp.closest('.cell'), v);
    runValidation();
    saveStateDebounced();
  }

  function clearCellAt(idx){
    const inputs = $board.find('input');
    const $inp = $(inputs.get(idx));
    if (!$inp.length || $inp.prop('disabled')) return;
    pushHistory();
    $inp.val('');
    toggleHasValue($inp.closest('.cell'), false);
    runValidation();
    saveStateDebounced();
  }

  // Bind keypad buttons
  $keypad.on('click', '.kp-num', function(){
    focusCurrent();
    const num = $(this).data('num');
    const [r,c] = getRCFromIndex(currentIndex);
    const cells = $board.find('.cell');
    const $cell = $(cells.get(currentIndex));
    if (notesEnabled){
      const inputs = $board.find('input');
      const $inp = $(inputs.get(currentIndex));
      if ($inp.prop('disabled')) return; // ignore fixed
      pushHistory();
      toggleAnnotation(r,c, Number(num));
      renderCellNotes(r,c,$cell);
      saveStateDebounced();
      return;
    }
    setCellValueAt(currentIndex, String(num));
  });

  $keypad.on('click', '.kp-erase', function(){
    focusCurrent();
    const [r,c] = getRCFromIndex(currentIndex);
    const cells = $board.find('.cell');
    const $cell = $(cells.get(currentIndex));
    if (notesEnabled){
      const inputs = $board.find('input');
      const $inp = $(inputs.get(currentIndex));
      if ($inp.prop('disabled')) return;
      pushHistory();
      clearCellAnnotations(r,c);
      renderCellNotes(r,c,$cell);
      saveStateDebounced();
      return;
    }
    clearCellAt(currentIndex);
  });

  // Backspace button removed per requirements; erase covers clearing behavior

  // Events
  $('#btn-generate').on('click', generate);
  $('#btn-notes').on('click', function(){
    notesEnabled = !notesEnabled;
    $(this).attr('aria-pressed', String(notesEnabled));
    if (notesEnabled) setStatus('Notes on: type 1–9 to add/remove pencil marks. Del clears cell notes.');
    else setStatus('');
    saveState();
  });
  $('#btn-solve').on('click', solve);
  $('#btn-clear').on('click', function(){ pushHistory(); stopCelebration(); clearBoard(); updateUndoButton(); });
  $undoBtn.on('click', function(){ undoLast(); });
  $('#difficulty').on('change', function(){ saveState(); });

  // Init
  buildBoard();
  renderAllNotes();
  updateUndoButton();
  // Try to restore saved game from storage on load
  tryRestoreFromStorage();
  // If restored state didn't focus any cell, focus first cell for keypad usability on touch
  setTimeout(() => { focusIndex(currentIndex); }, 0);

  // ---- History (Undo) ----
  function deepCopyAnnotations(src){
    return src.map(row => row.map(set => new Set(Array.from(set))));
  }

  function getFixedMask(){
    const inputs = $board.find('input');
    const mask = Array.from({length:9}, () => Array(9).fill(false));
    for (let r=0;r<9;r++){
      for (let c=0;c<9;c++){
        const idx = r*9 + c;
        const $inp = $(inputs[idx]);
        mask[r][c] = $inp.prop('disabled') || $inp.closest('.cell').hasClass('fixed');
      }
    }
    return mask;
  }

  function snapshot(){
    return {
      board: getBoard().map(row => row.slice()),
      fixedMask: getFixedMask(),
      annotations: deepCopyAnnotations(annotations)
    };
  }

  function pushHistory(){
    const snap = snapshot();
    history.push(snap);
    if (history.length > MAX_HISTORY) history.shift();
    updateUndoButton();
    // Persist history along with current state
    saveStateDebounced();
  }

  function undoLast(){
    cancelShuffle();
    stopCelebration();
    if (!history.length) return;
    const snap = history.pop();
    // Restore board and fixed, preserving annotations clearing
    const ann = snap.annotations; // keep reference
    setBoard(snap.board, snap.fixedMask, { preserveAnnotations: true });
    annotations = deepCopyAnnotations(ann);
    renderAllNotes();
    runValidation();
    setStatus('Undid last action');
    updateUndoButton();
    saveState();
  }

  function updateUndoButton(){
    const has = history.length > 0;
    $undoBtn.prop('disabled', !has);
  }
});
