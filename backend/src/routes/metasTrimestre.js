const router = require('express').Router();
const axios  = require('axios');
const { query } = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getZApiConfig() {
  const { ID_INSTANCIA, TOKEN_INSTANCIA, CLIENT_TOKEN } = process.env;
  if (!ID_INSTANCIA || !TOKEN_INSTANCIA || !CLIENT_TOKEN) {
    throw new Error('ID_INSTANCIA, TOKEN_INSTANCIA e CLIENT_TOKEN devem estar no .env');
  }
  return {
    baseUrl:     `https://api.z-api.io/instances/${ID_INSTANCIA}/token/${TOKEN_INSTANCIA}`,
    clientToken: CLIENT_TOKEN,
  };
}

async function enviarTextoParaGrupo(groupId, message) {
  const { baseUrl, clientToken } = getZApiConfig();
  const headers = { 'Client-Token': clientToken, 'Content-Type': 'application/json' };
  const resp = await axios.post(
    `${baseUrl}/send-text`,
    { phone: groupId, message },
    { headers, timeout: 30000 },
  ).catch(e => {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    throw new Error(`Z-API (texto) recusou: ${detail}`);
  });
  return resp.data;
}

// ── GET /preview ───────────────────────────────────────────────────────────────
// Calcula a média do que FOI REALIZADO (vendas) nos períodos selecionados:
//   meta_posto     = média do total de valor_final do posto por período
//   meta_frentista = média de (total vendas frentistas / qtd frentistas distintos) por período
//   meta_trocador  = média de (total vendas trocadores / qtd trocadores distintos) por período

router.get('/preview', auth, adminOnly, async (req, res) => {
  const { periodo_ids, percentual = 5 } = req.query;

  if (!periodo_ids) return res.status(400).json({ error: 'periodo_ids obrigatório' });

  const ids = String(periodo_ids).split(',').map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Nenhum período válido informado' });

  const pct   = parseFloat(percentual) || 5;
  const fator = 1 + pct / 100;

  // Agrupa por período+posto o que foi realizado nas vendas
  const { rows: realizados } = await query(`
    SELECT
      p.id               AS posto_id,
      p.codigo,
      p.nome             AS posto_nome,
      p.whatsapp_group_id,
      sub.periodo_id,
      sub.total_posto,
      sub.total_frent,
      sub.qtd_frent,
      sub.total_troc,
      sub.qtd_troc
    FROM postos p
    JOIN (
      SELECT
        v.periodo_id,
        v.posto_id,
        SUM(v.valor_final) AS total_posto,
        SUM(CASE WHEN v.tipo_funcionario = 'frentista' THEN v.valor_final ELSE 0 END) AS total_frent,
        COUNT(DISTINCT CASE WHEN v.tipo_funcionario = 'frentista' THEN v.funcionario ELSE NULL END) AS qtd_frent,
        SUM(CASE WHEN v.tipo_funcionario = 'trocador'  THEN v.valor_final ELSE 0 END) AS total_troc,
        COUNT(DISTINCT CASE WHEN v.tipo_funcionario = 'trocador'  THEN v.funcionario ELSE NULL END) AS qtd_troc
      FROM vendas v
      WHERE v.periodo_id = ANY($1)
      GROUP BY v.periodo_id, v.posto_id
    ) sub ON sub.posto_id = p.id
    ORDER BY p.codigo, sub.periodo_id
  `, [ids]);

  if (!realizados.length) {
    return res.status(400).json({ error: 'Nenhuma venda encontrada nos períodos selecionados' });
  }

  // Agrupa por posto e calcula médias
  const porPosto = {};
  for (const r of realizados) {
    if (!porPosto[r.posto_id]) {
      porPosto[r.posto_id] = {
        posto_id:        r.posto_id,
        codigo:          r.codigo,
        posto_nome:      r.posto_nome,
        whatsapp_group_id: r.whatsapp_group_id,
        periodos:        [],
      };
    }
    porPosto[r.posto_id].periodos.push({
      periodo_id:   r.periodo_id,
      total_posto:  parseFloat(r.total_posto) || 0,
      total_frent:  parseFloat(r.total_frent) || 0,
      qtd_frent:    parseInt(r.qtd_frent)     || 0,
      total_troc:   parseFloat(r.total_troc)  || 0,
      qtd_troc:     parseInt(r.qtd_troc)      || 0,
    });
  }

  const resultado = Object.values(porPosto).map(p => {
    const n = p.periodos.length;

    // média do total do posto
    const avg_posto = p.periodos.reduce((s, x) => s + x.total_posto, 0) / n;

    // média do realizado por frentista (ignora períodos sem frentistas)
    const perFrent  = p.periodos.filter(x => x.qtd_frent > 0)
                                .map(x => x.total_frent / x.qtd_frent);
    const avg_frentista = perFrent.length ? perFrent.reduce((s, x) => s + x, 0) / perFrent.length : 0;

    // média do realizado por trocador
    const perTroc   = p.periodos.filter(x => x.qtd_troc > 0)
                                .map(x => x.total_troc / x.qtd_troc);
    const avg_trocador = perTroc.length ? perTroc.reduce((s, x) => s + x, 0) / perTroc.length : 0;

    const r2 = (v) => Math.round(v * 100) / 100;

    return {
      posto_id:       p.posto_id,
      codigo:         p.codigo,
      posto_nome:     p.posto_nome,
      whatsapp_group_id: p.whatsapp_group_id,
      tem_whatsapp:   !!p.whatsapp_group_id,
      qtd_periodos:   n,
      avg_frentista:  r2(avg_frentista),
      avg_trocador:   r2(avg_trocador),
      avg_posto:      r2(avg_posto),
      nova_frentista: r2(avg_frentista * fator),
      nova_trocador:  r2(avg_trocador  * fator),
      nova_posto:     r2(avg_posto     * fator),
    };
  });

  res.json({ resultado, percentual: pct, qtd_periodos_selecionados: ids.length });
});

