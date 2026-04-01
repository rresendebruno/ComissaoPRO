const router = require('express').Router();
const axios  = require('axios');
const XLSX   = require('xlsx');
const { query }  = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { calcularComissoes } = require('../comissoes');

// ── PERÍODOS ──────────────────────────────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  const { rows } = await query('SELECT * FROM periodos ORDER BY data_inicio DESC');
  res.json(rows);
});

router.get('/:id', auth, async (req, res) => {
  const { rows } = await query('SELECT * FROM periodos WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Período não encontrado' });
  res.json(rows[0]);
});

router.post('/', auth, adminOnly, async (req, res) => {
  const { nome, data_inicio, data_fim, sheets_url } = req.body;
  if (!nome || !data_inicio || !data_fim)
    return res.status(400).json({ error: 'nome, data_inicio e data_fim são obrigatórios' });
  const { rows } = await query(
    'INSERT INTO periodos (nome, data_inicio, data_fim, sheets_url) VALUES ($1,$2,$3,$4) RETURNING *',
    [nome, data_inicio, data_fim, sheets_url || null]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', auth, adminOnly, async (req, res) => {
  const { nome, data_inicio, data_fim, sheets_url, status } = req.body;
  const { rows } = await query(
    `UPDATE periodos SET
       nome        = COALESCE($1, nome),
       data_inicio = COALESCE($2, data_inicio),
       data_fim    = COALESCE($3, data_fim),
       sheets_url  = COALESCE($4, sheets_url),
       status      = COALESCE($5, status)
     WHERE id=$6 RETURNING *`,
    [nome, data_inicio, data_fim, sheets_url, status, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Período não encontrado' });
  res.json(rows[0]);
});

// ── DELETE PERÍODO ────────────────────────────────────────────────────────────

router.delete('/:id', auth, adminOnly, async (req, res) => {
  const { rows } = await query('SELECT id FROM periodos WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Período não encontrado' });
  await query('DELETE FROM periodos WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── GERENTES & TROCADORES DO PERÍODO ─────────────────────────────────────────

router.get('/:id/funcionarios', auth, async (req, res) => {
  const { rows } = await query(
    `SELECT pf.*, p.codigo, p.nome as posto_nome
     FROM periodo_funcionarios pf
     JOIN postos p ON p.id = pf.posto_id
     WHERE pf.periodo_id = $1
     ORDER BY p.codigo, pf.tipo, pf.nome`,
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/funcionarios', auth, adminOnly, async (req, res) => {
  const { posto_id, nome, tipo } = req.body;
  if (!posto_id || !nome || !tipo)
    return res.status(400).json({ error: 'posto_id, nome e tipo são obrigatórios' });
  if (!['gerente','trocador'].includes(tipo))
    return res.status(400).json({ error: 'tipo deve ser gerente ou trocador' });

  // Verifica se já existe este par (período, posto, nome, tipo) — sem ON CONFLICT que sobrescreveria
  const { rows: existe } = await query(
    `SELECT id FROM periodo_funcionarios
     WHERE periodo_id=$1 AND posto_id=$2 AND LOWER(TRIM(nome))=LOWER(TRIM($3)) AND tipo=$4`,
    [req.params.id, posto_id, nome.trim(), tipo]
  );
  if (existe.length > 0) {
    const { rows: existing } = await query(
      `SELECT pf.*, p.codigo FROM periodo_funcionarios pf
       JOIN postos p ON p.id=pf.posto_id WHERE pf.id=$1`,
      [existe[0].id]
    );
    return res.status(201).json(existing[0]);
  }

  const { rows } = await query(
    `INSERT INTO periodo_funcionarios (periodo_id, posto_id, nome, tipo)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, posto_id, nome.trim(), tipo]
  );
  res.status(201).json(rows[0]);
});

router.put('/:periodoId/funcionarios/:id', auth, adminOnly, async (req, res) => {
  const { nome, tipo } = req.body;
  const { rows } = await query(
    `UPDATE periodo_funcionarios SET
       nome = COALESCE($1, nome),
       tipo = COALESCE($2, tipo)
     WHERE id=$3 AND periodo_id=$4 RETURNING *`,
    [nome?.trim(), tipo, req.params.id, req.params.periodoId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Funcionário não encontrado' });
  res.json(rows[0]);
});

router.delete('/:periodoId/funcionarios/:id', auth, adminOnly, async (req, res) => {
  await query(
    'DELETE FROM periodo_funcionarios WHERE id=$1 AND periodo_id=$2',
    [req.params.id, req.params.periodoId]
  );
  res.json({ success: true });
});

// ── METAS ─────────────────────────────────────────────────────────────────────

router.get('/:id/metas', auth, async (req, res) => {
  const { rows } = await query(
    `SELECT m.*, p.codigo, p.nome as posto_nome
     FROM metas m JOIN postos p ON p.id = m.posto_id
     WHERE m.periodo_id=$1 ORDER BY p.codigo`,
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/metas', auth, adminOnly, async (req, res) => {
  const { posto_id, meta_frentista, meta_trocador, meta_posto } = req.body;
  if (!posto_id) return res.status(400).json({ error: 'posto_id obrigatório' });
  const { rows } = await query(
    `INSERT INTO metas (periodo_id, posto_id, meta_frentista, meta_trocador, meta_posto)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (posto_id, periodo_id) DO UPDATE
       SET meta_frentista=$3, meta_trocador=$4, meta_posto=$5
     RETURNING *`,
    [req.params.id, posto_id, meta_frentista || 0, meta_trocador || 0, meta_posto || 0]
  );
  res.json(rows[0]);
});

// ── IMPORTAR PLANILHA ─────────────────────────────────────────────────────────

router.post('/:id/importar', auth, adminOnly, async (req, res) => {
  const periodoId = req.params.id;
  const { sheets_url } = req.body;

  const { rows: pRows } = await query('SELECT * FROM periodos WHERE id=$1', [periodoId]);
  if (!pRows.length) return res.status(404).json({ error: 'Período não encontrado' });

  const url = sheets_url || pRows[0].sheets_url;
  if (!url) return res.status(400).json({ error: 'URL do Google Sheets não informada' });

  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return res.status(400).json({ error: 'URL inválida. Use a URL de compartilhamento do Google Sheets.' });

  const sheetId  = match[1];
  const gidMatch = url.match(/gid=(\d+)/);
  const gid      = gidMatch ? gidMatch[1] : '0';
  const csvUrl   = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  let rows_data;
  try {
    const resp = await axios.get(csvUrl, { responseType: 'arraybuffer', timeout: 30000 });
    const wb   = XLSX.read(resp.data, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    rows_data  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  } catch {
    return res.status(400).json({ error: 'Não foi possível acessar a planilha. Verifique se está pública e a URL está correta.' });
  }

  if (!rows_data || rows_data.length < 2)
    return res.status(400).json({ error: 'Planilha vazia ou sem dados' });

  const { rows: postos }  = await query('SELECT * FROM postos WHERE ativo=true');
  const { rows: funcsEsp } = await query(
    'SELECT * FROM periodo_funcionarios WHERE periodo_id=$1', [periodoId]
  );

  const postoIdx = {};
  for (const p of postos) postoIdx[p.codigo.toLowerCase()] = p;

  // Se a pessoa tem cadastro como gerente E trocador, nas vendas ela entra como 'gerente'
  // O motor de cálculo detecta automaticamente a acumulação via trocadores[]
  const funcEspIdx = {};
  for (const f of funcsEsp) {
    const k = `${f.posto_id}|${f.nome.trim().toLowerCase()}`;
    if (!funcEspIdx[k] || f.tipo === 'gerente') {
      funcEspIdx[k] = f.tipo;
    }
  }

  const vendas = [];
  let erros = 0;

  for (let i = 1; i < rows_data.length; i++) {
    const row = rows_data[i];
    if (!row || row.every(c => c === '' || c == null)) continue;

    const [colA, colB, colC, colD, colE, colF, colG, colH, colI] = row;

    const codigoLimpo = String(colA || '').trim().split(/[\s-]/)[0].toLowerCase();
    const posto = postoIdx[codigoLimpo];
    if (!posto) { erros++; continue; }

    const nomeFuncionario = String(colB || '').trim();
    if (!nomeFuncionario) { erros++; continue; }

    const produto        = String(colC || '').trim();
    const quantidade     = parseFloat(String(colD).replace(',', '.')) || 0;
    const valor_unitario = parseFloat(String(colE).replace(',', '.')) || 0;
    const valor_bruto    = parseFloat(String(colF).replace(',', '.')) || 0;
    const valor_desconto = parseFloat(String(colG).replace(',', '.')) || 0;
    const valor_acrescimo= parseFloat(String(colH).replace(',', '.')) || 0;
    const valor_final    = parseFloat(String(colI).replace(',', '.')) || 0;

    const funcKey = `${posto.id}|${nomeFuncionario.toLowerCase()}`;
    const tipo    = funcEspIdx[funcKey] || 'frentista';

    vendas.push([periodoId, posto.id, nomeFuncionario, tipo, produto,
                 quantidade, valor_unitario, valor_bruto, valor_desconto, valor_acrescimo, valor_final]);
  }

  if (!vendas.length)
    return res.status(400).json({ error: 'Nenhuma venda válida.' });

  await query('DELETE FROM vendas WHERE periodo_id=$1', [periodoId]);

  const BATCH = 200;
  for (let i = 0; i < vendas.length; i += BATCH) {
    const batch = vendas.slice(i, i + BATCH);
    const vals  = batch.map((_, j) => {
      const b = j * 11;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`;
    }).join(',');
    await query(
      `INSERT INTO vendas (periodo_id,posto_id,funcionario,tipo_funcionario,produto,
        quantidade,valor_unitario,valor_bruto,valor_desconto,valor_acrescimo,valor_final)
       VALUES ${vals}`,
      batch.flat()
    );
  }

  if (sheets_url) await query('UPDATE periodos SET sheets_url=$1 WHERE id=$2', [sheets_url, periodoId]);

  res.json({
    success: true,
    imported: vendas.length,
    skipped: erros,
    message: `${vendas.length} vendas importadas com sucesso${erros > 0 ? `. ${erros} linhas ignoradas` : ''}`
  });
});

// ── COMISSÕES CALCULADAS ───────────────────────────────────────────────────────

router.get('/:id/comissoes', auth, async (req, res) => {
  const { posto_id } = req.query;
  const filtro  = posto_id ? 'AND v.posto_id=$2' : '';
  const params  = posto_id ? [req.params.id, posto_id] : [req.params.id];

  const [
    { rows: vendas },
    { rows: metas },
    { rows: produtosEspeciais },
    { rows: periodoFuncionarios },
    { rows: periodo },
  ] = await Promise.all([
    query(`SELECT v.*, p.codigo as posto_codigo, p.nome as posto_nome
           FROM vendas v JOIN postos p ON p.id=v.posto_id
           WHERE v.periodo_id=$1 ${filtro}
           ORDER BY p.codigo, v.funcionario`, params),
    query(`SELECT m.*, p.codigo, p.nome as posto_nome
           FROM metas m JOIN postos p ON p.id=m.posto_id
           WHERE m.periodo_id=$1`, [req.params.id]),
    query('SELECT * FROM produtos_especiais WHERE ativo=true'),
    query(`SELECT pf.*, p.codigo FROM periodo_funcionarios pf
           JOIN postos p ON p.id=pf.posto_id
           WHERE pf.periodo_id=$1`, [req.params.id]),
    query('SELECT * FROM periodos WHERE id=$1', [req.params.id]),
  ]);

  if (!periodo.length) return res.status(404).json({ error: 'Período não encontrado' });

  const comissoes = calcularComissoes(vendas, metas, produtosEspeciais, periodoFuncionarios, periodo[0]);

  const metasMap = {};
  for (const m of metas) metasMap[m.posto_id] = m;

  res.json({
    periodo: periodo[0],
    comissoes,
    metas: metasMap,
    totalVendas: vendas.length,
  });
});

// ── VENDAS PAGINADAS ──────────────────────────────────────────────────────────

router.get('/:id/vendas', auth, async (req, res) => {
  const { posto_id, funcionario, page = 1, limit = 50 } = req.query;
  const conditions = ['v.periodo_id=$1'];
  const params     = [req.params.id];
  let i = 2;
  if (posto_id)    { conditions.push(`v.posto_id=$${i++}`);           params.push(posto_id); }
  if (funcionario) { conditions.push(`v.funcionario ILIKE $${i++}`);  params.push(`%${funcionario}%`); }

  const limitVal = Math.min(Math.max(parseInt(limit) || 50, 1), 10000);
  const where  = conditions.join(' AND ');
  const { rows: total } = await query(`SELECT COUNT(*) FROM vendas v WHERE ${where}`, params);
  const offset = (parseInt(page) - 1) * limitVal;
  const { rows } = await query(
    `SELECT v.*, p.codigo as posto_codigo
     FROM vendas v JOIN postos p ON p.id=v.posto_id
     WHERE ${where}
     ORDER BY p.codigo, v.funcionario
     LIMIT $${i} OFFSET $${i+1}`,
    [...params, limitVal, offset]
  );
  res.json({ data: rows, total: parseInt(total[0].count), page: parseInt(page), limit: limitVal });
});

// ── TODOS OS FUNCIONÁRIOS DO PERÍODO ─────────────────────────────────────────

router.get('/:id/todos-funcionarios', auth, async (req, res) => {
  const periodoId = req.params.id;

  const { rows: vendasFuncs } = await query(
    `SELECT DISTINCT v.funcionario as nome, v.tipo_funcionario as tipo,
            p.codigo as posto_codigo, v.posto_id
     FROM vendas v
     JOIN postos p ON p.id = v.posto_id
     WHERE v.periodo_id = $1`,
    [periodoId]
  );

  const { rows: cadastrados } = await query(
    `SELECT pf.nome, pf.tipo, p.codigo as posto_codigo, pf.posto_id
     FROM periodo_funcionarios pf
     JOIN postos p ON p.id = pf.posto_id
     WHERE pf.periodo_id = $1`,
    [periodoId]
  );

  const seen = new Set();
  const todos = [];

  for (const f of [...vendasFuncs, ...cadastrados]) {
    const key = `${f.posto_codigo}|${f.nome.trim().toLowerCase()}|${f.tipo}`;
    if (!seen.has(key)) {
      seen.add(key);
      todos.push({ nome: f.nome.trim(), tipo: f.tipo, posto_codigo: f.posto_codigo, posto_id: Number(f.posto_id) });
    }
  }

  todos.sort((a, b) => a.posto_codigo.localeCompare(b.posto_codigo) || a.nome.localeCompare(b.nome));
  res.json(todos);
});

module.exports = router;
