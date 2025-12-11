// Sudoku core: solver and puzzle generator

function findEmpty(board) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (!board[r][c]) return [r, c];
    }
  }
  return null;
}

function isSafe(board, row, col, val) {
  const v = val;
  for (let i = 0; i < 9; i++) {
    if (board[row][i] === v) return false;
    if (board[i][col] === v) return false;
  }
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (board[br + r][bc + c] === v) return false;
    }
  }
  return true;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function solve(board) {
  const spot = findEmpty(board);
  if (!spot) return true;
  const [r, c] = spot;
  const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let n of nums) {
    if (isSafe(board, r, c, n)) {
      board[r][c] = n;
      if (solve(board)) return true;
      board[r][c] = 0;
    }
  }
  return false;
}

function countSolutions(board, limit = 2) {
  // Backtracking count up to limit
  let count = 0;
  function backtrack() {
    if (count >= limit) return; // early stop
    const spot = findEmpty(board);
    if (!spot) {
      count++;
      return;
    }
    const [r, c] = spot;
    for (let n = 1; n <= 9; n++) {
      if (isSafe(board, r, c, n)) {
        board[r][c] = n;
        backtrack();
        board[r][c] = 0;
        if (count >= limit) return;
      }
    }
  }
  backtrack();
  return count;
}

function cloneBoard(b) {
  return b.map(row => row.slice());
}

function generateFullSolution() {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  const rows = [...Array(9).keys()];
  const cols = [...Array(9).keys()];
  shuffle(rows);
  shuffle(cols);
  // Fill diagonal 3x3 boxes first to speed up
  for (let box = 0; box < 3; box++) {
    const start = box * 3;
    const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    let idx = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        board[start + r][start + c] = nums[idx++];
      }
    }
  }
  solve(board);
  return board;
}

function difficultyToRemovals(difficulty) {
  switch ((difficulty || 'medium').toLowerCase()) {
    case 'easy':
      return [38, 46]; // clues 43-51
    case 'medium':
      return [46, 52]; // clues 29-35
    case 'hard':
      return [52, 58]; // clues 23-29
    case 'expert':
      return [58, 64]; // clues 17-23
    default:
      return [46, 52];
  }
}

function generate(difficulty = 'medium') {
  const solution = generateFullSolution();
  const puzzle = cloneBoard(solution);
  // Determine number of cells to remove, ensure uniqueness while removing
  const [minRem, maxRem] = difficultyToRemovals(difficulty);
  const toRemove = Math.floor(minRem + Math.random() * (maxRem - minRem + 1));

  const positions = shuffle(Array.from({ length: 81 }, (_, i) => i));
  let removed = 0;
  for (let i = 0; i < positions.length && removed < toRemove; i++) {
    const pos = positions[i];
    const r = Math.floor(pos / 9);
    const c = pos % 9;
    if (puzzle[r][c] === 0) continue;
    const backup = puzzle[r][c];
    puzzle[r][c] = 0;

    // Check uniqueness
    const test = cloneBoard(puzzle);
    const solCount = countSolutions(test, 2);
    if (solCount !== 1) {
      puzzle[r][c] = backup; // revert
    } else {
      removed++;
    }
  }
  return puzzle;
}

module.exports = { solve, generate };