// ── POST /aplicar ─────────────────────────────────────────────────────────────

router.post('/aplicar', auth, adminOnly, async (req, res) => {
  const { periodo_ids, periodo_destino_id, percentual = 5, notificar_whatsapp = false } = req.body;

  if (!periodo_ids?.length) return res.status(400).json({ error: 'periodo_ids obrigatório' });
  if (!periodo_destino_id)  return res.status(400).json({ error: 'periodo_destino_id obrigatório' });

  const ids  = periodo_ids.map(Number).filter(Boolean);
  const pct  = parseFloat(percentual) || 5;
  const fator = 1 + pct / 100;

  // Verifica período destino
  const { rows: pRows } = await query('SELECT * FROM periodos WHERE id=$1', [periodo_destino_id]);
  if (!pRows.length) return res.status(404).json({ error: 'Período destino não encontrado' });
  const periodoDestino = pRows[0];

  // Médias
  const { rows: medias } = await query(`
    SELECT
      m.posto_id,
      p.codigo,
      p.nome      AS posto_nome,
      p.whatsapp_group_id,
      AVG(m.meta_frentista) AS avg_frentista,
      AVG(m.meta_trocador)  AS avg_trocador,
      AVG(m.meta_posto)     AS avg_posto
    FROM metas m
    JOIN postos p ON p.id = m.posto_id
    WHERE m.periodo_id = ANY($1)
    GROUP BY m.posto_id, p.codigo, p.nome, p.whatsapp_group_id
    ORDER BY p.codigo
  `, [ids]);

  if (!medias.length) {
    return res.status(400).json({ error: 'Nenhuma meta encontrada nos períodos selecionados' });
  }

  // Aplica metas no período destino
  let aplicadas = 0;
  for (const r of medias) {
    const nf = Math.round(parseFloat(r.avg_frentista) * fator * 100) / 100;
    const nt = Math.round(parseFloat(r.avg_trocador)  * fator * 100) / 100;
    const np = Math.round(parseFloat(r.avg_posto)     * fator * 100) / 100;
    await query(
      `INSERT INTO metas (periodo_id, posto_id, meta_frentista, meta_trocador, meta_posto)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (posto_id, periodo_id) DO UPDATE
         SET meta_frentista=$3, meta_trocador=$4, meta_posto=$5`,
      [periodo_destino_id, r.posto_id, nf, nt, np]
    );
    aplicadas++;
  }

  // Notificação WhatsApp
  const wppResultados = [];
  if (notificar_whatsapp) {
    for (const r of medias) {
      if (!r.whatsapp_group_id) continue;
      const nf = Math.round(parseFloat(r.avg_frentista) * fator * 100) / 100;
      const nt = Math.round(parseFloat(r.avg_trocador)  * fator * 100) / 100;
      const np = Math.round(parseFloat(r.avg_posto)     * fator * 100) / 100;

      const msg =
        `🎯 *Novas Metas — ${periodoDestino.nome}*\n\n` +
        `📍 ${r.codigo} — ${r.posto_nome}\n\n` +
        `👷 Frentistas: *${fmt(nf)}*\n` +
        `🔧 Trocadores:  *${fmt(nt)}*\n` +
        `🏪 Posto:       *${fmt(np)}*\n\n` +
        `_(Baseado na média dos últimos ${ids.length} períodos + ${pct}%)_`;

      try {
        await enviarTextoParaGrupo(r.whatsapp_group_id, msg);
        wppResultados.push({ posto: r.codigo, status: 'enviado' });
      } catch (e) {
        console.error(`[MetasTrimestre] WPP erro ${r.codigo}:`, e.message);
        wppResultados.push({ posto: r.codigo, status: 'erro', erro: e.message });
      }
    }
  }

  res.json({
    success: true,
    aplicadas,
    periodo_destino: periodoDestino.nome,
    percentual: pct,
    whatsapp: wppResultados,
    message: `${aplicadas} metas aplicadas no período "${periodoDestino.nome}"${notificar_whatsapp ? `. ${wppResultados.filter(r => r.status === 'enviado').length} grupos notificados.` : ''}`,
  });
});

