/**
 * Relatórios Route
 * GET /api/relatorios/postos          → resumo de vendas por posto
 * GET /api/relatorios/funcionarios    → resumo de vendas por funcionário
 * GET /api/relatorios/detalhado       → detalhe de produtos por funcionário
 *
 * Query params comuns:
 *   periodo_id  (obrigatório)
 *   posto_id    (opcional, filtra um posto)
 *   formato     csv | xlsx | pdf  (default: pdf)
 */

const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const XLSX   = require('xlsx');
const { query }           = require('../db');
const { auth }            = require('../middleware/auth');
const { calcularComissoes } = require('../comissoes');

const N = v => (v == null ? 0 : Number(v) || 0);

// ── Helpers BRL ───────────────────────────────────────────────────────────────
function brl(v) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(N(v));
}
function pctStr(v) { return `${(N(v) * 100).toFixed(1)}%`; }

// ── CSV simples ───────────────────────────────────────────────────────────────
function toCSV(headers, rows) {
  const escape = v => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) lines.push(row.map(escape).join(','));
  return '\uFEFF' + lines.join('\r\n'); // BOM para Excel pt-BR
}

// ── XLSX em buffer ────────────────────────────────────────────────────────────
function toXLSX(sheets) {
  // sheets: [{ name, headers, rows, colWidths? }]
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const data = [s.headers, ...s.rows];
    const ws   = XLSX.utils.aoa_to_sheet(data);

    // Larguras de coluna
    if (s.colWidths) {
      ws['!cols'] = s.colWidths.map(w => ({ wch: w }));
    }

    // Estilo do cabeçalho (negrito via s.headers)
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
      if (cell) {
        cell.s = {
          font: { bold: true },
          fill: { fgColor: { rgb: '1a1d27' } },
        };
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, s.name.substring(0, 31));
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

// ── PDF via Python/reportlab ──────────────────────────────────────────────────
function gerarPDF(tipo, dadosPDF, outputPath) {
  const { execSync } = require('child_process');
  const tmpJson = outputPath.replace('.pdf', '_data.json');
  fs.writeFileSync(tmpJson, JSON.stringify(dadosPDF, null, 2));

  const scripts = {
    postos:       scriptPostos(),
    funcionarios: scriptFuncionarios(),
    detalhado:    scriptDetalhado(),
  };

  const scriptPath = outputPath.replace('.pdf', '_gen.py');
  fs.writeFileSync(scriptPath, scripts[tipo]);

  try {
    const r = execSync(`python3 "${scriptPath}" "${tmpJson}" "${outputPath}"`, {
      timeout: 60000, encoding: 'utf8',
    });
    return r.trim().startsWith('OK:');
  } catch (e) {
    console.error('PDF error:', e.stderr || e.message);
    throw new Error('Falha ao gerar PDF: ' + (e.stderr || e.message));
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
    try { fs.unlinkSync(tmpJson); }   catch {}
  }
}

// ── Scripts Python ────────────────────────────────────────────────────────────

function pyHeader() {
  return `
import json, sys
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from datetime import datetime, timezone, timedelta

with open(sys.argv[1]) as f:
    d = json.load(f)
out = sys.argv[2]

BRT = timezone(timedelta(hours=-3))

def brl(v):
    if v is None: return '—'
    try: v = float(v)
    except: return '—'
    s = f'{abs(v):,.2f}'.replace(',','X').replace('.', ',').replace('X','.')
    return f'R$ {s}' if v >= 0 else f'R$ -{s}'

def pct(v):
    try: return f'{float(v)*100:.1f}%'
    except: return '—'

C_DARK   = colors.HexColor('#0f1117')
C_SURF   = colors.HexColor('#1a1d27')
C_SURF2  = colors.HexColor('#21253a')
C_SURF3  = colors.HexColor('#1e2133')
C_BORD   = colors.HexColor('#2a2f45')
C_TEXT   = colors.HexColor('#e8eaf0')
C_MUTED  = colors.HexColor('#6b7394')
C_DIM    = colors.HexColor('#9099b8')
C_ACCENT = colors.HexColor('#4f6ef7')
C_GREEN  = colors.HexColor('#22c55e')
C_RED    = colors.HexColor('#ef4444')
C_AMBER  = colors.HexColor('#f59e0b')
C_WHITE  = colors.white

styles = getSampleStyleSheet()
def S(name, **kw):
    return ParagraphStyle(name, parent=styles['Normal'], **kw)

sTitle   = S('T',  fontSize=16, textColor=C_WHITE,  fontName='Helvetica-Bold')
sSub     = S('Su', fontSize=9,  textColor=C_MUTED,  fontName='Helvetica')
sSec     = S('Sc', fontSize=10, textColor=C_ACCENT, fontName='Helvetica-Bold', spaceBefore=10, spaceAfter=4)
sMuted   = S('Mu', fontSize=7,  textColor=C_MUTED,  fontName='Helvetica')
sBold    = S('Bo', fontSize=8,  textColor=C_TEXT,   fontName='Helvetica-Bold')
sNorm    = S('No', fontSize=8,  textColor=C_TEXT,   fontName='Helvetica')
sCB      = S('CB', fontSize=7,  textColor=C_DIM,    fontName='Helvetica-Bold', alignment=TA_CENTER)
sCC      = S('CC', fontSize=8,  textColor=C_TEXT,   fontName='Helvetica',      alignment=TA_CENTER)
sR       = S('R',  fontSize=8,  textColor=C_TEXT,   fontName='Helvetica',      alignment=TA_RIGHT)
sRB      = S('RB', fontSize=8,  textColor=C_TEXT,   fontName='Helvetica-Bold', alignment=TA_RIGHT)
sRG      = S('RG', fontSize=8,  textColor=C_GREEN,  fontName='Helvetica-Bold', alignment=TA_RIGHT)
sRA      = S('RA', fontSize=8,  textColor=C_AMBER,  fontName='Helvetica-Bold', alignment=TA_RIGHT)
sRR      = S('RR', fontSize=8,  textColor=C_RED,    fontName='Helvetica-Bold', alignment=TA_RIGHT)
sGr      = S('Gr', fontSize=8,  textColor=C_GREEN,  fontName='Helvetica-Bold')
sAm      = S('Am', fontSize=8,  textColor=C_AMBER,  fontName='Helvetica-Bold')
sRd      = S('Rd', fontSize=8,  textColor=C_RED,    fontName='Helvetica-Bold')

def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(C_DARK)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    canvas.restoreState()

def on_page_land(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(C_DARK)
    canvas.rect(0, 0, A4[1], A4[0], fill=1, stroke=0)
    canvas.restoreState()

def make_header(story, W, titulo, subtitulo, periodo_nome):
    data = [[
        Paragraph(titulo, sTitle),
        Paragraph(f'Período: {periodo_nome}<br/>{subtitulo}',
                  S('HR', fontSize=9, textColor=C_MUTED, fontName='Helvetica', alignment=TA_RIGHT)),
    ]]
    t = Table(data, colWidths=[W*0.6, W*0.4])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0),(-1,-1), C_SURF),
        ('TOPPADDING',    (0,0),(-1,-1), 10),
        ('BOTTOMPADDING', (0,0),(-1,-1), 10),
        ('LEFTPADDING',   (0,0),(0,-1),  12),
        ('RIGHTPADDING',  (-1,0),(-1,-1),12),
        ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
    ]))
    story.append(t)
    story.append(Spacer(1, 10))
`;
}

function scriptPostos() {
  return pyHeader() + `
# ── Relatório por Posto ───────────────────────────────────────────────────────
doc = SimpleDocTemplate(out, pagesize=A4,
    leftMargin=14*mm, rightMargin=14*mm, topMargin=14*mm, bottomMargin=14*mm)
story = []
W = A4[0] - 28*mm

make_header(story, W, 'Vendas por Posto', f"Gerado em {datetime.now(BRT).strftime('%d/%m/%Y %H:%M')}", d['periodo_nome'])

postos = d['postos']

# KPIs globais
total_geral  = sum(float(p['total_vendas']) for p in postos)
total_com    = sum(float(p['total_comissoes']) for p in postos)
meta_geral   = sum(float(p['meta_posto']) for p in postos)

kpi_data = [
    ['Total Vendido', 'Meta Consolidada', 'Atingimento Médio', 'Total Comissões', 'Postos'],
    [
        Paragraph(brl(total_geral), S('k1', fontSize=12, fontName='Helvetica-Bold', textColor=C_WHITE, alignment=TA_CENTER)),
        Paragraph(brl(meta_geral),  S('k2', fontSize=12, fontName='Helvetica-Bold', textColor=C_WHITE, alignment=TA_CENTER)),
        Paragraph(pct(total_geral/meta_geral if meta_geral else 0), S('k3', fontSize=12, fontName='Helvetica-Bold',
            textColor=(C_GREEN if meta_geral and total_geral/meta_geral >= 1 else C_AMBER), alignment=TA_CENTER)),
        Paragraph(brl(total_com),   S('k4', fontSize=12, fontName='Helvetica-Bold', textColor=C_GREEN, alignment=TA_CENTER)),
        Paragraph(str(len(postos)), S('k5', fontSize=12, fontName='Helvetica-Bold', textColor=C_MUTED, alignment=TA_CENTER)),
    ]
]
kt = Table(kpi_data, colWidths=[W/5]*5)
kt.setStyle(TableStyle([
    ('BACKGROUND', (0,0),(-1,0), C_SURF2),
    ('BACKGROUND', (0,1),(-1,1), C_SURF),
    ('TEXTCOLOR', (0,0),(-1,0), C_MUTED),
    ('FONTNAME',  (0,0),(-1,0), 'Helvetica'),
    ('FONTSIZE',  (0,0),(-1,0), 7),
    ('ALIGN', (0,0),(-1,-1), 'CENTER'),
    ('TOPPADDING',    (0,0),(-1,-1), 8),
    ('BOTTOMPADDING', (0,0),(-1,-1), 8),
    ('GRID', (0,0),(-1,-1), 0.5, C_BORD),
]))
story.append(kt)
story.append(Spacer(1, 14))

# Tabela principal
story.append(Paragraph('Detalhamento por Posto', sSec))
hdr = [
    Paragraph('Posto', sCB), Paragraph('Nome', sCB),
    Paragraph('Total Vendas', sCB), Paragraph('Meta Efetiva', sCB),
    Paragraph('% Meta', sCB), Paragraph('Frentistas', sCB),
    Paragraph('Trocadores', sCB), Paragraph('Gerentes', sCB),
    Paragraph('Com. Total', sCB),
]
rows = [hdr]
for p in sorted(postos, key=lambda x: x['codigo']):
    pm = float(p['pct_meta'])
    cor = C_GREEN if pm >= 1 else (C_AMBER if pm >= 0.75 else C_RED)
    rows.append([
        Paragraph(p['codigo'],    S('pc', fontSize=8, textColor=C_ACCENT, fontName='Helvetica-Bold')),
        Paragraph(p['nome'],      sNorm),
        Paragraph(brl(p['total_vendas']),    sRB),
        Paragraph(brl(p['meta_posto']),      sR),
        Paragraph(pct(pm), S('pp', fontSize=8, fontName='Helvetica-Bold', textColor=cor, alignment=TA_CENTER)),
        Paragraph(str(p['qtd_frentistas']),  sCC),
        Paragraph(str(p['qtd_trocadores']),  sCC),
        Paragraph(str(p['qtd_gerentes']),    sCC),
        Paragraph(brl(p['total_comissoes']), sRG),
    ])

rows.append([
    Paragraph('TOTAL', sBold), Paragraph('', sNorm),
    Paragraph(brl(total_geral), sRG),
    Paragraph(brl(meta_geral),  sRB),
    Paragraph('', sNorm),
    Paragraph('', sNorm), Paragraph('', sNorm), Paragraph('', sNorm),
    Paragraph(brl(total_com), sRG),
])

cw = [W*0.07, W*0.22, W*0.13, W*0.12, W*0.08, W*0.09, W*0.09, W*0.09, W*0.11]
t = Table(rows, colWidths=cw, repeatRows=1)
ts = TableStyle([
    ('BACKGROUND', (0,0),(-1,0),  C_SURF2),
    ('BACKGROUND', (0,-1),(-1,-1), C_SURF2),
    ('GRID', (0,0),(-1,-1), 0.3, C_BORD),
    ('TOPPADDING',    (0,0),(-1,-1), 5),
    ('BOTTOMPADDING', (0,0),(-1,-1), 5),
    ('LEFTPADDING',   (0,0),(-1,-1), 4),
    ('RIGHTPADDING',  (0,0),(-1,-1), 4),
    ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
])
for i in range(1, len(rows)-1):
    if i % 2 == 0: ts.add('BACKGROUND', (0,i),(-1,i), C_SURF3)
t.setStyle(ts)
story.append(t)

story.append(Spacer(1, 8))
story.append(Paragraph(f"Gerado em {datetime.now(BRT).strftime('%d/%m/%Y %H:%M')} (Brasília) — ComissõesPRO", sMuted))

doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
print("OK:" + out)
`;
}

function scriptFuncionarios() {
  return pyHeader() + `
# ── Relatório por Funcionário ─────────────────────────────────────────────────
doc = SimpleDocTemplate(out, pagesize=landscape(A4),
    leftMargin=14*mm, rightMargin=14*mm, topMargin=14*mm, bottomMargin=14*mm)
story = []
W = A4[1] - 28*mm  # landscape: maior dimensão é a largura

make_header(story, W, 'Vendas por Funcionário', f"Gerado em {datetime.now(BRT).strftime('%d/%m/%Y %H:%M')}", d['periodo_nome'])

funcs = d['funcionarios']

total_geral = sum(float(f['total_vendas']) for f in funcs)
total_com   = sum(float(f['total_comissao']) for f in funcs)

kpi_data = [
    ['Total Vendido', 'Total Comissões', 'Funcionários', 'Qualificados', 'Desqualificados'],
    [
        Paragraph(brl(total_geral),  S('k1', fontSize=11, fontName='Helvetica-Bold', textColor=C_WHITE, alignment=TA_CENTER)),
        Paragraph(brl(total_com),    S('k2', fontSize=11, fontName='Helvetica-Bold', textColor=C_GREEN, alignment=TA_CENTER)),
        Paragraph(str(len(funcs)),   S('k3', fontSize=11, fontName='Helvetica-Bold', textColor=C_MUTED, alignment=TA_CENTER)),
        Paragraph(str(sum(1 for f in funcs if not f['desqualificado'])), S('k4', fontSize=11, fontName='Helvetica-Bold', textColor=C_GREEN, alignment=TA_CENTER)),
        Paragraph(str(sum(1 for f in funcs if f['desqualificado'])),     S('k5', fontSize=11, fontName='Helvetica-Bold', textColor=C_RED, alignment=TA_CENTER)),
    ]
]
kt = Table(kpi_data, colWidths=[W/5]*5)
kt.setStyle(TableStyle([
    ('BACKGROUND', (0,0),(-1,0), C_SURF2),
    ('BACKGROUND', (0,1),(-1,1), C_SURF),
    ('TEXTCOLOR', (0,0),(-1,0), C_MUTED),
    ('FONTNAME',  (0,0),(-1,0), 'Helvetica'),
    ('FONTSIZE',  (0,0),(-1,0), 7),
    ('ALIGN', (0,0),(-1,-1), 'CENTER'),
    ('TOPPADDING', (0,0),(-1,-1), 7),
    ('BOTTOMPADDING', (0,0),(-1,-1), 7),
    ('GRID', (0,0),(-1,-1), 0.5, C_BORD),
]))
story.append(kt)
story.append(Spacer(1, 14))

story.append(Paragraph('Detalhamento por Funcionário', sSec))

hdr = [
    Paragraph('Posto', sCB), Paragraph('Funcionário', sCB), Paragraph('Tipo', sCB),
    Paragraph('Total Vendas', sCB), Paragraph('Meta Efetiva', sCB), Paragraph('% Meta', sCB),
    Paragraph('Taxa', sCB), Paragraph('Com. Faixa', sCB),
    Paragraph('Com. Especiais', sCB), Paragraph('Total Comissão', sCB), Paragraph('Status', sCB),
]
rows = [hdr]

TIPO_COR = {'frentista': C_DIM, 'trocador': C_AMBER, 'gerente': C_ACCENT}

for f in sorted(funcs, key=lambda x: (x['posto_codigo'], x['tipo'], x['nome'])):
    desq = f['desqualificado']
    pm = float(f['pct_meta'])
    cor_pct = C_GREEN if pm >= 1 else (C_AMBER if pm >= 0.75 else C_RED)
    tc = TIPO_COR.get(f['tipo'], C_DIM)
    nome_txt = f"<strike>{f['nome']}</strike>" if desq else f['nome']
    rows.append([
        Paragraph(f['posto_codigo'],  S('po', fontSize=7, textColor=C_ACCENT, fontName='Helvetica-Bold')),
        Paragraph(nome_txt, S('fn', fontSize=7, textColor=C_RED if desq else C_TEXT, fontName='Helvetica')),
        Paragraph(f['tipo'],  S('ti', fontSize=7, textColor=tc, fontName='Helvetica-Bold', alignment=TA_CENTER)),
        Paragraph(brl(f['total_vendas']),    sRB),
        Paragraph(brl(f['meta_efetiva']),    sR),
        Paragraph(pct(pm), S('pp', fontSize=7, fontName='Helvetica-Bold', textColor=cor_pct, alignment=TA_CENTER)),
        Paragraph(f"{float(f['taxa_comissao'])*100:.1f}%" if not desq else '0%', sCC),
        Paragraph(brl(f['comissao_faixa']),    sR),
        Paragraph(brl(f['comissao_especiais']), sR),
        Paragraph(brl(f['total_comissao']), sRR if desq else sRG),
        Paragraph('Desq.' if desq else 'OK', S('st', fontSize=7, fontName='Helvetica-Bold',
            textColor=C_RED if desq else C_GREEN, alignment=TA_CENTER)),
    ])

rows.append([
    Paragraph('TOTAL', sBold), Paragraph('', sNorm), Paragraph('', sNorm),
    Paragraph(brl(total_geral), sRG),
    Paragraph('', sNorm), Paragraph('', sNorm), Paragraph('', sNorm),
    Paragraph(brl(sum(float(f['comissao_faixa']) for f in funcs)), sRB),
    Paragraph(brl(sum(float(f['comissao_especiais']) for f in funcs)), sRB),
    Paragraph(brl(total_com), sRG),
    Paragraph('', sNorm),
])

cw = [W*0.06, W*0.19, W*0.07, W*0.10, W*0.09, W*0.07, W*0.06, W*0.09, W*0.09, W*0.10, W*0.06]
total_cw = sum(cw); cw = [c*W/total_cw for c in cw]

t = Table(rows, colWidths=cw, repeatRows=1)
ts = TableStyle([
    ('BACKGROUND', (0,0),(-1,0),  C_SURF2),
    ('BACKGROUND', (0,-1),(-1,-1), C_SURF2),
    ('GRID', (0,0),(-1,-1), 0.3, C_BORD),
    ('TOPPADDING',    (0,0),(-1,-1), 4),
    ('BOTTOMPADDING', (0,0),(-1,-1), 4),
    ('LEFTPADDING',   (0,0),(-1,-1), 3),
    ('RIGHTPADDING',  (0,0),(-1,-1), 3),
    ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
])
for i in range(1, len(rows)-1):
    if i % 2 == 0: ts.add('BACKGROUND', (0,i),(-1,i), C_SURF3)
    if funcs[i-1]['desqualificado']:
        ts.add('BACKGROUND', (0,i),(-1,i), colors.HexColor('#2a1515'))
t.setStyle(ts)
story.append(t)

story.append(Spacer(1, 8))
story.append(Paragraph(f"Gerado em {datetime.now(BRT).strftime('%d/%m/%Y %H:%M')} (Brasília) — ComissõesPRO", sMuted))

doc.build(story, onFirstPage=on_page_land, onLaterPages=on_page_land)
print("OK:" + out)
`;
}

function scriptDetalhado() {
  return pyHeader() + `
# ── Relatório Detalhado por Funcionário ───────────────────────────────────────
doc = SimpleDocTemplate(out, pagesize=landscape(A4),
    leftMargin=14*mm, rightMargin=14*mm, topMargin=14*mm, bottomMargin=14*mm)
story = []
W = A4[1] - 28*mm

make_header(story, W, 'Produtos por Funcionário — Detalhado',
            f"Gerado em {datetime.now(BRT).strftime('%d/%m/%Y %H:%M')}", d['periodo_nome'])

grupos = d['grupos']  # lista de { posto_codigo, posto_nome, funcionario, tipo, produtos: [...] }

TIPO_COR = {'frentista': C_DIM, 'trocador': C_AMBER, 'gerente': C_ACCENT}

for g in grupos:
    tc = TIPO_COR.get(g['tipo'], C_DIM)
    label = f"{g['posto_codigo']} — {g['funcionario']}"
    tipo_label = g['tipo'].capitalize()
    story.append(Paragraph(
        f'{label} <font color="#6b7394">({tipo_label} · {g["posto_nome"]})</font>',
        S('GL', fontSize=9, textColor=C_TEXT, fontName='Helvetica-Bold', spaceBefore=8, spaceAfter=3)
    ))

    hdr = [
        Paragraph('Produto', sCB),
        Paragraph('Especial', sCB),
        Paragraph('Qtde', sCB),
        Paragraph('Vl. Unit.', sCB),
        Paragraph('Vl. Total', sCB),
        Paragraph('Com./un', sCB),
        Paragraph('Com. Especial', sCB),
    ]
    rows = [hdr]

    total_vl = 0; total_com_esp = 0
    for p in g['produtos']:
        esp = bool(p['especial'])
        total_vl     += float(p['valor_total'])
        total_com_esp += float(p['com_especial'])
        rows.append([
            Paragraph(p['produto'],
                S('pr', fontSize=7, textColor=C_AMBER if esp else C_TEXT, fontName='Helvetica')),
            Paragraph('★ Especial' if esp else '—',
                S('es', fontSize=7, textColor=C_AMBER if esp else C_MUTED,
                  fontName='Helvetica-Bold' if esp else 'Helvetica', alignment=TA_CENTER)),
            Paragraph(f"{float(p['quantidade']):.3f}".rstrip('0').rstrip('.'),
                S('qt', fontSize=7, textColor=C_TEXT, fontName='Helvetica', alignment=TA_RIGHT)),
            Paragraph(brl(p['valor_unit']), sR),
            Paragraph(brl(p['valor_total']), sRB),
            Paragraph(brl(p['com_unit']) if esp else '—',
                S('cu', fontSize=7, textColor=C_AMBER if esp else C_MUTED,
                  fontName='Helvetica', alignment=TA_RIGHT)),
            Paragraph(brl(p['com_especial']) if esp else '—',
                S('ce', fontSize=7, textColor=C_AMBER if esp else C_MUTED,
                  fontName='Helvetica-Bold' if esp else 'Helvetica', alignment=TA_RIGHT)),
        ])

    rows.append([
        Paragraph('SUBTOTAL', sBold), Paragraph('', sNorm),
        Paragraph(str(len(g['produtos'])) + ' itens', S('ni', fontSize=7, textColor=C_MUTED, fontName='Helvetica', alignment=TA_RIGHT)),
        Paragraph('', sNorm),
        Paragraph(brl(total_vl), sRB),
        Paragraph('', sNorm),
        Paragraph(brl(total_com_esp) if total_com_esp else '—', sRA),
    ])

    cw = [W*0.36, W*0.10, W*0.08, W*0.10, W*0.12, W*0.10, W*0.14]
    total_cw = sum(cw); cw = [c*W/total_cw for c in cw]

    t = Table(rows, colWidths=cw, repeatRows=1)
    ts = TableStyle([
        ('BACKGROUND', (0,0),(-1,0),  C_SURF2),
        ('BACKGROUND', (0,-1),(-1,-1), C_SURF2),
        ('GRID', (0,0),(-1,-1), 0.3, C_BORD),
        ('TOPPADDING',    (0,0),(-1,-1), 3),
        ('BOTTOMPADDING', (0,0),(-1,-1), 3),
        ('LEFTPADDING',   (0,0),(-1,-1), 3),
        ('RIGHTPADDING',  (0,0),(-1,-1), 3),
        ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
    ])
    for i in range(1, len(rows)-1):
        if i % 2 == 0: ts.add('BACKGROUND', (0,i),(-1,i), C_SURF3)
        if g['produtos'][i-1]['especial']:
            ts.add('BACKGROUND', (1,i),(1,i), colors.HexColor('#2a2010'))
    t.setStyle(ts)
    story.append(t)

story.append(Spacer(1, 10))
story.append(HRFlowable(width=W, thickness=1, color=C_BORD))
story.append(Spacer(1, 6))
story.append(Paragraph(f"Gerado em {datetime.now(BRT).strftime('%d/%m/%Y %H:%M')} (Brasília) — ComissõesPRO", sMuted))

doc.build(story, onFirstPage=on_page_land, onLaterPages=on_page_land)
print("OK:" + out)
`;
}

// ─── Coleta de dados ──────────────────────────────────────────────────────────

async function coletarDados(periodoId, postoIdFiltro) {
  const filtroVendas = postoIdFiltro
    ? 'AND v.posto_id=$2'
    : '';
  const paramsVendas = postoIdFiltro
    ? [periodoId, postoIdFiltro]
    : [periodoId];

  const [
    { rows: periodo },
    { rows: vendas },
    { rows: metas },
    { rows: produtosEspeciais },
    { rows: periodoFuncionarios },
  ] = await Promise.all([
    query('SELECT * FROM periodos WHERE id=$1', [periodoId]),
    query(`SELECT v.*, p.codigo as posto_codigo, p.nome as posto_nome
           FROM vendas v JOIN postos p ON p.id=v.posto_id
           WHERE v.periodo_id=$1 ${filtroVendas}
           ORDER BY p.codigo, v.funcionario, v.produto`, paramsVendas),
    query(`SELECT m.*, p.codigo, p.nome as posto_nome
           FROM metas m JOIN postos p ON p.id=m.posto_id
           WHERE m.periodo_id=$1`, [periodoId]),
    query('SELECT * FROM produtos_especiais WHERE ativo=true'),
    query(`SELECT pf.*, p.codigo FROM periodo_funcionarios pf
           JOIN postos p ON p.id=pf.posto_id WHERE pf.periodo_id=$1`, [periodoId]),
  ]);

  if (!periodo.length) throw new Error('Período não encontrado');

  let desqualificados = [];
  try {
    const { rows } = await query(
      'SELECT * FROM periodo_desqualificados WHERE periodo_id=$1', [periodoId]
    );
    desqualificados = rows;
  } catch {}

  const comissoes = calcularComissoes(
    vendas, metas, produtosEspeciais, periodoFuncionarios, periodo[0], desqualificados
  );

  // Índice de produtos especiais: "postoId|nomeProduto" → pe
  const espIdx = {};
  for (const pe of produtosEspeciais) {
    espIdx[`${pe.posto_id}|${pe.nome_produto.trim().toLowerCase()}`] = pe;
  }

  return { periodo: periodo[0], vendas, comissoes, espIdx };
}

// ─── Monta dados para Resumo por Posto ───────────────────────────────────────

function dadosPostos(comissoes, periodo) {
  const postos = [];
  for (const [sid, d] of Object.entries(comissoes)) {
    const frentistas = d.funcionarios.filter(f => f.tipo === 'frentista');
    const trocadores = d.funcionarios.filter(f => f.tipo === 'trocador');
    const gerentes   = d.funcionarios.filter(f => f.tipo === 'gerente');
    // pega codigo/nome do primeiro funcionário disponível
    const firstF = d.funcionarios[0];
    postos.push({
      codigo:          firstF?.posto_codigo || sid,
      nome:            firstF?.posto_nome   || '',
      total_vendas:    N(d.totalVendasPosto),
      meta_posto:      N(d.metaPostoEfetiva),
      pct_meta:        N(d.pctMetaPosto),
      qtd_frentistas:  frentistas.length,
      qtd_trocadores:  trocadores.length,
      qtd_gerentes:    gerentes.length,
      total_comissoes: N(d.totalComissoes),
    });
  }
  return postos.sort((a, b) => a.codigo.localeCompare(b.codigo));
}

// Versão enriquecida que pega posto_codigo/nome direto das vendas
function dadosPostosFromVendas(comissoes, vendas) {
  // indexa posto_codigo e posto_nome pelo posto_id
  const postoMeta = {};
  for (const v of vendas) {
    if (!postoMeta[String(v.posto_id)]) {
      postoMeta[String(v.posto_id)] = { codigo: v.posto_codigo, nome: v.posto_nome };
    }
  }

  const postos = [];
  for (const [sid, d] of Object.entries(comissoes)) {
    const frentistas = d.funcionarios.filter(f => f.tipo === 'frentista');
    const trocadores = d.funcionarios.filter(f => f.tipo === 'trocador');
    const gerentes   = d.funcionarios.filter(f => f.tipo === 'gerente');
    const meta = postoMeta[sid] || { codigo: sid, nome: '' };
    postos.push({
      codigo:          meta.codigo,
      nome:            meta.nome,
      total_vendas:    N(d.totalVendasPosto),
      meta_posto:      N(d.metaPostoEfetiva),
      pct_meta:        N(d.pctMetaPosto),
      qtd_frentistas:  frentistas.length,
      qtd_trocadores:  trocadores.length,
      qtd_gerentes:    gerentes.length,
      total_comissoes: N(d.totalComissoes),
    });
  }
  return postos.sort((a, b) => a.codigo.localeCompare(b.codigo));
}

// ─── Monta dados para Resumo por Funcionário ──────────────────────────────────

function dadosFuncionarios(comissoes, vendas) {
  const postoMeta = {};
  for (const v of vendas) {
    if (!postoMeta[String(v.posto_id)]) {
      postoMeta[String(v.posto_id)] = { codigo: v.posto_codigo, nome: v.posto_nome };
    }
  }

  const lista = [];
  for (const [sid, d] of Object.entries(comissoes)) {
    const meta = postoMeta[sid] || { codigo: sid, nome: '' };
    for (const f of d.funcionarios) {
      lista.push({
        posto_codigo:      meta.codigo,
        posto_nome:        meta.nome,
        nome:              f.nome,
        tipo:              f.tipo,
        total_vendas:      N(f.totalVendas),
        meta_efetiva:      N(f.metaEfetiva),
        pct_meta:          N(f.pctMeta),
        taxa_comissao:     N(f.taxaComissao),
        comissao_faixa:    N(f.comissaoAgregados),
        comissao_especiais:N(f.comissaoEspeciais),
        total_comissao:    N(f.totalComissao),
        desqualificado:    !!f.desqualificado,
        motivo_desq:       f.motivoDesqualificacao || '',
      });
    }
  }
  return lista.sort((a, b) =>
    a.posto_codigo.localeCompare(b.posto_codigo) ||
    a.tipo.localeCompare(b.tipo) ||
    a.nome.localeCompare(b.nome)
  );
}

// ─── Monta dados para Relatório Detalhado ────────────────────────────────────

function dadosDetalhado(vendas, espIdx) {
  // Agrupa por posto_id|funcionario
  const grupos = {};
  for (const v of vendas) {
    const key = `${v.posto_id}|${v.funcionario}|${v.tipo_funcionario}`;
    if (!grupos[key]) {
      grupos[key] = {
        posto_codigo: v.posto_codigo,
        posto_nome:   v.posto_nome,
        funcionario:  v.funcionario,
        tipo:         v.tipo_funcionario,
        produtos:     {},
      };
    }
    const pKey = v.produto.trim().toLowerCase();
    if (!grupos[key].produtos[pKey]) {
      const peK = `${v.posto_id}|${pKey}`;
      const pe  = espIdx[peK];
      const comUnit = pe
        ? N(v.tipo_funcionario === 'trocador' ? pe.comissao_trocador
          : v.tipo_funcionario === 'gerente'  ? pe.comissao_gerente
          : pe.comissao_frentista)
        : 0;
      grupos[key].produtos[pKey] = {
        produto:     v.produto,
        especial:    !!pe,
        quantidade:  0,
        valor_unit:  N(v.valor_unitario),
        valor_total: 0,
        com_unit:    comUnit,
        com_especial:0,
      };
    }
    const p = grupos[key].produtos[pKey];
    p.quantidade  += N(v.quantidade);
    p.valor_total += N(v.valor_final);
    p.valor_unit   = N(v.valor_unitario); // último
    if (p.especial) p.com_especial = Math.round(p.com_unit * p.quantidade * 100) / 100;
  }

  return Object.values(grupos)
    .map(g => ({
      ...g,
      produtos: Object.values(g.produtos).sort((a, b) => {
        // especiais primeiro, depois alfabético
        if (b.especial !== a.especial) return b.especial ? 1 : -1;
        return a.produto.localeCompare(b.produto);
      }),
    }))
    .sort((a, b) =>
      a.posto_codigo.localeCompare(b.posto_codigo) ||
      a.funcionario.localeCompare(b.funcionario)
    );
}

// ─── Rota: Postos ─────────────────────────────────────────────────────────────

router.get('/postos', auth, async (req, res) => {
  const { periodo_id, posto_id, formato = 'pdf' } = req.query;
  if (!periodo_id) return res.status(400).json({ error: 'periodo_id obrigatório' });

  const { periodo, vendas, comissoes } = await coletarDados(periodo_id, posto_id || null);
  const postos = dadosPostosFromVendas(comissoes, vendas);

  const nome = `vendas_por_posto_${periodo.nome.replace(/[^a-zA-Z0-9]/g, '_')}`;

  if (formato === 'csv') {
    const headers = ['Posto','Nome','Total Vendas','Meta Efetiva','% Meta','Frentistas','Trocadores','Gerentes','Total Comissões'];
    const rows = postos.map(p => [
      p.codigo, p.nome,
      p.total_vendas.toFixed(2).replace('.',','),
      p.meta_posto.toFixed(2).replace('.',','),
      `${(p.pct_meta*100).toFixed(1)}%`,
      p.qtd_frentistas, p.qtd_trocadores, p.qtd_gerentes,
      p.total_comissoes.toFixed(2).replace('.',','),
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
    return res.send(toCSV(headers, rows));
  }

  if (formato === 'xlsx') {
    const headers = ['Posto','Nome','Total Vendas (R$)','Meta Efetiva (R$)','% Meta','Frentistas','Trocadores','Gerentes','Total Comissões (R$)'];
    const rows = postos.map(p => [
      p.codigo, p.nome,
      p.total_vendas, p.meta_posto,
      parseFloat((p.pct_meta*100).toFixed(1)),
      p.qtd_frentistas, p.qtd_trocadores, p.qtd_gerentes,
      p.total_comissoes,
    ]);
    const buf = toXLSX([{
      name: 'Vendas por Posto',
      headers, rows,
      colWidths: [8, 30, 18, 18, 10, 12, 12, 12, 18],
    }]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xlsx"`);
    return res.send(buf);
  }

  // PDF
  const pdfPath = `/tmp/${nome}_${Date.now()}.pdf`;
  try {
    gerarPDF('postos', { periodo_nome: periodo.nome, postos }, pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.pdf"`);
    const stream = require('fs').createReadStream(pdfPath);
    stream.on('end', () => { try { require('fs').unlinkSync(pdfPath); } catch {} });
    stream.pipe(res);
  } catch (e) {
    try { require('fs').unlinkSync(pdfPath); } catch {}
    res.status(500).json({ error: e.message });
  }
});

// ─── Rota: Funcionários ───────────────────────────────────────────────────────

router.get('/funcionarios', auth, async (req, res) => {
  const { periodo_id, posto_id, formato = 'pdf' } = req.query;
  if (!periodo_id) return res.status(400).json({ error: 'periodo_id obrigatório' });

  const { periodo, vendas, comissoes } = await coletarDados(periodo_id, posto_id || null);
  const funcs = dadosFuncionarios(comissoes, vendas);

  const nome = `vendas_por_funcionario_${periodo.nome.replace(/[^a-zA-Z0-9]/g, '_')}`;

  if (formato === 'csv') {
    const headers = ['Posto','Nome Posto','Funcionário','Tipo','Total Vendas','Meta Efetiva','% Meta','Taxa','Com. Faixa','Com. Especiais','Total Comissão','Status','Motivo'];
    const rows = funcs.map(f => [
      f.posto_codigo, f.posto_nome, f.nome, f.tipo,
      f.total_vendas.toFixed(2).replace('.',','),
      f.meta_efetiva.toFixed(2).replace('.',','),
      `${(f.pct_meta*100).toFixed(1)}%`,
      `${(f.taxa_comissao*100).toFixed(1)}%`,
      f.comissao_faixa.toFixed(2).replace('.',','),
      f.comissao_especiais.toFixed(2).replace('.',','),
      f.total_comissao.toFixed(2).replace('.',','),
      f.desqualificado ? 'Desqualificado' : 'Qualificado',
      f.motivo_desq,
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
    return res.send(toCSV(headers, rows));
  }

  if (formato === 'xlsx') {
    const headers = ['Posto','Nome Posto','Funcionário','Tipo','Total Vendas (R$)','Meta Efetiva (R$)','% Meta','Taxa %','Com. Faixa (R$)','Com. Especiais (R$)','Total Comissão (R$)','Status','Motivo Desq.'];
    const rows = funcs.map(f => [
      f.posto_codigo, f.posto_nome, f.nome, f.tipo,
      f.total_vendas, f.meta_efetiva,
      parseFloat((f.pct_meta*100).toFixed(1)),
      parseFloat((f.taxa_comissao*100).toFixed(1)),
      f.comissao_faixa, f.comissao_especiais, f.total_comissao,
      f.desqualificado ? 'Desqualificado' : 'Qualificado',
      f.motivo_desq,
    ]);
    const buf = toXLSX([{
      name: 'Por Funcionário',
      headers, rows,
      colWidths: [8, 28, 30, 10, 16, 16, 8, 8, 15, 15, 15, 14, 30],
    }]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xlsx"`);
    return res.send(buf);
  }

  // PDF
  const pdfPath = `/tmp/${nome}_${Date.now()}.pdf`;
  try {
    gerarPDF('funcionarios', { periodo_nome: periodo.nome, funcionarios: funcs }, pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.pdf"`);
    const stream = require('fs').createReadStream(pdfPath);
    stream.on('end', () => { try { require('fs').unlinkSync(pdfPath); } catch {} });
    stream.pipe(res);
  } catch (e) {
    try { require('fs').unlinkSync(pdfPath); } catch {}
    res.status(500).json({ error: e.message });
  }
});

// ─── Rota: Detalhado ──────────────────────────────────────────────────────────

router.get('/detalhado', auth, async (req, res) => {
  const { periodo_id, posto_id, formato = 'pdf' } = req.query;
  if (!periodo_id) return res.status(400).json({ error: 'periodo_id obrigatório' });

  const { periodo, vendas, espIdx } = await coletarDados(periodo_id, posto_id || null);
  const grupos = dadosDetalhado(vendas, espIdx);

  const nome = `detalhado_por_funcionario_${periodo.nome.replace(/[^a-zA-Z0-9]/g, '_')}`;

  if (formato === 'csv') {
    const headers = ['Posto','Funcionário','Tipo','Produto','Especial','Quantidade','Vl. Unitário','Vl. Total','Com./un','Com. Especial Total'];
    const rows = [];
    for (const g of grupos) {
      for (const p of g.produtos) {
        rows.push([
          g.posto_codigo, g.funcionario, g.tipo,
          p.produto,
          p.especial ? 'Sim' : 'Não',
          p.quantidade.toFixed(3).replace('.',','),
          p.valor_unit.toFixed(2).replace('.',','),
          p.valor_total.toFixed(2).replace('.',','),
          p.especial ? p.com_unit.toFixed(2).replace('.',',') : '',
          p.especial ? p.com_especial.toFixed(2).replace('.',',') : '',
        ]);
      }
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
    return res.send(toCSV(headers, rows));
  }

  if (formato === 'xlsx') {
    const headers = ['Posto','Funcionário','Tipo','Produto','Especial','Quantidade','Vl. Unitário (R$)','Vl. Total (R$)','Com./un (R$)','Com. Especial (R$)'];
    const rows = [];
    for (const g of grupos) {
      for (const p of g.produtos) {
        rows.push([
          g.posto_codigo, g.funcionario, g.tipo,
          p.produto,
          p.especial ? 'Sim' : 'Não',
          p.quantidade,
          p.valor_unit,
          p.valor_total,
          p.especial ? p.com_unit    : 0,
          p.especial ? p.com_especial: 0,
        ]);
      }
    }
    const buf = toXLSX([{
      name: 'Detalhado',
      headers, rows,
      colWidths: [8, 30, 10, 40, 9, 10, 16, 16, 12, 16],
    }]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.xlsx"`);
    return res.send(buf);
  }

  // PDF
  const pdfPath = `/tmp/${nome}_${Date.now()}.pdf`;
  try {
    gerarPDF('detalhado', { periodo_nome: periodo.nome, grupos }, pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.pdf"`);
    const stream = require('fs').createReadStream(pdfPath);
    stream.on('end', () => { try { require('fs').unlinkSync(pdfPath); } catch {} });
    stream.pipe(res);
  } catch (e) {
    try { require('fs').unlinkSync(pdfPath); } catch {}
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
