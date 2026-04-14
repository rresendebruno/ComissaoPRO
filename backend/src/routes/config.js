/**
 * Rota de configurações do sistema — salva no banco, vale para todos os usuários.
 * GET  /api/config        → retorna { nome, logo }
 * PUT  /api/config        → salva { nome, logo } (admin only)
 */

const router = require('express').Router();
const { query } = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

// Garante que a tabela existe (migração inline tolerante)
async function ensureConfigTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS system_config (
      key   VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

router.get('/', async (req, res) => {
  await ensureConfigTable();
  const { rows } = await query('SELECT key, value FROM system_config WHERE key IN ($1,$2)', ['nome', 'logo']);
  const config = { nome: 'ComissõesPRO', logo: null };
  for (const row of rows) {
    if (row.key === 'nome') config.nome = row.value;
    if (row.key === 'logo') config.logo = row.value;
  }
  res.json(config);
});

router.put('/', auth, adminOnly, async (req, res) => {
  await ensureConfigTable();
  const { nome, logo } = req.body;

  if (nome !== undefined) {
    await query(`
      INSERT INTO system_config (key, value, updated_at) VALUES ('nome', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
    `, [nome || 'ComissõesPRO']);
  }

  if (logo !== undefined) {
    if (logo === null) {
      await query('DELETE FROM system_config WHERE key=$1', ['logo']);
    } else {
      await query(`
        INSERT INTO system_config (key, value, updated_at) VALUES ('logo', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()
      `, [logo]);
    }
  }

  // Retorna config atualizada
  const { rows } = await query('SELECT key, value FROM system_config WHERE key IN ($1,$2)', ['nome', 'logo']);
  const config = { nome: 'ComissõesPRO', logo: null };
  for (const row of rows) {
    if (row.key === 'nome') config.nome = row.value;
    if (row.key === 'logo') config.logo = row.value;
  }
  res.json(config);
});

module.exports = router;
