const router = require('express').Router();
const { query } = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const { rows } = await query('SELECT * FROM itens_ignorados ORDER BY tipo, nome');
  res.json(rows);
});

router.post('/', auth, adminOnly, async (req, res) => {
  const { tipo, nome } = req.body;
  if (!tipo || !nome) return res.status(400).json({ error: 'tipo e nome são obrigatórios' });
  if (!['produto', 'funcionario'].includes(tipo))
    return res.status(400).json({ error: 'tipo deve ser produto ou funcionario' });
  try {
    const { rows } = await query(
      'INSERT INTO itens_ignorados (tipo, nome) VALUES ($1, $2) RETURNING *',
      [tipo, nome.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Já existe na lista' });
    throw e;
  }
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  await query('DELETE FROM itens_ignorados WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
