const router = require('express').Router();
const multer = require('multer');
const { query } = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCSVLine(line, delim) {
  const result = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === delim && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function toNum(v) {
  if (!v || v === '-') return 0;
  const s = String(v).replace(/[R$\s]/g, '').trim();
  if (!s || s === '-') return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

// Extrai datas de "Visão financeira / De 18/06/26 até 18/06/26 / ..."
// Usa \S* após "at" para tolerar "até" com qualquer codificação de caractere
function extrairDatas(cellStr) {
  const m = String(cellStr).match(/De\s+(\d{2}\/\d{2}\/\d{2})\s+at\S*\s+(\d{2}\/\d{2}\/\d{2})/i);
  if (!m) return null;
  const parseD = (s) => {
    const [d, mo, y] = s.split('/');
    return new Date(2000 + parseInt(y), parseInt(mo) - 1, parseInt(d));
  };
  return { ini: parseD(m[1]), fim: parseD(m[2]) };
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function addDias(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// ── Meses disponíveis ─────────────────────────────────────────────────────────

router.get('/meses', auth, async (req, res) => {
  const { rows } = await query(`
    SELECT DISTINCT TO_CHAR(data, 'YYYY-MM') AS mes
    FROM ll_itens ORDER BY mes DESC
  `);
  res.json(rows.map(r => r.mes));
});

// ── Dados mensais (visão dia × posto) ─────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  const { mes } = req.query;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes))
    return res.status(400).json({ error: 'Parâmetro mes inválido (YYYY-MM)' });

  const [ano, mm] = mes.split('-').map(Number);

  const { rows: dados } = await query(`
    SELECT li.data, li.posto_id,
           SUM(li.lucro_bruto) AS lucro_bruto,
           p.codigo
    FROM ll_itens li
    JOIN postos p ON p.id = li.posto_id
    WHERE TO_CHAR(li.data, 'YYYY-MM') = $1
    GROUP BY li.data, li.posto_id, p.codigo
    ORDER BY li.data, p.codigo
  `, [mes]);

  const postosMap = {};
  for (const r of dados) postosMap[r.posto_id] = r.codigo;
  const postos = Object.entries(postosMap)
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: 'base' }))
    .map(([id, codigo]) => ({ id: Number(id), codigo }));

  const diasNoMes = new Date(ano, mm, 0).getDate();
  const diasMap = {};
  for (let d = 1; d <= diasNoMes; d++) {
    const key = `${ano}-${String(mm).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    diasMap[key] = {};
  }
  for (const r of dados) {
    const key = r.data.toISOString().split('T')[0];
    diasMap[key][r.posto_id] = Number(r.lucro_bruto);
  }

  const totaisPosto = {};
  for (const p of postos) totaisPosto[p.id] = 0;
  for (const r of dados) totaisPosto[r.posto_id] = (totaisPosto[r.posto_id] || 0) + Number(r.lucro_bruto);

  res.json({ postos, diasMap, totaisPosto });
});

// ── Importar CSV (múltiplos arquivos) ─────────────────────────────────────────

router.post('/importar', auth, adminOnly, upload.array('arquivo', 50), async (req, res) => {
  const arquivos = req.files || [];
  if (!arquivos.length) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  const { rows: postosDB } = await query('SELECT id, codigo, chave_empresa FROM postos WHERE ativo=true');
  const postoIdx = {};
  for (const p of postosDB) {
    if (p.chave_empresa) postoIdx[p.chave_empresa.trim().toLowerCase()] = p;
  }

  let totalInseridos = 0;
  let totalErros = 0;
  const mesesAfetados = new Set();

  for (const arquivo of arquivos) {
    const ext = arquivo.originalname.split('.').pop().toLowerCase();
    if (ext !== 'csv') { totalErros++; continue; }

    // Tenta UTF-8 primeiro; se houver caracteres inválidos usa latin1 (Windows-1252)
    let text = arquivo.buffer.toString('utf8');
    if (text.includes('�')) text = arquivo.buffer.toString('latin1');
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());
    if (!lines.length) { totalErros++; continue; }

    const firstLine = lines[0];
    const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

    // Coleta itens a inserir: { dataISO, postoId, produtoNome, qtd, vBruto, vLiq, vCusto, lBruto }
    const itens = [];
    const diagnostico = { semChave: 0, semPosto: new Set(), semData: 0, semProduto: 0, ok: 0, amostra: null };

    for (let i = 0; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i], delim);

      const chave   = String(cols[1] || '').trim().toLowerCase();   // col B
      const dataCel = String(cols[3] || '').trim();                  // col D
      const produto = String(cols[25] || '').trim();                 // col Z
      const qtd     = toNum(cols[26]);                               // col AA
      const vBruto  = toNum(cols[29]);                               // col AD
      const vLiq    = toNum(cols[30]);                               // col AE
      const vCusto  = toNum(cols[31]);                               // col AF
      const lBruto  = toNum(cols[32]);                               // col AG

      // Amostra da primeira linha para diagnóstico
      if (i === 1) diagnostico.amostra = {
        totalCols: cols.length, delim,
        colB:  cols[1],
        colD:  cols[3],
        colZ:  cols[25],
        colAA: cols[26],   // quantidade
        colAD_raw: cols[29], colAD_num: toNum(cols[29]),  // valor_bruto
        colAE_raw: cols[30], colAE_num: toNum(cols[30]),  // valor_liquido
        colAF_raw: cols[31], colAF_num: toNum(cols[31]),  // valor_custo
        colAG_raw: cols[32], colAG_num: toNum(cols[32]),  // lucro_bruto
      };

      if (!chave) { diagnostico.semChave++; totalErros++; continue; }
      if (!produto) { diagnostico.semProduto++; totalErros++; continue; }

      const posto = postoIdx[chave];
      if (!posto) { diagnostico.semPosto.add(chave); totalErros++; continue; }

      const datas = extrairDatas(dataCel);
      if (!datas) { diagnostico.semData++; totalErros++; continue; }

      const dataStr = isoDate(datas.fim);
      itens.push({
        data:    dataStr,
        postoId: posto.id,
        produto,
        qtd,
        vBruto,
        vLiq,
        vCusto,
        lBruto,
      });
      mesesAfetados.add(dataStr.substring(0, 7));
    }

    console.log('[LL Import]', arquivo.originalname, {
      delim,
      totalLinhas: lines.length - 1,
      amostra: diagnostico.amostra,
      semChave: diagnostico.semChave,
      semProduto: diagnostico.semProduto,
      semPosto: [...diagnostico.semPosto].slice(0, 5),
      semData: diagnostico.semData,
      itensGerados: itens.length,
    });

    if (!itens.length) continue;

    // Registra produtos ainda não catalogados
    const produtosUnicos = [...new Set(itens.map(it => it.produto))];
    for (const nome of produtosUnicos) {
      await query(
        'INSERT INTO ll_produtos (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING',
        [nome]
      );
    }

    // Busca IDs de produtos
    const { rows: prodRows } = await query(
      'SELECT id, nome FROM ll_produtos WHERE nome = ANY($1)',
      [produtosUnicos]
    );
    const prodIdx = {};
    for (const p of prodRows) prodIdx[p.nome] = p.id;

    // Deleta apenas os pares (data, posto_id) exatos que serão reimportados
    const pares = [...new Set(itens.map(it => `${it.data}|${it.postoId}`))];
    for (const par of pares) {
      const [data, postoId] = par.split('|');
      await query(`DELETE FROM ll_itens WHERE data=$1 AND posto_id=$2`, [data, postoId]);
    }

    // Insert em batch
    const BATCH = 200;
    for (let i = 0; i < itens.length; i += BATCH) {
      const batch = itens.slice(i, i + BATCH);
      const vals  = batch.map((_, j) => {
        const b = j * 8;
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`;
      }).join(',');
      await query(
        `INSERT INTO ll_itens
           (data, posto_id, produto_id, quantidade, valor_bruto, valor_liquido, valor_custo, lucro_bruto)
         VALUES ${vals}`,
        batch.flatMap(it => [
          it.data, it.postoId, prodIdx[it.produto] || null,
          it.qtd, it.vBruto, it.vLiq, it.vCusto, it.lBruto,
        ])
      );
      totalInseridos += batch.length;
    }
  }

  res.json({
    success: totalInseridos > 0,
    inseridos: totalInseridos,
    erros: totalErros,
    meses: [...mesesAfetados],
    message: `${totalInseridos} itens importados. ${totalErros > 0 ? `${totalErros} linhas ignoradas.` : ''}`,
  });
});

