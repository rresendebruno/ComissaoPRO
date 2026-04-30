const router = require('express').Router();
const axios  = require('axios');
const XLSX   = require('xlsx');
const { query }  = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { calcularComissoes } = require('../comissoes');

// ── Parse numérico robusto ────────────────────────────────────────────────────
function parseVal(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  var s = String(v).trim().replace(/[R$\s]/g, '');
  if (!s) return 0;

  var temPonto   = s.includes('.');
  var temVirgula = s.includes(',');

  if (temVirgula && temPonto) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (temVirgula) {
    s = s.replace(',', '.');
  } else if (temPonto) {
    var partes = s.split('.');
    if (partes.length === 2 && partes[1].length === 3) {
      s = s.replace('.', '');
    }
  }

  return parseFloat(s) || 0;
}

// ── Helper: formata moeda BRL ─────────────────────────────────────────────────
function fmtBRL(v) {
  if (v == null) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(v) || 0);
}

// ── Helper: envia texto via Evolution API ─────────────────────────────────────
function parseEvoConfig() {
  const EVOURL  = process.env.EVOURL;
  const API_KEY = process.env.API_KEY;

  if (!EVOURL || !API_KEY) return null; // sem config → silencia, não lança erro

  const sendMatch = EVOURL.match(/\/message\/send\w+\/([^/?#]+)/);
  let instanceName, baseUrl;

  if (sendMatch) {
    instanceName = sendMatch[1];
    baseUrl = EVOURL.replace(/\/message\/send\w+\/[^/?#]+.*$/, '');
  } else {
    const clean = EVOURL.replace(/\/$/, '');
    const parts = clean.split('/');
    const last  = parts[parts.length - 1];
    if (last && !['api', 'v1', 'v2'].includes(last.toLowerCase())) {
      instanceName = last;
      baseUrl = parts.slice(0, -1).join('/');
    } else {
      return null;
    }
  }

  if (!instanceName) return null;
  return { baseUrl, instanceName, apiKey: API_KEY };
}

async function enviarTextoWpp(groupId, texto) {
  const cfg = parseEvoConfig();
  if (!cfg) return; // Evolution API não configurada → ignora silenciosamente

  const url     = `${cfg.baseUrl}/message/sendText/${cfg.instanceName}`;
  const payload = { number: groupId, text: texto };

  try {
    await axios.post(url, payload, {
      headers: { apikey: cfg.apiKey, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    console.log(`[WhatsApp] Notificação de meta enviada para ${groupId}`);
  } catch (e) {
    // Falha no envio não deve quebrar a requisição principal
    console.error(`[WhatsApp] Falha ao enviar notificação para ${groupId}:`, e.message);
  }
}

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

// ── POST /periodos/:id/metas — salva/atualiza meta e notifica WhatsApp ────────
router.post('/:id/metas', auth, adminOnly, async (req, res) => {
  const { posto_id, meta_frentista, meta_trocador, meta_posto } = req.body;
  if (!posto_id) return res.status(400).json({ error: 'posto_id obrigatório' });

  const novoF = Number(meta_frentista) || 0;
  const novoT = Number(meta_trocador)  || 0;
  const novoP = Number(meta_posto)     || 0;

  // ── 1. Captura valores anteriores (se a meta já existia) ──────────────────
  const { rows: anterior } = await query(
    `SELECT m.*, p.codigo as posto_codigo, p.nome as posto_nome, p.whatsapp_group_id,
            per.nome as periodo_nome
     FROM metas m
     JOIN postos p ON p.id = m.posto_id
     JOIN periodos per ON per.id = m.periodo_id
     WHERE m.posto_id=$1 AND m.periodo_id=$2`,
    [posto_id, req.params.id]
  );

  const isEdicao = anterior.length > 0;

  // ── 2. Upsert da meta ─────────────────────────────────────────────────────
  const { rows } = await query(
    `INSERT INTO metas (periodo_id, posto_id, meta_frentista, meta_trocador, meta_posto)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (posto_id, periodo_id) DO UPDATE
       SET meta_frentista=$3, meta_trocador=$4, meta_posto=$5
     RETURNING *`,
    [req.params.id, posto_id, novoF, novoT, novoP]
  );

  // ── 3. Notificação WhatsApp (somente em edição com grupo configurado) ──────
  if (isEdicao) {
    const ant        = anterior[0];
    const groupId    = ant.whatsapp_group_id;
    const antF       = Number(ant.meta_frentista) || 0;
    const antT       = Number(ant.meta_trocador)  || 0;
    const antP       = Number(ant.meta_posto)     || 0;

    // Só envia se algo mudou e o posto tem grupo configurado
    const houveAlteracao = antF !== novoF || antT !== novoT || antP !== novoP;

    if (groupId && groupId.trim() && houveAlteracao) {
      const linhas = [];

      if (antF !== novoF) {
        linhas.push(
          `📋 *Meta Frentista:*\n` +
          `   Anterior: ${fmtBRL(antF)}\n` +
          `   Novo:     ${fmtBRL(novoF)}`
        );
      }
      if (antT !== novoT) {
        linhas.push(
          `🔧 *Meta Trocador:*\n` +
          `   Anterior: ${fmtBRL(antT)}\n` +
          `   Novo:     ${fmtBRL(novoT)}`
        );
      }
      if (antP !== novoP) {
        linhas.push(
          `🏪 *Meta do Posto:*\n` +
          `   Anterior: ${fmtBRL(antP)}\n` +
          `   Novo:     ${fmtBRL(novoP)}`
        );
      }

      const mensagem =
        `⚠️ *Atualização de Metas*\n` +
        `📍 ${ant.posto_codigo} — ${ant.posto_nome}\n` +
        `📅 Período: ${ant.periodo_nome}\n\n` +
        linhas.join('\n\n') +
        `\n\n_Alteração realizada em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}_`;

      // Dispara em background — não bloqueia a resposta
      enviarTextoWpp(groupId.trim(), mensagem).catch(() => {});
    }
  }

  res.json(rows[0]);
});

// ── DESQUALIFICADOS ───────────────────────────────────────────────────────────

async function ensureDesqTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS periodo_desqualificados (
      id          SERIAL PRIMARY KEY,
      periodo_id  INTEGER REFERENCES periodos(id) ON DELETE CASCADE,
      posto_id    INTEGER NOT NULL,
      posto_codigo VARCHAR(20) NOT NULL,
      nome        VARCHAR(255) NOT NULL,
      tipo        VARCHAR(20)  NOT NULL CHECK (tipo IN ('frentista','trocador','gerente')),
      motivo      TEXT DEFAULT '',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(periodo_id, posto_id, nome, tipo)
    );
    CREATE INDEX IF NOT EXISTS idx_desq_periodo ON periodo_desqualificados(periodo_id);
  `);
}

router.get('/:id/desqualificados', auth, async (req, res) => {
  await ensureDesqTable();
  const { rows } = await query(
    `SELECT * FROM periodo_desqualificados WHERE periodo_id=$1 ORDER BY posto_codigo, nome`,
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/desqualificados', auth, adminOnly, async (req, res) => {
  const { nome, tipo, posto_codigo, posto_id, motivo } = req.body;
  if (!nome || !tipo || !posto_codigo || !posto_id)
    return res.status(400).json({ error: 'nome, tipo, posto_codigo e posto_id são obrigatórios' });

  await ensureDesqTable();
  const { rows } = await query(
    `INSERT INTO periodo_desqualificados (periodo_id, posto_id, posto_codigo, nome, tipo, motivo)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (periodo_id, posto_id, nome, tipo) DO UPDATE SET motivo=$6
     RETURNING *`,
    [req.params.id, posto_id, posto_codigo, nome.trim(), tipo, motivo || '']
  );
  res.status(201).json(rows[0]);
});

router.delete('/:periodoId/desqualificados/:id', auth, adminOnly, async (req, res) => {
  await ensureDesqTable();
  await query(
    'DELETE FROM periodo_desqualificados WHERE id=$1 AND periodo_id=$2',
    [req.params.id, req.params.periodoId]
  );
  res.json({ success: true });
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
    rows_data  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  } catch {
    return res.status(400).json({ error: 'Não foi possível acessar a planilha. Verifique se está pública e a URL está correta.' });
  }

  if (!rows_data || rows_data.length < 2)
    return res.status(400).json({ error: 'Planilha vazia ou sem dados' });

  const { rows: postos }   = await query('SELECT * FROM postos WHERE ativo=true');
  const { rows: funcsEsp } = await query(
    'SELECT * FROM periodo_funcionarios WHERE periodo_id=$1', [periodoId]
  );

  const postoIdx = {};
  for (const p of postos) postoIdx[p.codigo.toLowerCase()] = p;

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

    const produto         = String(colC || '').trim();
    const quantidade      = parseVal(colD);
    const valor_unitario  = parseVal(colE);
    const valor_bruto     = parseVal(colF);
    const valor_desconto  = parseVal(colG);
    const valor_acrescimo = parseVal(colH);
    const valor_final     = parseVal(colI);

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

  await query(
    'UPDATE periodos SET sheets_url=COALESCE($1, sheets_url), data_ultima_importacao=NOW() WHERE id=$2',
    [sheets_url || null, periodoId]
  );

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

  let desqualificados = [];
  try {
    const { rows: desqRows } = await query(
      'SELECT * FROM periodo_desqualificados WHERE periodo_id=$1', [req.params.id]
    );
    desqualificados = desqRows;
  } catch (e) {
    console.warn('Tabela periodo_desqualificados ainda não existe, ignorando:', e.message);
  }

  const comissoes = calcularComissoes(vendas, metas, produtosEspeciais, periodoFuncionarios, periodo[0], desqualificados);

  const metasMap = {};
  for (const m of metas) metasMap[m.posto_id] = m;

  res.json({
    periodo: periodo[0],
    comissoes,
    metas: metasMap,
    totalVendas: vendas.length,
    dataUltimaImportacao: periodo[0].data_ultima_importacao || null,
  });
});

// ── VENDAS PAGINADAS ──────────────────────────────────────────────────────────

router.get('/:id/vendas', auth, async (req, res) => {
  const { posto_id, funcionario, page = 1, limit = 50 } = req.query;
  const conditions = ['v.periodo_id=$1'];
  const params     = [req.params.id];
  let i = 2;
  if (posto_id) {
    conditions.push(`v.posto_id=$${i++}`);
    params.push(posto_id);
  }
  if (funcionario) {
    conditions.push(`(v.funcionario ILIKE $${i} OR v.produto ILIKE $${i})`);
    params.push(`%${funcionario}%`);
    i++;
  }

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

// ── REPLICAR PERÍODO ──────────────────────────────────────────────────────────
// POST /api/periodos/:id/replicar
// Body: { origem_id: number }
//
// Copia do período origem para o período destino (:id):
//   - metas (meta_frentista, meta_trocador, meta_posto) por posto
//   - periodo_funcionarios (gerentes e trocadores) por posto
//
// Regras:
//   - Metas já existentes no destino são atualizadas (upsert)
//   - Funcionários já existentes no destino são ignorados (on conflict do nothing)
//   - O período destino deve existir e ser diferente do origem

router.post('/:id/replicar', auth, adminOnly, async (req, res) => {
  const destinoId = parseInt(req.params.id);
  const { origem_id } = req.body;
  const origemId = parseInt(origem_id);

  if (!origemId || isNaN(origemId)) {
    return res.status(400).json({ error: 'origem_id é obrigatório' });
  }
  if (destinoId === origemId) {
    return res.status(400).json({ error: 'O período origem deve ser diferente do destino' });
  }

  // Valida existência de ambos os períodos
  const [{ rows: destRows }, { rows: origRows }] = await Promise.all([
    query('SELECT id, nome FROM periodos WHERE id=$1', [destinoId]),
    query('SELECT id, nome FROM periodos WHERE id=$1', [origemId]),
  ]);
  if (!destRows.length) return res.status(404).json({ error: 'Período destino não encontrado' });
  if (!origRows.length) return res.status(404).json({ error: 'Período origem não encontrado' });

  // ── 1. Replica metas ───────────────────────────────────────────────────────
  const { rows: metasOrigem } = await query(
    `SELECT posto_id, meta_frentista, meta_trocador, meta_posto
     FROM metas WHERE periodo_id = $1`,
    [origemId]
  );

  let metasReplicadas = 0;
  for (const m of metasOrigem) {
    await query(
      `INSERT INTO metas (periodo_id, posto_id, meta_frentista, meta_trocador, meta_posto)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (posto_id, periodo_id) DO UPDATE
         SET meta_frentista = $3,
             meta_trocador  = $4,
             meta_posto     = $5`,
      [destinoId, m.posto_id, m.meta_frentista, m.meta_trocador, m.meta_posto]
    );
    metasReplicadas++;
  }

  // ── 2. Replica funcionários (gerentes e trocadores) ────────────────────────
  const { rows: funcsOrigem } = await query(
    `SELECT posto_id, nome, tipo
     FROM periodo_funcionarios WHERE periodo_id = $1`,
    [origemId]
  );

  let funcsReplicados = 0;
  let funcsIgnorados  = 0;
  for (const f of funcsOrigem) {
    const { rowCount } = await query(
      `INSERT INTO periodo_funcionarios (periodo_id, posto_id, nome, tipo)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (periodo_id, posto_id, nome, tipo) DO NOTHING`,
      [destinoId, f.posto_id, f.nome, f.tipo]
    );
    if (rowCount > 0) funcsReplicados++;
    else funcsIgnorados++;
  }

  res.json({
    success: true,
    origem:  { id: origemId,  nome: origRows[0].nome },
    destino: { id: destinoId, nome: destRows[0].nome },
    metas:       { replicadas: metasReplicadas },
    funcionarios:{ replicados: funcsReplicados, ignorados: funcsIgnorados },
    message: `Replicação concluída: ${metasReplicadas} meta(s) e ${funcsReplicados} funcionário(s) copiados de "${origRows[0].nome}".`,
  });
});


module.exports = router;
