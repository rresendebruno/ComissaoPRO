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
const crypto   = require('crypto');
const { query }           = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { calcularComissoes } = require('../comissoes');

// Mapa de tokens → caminhos de PDF temporários para envio via link
const tempFiles = new Map();

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
      // vendas brutas por papel (para gerente mostrar total vendido)
      vendas_prop_frentista: f.vendasPropFrentista || 0,
      vendas_prop_trocador:  f.vendasPropTrocador  || 0,
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
# Linha 1: resumo financeiro do posto
pct_posto = float(d['pct_meta_posto'] or 0)
pct_posto_cor = C_GREEN if pct_posto >= 1 else (C_AMBER if pct_posto >= 0.75 else C_RED)

kpis = [
    ['Total Vendas Posto', 'Meta Posto Efetiva', '% Meta Posto', 'Total Comissões'],
    [
        Paragraph(brl(d['total_vendas_posto']), S('kv1', fontSize=12, fontName='Helvetica-Bold', textColor=C_WHITE, alignment=TA_CENTER)),
        Paragraph(brl(d['meta_posto_ef']), S('kv2', fontSize=12, fontName='Helvetica-Bold', textColor=C_WHITE, alignment=TA_CENTER)),
        Paragraph(f"{pct_posto*100:.1f}%", S('kv3', fontSize=12, fontName='Helvetica-Bold', textColor=pct_posto_cor, alignment=TA_CENTER)),
        Paragraph(brl(d['total_comissoes']), S('kv4', fontSize=12, fontName='Helvetica-Bold', textColor=C_GREEN, alignment=TA_CENTER)),
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
    # Destaque na coluna de Total Vendas Posto (primeira)
    ('LINEBELOW', (0,0),(0,0), 2, C_ACCENT),
])
kpi_table = Table(kpis, colWidths=[W/4]*4)
kpi_table.setStyle(kpi_style)
story.append(kpi_table)

# Linha 2 de KPIs: vendas por categoria de funcionário
frentistas_all = [f for f in d['funcionarios'] if f['tipo'] == 'frentista']
trocadores_all = [f for f in d['funcionarios'] if f['tipo'] == 'trocador']
gerentes_all   = [f for f in d['funcionarios'] if f['tipo'] == 'gerente']

total_vend_frent = sum(float(f['total_vendas'] or 0) for f in frentistas_all)
total_vend_troc  = sum(float(f['total_vendas'] or 0) for f in trocadores_all)
total_vend_ger   = sum(float(f['total_vendas'] or 0) for f in gerentes_all)

kpis2 = [
    ['Vendas Frentistas', 'Vendas Trocadores', 'Vendas Gerentes', 'Funcionários'],
    [
        Paragraph(brl(total_vend_frent), S('kv5', fontSize=10, fontName='Helvetica-Bold', textColor=C_TEXT, alignment=TA_CENTER)),
        Paragraph(brl(total_vend_troc),  S('kv6', fontSize=10, fontName='Helvetica-Bold', textColor=C_AMBER, alignment=TA_CENTER)),
        Paragraph(brl(total_vend_ger),   S('kv7', fontSize=10, fontName='Helvetica-Bold', textColor=C_ACCENT, alignment=TA_CENTER)),
        Paragraph(str(len(d['funcionarios'])), S('kv8', fontSize=10, fontName='Helvetica-Bold', textColor=C_MUTED, alignment=TA_CENTER)),
    ]
]
kpi2_style = TableStyle([
    ('BACKGROUND', (0,0),(-1,0), C_SURF2),
    ('BACKGROUND', (0,1),(-1,1), C_SURF),
    ('TEXTCOLOR', (0,0),(-1,0), C_MUTED),
    ('FONTNAME', (0,0),(-1,0), 'Helvetica'),
    ('FONTSIZE', (0,0),(-1,0), 7),
    ('ALIGN', (0,0),(-1,-1), 'CENTER'),
    ('TOPPADDING', (0,0),(-1,-1), 6),
    ('BOTTOMPADDING', (0,0),(-1,-1), 6),
    ('GRID', (0,0),(-1,-1), 0.5, C_BORD),
])
kpi2_table = Table(kpis2, colWidths=[W/4]*4)
kpi2_table.setStyle(kpi2_style)
story.append(Spacer(1, 4))
story.append(kpi2_table)
story.append(Spacer(1, 10))

