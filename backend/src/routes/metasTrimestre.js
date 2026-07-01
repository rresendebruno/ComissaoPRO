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
// Query: periodo_ids (csv), periodo_destino_id, percentual (default 5)

router.get('/preview', auth, adminOnly, async (req, res) => {
  const { periodo_ids, percentual = 5 } = req.query;

  if (!periodo_ids) return res.status(400).json({ error: 'periodo_ids obrigatório' });

  const ids = String(periodo_ids).split(',').map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Nenhum período válido informado' });

  const pct = parseFloat(percentual) || 5;

  // Médias por posto dos períodos selecionados
  const { rows: medias } = await query(`
    SELECT
      m.posto_id,
      p.codigo,
      p.nome      AS posto_nome,
      p.whatsapp_group_id,
      AVG(m.meta_frentista) AS avg_frentista,
      AVG(m.meta_trocador)  AS avg_trocador,
      AVG(m.meta_posto)     AS avg_posto,
      COUNT(*)              AS qtd_periodos
    FROM metas m
    JOIN postos p ON p.id = m.posto_id
    WHERE m.periodo_id = ANY($1)
    GROUP BY m.posto_id, p.codigo, p.nome, p.whatsapp_group_id
    ORDER BY p.codigo
  `, [ids]);

  const fator = 1 + pct / 100;

  const resultado = medias.map(r => ({
    posto_id:      r.posto_id,
    codigo:        r.codigo,
    posto_nome:    r.posto_nome,
    tem_whatsapp:  !!r.whatsapp_group_id,
    qtd_periodos:  Number(r.qtd_periodos),
    avg_frentista: Math.round(parseFloat(r.avg_frentista) * 100) / 100,
    avg_trocador:  Math.round(parseFloat(r.avg_trocador)  * 100) / 100,
    avg_posto:     Math.round(parseFloat(r.avg_posto)     * 100) / 100,
    nova_frentista: Math.round(parseFloat(r.avg_frentista) * fator * 100) / 100,
    nova_trocador:  Math.round(parseFloat(r.avg_trocador)  * fator * 100) / 100,
    nova_posto:     Math.round(parseFloat(r.avg_posto)     * fator * 100) / 100,
  }));

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

module.exports = router;
