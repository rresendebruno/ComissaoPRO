/**
 * WhatsApp Dispatch Route
 * POST /api/whatsapp/disparar/:periodoId
 *
 * Gera um PDF de comissões para cada posto que tenha whatsapp_group_id configurado
 * e envia via Evolution API para o grupo correspondente.
 */

const router   = require('express').Router();
const axios    = require('axios');
const path     = require('path');
const fs       = require('fs');
const { query }           = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { calcularComissoes } = require('../comissoes');

// ─── Helpers de formatação ────────────────────────────────────────────────────

function fmt(v) {
  if (v == null) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

function fmtPct(v) {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function getFaixaLabel(pct, tipo) {
  const p = pct * 100;
  if (tipo === 'trocador') {
    if (p >= 150) return { label: '≥150%', taxa: '15%' };
    if (p >= 100) return { label: '100–150%', taxa: '10%' };
    if (p >= 75)  return { label: '75–100%', taxa: '7%' };
    if (p >= 50)  return { label: '50–75%', taxa: '5%' };
    return { label: '<50%', taxa: '0%' };
  }
  if (tipo === 'gerente') {
    return p >= 100
      ? { label: '≥100%', taxa: '3% posto' }
      : { label: '<100%', taxa: '0%' };
  }
  // frentista
  if (p >= 150) return { label: '≥150%', taxa: '10%' };
  if (p >= 100) return { label: '100–150%', taxa: '6%' };
  if (p >= 75)  return { label: '75–100%', taxa: '4,5%' };
  if (p >= 50)  return { label: '50–75%', taxa: '3%' };
  return { label: '<50%', taxa: '0%' };
}

// ─── Geração de PDF com reportlab via script Python inline ───────────────────

function gerarPDFScript(posto, periodoNome, dadosPosto, outputPath) {
  const { execSync } = require('child_process');

  const funcs     = dadosPosto.funcionarios || [];
  const proRata   = dadosPosto.proRata;
  const fatorPR   = dadosPosto.fatorProRata || 1;
  const diasCorr  = dadosPosto.diasCorridos;
  const diasTot   = dadosPosto.diasTotais;

  // Serializa dados para JSON temporário que o script Python irá ler
  const tmpJson = outputPath.replace('.pdf', '_data.json');
  fs.writeFileSync(tmpJson, JSON.stringify({
    posto_codigo:     posto.codigo,
    posto_nome:       posto.nome,
    periodo_nome:     periodoNome,
    pro_rata:         proRata,
    fator_pro_rata:   fatorPR,
    dias_corridos:    diasCorr,
    dias_totais:      diasTot,
    pct_meta_posto:   dadosPosto.pctMetaPosto,
    meta_frentista:   dadosPosto.metaFrentista,
    meta_trocador:    dadosPosto.metaTrocador,
    meta_posto:       dadosPosto.metaPosto,
    meta_frentista_ef: dadosPosto.metaFrentistaEfetiva,
    meta_trocador_ef:  dadosPosto.metaTrocadorEfetiva,
    meta_posto_ef:     dadosPosto.metaPostoEfetiva,
    total_vendas_posto: dadosPosto.totalVendasPosto,
    total_comissoes:  dadosPosto.totalComissoes,
    funcionarios:     funcs.map(f => ({
      nome:              f.nome,
      tipo:              f.tipo,
      total_vendas:      f.totalVendas,
      meta_efetiva:      f.metaEfetiva,
      pct_meta:          f.pctMeta,
      taxa_comissao:     f.taxaComissao,
      comissao_faixa:    f.comissaoAgregados,
      comissao_especiais:f.comissaoEspeciais,
      total_comissao:    f.totalComissao,
      desqualificado:    f.desqualificado,
      motivo_desq:       f.motivoDesqualificacao || '',
      meta_atingida:     f.metaAtingida,
      comissao_pct_posto:f.comissaoPercentualPosto || 0,
      tambem_trocador:   f.tambemTrocador || false,
      total_prop_frent:  f.totalPropFrentista || 0,
      total_prop_troc:   f.totalPropTrocador || 0,
    })),
  }, null, 2));

  const script = `
import json, sys, os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

# ── Lê dados ──────────────────────────────────────────────────────────────────
with open(sys.argv[1]) as f:
    d = json.load(f)

out = sys.argv[2]

# ── Helpers ───────────────────────────────────────────────────────────────────
def brl(v):
    if v is None: return '—'
    try:
        v = float(v)
    except: return '—'
    s = f'{abs(v):,.2f}'.replace(',','X').replace('.', ',').replace('X','.')
    return f'R$ {s}' if v >= 0 else f'R$ -{s}'

def pct(v):
    try: return f'{float(v)*100:.1f}%'
    except: return '—'

# ── Cores ─────────────────────────────────────────────────────────────────────
C_DARK   = colors.HexColor('#0f1117')
C_SURF   = colors.HexColor('#1a1d27')
C_SURF2  = colors.HexColor('#21253a')
C_BORD   = colors.HexColor('#2a2f45')
C_TEXT   = colors.HexColor('#e8eaf0')
C_MUTED  = colors.HexColor('#6b7394')
C_ACCENT = colors.HexColor('#4f6ef7')
C_GREEN  = colors.HexColor('#22c55e')
C_RED    = colors.HexColor('#ef4444')
C_AMBER  = colors.HexColor('#f59e0b')
C_WHITE  = colors.white

# ── Estilos ───────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def S(name, **kw):
    base = styles['Normal']
    return ParagraphStyle(name, parent=base, **kw)

sTitle   = S('sTitle',   fontSize=18, textColor=C_WHITE,  spaceAfter=2,  fontName='Helvetica-Bold', alignment=TA_LEFT)
sSub     = S('sSub',     fontSize=9,  textColor=C_MUTED,  spaceAfter=0,  fontName='Helvetica')
sSection = S('sSection', fontSize=10, textColor=C_ACCENT, spaceAfter=4,  fontName='Helvetica-Bold', spaceBefore=8)
sNormal  = S('sNormal',  fontSize=8,  textColor=C_TEXT,   fontName='Helvetica')
sMuted   = S('sMuted',   fontSize=7,  textColor=C_MUTED,  fontName='Helvetica')
sBold    = S('sBold',    fontSize=8,  textColor=C_TEXT,   fontName='Helvetica-Bold')
sGreen   = S('sGreen',   fontSize=9,  textColor=C_GREEN,  fontName='Helvetica-Bold', alignment=TA_RIGHT)
sAmber   = S('sAmber',   fontSize=8,  textColor=C_AMBER,  fontName='Helvetica')
sRed     = S('sRed',     fontSize=8,  textColor=C_RED,    fontName='Helvetica')
sCenter  = S('sCenter',  fontSize=8,  textColor=C_TEXT,   fontName='Helvetica', alignment=TA_CENTER)
sCenterB = S('sCenterB', fontSize=8,  textColor=C_TEXT,   fontName='Helvetica-Bold', alignment=TA_CENTER)
sRight   = S('sRight',   fontSize=8,  textColor=C_TEXT,   fontName='Helvetica', alignment=TA_RIGHT)
sRightB  = S('sRightB',  fontSize=8,  textColor=C_TEXT,   fontName='Helvetica-Bold', alignment=TA_RIGHT)
sRightG  = S('sRightG',  fontSize=8,  textColor=C_GREEN,  fontName='Helvetica-Bold', alignment=TA_RIGHT)
sRightR  = S('sRightR',  fontSize=8,  textColor=C_RED,    fontName='Helvetica-Bold', alignment=TA_RIGHT)
sRightA  = S('sRightA',  fontSize=8,  textColor=C_AMBER,  fontName='Helvetica-Bold', alignment=TA_RIGHT)

# ── Documento ─────────────────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    out, pagesize=A4,
    leftMargin=14*mm, rightMargin=14*mm, topMargin=14*mm, bottomMargin=14*mm,
    title=f"Comissoes - {d['posto_codigo']} - {d['periodo_nome']}",
)

story = []
W = A4[0] - 28*mm

# ── Cabeçalho ────────────────────────────────────────────────────────────────
hdr_data = [[
    Paragraph(f"{d['posto_codigo']} — {d['posto_nome']}", sTitle),
    Paragraph(
        f"Período: {d['periodo_nome']}" +
        (f"<br/>Pro rata: {d['dias_corridos']}/{d['dias_totais']} dias ({pct(d['fator_pro_rata'])})" if d['pro_rata'] else ''),
        S('hdrRight', fontSize=9, textColor=C_MUTED, fontName='Helvetica', alignment=TA_RIGHT)
    ),
]]
hdr = Table(hdr_data, colWidths=[W*0.6, W*0.4])
hdr.setStyle(TableStyle([
    ('BACKGROUND', (0,0),(-1,-1), C_SURF),
    ('TOPPADDING', (0,0),(-1,-1), 10),
    ('BOTTOMPADDING', (0,0),(-1,-1), 10),
    ('LEFTPADDING', (0,0),(0,-1), 12),
    ('RIGHTPADDING', (-1,0),(-1,-1), 12),
    ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
    ('ROUNDEDCORNERS', [6,6,6,6]),
]))
story.append(hdr)
story.append(Spacer(1, 8))

# ── KPIs ─────────────────────────────────────────────────────────────────────
pct_posto = float(d['pct_meta_posto'] or 0)
pct_posto_cor = C_GREEN if pct_posto >= 1 else (C_AMBER if pct_posto >= 0.75 else C_RED)

kpis = [
    ['Total Vendas Posto', 'Meta Posto Efetiva', '% Meta Posto', 'Total Comissões'],
    [
        Paragraph(brl(d['total_vendas_posto']), S('kv1', fontSize=11, fontName='Helvetica-Bold', textColor=C_WHITE, alignment=TA_CENTER)),
        Paragraph(brl(d['meta_posto_ef']), S('kv2', fontSize=11, fontName='Helvetica-Bold', textColor=C_WHITE, alignment=TA_CENTER)),
        Paragraph(f"{pct_posto*100:.1f}%", S('kv3', fontSize=11, fontName='Helvetica-Bold', textColor=pct_posto_cor, alignment=TA_CENTER)),
        Paragraph(brl(d['total_comissoes']), S('kv4', fontSize=11, fontName='Helvetica-Bold', textColor=C_GREEN, alignment=TA_CENTER)),
    ]
]

kpi_style = TableStyle([
    ('BACKGROUND', (0,0),(-1,0), C_SURF2),
    ('BACKGROUND', (0,1),(-1,1), C_SURF),
    ('TEXTCOLOR', (0,0),(-1,0), C_MUTED),
    ('FONTNAME', (0,0),(-1,0), 'Helvetica'),
    ('FONTSIZE', (0,0),(-1,0), 7),
    ('ALIGN', (0,0),(-1,-1), 'CENTER'),
    ('TOPPADDING', (0,0),(-1,-1), 8),
    ('BOTTOMPADDING', (0,0),(-1,-1), 8),
    ('GRID', (0,0),(-1,-1), 0.5, C_BORD),
    ('ROUNDEDCORNERS', [4,4,4,4]),
])
kpi_table = Table(kpis, colWidths=[W/4]*4)
kpi_table.setStyle(kpi_style)
story.append(kpi_table)
story.append(Spacer(1, 10))

# ── Separa funcionários ───────────────────────────────────────────────────────
frentistas = [f for f in d['funcionarios'] if f['tipo'] == 'frentista']
trocadores = [f for f in d['funcionarios'] if f['tipo'] == 'trocador']
gerentes   = [f for f in d['funcionarios'] if f['tipo'] == 'gerente']

# ── Função para tabela de frentistas/trocadores ───────────────────────────────
def tabela_frent_troc(lista, titulo, meta_ef, meta_orig, pro_rata):
    if not lista: return
    story.append(Paragraph(titulo, sSection))

    # Sub-info de meta
    meta_txt = f"Meta efetiva: {brl(meta_ef)}"
    if pro_rata and meta_orig:
        meta_txt += f"  (de {brl(meta_orig)} com pro rata)"
    story.append(Paragraph(meta_txt, sMuted))
    story.append(Spacer(1, 4))

    header = [
        Paragraph('Funcionário', sCenterB),
        Paragraph('Total Vendas', sCenterB),
        Paragraph('Meta Efetiva', sCenterB),
        Paragraph('% Meta', sCenterB),
        Paragraph('Taxa', sCenterB),
        Paragraph('Com. Faixa', sCenterB),
        Paragraph('Com. Especiais', sCenterB),
        Paragraph('Total', sCenterB),
    ]
    rows = [header]
    for f in sorted(lista, key=lambda x: -x['total_comissao']):
        desq = f['desqualificado']
        nome_p = Paragraph(
            f"<strike>{f['nome']}</strike> <font color='#ef4444'>[Desq.]</font>" if desq else f['nome'],
            S('fn', fontSize=7, fontName='Helvetica', textColor=C_RED if desq else C_TEXT)
        )
        p_meta = float(f['pct_meta'] or 0)
        cor_pct = C_GREEN if p_meta >= 1 else (C_AMBER if p_meta >= 0.75 else C_RED)
        rows.append([
            nome_p,
            Paragraph(brl(f['total_vendas']), sRight),
            Paragraph(brl(f['meta_efetiva']), sRight),
            Paragraph(f"{p_meta*100:.1f}%", S('pp', fontSize=8, fontName='Helvetica-Bold', textColor=cor_pct, alignment=TA_CENTER)),
            Paragraph('0%' if desq else f"{float(f['taxa_comissao'] or 0)*100:.1f}%", sCenter),
            Paragraph(brl(0 if desq else f['comissao_faixa']), sRight),
            Paragraph(brl(0 if desq else f['comissao_especiais']), sRight),
            Paragraph(brl(f['total_comissao']), sRightR if desq else sRightG),
        ])
        if desq and f['motivo_desq']:
            rows.append([
                Paragraph(f"  ↳ Motivo: {f['motivo_desq']}", sRed),
                '', '', '', '', '', '', ''
            ])

    # Footer
    tot_faixa = sum(float(f['comissao_faixa'] or 0) for f in lista if not f['desqualificado'])
    tot_esp   = sum(float(f['comissao_especiais'] or 0) for f in lista if not f['desqualificado'])
    tot_total = sum(float(f['total_comissao'] or 0) for f in lista)
    rows.append([
        Paragraph('SUBTOTAL', sBold),
        '', '', '', '',
        Paragraph(brl(tot_faixa), sRightB),
        Paragraph(brl(tot_esp), sRightB),
        Paragraph(brl(tot_total), sRightG),
    ])

    cw = [W*0.26, W*0.11, W*0.11, W*0.09, W*0.08, W*0.11, W*0.12, W*0.12]
    t = Table(rows, colWidths=cw, repeatRows=1)
    ts = TableStyle([
        ('BACKGROUND', (0,0),(-1,0), C_SURF2),
        ('BACKGROUND', (0,-1),(-1,-1), C_SURF2),
        ('TEXTCOLOR', (0,0),(-1,0), C_MUTED),
        ('GRID', (0,0),(-1,-1), 0.3, C_BORD),
        ('TOPPADDING', (0,0),(-1,-1), 5),
        ('BOTTOMPADDING', (0,0),(-1,-1), 5),
        ('LEFTPADDING', (0,0),(-1,-1), 4),
        ('RIGHTPADDING', (0,0),(-1,-1), 4),
        ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
        ('SPAN', (1,-1),(6,-1)),
    ])
    # Zebra
    for i in range(1, len(rows)-1):
        if i % 2 == 0:
            ts.add('BACKGROUND', (0,i),(-1,i), colors.HexColor('#1e2133'))
    t.setStyle(ts)
    story.append(t)
    story.append(Spacer(1, 8))

tabela_frent_troc(frentistas, 'Frentistas', d['meta_frentista_ef'], d['meta_frentista'], d['pro_rata'])
tabela_frent_troc(trocadores, 'Trocadores de Oleo', d['meta_trocador_ef'], d['meta_trocador'], d['pro_rata'])

# ── Tabela Gerentes ───────────────────────────────────────────────────────────
if gerentes:
    story.append(Paragraph('Gerentes', sSection))
    meta_posto_txt = f"Meta posto efetiva: {brl(d['meta_posto_ef'])}"
    if d['pro_rata']:
        meta_posto_txt += f"  (de {brl(d['meta_posto'])} com pro rata)"
    story.append(Paragraph(meta_posto_txt, sMuted))
    story.append(Spacer(1, 4))

    hdr_g = [
        Paragraph('Gerente', sCenterB),
        Paragraph('Com. Prop. Frent.', sCenterB),
        Paragraph('Com. Prop. Troc.', sCenterB),
        Paragraph('3% Posto', sCenterB),
        Paragraph('Com. Especial', sCenterB),
        Paragraph('% Meta Posto', sCenterB),
        Paragraph('Total', sCenterB),
    ]
    rows_g = [hdr_g]
    for f in gerentes:
        desq = f['desqualificado']
        p_meta = float(f['pct_meta'] or 0)
        cor_pct = C_GREEN if p_meta >= 1 else (C_AMBER if p_meta >= 0.75 else C_RED)
        nome_p = Paragraph(
            f"<strike>{f['nome']}</strike>" if desq else f['nome'],
            S('gn', fontSize=7, fontName='Helvetica', textColor=C_RED if desq else C_TEXT)
        )
        rows_g.append([
            nome_p,
            Paragraph(brl(0 if desq else f['total_prop_frent']), sRight),
            Paragraph(brl(0 if desq else f['total_prop_troc']), sRight),
            Paragraph(
                brl(0 if desq else f['comissao_pct_posto']),
                sRightG if (not desq and float(f['comissao_pct_posto'] or 0) > 0) else sRight
            ),
            Paragraph(brl(0 if desq else f['comissao_especiais']), sRight),
            Paragraph(f"{p_meta*100:.1f}%", S('gp', fontSize=8, fontName='Helvetica-Bold', textColor=cor_pct, alignment=TA_CENTER)),
            Paragraph(brl(f['total_comissao']), sRightR if desq else sRightG),
        ])
        if desq and f['motivo_desq']:
            rows_g.append([Paragraph(f"  ↳ {f['motivo_desq']}", sRed), '','','','','',''])

    tot_g = sum(float(f['total_comissao'] or 0) for f in gerentes)
    rows_g.append([Paragraph('SUBTOTAL', sBold), '','','','','', Paragraph(brl(tot_g), sRightG)])

    cw_g = [W*0.24, W*0.13, W*0.13, W*0.13, W*0.13, W*0.12, W*0.12]
    tg = Table(rows_g, colWidths=cw_g, repeatRows=1)
    tgs = TableStyle([
        ('BACKGROUND', (0,0),(-1,0), C_SURF2),
        ('BACKGROUND', (0,-1),(-1,-1), C_SURF2),
        ('TEXTCOLOR', (0,0),(-1,0), C_MUTED),
        ('GRID', (0,0),(-1,-1), 0.3, C_BORD),
        ('TOPPADDING', (0,0),(-1,-1), 5),
        ('BOTTOMPADDING', (0,0),(-1,-1), 5),
        ('LEFTPADDING', (0,0),(-1,-1), 4),
        ('RIGHTPADDING', (0,0),(-1,-1), 4),
        ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
    ])
    for i in range(1, len(rows_g)-1):
        if i % 2 == 0:
            tgs.add('BACKGROUND', (0,i),(-1,i), colors.HexColor('#1e2133'))
    tg.setStyle(tgs)
    story.append(tg)
    story.append(Spacer(1, 8))

# ── Rodapé Total Geral ────────────────────────────────────────────────────────
story.append(HRFlowable(width=W, thickness=1, color=C_BORD))
story.append(Spacer(1, 6))
footer_data = [[
    Paragraph('TOTAL GERAL DE COMISSOES', S('ft', fontSize=12, fontName='Helvetica-Bold', textColor=C_WHITE)),
    Paragraph(brl(d['total_comissoes']), S('fv', fontSize=14, fontName='Helvetica-Bold', textColor=C_GREEN, alignment=TA_RIGHT)),
]]
ft = Table(footer_data, colWidths=[W*0.6, W*0.4])
ft.setStyle(TableStyle([
    ('BACKGROUND', (0,0),(-1,-1), C_SURF),
    ('TOPPADDING', (0,0),(-1,-1), 10),
    ('BOTTOMPADDING', (0,0),(-1,-1), 10),
    ('LEFTPADDING', (0,0),(-1,-1), 12),
    ('RIGHTPADDING', (0,0),(-1,-1), 12),
    ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
]))
story.append(ft)

# ── Rodapé geração ────────────────────────────────────────────────────────────
from datetime import datetime
story.append(Spacer(1, 6))
story.append(Paragraph(f"Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')}", sMuted))

# ── Build ─────────────────────────────────────────────────────────────────────
def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(C_DARK)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    canvas.restoreState()

doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
print("OK:" + out)
`;

  const scriptPath = outputPath.replace('.pdf', '_gen.py');
  fs.writeFileSync(scriptPath, script);

  try {
    const result = execSync(`python3 "${scriptPath}" "${tmpJson}" "${outputPath}"`, {
      timeout: 30000,
      encoding: 'utf8',
    });
    return result.trim().startsWith('OK:');
  } catch (e) {
    console.error('PDF generation error:', e.message, e.stderr);
    throw new Error('Falha ao gerar PDF: ' + (e.stderr || e.message));
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(scriptPath); } catch {}
    try { fs.unlinkSync(tmpJson); }   catch {}
  }
}

// ─── Envia documento via Evolution API ───────────────────────────────────────
//
// O EVOURL pode estar em dois formatos:
//   A) URL base:     https://evo2.exemplo.com.br
//   B) URL completa: https://evo2.exemplo.com.br/message/sendText/INSTANCIA
//
// Em ambos os casos extraímos a base e o nome da instância.

function parseEvoConfig() {
  const EVOURL  = process.env.EVOURL;
  const API_KEY = process.env.API_KEY;

  if (!EVOURL || !API_KEY) {
    throw new Error('EVOURL e API_KEY devem estar configurados no .env');
  }

  // Tenta extrair instanceName do padrão: /message/sendText/INSTANCIA
  //                                    ou: /message/sendMedia/INSTANCIA
  //                                    ou: /INSTANCIA (último segmento)
  const sendMatch = EVOURL.match(/\/message\/send\w+\/([^/?#]+)/);
  let instanceName;
  let baseUrl;

  if (sendMatch) {
    // Formato B — extrai base e instância
    instanceName = sendMatch[1];
    // base = tudo antes de /message/
    baseUrl = EVOURL.replace(/\/message\/send\w+\/[^/?#]+.*$/, '');
  } else {
    // Formato A — apenas base URL, instância é o último segmento
    const clean = EVOURL.replace(/\/$/, '');
    const parts = clean.split('/');
    // Heurística: se o último segmento não parece um path de API, é a instância
    const last = parts[parts.length - 1];
    if (last && !['api', 'v1', 'v2'].includes(last.toLowerCase())) {
      instanceName = last;
      baseUrl = parts.slice(0, -1).join('/');
    } else {
      instanceName = null;
      baseUrl = clean;
    }
  }

  if (!instanceName) {
    throw new Error(
      'Não foi possível extrair o nome da instância do EVOURL. ' +
      'Use o formato: https://seu-servidor.com/message/sendText/NOME_INSTANCIA ' +
      'ou configure EVOINSTANCE separadamente.'
    );
  }

  return { baseUrl, instanceName, apiKey: API_KEY };
}

async function enviarParaGrupo(groupId, pdfPath, caption) {
  const { baseUrl, instanceName, apiKey } = parseEvoConfig();

  // Lê o PDF e converte para base64
  const pdfBuffer = fs.readFileSync(pdfPath);
  const b64       = pdfBuffer.toString('base64');

  const payload = {
    number:    groupId,
    mediatype: 'document',
    mimetype:  'application/pdf',
    media:     b64,
    fileName:  path.basename(pdfPath),
    caption:   caption,
  };

  const url = `${baseUrl}/message/sendMedia/${instanceName}`;
  console.log(`[WhatsApp] Enviando para ${groupId} via ${url}`);

  try {
    const resp = await axios.post(url, payload, {
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      timeout: 60000,
    });
    return resp.data;
  } catch (e) {
    const detail = e.response?.data
      ? JSON.stringify(e.response.data)
      : e.message;
    throw new Error(`Evolution API recusou o envio: ${detail}`);
  }
}

// ─── Rota Principal ───────────────────────────────────────────────────────────

router.post('/disparar/:periodoId', auth, adminOnly, async (req, res) => {
  const periodoId = req.params.periodoId;
  const { posto_ids } = req.body; // opcional: array de posto IDs para filtrar

  // Busca período
  const { rows: pRows } = await query('SELECT * FROM periodos WHERE id=$1', [periodoId]);
  if (!pRows.length) return res.status(404).json({ error: 'Período não encontrado' });
  const periodo = pRows[0];

  // Busca postos com grupo WhatsApp configurado
  let postoQuery = 'SELECT * FROM postos WHERE ativo=true AND whatsapp_group_id IS NOT NULL AND TRIM(whatsapp_group_id) != \'\'';
  const postoParams = [];
  if (posto_ids && posto_ids.length) {
    postoQuery += ` AND id = ANY($1)`;
    postoParams.push(posto_ids);
  }
  const { rows: postos } = await query(postoQuery, postoParams);

  if (!postos.length) {
    return res.status(400).json({
      error: 'Nenhum posto com grupo WhatsApp configurado. Configure o ID do grupo no cadastro de postos.'
    });
  }

  // Busca dados para cálculo
  const [
    { rows: vendas },
    { rows: metas },
    { rows: produtosEspeciais },
    { rows: periodoFuncionarios },
  ] = await Promise.all([
    query(`SELECT v.*, p.codigo as posto_codigo, p.nome as posto_nome
           FROM vendas v JOIN postos p ON p.id=v.posto_id
           WHERE v.periodo_id=$1`, [periodoId]),
    query(`SELECT m.*, p.codigo, p.nome as posto_nome
           FROM metas m JOIN postos p ON p.id=m.posto_id
           WHERE m.periodo_id=$1`, [periodoId]),
    query('SELECT * FROM produtos_especiais WHERE ativo=true'),
    query(`SELECT pf.*, p.codigo FROM periodo_funcionarios pf
           JOIN postos p ON p.id=pf.posto_id WHERE pf.periodo_id=$1`, [periodoId]),
  ]);

  let desqualificados = [];
  try {
    const { rows: dq } = await query('SELECT * FROM periodo_desqualificados WHERE periodo_id=$1', [periodoId]);
    desqualificados = dq;
  } catch {}

  const comissoes = calcularComissoes(vendas, metas, produtosEspeciais, periodoFuncionarios, periodo, desqualificados);

  // Pasta temporária para PDFs
  const tmpDir = path.join('/tmp', `whatsapp_${periodoId}_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const resultados = [];
  const erros      = [];

  for (const posto of postos) {
    const postoId     = String(posto.id);
    const dadosPosto  = comissoes[postoId];

    if (!dadosPosto) {
      erros.push({ posto: posto.codigo, erro: 'Nenhuma venda encontrada para este posto no período.' });
      continue;
    }

    const pdfName = `comissoes_${posto.codigo}_${periodo.nome.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    const pdfPath = path.join(tmpDir, pdfName);

    try {
      // Gera PDF
      gerarPDFScript(posto, periodo.nome, dadosPosto, pdfPath);

      // Monta caption
      const pctPosto   = dadosPosto.pctMetaPosto || 0;
      const totalCom   = dadosPosto.totalComissoes || 0;
      const emoji      = pctPosto >= 1 ? '✅' : pctPosto >= 0.75 ? '⚠️' : '❌';
      const caption    =
        `${emoji} *Relatório de Comissões*\n` +
        `📍 ${posto.codigo} — ${posto.nome}\n` +
        `📅 ${periodo.nome}\n` +
        `📊 Atingimento: *${(pctPosto * 100).toFixed(1)}%* da meta\n` +
        `💰 Total comissões: *${fmt(totalCom)}*`;

      // Envia
      await enviarParaGrupo(posto.whatsapp_group_id, pdfPath, caption);
      resultados.push({ posto: posto.codigo, nome: posto.nome, status: 'enviado', total: totalCom });
    } catch (e) {
      console.error(`Erro no posto ${posto.codigo}:`, e.message);
      erros.push({ posto: posto.codigo, nome: posto.nome, erro: e.message });
    } finally {
      try { fs.unlinkSync(pdfPath); } catch {}
    }
  }

  // Remove pasta temp
  try { fs.rmdirSync(tmpDir); } catch {}

  res.json({
    success: resultados.length > 0,
    enviados: resultados.length,
    erros:    erros.length,
    detalhes: { enviados: resultados, erros },
    message:  resultados.length > 0
      ? `${resultados.length} relatório(s) enviado(s) com sucesso${erros.length ? `, ${erros.length} com erro` : ''}.`
      : `Nenhum relatório enviado. ${erros.length} erro(s).`,
  });
});

// ─── Preview PDF (gera e retorna o arquivo) ───────────────────────────────────

router.get('/preview/:periodoId/:postoId', auth, async (req, res) => {
  const { periodoId, postoId } = req.params;

  const { rows: pRows } = await query('SELECT * FROM periodos WHERE id=$1', [periodoId]);
  if (!pRows.length) return res.status(404).json({ error: 'Período não encontrado' });
  const periodo = pRows[0];

  const { rows: postoRows } = await query('SELECT * FROM postos WHERE id=$1', [postoId]);
  if (!postoRows.length) return res.status(404).json({ error: 'Posto não encontrado' });
  const posto = postoRows[0];

  const [
    { rows: vendas },
    { rows: metas },
    { rows: produtosEspeciais },
    { rows: periodoFuncionarios },
  ] = await Promise.all([
    query(`SELECT v.*, p.codigo as posto_codigo FROM vendas v JOIN postos p ON p.id=v.posto_id WHERE v.periodo_id=$1`, [periodoId]),
    query(`SELECT m.*, p.codigo FROM metas m JOIN postos p ON p.id=m.posto_id WHERE m.periodo_id=$1`, [periodoId]),
    query('SELECT * FROM produtos_especiais WHERE ativo=true'),
    query(`SELECT pf.*, p.codigo FROM periodo_funcionarios pf JOIN postos p ON p.id=pf.posto_id WHERE pf.periodo_id=$1`, [periodoId]),
  ]);

  let desq = [];
  try { const { rows } = await query('SELECT * FROM periodo_desqualificados WHERE periodo_id=$1', [periodoId]); desq = rows; } catch {}

  const comissoes   = calcularComissoes(vendas, metas, produtosEspeciais, periodoFuncionarios, periodo, desq);
  const dadosPosto  = comissoes[String(postoId)];
  if (!dadosPosto) return res.status(404).json({ error: 'Nenhuma venda para este posto no período.' });

  const pdfPath = `/tmp/preview_${postoId}_${periodoId}_${Date.now()}.pdf`;
  try {
    gerarPDFScript(posto, periodo.nome, dadosPosto, pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="comissoes_${posto.codigo}.pdf"`);
    const stream = fs.createReadStream(pdfPath);
    stream.on('end', () => { try { fs.unlinkSync(pdfPath); } catch {} });
    stream.pipe(res);
  } catch (e) {
    try { fs.unlinkSync(pdfPath); } catch {}
    res.status(500).json({ error: e.message });
  }
});


// ─── Diagnóstico (admin only) ─────────────────────────────────────────────────
// GET /api/whatsapp/diagnostico
router.get('/diagnostico', auth, adminOnly, async (req, res) => {
  const EVOURL  = process.env.EVOURL;
  const API_KEY = process.env.API_KEY;

  const info = {
    EVOURL_definido:  !!EVOURL,
    EVOURL_valor:     EVOURL ? EVOURL.substring(0, 50) + (EVOURL.length > 50 ? '...' : '') : null,
    API_KEY_definido: !!API_KEY,
    API_KEY_preview:  API_KEY ? API_KEY.substring(0, 6) + '...' : null,
  };

  if (EVOURL && API_KEY) {
    try {
      const { baseUrl, instanceName } = parseEvoConfig();
      info.parse_ok      = true;
      info.baseUrl       = baseUrl;
      info.instanceName  = instanceName;
      info.sendMedia_url = baseUrl + '/message/sendMedia/' + instanceName;
    } catch (e) {
      info.parse_ok    = false;
      info.parse_error = e.message;
    }
  }

  const { execSync } = require('child_process');
  try {
    const v = execSync('python3 -c "import reportlab; print(reportlab.Version)"', { timeout: 5000, encoding: 'utf8' });
    info.python3_reportlab = true;
    info.reportlab_version = v.trim();
  } catch {
    info.python3_reportlab = false;
    info.python3_reportlab_erro = 'python3 ou reportlab nao encontrado no container — necessario para gerar PDFs';
  }

  res.json(info);
});

module.exports = router;