// ── Categorias ────────────────────────────────────────────────────────────────

router.get('/categorias', auth, async (req, res) => {
  const { rows } = await query('SELECT * FROM ll_categorias ORDER BY pai_id NULLS FIRST, nome');
  res.json(rows);
});

router.post('/categorias', auth, adminOnly, async (req, res) => {
  const { nome, pai_id } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const { rows } = await query(
      'INSERT INTO ll_categorias (nome, pai_id) VALUES ($1, $2) RETURNING *',
      [nome.trim(), pai_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Categoria já existe neste nível' });
    throw e;
  }
});

router.delete('/categorias/:id', auth, adminOnly, async (req, res) => {
  await query('DELETE FROM ll_categorias WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Produtos ──────────────────────────────────────────────────────────────────

router.get('/produtos', auth, async (req, res) => {
  const { rows } = await query(`
    SELECT lp.*, lc.nome as categoria_nome,
           lp2.nome as pai_nome
    FROM ll_produtos lp
    LEFT JOIN ll_categorias lc ON lc.id = lp.categoria_id
    LEFT JOIN ll_categorias lp2 ON lp2.id = lc.pai_id
    ORDER BY lp.categoria_id NULLS FIRST, lp.nome
  `);
  res.json(rows);
});

router.put('/produtos/:id', auth, adminOnly, async (req, res) => {
  const { categoria_id } = req.body;
  const { rows } = await query(
    'UPDATE ll_produtos SET categoria_id=$1 WHERE id=$2 RETURNING *',
    [categoria_id || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Produto não encontrado' });
  res.json(rows[0]);
});

// ── Manutenção: excluir registros de um dia/posto ────────────────────────────

router.delete('/manutencao', auth, adminOnly, async (req, res) => {
  const { data, posto_id } = req.query;
  if (!data || !posto_id) return res.status(400).json({ error: 'data e posto_id obrigatórios' });
  const { rowCount } = await query(
    'DELETE FROM ll_itens WHERE data=$1 AND posto_id=$2',
    [data, posto_id]
  );
  res.json({ success: true, removidos: rowCount });
});

router.get('/manutencao/contagem', auth, adminOnly, async (req, res) => {
  const { data, posto_id } = req.query;
  if (!data || !posto_id) return res.json({ count: 0 });
  const { rows } = await query(
    'SELECT COUNT(*) AS count FROM ll_itens WHERE data=$1 AND posto_id=$2',
    [data, posto_id]
  );
  res.json({ count: Number(rows[0].count) });
});

// ── BI Analytics ─────────────────────────────────────────────────────────────

router.get('/bi', auth, async (req, res) => {
  const { mes } = req.query;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes))
    return res.status(400).json({ error: 'Parâmetro mes inválido (YYYY-MM)' });

  const n = v => Number(v) || 0;

  // KPIs gerais
  const { rows: [k] } = await query(`
    SELECT SUM(valor_bruto)   AS vbruto,
           SUM(valor_liquido) AS vliq,
           SUM(valor_custo)   AS vcusto,
           SUM(lucro_bruto)   AS lucro,
           COUNT(*)           AS registros
    FROM ll_itens
    WHERE TO_CHAR(data, 'YYYY-MM') = $1
  `, [mes]);

  // Por posto
  const { rows: porPosto } = await query(`
    SELECT p.codigo, p.ativo,
           SUM(li.valor_bruto)  AS vbruto,
           SUM(li.lucro_bruto)  AS lucro,
           CASE WHEN SUM(li.valor_bruto) > 0
                THEN ROUND(SUM(li.lucro_bruto) / SUM(li.valor_bruto) * 100, 1)
                ELSE 0 END      AS margem
    FROM ll_itens li
    JOIN postos p ON p.id = li.posto_id
    WHERE TO_CHAR(li.data, 'YYYY-MM') = $1
    GROUP BY p.id, p.codigo, p.ativo
    ORDER BY lucro DESC
  `, [mes]);

  // Por posto x categoria raiz (lucro bruto de cada posto separado por Combustíveis, Agregados, Bebidas...)
  const { rows: porPostoCategoria } = await query(`
    WITH RECURSIVE raiz AS (
      SELECT id, nome FROM ll_categorias WHERE pai_id IS NULL
      UNION ALL
      SELECT c.id, r.nome FROM ll_categorias c JOIN raiz r ON c.pai_id = r.id
    )
    SELECT p.codigo,
           COALESCE(r.nome, 'Sem Categoria') AS categoria,
           SUM(li.lucro_bruto) AS lucro
    FROM ll_itens li
    JOIN postos p ON p.id = li.posto_id
    LEFT JOIN ll_produtos lp ON lp.id = li.produto_id
    LEFT JOIN raiz r ON r.id = lp.categoria_id
    WHERE TO_CHAR(li.data, 'YYYY-MM') = $1
    GROUP BY p.codigo, r.nome
    ORDER BY p.codigo
  `, [mes]);

  // Por categoria raiz (sobe a árvore até a raiz)
  const { rows: porCategoria } = await query(`
    WITH RECURSIVE raiz AS (
      SELECT id, nome FROM ll_categorias WHERE pai_id IS NULL
      UNION ALL
      SELECT c.id, r.nome FROM ll_categorias c JOIN raiz r ON c.pai_id = r.id
    )
    SELECT COALESCE(r.nome, 'Sem Categoria') AS categoria,
           SUM(li.valor_bruto)  AS vbruto,
           SUM(li.lucro_bruto)  AS lucro,
           CASE WHEN SUM(li.valor_bruto) > 0
                THEN ROUND(SUM(li.lucro_bruto) / SUM(li.valor_bruto) * 100, 1)
                ELSE 0 END      AS margem
    FROM ll_itens li
    LEFT JOIN ll_produtos lp ON lp.id = li.produto_id
    LEFT JOIN raiz r ON r.id = lp.categoria_id
    WHERE TO_CHAR(li.data, 'YYYY-MM') = $1
    GROUP BY r.nome
    ORDER BY lucro DESC
  `, [mes]);

  // Top 30 produtos (com grupo raiz: Combustíveis, Agregados, Bebidas...)
  const { rows: topProdutos } = await query(`
    WITH RECURSIVE raiz AS (
      SELECT id, nome FROM ll_categorias WHERE pai_id IS NULL
      UNION ALL
      SELECT c.id, r.nome FROM ll_categorias c JOIN raiz r ON c.pai_id = r.id
    )
    SELECT lp.nome AS produto,
           COALESCE(r.nome, 'Sem Categoria') AS categoria,
           COALESCE(lc.nome, '—') AS subcategoria,
           SUM(li.quantidade)   AS qtd,
           SUM(li.valor_bruto)  AS vbruto,
           SUM(li.lucro_bruto)  AS lucro,
           CASE WHEN SUM(li.valor_bruto) > 0
                THEN ROUND(SUM(li.lucro_bruto) / SUM(li.valor_bruto) * 100, 1)
                ELSE 0 END      AS margem
    FROM ll_itens li
    JOIN ll_produtos lp ON lp.id = li.produto_id
    LEFT JOIN ll_categorias lc ON lc.id = lp.categoria_id
    LEFT JOIN raiz r ON r.id = lp.categoria_id
    WHERE TO_CHAR(li.data, 'YYYY-MM') = $1
    GROUP BY lp.id, lp.nome, lc.nome, r.nome
    ORDER BY lucro DESC
    LIMIT 30
  `, [mes]);

  // Evolução dos últimos 12 meses
  const { rows: evolucao } = await query(`
    SELECT TO_CHAR(data, 'YYYY-MM') AS mes,
           SUM(lucro_bruto) AS lucro,
           SUM(valor_bruto) AS vbruto
    FROM ll_itens
    WHERE data >= NOW() - INTERVAL '13 months'
    GROUP BY TO_CHAR(data, 'YYYY-MM')
    ORDER BY mes
  `);

  const totalLucro = n(k?.lucro);
  const totalBruto = n(k?.vbruto);
  const maxEvolucao = Math.max(...evolucao.map(e => n(e.lucro)), 1);

  res.json({
    kpis: {
      totalBruto,
      totalLiquido: n(k?.vliq),
      totalCusto:   n(k?.vcusto),
      totalLucro,
      margem: totalBruto > 0 ? Math.round(totalLucro / totalBruto * 1000) / 10 : 0,
      registros: n(k?.registros),
    },
    porPosto:     porPosto.map(r     => ({ ...r, vbruto: n(r.vbruto), lucro: n(r.lucro), margem: n(r.margem) })),
    porPostoCategoria: porPostoCategoria.map(r => ({ ...r, lucro: n(r.lucro) })),
    porCategoria: porCategoria.map(r => ({ ...r, vbruto: n(r.vbruto), lucro: n(r.lucro), margem: n(r.margem) })),
    topProdutos:  topProdutos.map(r  => ({ ...r, qtd: n(r.qtd), vbruto: n(r.vbruto), lucro: n(r.lucro), margem: n(r.margem) })),
    evolucao:     evolucao.map(r     => ({ mes: r.mes, lucro: n(r.lucro), vbruto: n(r.vbruto), pct: Math.round(n(r.lucro) / maxEvolucao * 100) })),
  });
});

module.exports = router;
