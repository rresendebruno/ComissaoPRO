/**
 * Previsão de Compras / Controle de Estoque
 * GET  /api/estoque/previsao   → saída, média, tendência e sugestão de compra por produto
 * PUT  /api/estoque/produto    → atualiza estoque atual e prazo de reposição de um produto
 * POST /api/estoque/importar   → importa estoque atual em massa via arquivo (CSV/XLSX)
 *
 * Base de dados: tabela `vendas` (produtos vendidos por período de apuração).
 * Cada período tem data_inicio/data_fim; a média diária é calculada dividindo
 * a soma vendida pela soma de dias dos períodos considerados.
 */

const router = require('express').Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { query } = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const N = v => (v == null ? 0 : Number(v) || 0);
const MS_DIA = 24 * 60 * 60 * 1000;

// Remove acentos e normaliza para comparação de texto (ex.: "Óleo" -> "oleo")
function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{Mn}/gu, '')
    .toLowerCase().trim();
}

function diasEntre(a, b) {
  return Math.max(1, Math.round((new Date(b) - new Date(a)) / MS_DIA) + 1);
}

// ── Helpers de importação (CSV/XLSX) ───────────────────────────────────────────

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
  if (v == null || v === '-') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[R$\s]/g, '').trim();
  if (!s || s === '-') return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function linhasDoArquivo(arquivo) {
  const ext = arquivo.originalname.split('.').pop().toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(arquivo.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  }
  if (ext === 'csv') {
    let text = arquivo.buffer.toString('utf8');
    if (text.includes('�')) text = arquivo.buffer.toString('latin1');
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());
    if (!lines.length) return [];
    const delim = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
    return lines.map(l => parseCSVLine(l, delim));
  }
  return null; // extensão não suportada
}

// ── Previsão de compras ────────────────────────────────────────────────────────