# ── Separa funcionários ───────────────────────────────────────────────────────
frentistas = frentistas_all
trocadores = trocadores_all
gerentes   = gerentes_all

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

    # MODIFICADO: coluna "Total Vendido" destacada (negrito + cor) como 2ª coluna
    header = [
        Paragraph('Funcionário', sCenterB),
        Paragraph('Total Vendido', sCenterB),   # ← destaque individual
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

        # Total vendido individual — negrito e cor de destaque
        tv = float(f['total_vendas'] or 0)
        tv_style = S('tv', fontSize=8, fontName='Helvetica-Bold',
                     textColor=C_GREEN if tv > 0 else C_MUTED, alignment=TA_RIGHT)

        rows.append([
            nome_p,
            Paragraph(brl(tv), tv_style),          # ← valor individual destacado
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

    # Footer com subtotais
    tot_vendas = sum(float(f['total_vendas'] or 0) for f in lista)
    tot_faixa  = sum(float(f['comissao_faixa'] or 0) for f in lista if not f['desqualificado'])
    tot_esp    = sum(float(f['comissao_especiais'] or 0) for f in lista if not f['desqualificado'])
    tot_total  = sum(float(f['total_comissao'] or 0) for f in lista)
    rows.append([
        Paragraph('SUBTOTAL', sBold),
        Paragraph(brl(tot_vendas), sRightB),   # ← subtotal de vendas
        '', '', '',
        Paragraph(brl(tot_faixa), sRightB),
        Paragraph(brl(tot_esp), sRightB),
        Paragraph(brl(tot_total), sRightG),
    ])

    cw = [W*0.24, W*0.12, W*0.10, W*0.08, W*0.07, W*0.11, W*0.12, W*0.12] # = 0.96, ajuste fino
    # Normaliza para W exato
    total_cw = sum(cw)
    cw = [c * W / total_cw for c in cw]

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
        # Linha de destaque na coluna "Total Vendido" (col 1)
        ('LINEAFTER', (1,0),(1,-1), 1, C_BORD),
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

    # MODIFICADO: adicionada coluna "Total Vendido" para gerentes
    hdr_g = [
        Paragraph('Gerente', sCenterB),
        Paragraph('Total Vendido', sCenterB),   # ← novo
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

        # Total vendido = vendasPropFrentista + vendasPropTrocador
        tv_frent = float(f.get('vendas_prop_frentista') or f.get('total_prop_frent') or 0)
        tv_troc  = float(f.get('vendas_prop_trocador')  or f.get('total_prop_troc')  or 0)
        # Se total_vendas existe e é maior (fallback)
        tv_total_raw = float(f.get('total_vendas') or 0)
        tv_ger = tv_frent + tv_troc if (tv_frent + tv_troc) > 0 else tv_total_raw

        tv_style_g = S('tvg', fontSize=8, fontName='Helvetica-Bold',
                       textColor=C_GREEN if tv_ger > 0 else C_MUTED, alignment=TA_RIGHT)

        rows_g.append([
            nome_p,
            Paragraph(brl(tv_ger), tv_style_g),   # ← total vendido individual
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
            rows_g.append([Paragraph(f"  ↳ {f['motivo_desq']}", sRed), '','','','','','',''])

    # Subtotal gerentes
    tot_tv_g = sum(
        (float(f.get('vendas_prop_frentista') or 0) + float(f.get('vendas_prop_trocador') or 0))
        or float(f.get('total_vendas') or 0)
        for f in gerentes
    )
    tot_g = sum(float(f['total_comissao'] or 0) for f in gerentes)
    rows_g.append([
        Paragraph('SUBTOTAL', sBold),
        Paragraph(brl(tot_tv_g), sRightB),
        '','','','','',
        Paragraph(brl(tot_g), sRightG)
    ])

    cw_g = [W*0.20, W*0.12, W*0.12, W*0.11, W*0.11, W*0.11, W*0.11, W*0.12]
    total_cw_g = sum(cw_g)
    cw_g = [c * W / total_cw_g for c in cw_g]

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
        ('LINEAFTER', (1,0),(1,-1), 1, C_BORD),
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
from datetime import datetime, timezone, timedelta
BRT = timezone(timedelta(hours=-3))
story.append(Spacer(1, 6))
story.append(Paragraph(f"Gerado em {datetime.now(BRT).strftime('%d/%m/%Y %H:%M')} (Brasília)", sMuted))

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

// ─── Envia documento via Z-API ───────────────────────────────────────────────

function getZApiConfig() {
  const { ID_INSTANCIA, TOKEN_INSTANCIA, CLIENT_TOKEN } = process.env;
  if (!ID_INSTANCIA || !TOKEN_INSTANCIA || !CLIENT_TOKEN) {
    throw new Error('ID_INSTANCIA, TOKEN_INSTANCIA e CLIENT_TOKEN devem estar configurados no .env');
  }
  const baseUrl = `https://api.z-api.io/instances/${ID_INSTANCIA}/token/${TOKEN_INSTANCIA}`;
  return { baseUrl, clientToken: CLIENT_TOKEN };
}

// ─── Rota temporária para Z-API buscar o PDF via link ────────────────────────
// A URL inclui o nome do arquivo com .pdf para Z-API usar como filename

router.get('/temp/:token/:filename', (req, res) => {
  const filePath = tempFiles.get(req.params.token);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${req.params.filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

async function enviarParaGrupo(groupId, pdfPath, caption) {
  const { baseUrl, clientToken } = getZApiConfig();
  const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

  const isPublicUrl = PUBLIC_URL &&
    /^https?:\/\//.test(PUBLIC_URL) &&
    !/localhost|127\.0\.0\.1/.test(PUBLIC_URL);

  let url, payload, token;

  if (isPublicUrl) {
    token = crypto.randomBytes(16).toString('hex');
    tempFiles.set(token, pdfPath);
    const fileName = path.basename(pdfPath);
    const fileUrl  = `${PUBLIC_URL}/api/whatsapp/temp/${token}/${encodeURIComponent(fileName)}`;
    url     = `${baseUrl}/send-document/link`;
    payload = { phone: groupId, document: fileUrl, fileName, caption };
    console.log(`[WhatsApp Z-API] Enviando via link: ${fileUrl}`);
  } else {
    const b64 = `data:application/pdf;base64,${fs.readFileSync(pdfPath).toString('base64')}`;
    url     = `${baseUrl}/send-document/local`;
    payload = { phone: groupId, document: b64, fileName: path.basename(pdfPath), caption };
    console.log(`[WhatsApp Z-API] Enviando via base64 para "${groupId}" (nome pode ter .local)`);
  }

  try {
    const resp = await axios.post(url, payload, {
      headers: { 'Client-Token': clientToken, 'Content-Type': 'application/json' },
      timeout: 60000,
    });
    console.log(`[WhatsApp Z-API] Resposta (${resp.status}):`, JSON.stringify(resp.data));

    if (token) {
      // Aguarda Z-API buscar o arquivo antes de liberar para deleção
      await new Promise(resolve => setTimeout(resolve, 8000));
      tempFiles.delete(token);
    }

    return resp.data;
  } catch (e) {
    if (token) tempFiles.delete(token);
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error(`[WhatsApp Z-API] Erro ao enviar para ${groupId}:`, detail);
    throw new Error(`Z-API recusou o envio: ${detail}`);
  }
}

// ─── Rota Principal ───────────────────────────────────────────────────────────

router.post('/disparar/:periodoId', auth, adminOnly, async (req, res) => {
  const periodoId = req.params.periodoId;
  const { posto_ids } = req.body;

  const { rows: pRows } = await query('SELECT * FROM periodos WHERE id=$1', [periodoId]);
  if (!pRows.length) return res.status(404).json({ error: 'Período não encontrado' });
  const periodo = pRows[0];

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
      gerarPDFScript(posto, periodo.nome, dadosPosto, pdfPath);

      const pctPosto   = dadosPosto.pctMetaPosto || 0;
      const totalCom   = dadosPosto.totalComissoes || 0;
      const totalVend  = dadosPosto.totalVendasPosto || 0;
      const emoji      = pctPosto >= 1 ? '✅' : pctPosto >= 0.75 ? '⚠️' : '❌';
      const caption    =
        `${emoji} *Relatório de Comissões*\n` +
        `📍 ${posto.codigo} — ${posto.nome}\n` +
        `📅 ${periodo.nome}\n` +
        `🛒 Total vendido: *${fmt(totalVend)}*\n` +
        `📊 Atingimento: *${(pctPosto * 100).toFixed(1)}%* da meta\n` +
        `💰 Total comissões: *${fmt(totalCom)}*`;

      await enviarParaGrupo(posto.whatsapp_group_id, pdfPath, caption);
      resultados.push({ posto: posto.codigo, nome: posto.nome, status: 'enviado', total: totalCom });
    } catch (e) {
      console.error(`Erro no posto ${posto.codigo}:`, e.message);
      erros.push({ posto: posto.codigo, nome: posto.nome, erro: e.message });
    } finally {
      try { fs.unlinkSync(pdfPath); } catch {}
    }

    if (postos.indexOf(posto) < postos.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

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

// ─── Preview PDF ──────────────────────────────────────────────────────────────

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

// ─── Diagnóstico ──────────────────────────────────────────────────────────────

router.get('/diagnostico', auth, adminOnly, async (req, res) => {
  const { ID_INSTANCIA, TOKEN_INSTANCIA, CLIENT_TOKEN } = process.env;

  const info = {
    ID_INSTANCIA_definido:    !!ID_INSTANCIA,
    TOKEN_INSTANCIA_definido: !!TOKEN_INSTANCIA,
    CLIENT_TOKEN_definido:    !!CLIENT_TOKEN,
    CLIENT_TOKEN_preview:     CLIENT_TOKEN ? CLIENT_TOKEN.substring(0, 6) + '...' : null,
  };

  const PUBLIC_URL = process.env.PUBLIC_URL;
  const isPublicUrl = PUBLIC_URL && /^https?:\/\//.test(PUBLIC_URL) && !/localhost|127\.0\.0\.1/.test(PUBLIC_URL);
  info.PUBLIC_URL_definido = !!PUBLIC_URL;
  info.PUBLIC_URL_valor    = PUBLIC_URL || null;
  info.modo_envio = isPublicUrl ? 'link (sem .local no nome)' : 'base64 (nome vem com .local — configure PUBLIC_URL com URL pública para corrigir)';

  try {
    const { baseUrl } = getZApiConfig();
    info.zapi_ok           = true;
    info.baseUrl           = baseUrl;
    info.send_document_url = PUBLIC_URL
      ? baseUrl + '/send-document/link'
      : baseUrl + '/send-document/local';
  } catch (e) {
    info.zapi_ok    = false;
    info.zapi_erro  = e.message;
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