// ── POST /aplicar-valores ─────────────────────────────────────────────────────
// Aplica valores já calculados/editados pelo usuário no frontend.
// Body: { periodo_destino_id, metas: [{posto_id, codigo, posto_nome, meta_frentista, meta_trocador, meta_posto, whatsapp_group_id?}], notificar_whatsapp }

router.post('/aplicar-valores', auth, adminOnly, async (req, res) => {
  const { periodo_destino_id, metas: metasInput, notificar_whatsapp = false } = req.body;

  if (!periodo_destino_id)     return res.status(400).json({ error: 'periodo_destino_id obrigatório' });
  if (!metasInput?.length)     return res.status(400).json({ error: 'metas obrigatório' });

  const { rows: pRows } = await query('SELECT * FROM periodos WHERE id=$1', [periodo_destino_id]);
  if (!pRows.length) return res.status(404).json({ error: 'Período destino não encontrado' });
  const periodoDestino = pRows[0];

  let aplicadas = 0;
  for (const m of metasInput) {
    await query(
      `INSERT INTO metas (periodo_id, posto_id, meta_frentista, meta_trocador, meta_posto)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (posto_id, periodo_id) DO UPDATE
         SET meta_frentista=$3, meta_trocador=$4, meta_posto=$5`,
      [periodo_destino_id, m.posto_id,
       parseFloat(m.meta_frentista) || 0,
       parseFloat(m.meta_trocador)  || 0,
       parseFloat(m.meta_posto)     || 0]
    );
    aplicadas++;
  }

  const wppResultados = [];
  if (notificar_whatsapp) {
    for (const m of metasInput) {
      if (!m.whatsapp_group_id) continue;
      const msg =
        `🎯 *Novas Metas — ${periodoDestino.nome}*\n\n` +
        `📍 ${m.codigo} — ${m.posto_nome}\n\n` +
        `👷 Frentistas: *${fmt(parseFloat(m.meta_frentista) || 0)}*\n` +
        `🔧 Trocadores:  *${fmt(parseFloat(m.meta_trocador)  || 0)}*\n` +
        `🏪 Posto:       *${fmt(parseFloat(m.meta_posto)     || 0)}*`;
      try {
        await enviarTextoParaGrupo(m.whatsapp_group_id, msg);
        wppResultados.push({ posto: m.codigo, status: 'enviado' });
      } catch (e) {
        console.error(`[MetasTrimestre] WPP erro ${m.codigo}:`, e.message);
        wppResultados.push({ posto: m.codigo, status: 'erro', erro: e.message });
      }
    }
  }

  res.json({
    success: true,
    aplicadas,
    periodo_destino: periodoDestino.nome,
    whatsapp: wppResultados,
    message: `${aplicadas} metas aplicadas no período "${periodoDestino.nome}"${notificar_whatsapp ? `. ${wppResultados.filter(r => r.status === 'enviado').length} grupos notificados.` : ''}`,
  });
});

module.exports = router;
