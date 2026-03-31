const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuário e senha obrigatórios' });

  const { rows } = await query('SELECT * FROM users WHERE username = $1 AND ativo = true', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });

  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

router.get('/me', auth, (req, res) => res.json(req.user));

// User management (admin only)
router.get('/users', auth, adminOnly, async (req, res) => {
  const { rows } = await query('SELECT id, username, name, role, ativo, created_at FROM users ORDER BY id');
  res.json(rows);
});

router.post('/users', auth, adminOnly, async (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name || !role) return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  const hash = bcrypt.hashSync(password, 10);
  const { rows } = await query(
    'INSERT INTO users (username, password_hash, name, role) VALUES ($1,$2,$3,$4) RETURNING id, username, name, role, ativo',
    [username, hash, name, role]
  );
  res.status(201).json(rows[0]);
});

router.put('/users/:id', auth, adminOnly, async (req, res) => {
  const { name, role, ativo, password } = req.body;
  const fields = [], vals = [];
  let i = 1;
  if (name) { fields.push(`name=$${i++}`); vals.push(name); }
  if (role) { fields.push(`role=$${i++}`); vals.push(role); }
  if (ativo !== undefined) { fields.push(`ativo=$${i++}`); vals.push(ativo); }
  if (password) { fields.push(`password_hash=$${i++}`); vals.push(bcrypt.hashSync(password, 10)); }
  if (!fields.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
  vals.push(req.params.id);
  const { rows } = await query(`UPDATE users SET ${fields.join(',')} WHERE id=$${i} RETURNING id, username, name, role, ativo`, vals);
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(rows[0]);
});

router.delete('/users/:id', auth, adminOnly, async (req, res) => {
  const { rows } = await query('SELECT username FROM users WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (rows[0].username === 'admin') return res.status(400).json({ error: 'Não é possível remover o admin principal' });
  await query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
