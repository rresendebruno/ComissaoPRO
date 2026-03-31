const router = require('express').Router();
const { query } = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

// GET all postos
router.get('/', auth, async (req, res) => {
  const { rows } = await query(`SELECT * FROM postos ORDER BY codigo`);
  res.json(rows);
});

router.get('/:id', auth, async (req, res) => {
  const { rows } = await query(`SELECT * FROM postos WHERE id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Posto não encontrado' });
  res.json(rows[0]);
});

router.post('/', auth, adminOnly, async (req, res) => {
  const { codigo, nome } = req.body;
  if (!codigo || !nome) return res.status(400).json({ error: 'Código e nome são obrigatórios' });
  const { rows } = await query(
    'INSERT INTO postos (codigo, nome) VALUES ($1,$2) RETURNING *',
    [codigo.toUpperCase().trim(), nome.trim()]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  const { codigo, nome, ativo } = req.body;
  const { rows } = await query(
    `UPDATE postos SET
       codigo = COALESCE($1, codigo),
       nome   = COALESCE($2, nome),
       ativo  = COALESCE($3, ativo)
     WHERE id=$4 RETURNING *`,
    [codigo?.toUpperCase().trim(), nome?.trim(), ativo, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Posto não encontrado' });
  res.json(rows[0]);
});

router.delete('/:id', auth, adminOnly, async (req, res) => {
  await query('DELETE FROM postos WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// Produtos especiais do posto (permanecem no posto, não no período)
router.get('/:id/produtos-especiais', auth, async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM produtos_especiais WHERE posto_id=$1 ORDER BY nome_produto',
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/produtos-especiais', auth, adminOnly, async (req, res) => {
  const { nome_produto, comissao_frentista, comissao_trocador, comissao_gerente } = req.body;
  if (!nome_produto) return res.status(400).json({ error: 'Nome do produto obrigatório' });
  const { rows } = await query(
    `INSERT INTO produtos_especiais (posto_id, nome_produto, comissao_frentista, comissao_trocador, comissao_gerente)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (posto_id, nome_produto) DO UPDATE
       SET comissao_frentista=$3, comissao_trocador=$4, comissao_gerente=$5, ativo=true
     RETURNING *`,
    [req.params.id, nome_produto.trim(), comissao_frentista || 0, comissao_trocador || 0, comissao_gerente || 0]
  );
  res.status(201).json(rows[0]);
});

router.put('/:postoId/produtos-especiais/:id', auth, adminOnly, async (req, res) => {
  const { nome_produto, comissao_frentista, comissao_trocador, comissao_gerente, ativo } = req.body;
  const { rows } = await query(
    `UPDATE produtos_especiais SET
       nome_produto       = COALESCE($1, nome_produto),
       comissao_frentista = COALESCE($2, comissao_frentista),
       comissao_trocador  = COALESCE($3, comissao_trocador),
       comissao_gerente   = COALESCE($4, comissao_gerente),
       ativo              = COALESCE($5, ativo)
     WHERE id=$6 AND posto_id=$7 RETURNING *`,
    [nome_produto?.trim(), comissao_frentista, comissao_trocador, comissao_gerente, ativo, req.params.id, req.params.postoId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado' });
  res.json(rows[0]);
});

router.delete('/:postoId/produtos-especiais/:id', auth, adminOnly, async (req, res) => {
  await query('DELETE FROM produtos_especiais WHERE id=$1 AND posto_id=$2', [req.params.id, req.params.postoId]);
  res.json({ success: true });
});

module.exports = router;