router.get('/previsao', auth, async (req, res) => {
  const postoId       = req.query.posto_id ? Number(req.query.posto_id) : null;
  const nPeriodos      = Math.min(Math.max(Number(req.query.periodos) || 6, 2), 24);
  const coberturaDias  = Math.min(Math.max(Number(req.query.cobertura_dias) || 7, 1), 90);

  // Últimos N períodos (mais recentes primeiro)
  const { rows: periodos } = await query(
    `SELECT id, nome, data_inicio, data_fim FROM periodos ORDER BY data_fim DESC LIMIT $1`,
    [nPeriodos]
  );
  if (!periodos.length) return res.json({ periodos: [], produtos: [], coberturaDias, totalDias: 0 });

  const periodoIds   = periodos.map(p => p.id);
  const maisRecenteId = periodos[0].id;
  const totalDias     = periodos.reduce((s, p) => s + diasEntre(p.data_inicio, p.data_fim), 0);
  const diasRecente    = diasEntre(periodos[0].data_inicio, periodos[0].data_fim);
  const diasAnteriores  = totalDias - diasRecente;
  const hoje = new Date();

  // Soma de vendas por produto x período
  const { rows: vendas } = await query(
    `SELECT produto, periodo_id, SUM(quantidade) AS qtd
     FROM vendas
     WHERE periodo_id = ANY($1) ${postoId ? 'AND posto_id = $2' : ''}
     GROUP BY produto, periodo_id`,
    postoId ? [periodoIds, postoId] : [periodoIds]
  );

  // Estoque configurado (só faz sentido por posto específico)
  let estoqueMap = {};
  if (postoId) {
    const { rows: estoqueRows } = await query(
      `SELECT produto, estoque_atual, prazo_reposicao_dias FROM estoque_produtos WHERE posto_id = $1`,
      [postoId]
    );
    for (const r of estoqueRows) estoqueMap[r.produto] = r;
  }

  // Categorias atribuídas aos produtos (ex.: Lubrificante > Primeira Linha)
  const { rows: catRows } = await query(`
    WITH RECURSIVE raiz AS (
      SELECT id, nome FROM estoque_categorias WHERE pai_id IS NULL
      UNION ALL
      SELECT c.id, r.nome FROM estoque_categorias c JOIN raiz r ON c.pai_id = r.id
    )
    SELECT epc.produto, ec.id AS categoria_id,
           COALESCE(r.nome, 'Sem Categoria') AS categoria,
           ec.nome AS subcategoria
    FROM estoque_produto_categoria epc
    LEFT JOIN estoque_categorias ec ON ec.id = epc.categoria_id
    LEFT JOIN raiz r ON r.id = ec.id
  `);
  const categoriaMap = {};
  for (const r of catRows) categoriaMap[r.produto] = r;

  // Agrega por produto
  const porProduto = {};
  for (const v of vendas) {
    if (!porProduto[v.produto]) porProduto[v.produto] = { produto: v.produto, total: 0, recente: 0, anteriores: 0, ultimoPeriodoComVenda: null };
    const p = porProduto[v.produto];
    const qtd = N(v.qtd);
    p.total += qtd;
    if (v.periodo_id === maisRecenteId) p.recente += qtd;
    else p.anteriores += qtd;
    if (qtd > 0) {
      const per = periodos.find(pe => pe.id === v.periodo_id);
      if (per && (!p.ultimoPeriodoComVenda || new Date(per.data_fim) > new Date(p.ultimoPeriodoComVenda)))
        p.ultimoPeriodoComVenda = per.data_fim;
    }
  }

  const produtos = Object.values(porProduto).map(p => {
    const mediaDiaria     = totalDias > 0 ? p.total / totalDias : 0;
    const mediaRecente     = diasRecente > 0 ? p.recente / diasRecente : 0;
    const mediaAnteriores  = diasAnteriores > 0 ? p.anteriores / diasAnteriores : 0;
    const tendenciaPct     = mediaAnteriores > 0
      ? ((mediaRecente - mediaAnteriores) / mediaAnteriores) * 100
      : (mediaRecente > 0 ? 100 : 0);
    const diasSemSaida = p.ultimoPeriodoComVenda
      ? Math.round((hoje - new Date(p.ultimoPeriodoComVenda)) / MS_DIA)
      : null;

    const estoqueCfg      = estoqueMap[p.produto] || null;
    const estoqueAtual     = estoqueCfg ? N(estoqueCfg.estoque_atual) : null;
    const prazoReposicao   = estoqueCfg ? Number(estoqueCfg.prazo_reposicao_dias) : 3;
    const estoqueMinimo    = mediaDiaria * coberturaDias;
    const pontoPedido      = mediaDiaria * (prazoReposicao + coberturaDias);
    const sugestaoCompra   = estoqueAtual != null ? Math.max(0, pontoPedido - estoqueAtual) : null;

    let status = 'sem_config';
    if (estoqueAtual != null) {
      const estoqueSeguranca = mediaDiaria * prazoReposicao;
      if (estoqueAtual <= estoqueSeguranca) status = 'critico';
      else if (estoqueAtual < pontoPedido) status = 'comprar';
      else status = 'ok';
    }

    const cat = categoriaMap[p.produto] || null;

    return {
      produto: p.produto,
      categoriaId: cat?.categoria_id ?? null,
      categoria: cat?.categoria || null,
      subcategoria: cat?.subcategoria || null,
      qtdTotal: p.total,
      mediaDiaria,
      tendenciaPct,
      diasSemSaida,
      estoqueAtual,
      prazoReposicaoDias: prazoReposicao,
      estoqueMinimoSugerido: estoqueMinimo,
      pontoPedido,
      sugestaoCompra,
      status,
    };
  }).sort((a, b) => b.qtdTotal - a.qtdTotal);

  res.json({
    periodos: periodos.map(p => ({ id: p.id, nome: p.nome, data_inicio: p.data_inicio, data_fim: p.data_fim })),
    coberturaDias,
    totalDias,
    produtos,
  });
});

// ── Atualiza estoque atual / prazo de reposição de um produto ─────────────────

router.put('/produto', auth, adminOnly, async (req, res) => {
  const { posto_id, produto, estoque_atual, prazo_reposicao_dias } = req.body;
  if (!posto_id || !produto) return res.status(400).json({ error: 'posto_id e produto são obrigatórios' });

  const { rows } = await query(
    `INSERT INTO estoque_produtos (posto_id, produto, estoque_atual, prazo_reposicao_dias, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (posto_id, produto)
     DO UPDATE SET estoque_atual = $3, prazo_reposicao_dias = $4, updated_at = NOW()
     RETURNING *`,
    [posto_id, produto.trim(), N(estoque_atual), Math.max(0, Number(prazo_reposicao_dias) || 3)]
  );
  res.json(rows[0]);
});

