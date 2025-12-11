const express = require('express');
const path = require('path');
const sudoku = require('./src/sudoku');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/generate', (req, res) => {
  const { difficulty = 'medium' } = req.query;
  try {
    const puzzle = sudoku.generate(String(difficulty));
    res.json({ puzzle });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to generate puzzle' });
  }
});

app.post('/api/solve', (req, res) => {
  const { board } = req.body || {};
  if (!Array.isArray(board) || board.length !== 9 || !board.every(r => Array.isArray(r) && r.length === 9)) {
    return res.status(400).json({ error: 'Invalid board format' });
  }
  try {
    const copy = board.map(row => row.map(n => Number(n) || 0));
    const solved = sudoku.solve(copy);
    if (!solved) {
      return res.status(422).json({ error: 'Unsolvable puzzle' });
    }
    res.json({ solution: copy });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to solve puzzle' });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Sudoku app listening on http://localhost:${PORT}`);
});