// ── Categorias de produtos ──────────────────────────────────────────────────────

router.get('/categorias', auth, async (req, res) => {
  const { rows } = await query('SELECT * FROM estoque_categorias ORDER BY pai_id NULLS FIRST, nome');
  res.json(rows);
});

router.post('/categorias', auth, adminOnly, async (req, res) => {
  const { nome, pai_id } = req.body;
  if (!nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });

  const paiId = pai_id || null;
  const { rows: existentes } = await query(
    `SELECT id FROM estoque_categorias
     WHERE LOWER(nome) = LOWER($1) AND COALESCE(pai_id, 0) = COALESCE($2, 0)`,
    [nome.trim(), paiId]
  );
  if (existentes.length) {
    return res.status(409).json({ error: `Já existe uma categoria "${nome.trim()}" ${paiId ? 'nesse nível' : 'raiz'}.` });
  }

  const { rows } = await query(
    'INSERT INTO estoque_categorias (nome, pai_id) VALUES ($1, $2) RETURNING *',
    [nome.trim(), paiId]
  );
  res.status(201).json(rows[0]);
});

router.delete('/categorias/:id', auth, adminOnly, async (req, res) => {
  await query('DELETE FROM estoque_categorias WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Atribui categoria a um produto ──────────────────────────────────────────────

router.put('/produto-categoria', auth, adminOnly, async (req, res) => {
  const { produto, categoria_id } = req.body;
  if (!produto?.trim()) return res.status(400).json({ error: 'produto é obrigatório' });
  const { rows } = await query(
    `INSERT INTO estoque_produto_categoria (produto, categoria_id)
     VALUES ($1, $2)
     ON CONFLICT (produto) DO UPDATE SET categoria_id = $2
     RETURNING *`,
    [produto.trim(), categoria_id || null]
  );
  res.json(rows[0]);
});

// ── Regras de categorização automática ─────────────────────────────────────────
// Cada regra tem uma lista de palavras (todas precisam aparecer no nome do produto,
// sem acento/maiúscula) que, se bater, atribuem a categoria configurada.

router.get('/regras', auth, async (req, res) => {
  const { rows } = await query(`
    SELECT r.id, r.palavras, r.categoria_id, r.criado_em,
           ec.nome AS categoria_nome, pai.nome AS categoria_pai_nome
    FROM estoque_regras_categoria r
    JOIN estoque_categorias ec ON ec.id = r.categoria_id
    LEFT JOIN estoque_categorias pai ON pai.id = ec.pai_id
    ORDER BY r.criado_em
  `);
  res.json(rows);
});

router.post('/regras', auth, adminOnly, async (req, res) => {
  const { palavras, categoria_id } = req.body;
  if (!palavras?.trim()) return res.status(400).json({ error: 'Informe ao menos uma palavra-chave' });
  if (!categoria_id) return res.status(400).json({ error: 'categoria_id é obrigatório' });
  const { rows } = await query(
    'INSERT INTO estoque_regras_categoria (palavras, categoria_id) VALUES ($1, $2) RETURNING *',
    [palavras.trim(), categoria_id]
  );
  res.status(201).json(rows[0]);
});

router.delete('/regras/:id', auth, adminOnly, async (req, res) => {
  await query('DELETE FROM estoque_regras_categoria WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Cria de uma vez as categorias/regras sugeridas para lubrificantes ──────────
// Lubrificante > Primeira Linha (Lubrax/Petronas/Gulf/Shell/Mobil) ou Segunda
// Linha (qualquer outra marca); Filtro; Aditivo Combustível.

router.post('/regras/sugestoes', auth, adminOnly, async (req, res) => {
  async function garantirCategoria(nome, paiId = null) {
    const { rows } = await query(
      `SELECT id FROM estoque_categorias WHERE LOWER(nome)=LOWER($1) AND COALESCE(pai_id,0)=COALESCE($2,0)`,
      [nome, paiId]
    );
    if (rows.length) return rows[0].id;
    const ins = await query(
      'INSERT INTO estoque_categorias (nome, pai_id) VALUES ($1,$2) RETURNING id',
      [nome, paiId]
    );
    return ins.rows[0].id;
  }

  async function garantirRegra(palavras, categoriaId) {
    const { rows } = await query(
      `SELECT id FROM estoque_regras_categoria WHERE LOWER(palavras)=LOWER($1) AND categoria_id=$2`,
      [palavras, categoriaId]
    );
    if (rows.length) return false;
    await query('INSERT INTO estoque_regras_categoria (palavras, categoria_id) VALUES ($1,$2)', [palavras, categoriaId]);
    return true;
  }

  const lubrificanteId  = await garantirCategoria('Lubrificante');
  const primeiraLinhaId = await garantirCategoria('Primeira Linha', lubrificanteId);
  const segundaLinhaId  = await garantirCategoria('Segunda Linha', lubrificanteId);
  const filtroId        = await garantirCategoria('Filtro');
  const aditivoCombId   = await garantirCategoria('Aditivo Combustível');

  let criadas = 0;
  const marcas = ['lubrax', 'petronas', 'gulf', 'shell', 'mobil'];
  for (const marca of marcas) {
    if (await garantirRegra(`oleo,${marca}`, primeiraLinhaId)) criadas++;
  }
  if (await garantirRegra('oleo', segundaLinhaId)) criadas++;
  if (await garantirRegra('filtro', filtroId)) criadas++;
  if (await garantirRegra('aditivo,combustivel', aditivoCombId)) criadas++;

  res.json({ success: true, regrasCriadas: criadas, message: `${criadas} regra(s) nova(s) criada(s).` });
});

// ── Executa as regras contra o catálogo de produtos ────────────────────────────

router.post('/auto-categorizar', auth, adminOnly, async (req, res) => {
  const sobrescrever = !!req.body?.sobrescrever;

  const { rows: regrasDB } = await query('SELECT id, palavras, categoria_id FROM estoque_regras_categoria');
  if (!regrasDB.length) return res.json({ avaliados: 0, categorizados: 0, semCorrespondencia: 0, message: 'Nenhuma regra cadastrada.' });

  // Regras com mais palavras-chave são mais específicas e devem ser testadas primeiro
  const regras = regrasDB
    .map(r => ({ ...r, termos: r.palavras.split(',').map(normalizar).filter(Boolean) }))
    .sort((a, b) => b.termos.length - a.termos.length);

  const { rows: produtosDB } = await query('SELECT DISTINCT produto FROM vendas');
  const { rows: existentesDB } = await query('SELECT produto, categoria_id FROM estoque_produto_categoria');
  const jaCategorizado = new Set(existentesDB.filter(e => e.categoria_id).map(e => e.produto));

  let categorizados = 0;
  const writes = [];
  for (const { produto } of produtosDB) {
    if (!sobrescrever && jaCategorizado.has(produto)) continue;
    const nomeNorm = normalizar(produto);
    const regra = regras.find(r => r.termos.every(t => nomeNorm.includes(t)));
    if (regra) {
      writes.push([produto, regra.categoria_id]);
      categorizados++;
    }
  }

  const BATCH = 200;
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = writes.slice(i, i + BATCH);
    const vals = batch.map((_, j) => `($${j*2+1},$${j*2+2})`).join(',');
    await query(
      `INSERT INTO estoque_produto_categoria (produto, categoria_id)
       VALUES ${vals}
       ON CONFLICT (produto) DO UPDATE SET categoria_id = EXCLUDED.categoria_id`,
      batch.flat()
    );
  }

  res.json({
    avaliados: produtosDB.length,
    categorizados,
    semCorrespondencia: produtosDB.length - categorizados - (sobrescrever ? 0 : jaCategorizado.size),
    message: `${categorizados} produto(s) categorizado(s) automaticamente.`,
  });
});

// ── Importa estoque atual em massa (CSV/XLSX) ──────────────────────────────────
// Colunas esperadas: B = chave da empresa, U = produto, AA = quantidade em estoque

router.post('/importar', auth, adminOnly, upload.array('arquivo', 50), async (req, res) => {
  const arquivos = req.files || [];
  if (!arquivos.length) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  const { rows: postosDB } = await query('SELECT id, codigo, chave_empresa FROM postos WHERE ativo=true');
  const postoIdx = {};
  for (const p of postosDB) {
    if (p.chave_empresa) postoIdx[p.chave_empresa.trim().toLowerCase()] = p;
  }

  const diagnostico = { semChave: 0, semProduto: 0, semPosto: new Set(), ok: 0, arquivosInvalidos: 0, amostra: null };
  // Map "postoId|produto" -> quantidade acumulada (somada entre todos os arquivos)
  const itensMap = new Map();

  for (const arquivo of arquivos) {
    const linhas = linhasDoArquivo(arquivo);
    if (linhas === null || !linhas.length) { diagnostico.arquivosInvalidos++; continue; }

    for (let i = 1; i < linhas.length; i++) { // linha 0 = cabeçalho
      const cols = linhas[i];
      if (!cols || !cols.length) continue;

      const chave      = String(cols[1]  ?? '').trim().toLowerCase(); // col B
      const produto     = String(cols[20] ?? '').trim();               // col U
      const quantidade  = toNum(cols[26]);                             // col AA

      if (i === 1 && !diagnostico.amostra) diagnostico.amostra = { totalCols: cols.length, colB: cols[1], colU: cols[20], colAA: cols[26] };

      if (!chave)   { diagnostico.semChave++;   continue; }
      if (!produto) { diagnostico.semProduto++; continue; }

      const posto = postoIdx[chave];
      if (!posto) { diagnostico.semPosto.add(chave); continue; }

      const key = `${posto.id}|${produto}`;
      itensMap.set(key, {
        postoId: posto.id,
        produto,
        quantidade: (itensMap.get(key)?.quantidade || 0) + quantidade,
      });
      diagnostico.ok++;
    }
  }

  console.log('[Estoque Import]', arquivos.map(a => a.originalname), {
    arquivos: arquivos.length,
    amostra: diagnostico.amostra,
    semChave: diagnostico.semChave,
    semProduto: diagnostico.semProduto,
    semPosto: [...diagnostico.semPosto].slice(0, 5),
    itensGerados: itensMap.size,
  });

  if (!itensMap.size) {
    return res.json({
      success: false, postosAtualizados: 0, produtosAtualizados: 0, zerados: 0,
      erros: diagnostico.semChave + diagnostico.semProduto + diagnostico.semPosto.size,
      message: 'Nenhum item válido encontrado. Verifique as colunas B (chave), U (produto) e AA (quantidade).',
    });
  }

  const itens = [...itensMap.values()];
  const porPosto = new Map();
  for (const it of itens) {
    if (!porPosto.has(it.postoId)) porPosto.set(it.postoId, []);
    porPosto.get(it.postoId).push(it);
  }

  let produtosAtualizados = 0;
  let zerados = 0;

  for (const [postoId, itensPosto] of porPosto) {
    const BATCH = 200;
    for (let i = 0; i < itensPosto.length; i += BATCH) {
      const batch = itensPosto.slice(i, i + BATCH);
      const vals = batch.map((_, j) => `($${j*3+1},$${j*3+2},$${j*3+3},NOW())`).join(',');
      await query(
        `INSERT INTO estoque_produtos (posto_id, produto, estoque_atual, updated_at)
         VALUES ${vals}
         ON CONFLICT (posto_id, produto)
         DO UPDATE SET estoque_atual = EXCLUDED.estoque_atual, updated_at = NOW()`,
        batch.flatMap(it => [postoId, it.produto, it.quantidade])
      );
      produtosAtualizados += batch.length;
    }

    // Produtos previamente cadastrados que não vieram nesta importação → zera estoque
    const nomesImportados = itensPosto.map(it => it.produto);
    const { rowCount } = await query(
      `UPDATE estoque_produtos SET estoque_atual = 0, updated_at = NOW()
       WHERE posto_id = $1 AND produto <> ALL($2) AND estoque_atual <> 0`,
      [postoId, nomesImportados]
    );
    zerados += rowCount;
  }

  res.json({
    success: true,
    postosAtualizados: porPosto.size,
    produtosAtualizados,
    zerados,
    erros: diagnostico.semChave + diagnostico.semProduto + diagnostico.semPosto.size + diagnostico.arquivosInvalidos,
    message: `Estoque atualizado: ${produtosAtualizados} produtos em ${porPosto.size} posto(s), a partir de ${arquivos.length} arquivo(s). ${zerados > 0 ? `${zerados} produtos zerados (não vieram nos arquivos).` : ''}`,
  });
});

module.exports = router;
