import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API } from '../contexts/AuthContext';
import { fmt } from '../utils/fmt';
import { Spinner } from '../components/ui';

const toN = (v) => (v == null ? 0 : Number(v) || 0);

const TIPO_LABEL = { frentista: 'Frentista', trocador: 'Trocador', gerente: 'Gerente' };
const TIPO_ORDER = { gerente: 0, trocador: 1, frentista: 2 };

function buildLinhas(comissoes, postos) {
  const linhas = [];
  for (const pid of Object.keys(comissoes)) {
    const d = comissoes[pid];
    const posto = postos.find(p => p.id === parseInt(pid));
    const codigoPosto = posto?.codigo || `#${pid}`;
    const nomePosto   = posto?.nome   || '';
    for (const f of d.funcionarios) {
      linhas.push({
        posto_codigo: codigoPosto,
        posto_nome:   nomePosto,
        nome:         f.nome,
        tipo:         f.tipo,
        totalComissao: toN(f.totalComissao),
        desqualificado: !!f.desqualificado,
        motivo_desq: typeof f.desqualificado === 'string' ? f.desqualificado : '',
      });
    }
  }
  linhas.sort((a, b) => {
    if (a.posto_codigo < b.posto_codigo) return -1;
    if (a.posto_codigo > b.posto_codigo) return  1;
    const ta = TIPO_ORDER[a.tipo] ?? 9;
    const tb = TIPO_ORDER[b.tipo] ?? 9;
    if (ta !== tb) return ta - tb;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
  return linhas;
}

function exportXLSX(linhas, periodoNome) {
  import('xlsx').then(XLSX => {
    const cabecalho = [
      ['Posto', 'Nome do Posto', 'Funcionário', 'Tipo', 'Comissão (R$)', 'Situação', 'Motivo Desqualificação'],
    ];
    const dados = linhas.map(l => [
      l.posto_codigo,
      l.posto_nome,
      l.nome,
      TIPO_LABEL[l.tipo] || l.tipo,
      l.totalComissao,
      l.desqualificado ? 'Desqualificado' : 'Qualificado',
      l.motivo_desq || '',
    ]);

    const totalGeral = linhas.reduce((s, l) => s + l.totalComissao, 0);
    const rodape = [['', '', '', 'TOTAL', totalGeral, '', '']];

    const ws = XLSX.utils.aoa_to_sheet([...cabecalho, ...dados, [], rodape]);

    // Larguras das colunas
    ws['!cols'] = [
      { wch: 8 },   // Posto
      { wch: 28 },  // Nome Posto
      { wch: 38 },  // Funcionário
      { wch: 12 },  // Tipo
      { wch: 16 },  // Comissão
      { wch: 16 },  // Situação
      { wch: 30 },  // Motivo
    ];

    // Formata coluna de comissão como moeda
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let row = 1; row <= range.e.r; row++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: 4 })];
      if (cell && typeof cell.v === 'number') {
        cell.z = 'R$ #,##0.00';
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comissões');

    const nome = `comissoes_${periodoNome.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
    XLSX.writeFile(wb, nome);
  });
}

export default function RelatorioFinanceiroPage() {
  const [periodos, setPeriodos]       = useState([]);
  const [postos, setPostos]           = useState([]);
  const [periodoId, setPeriodoId]     = useState('');
  const [periodoInfo, setPeriodoInfo] = useState(null);
  const [comissoes, setComissoes]     = useState(null);
  const [loading, setLoading]         = useState(false);
  const [tipoFiltro, setTipoFiltro]   = useState('todos');
  const [postoFiltro, setPostoFiltro] = useState('');
  const [mostrarDesq, setMostrarDesq] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/periodos`),
      axios.get(`${API}/postos`),
    ]).then(([r1, r2]) => {
      setPeriodos(r1.data);
      setPostos(r2.data);
      if (r1.data.length) setPeriodoId(String(r1.data[0].id));
    });
  }, []);

  const load = useCallback(() => {
    if (!periodoId) return;
    setLoading(true);
    axios.get(`${API}/periodos/${periodoId}/comissoes`).then(r => {
      setComissoes(r.data.comissoes);
      setPeriodoInfo(r.data.periodo);
    }).finally(() => setLoading(false));
  }, [periodoId]);

  useEffect(() => { load(); }, [load]);

  const periodoNome = periodoInfo?.nome || periodos.find(p => String(p.id) === periodoId)?.nome || '';

  const todasLinhas = comissoes && postos.length ? buildLinhas(comissoes, postos) : [];

  const linhasFiltradas = todasLinhas.filter(l => {
    if (tipoFiltro !== 'todos' && l.tipo !== tipoFiltro) return false;
    if (postoFiltro && l.posto_codigo !== postoFiltro) return false;
    if (!mostrarDesq && l.desqualificado) return false;
    return true;
  });

  const totalGeral  = linhasFiltradas.reduce((s, l) => s + l.totalComissao, 0);
  const totalFrent  = linhasFiltradas.filter(l => l.tipo === 'frentista').reduce((s, l) => s + l.totalComissao, 0);
  const totalTroc   = linhasFiltradas.filter(l => l.tipo === 'trocador').reduce((s, l) => s + l.totalComissao, 0);
  const totalGer    = linhasFiltradas.filter(l => l.tipo === 'gerente').reduce((s, l) => s + l.totalComissao, 0);
  const qtdDesq     = todasLinhas.filter(l => l.desqualificado).length;

  const codigoPostos = [...new Set(todasLinhas.map(l => l.posto_codigo))].sort();

  return (
    <>
      {/* ── Topbar ── */}
      <div className="topbar no-print">
        <div>
          <div className="topbar-title">Relatório Financeiro de Comissões</div>
          <div className="topbar-sub">Pagamento por colaborador — exportável em XLSX e PDF</div>
        </div>
        <div className="flex items-center gap-8">
          <select value={periodoId} onChange={e => setPeriodoId(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Selecione o período…</option>
            {periodos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="page">
        {/* ── Filtros ── */}
        {comissoes && (
          <div className="card no-print" style={{ padding: '12px 16px', marginBottom: 16 }}>
            <div className="filters" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <select value={postoFiltro} onChange={e => setPostoFiltro(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="">Todos os postos</option>
                {codigoPostos.map(c => {
                  const p = todasLinhas.find(l => l.posto_codigo === c);
                  return <option key={c} value={c}>{c} — {p?.posto_nome}</option>;
                })}
              </select>

              <div className="tabs" style={{ display: 'inline-flex' }}>
                {[['todos','Todos'],['frentista','Frentistas'],['trocador','Trocadores'],['gerente','Gerentes']].map(([k, v]) => (
                  <div key={k} className={`tab ${tipoFiltro === k ? 'on' : ''}`}
                    onClick={() => setTipoFiltro(k)} style={{ fontSize: 12 }}>{v}</div>
                ))}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={mostrarDesq}
                  onChange={e => setMostrarDesq(e.target.checked)} />
                Mostrar desqualificados
              </label>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!linhasFiltradas.length}
                  onClick={() => exportXLSX(todasLinhas, periodoNome)}
                  title="Exportar planilha Excel com todos os dados (sem filtros aplicados)"
                >
                  📊 Exportar XLSX
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!linhasFiltradas.length}
                  onClick={() => window.print()}
                >
                  🖨️ Exportar PDF
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Sumário ── */}
        {!loading && comissoes && (
          <div className="stats no-print" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="stat-label">Total a Pagar</div>
              <div className="stat-value" style={{ color: 'var(--green)' }}>{fmt(totalGeral)}</div>
              <div className="stat-note">{linhasFiltradas.length} colaboradores</div>
            </div>
            <div className="stat">
              <div className="stat-label">Frentistas</div>
              <div className="stat-value">{fmt(totalFrent)}</div>
              <div className="stat-note">{linhasFiltradas.filter(l => l.tipo === 'frentista').length} colaboradores</div>
            </div>
            <div className="stat">
              <div className="stat-label">Trocadores</div>
              <div className="stat-value">{fmt(totalTroc)}</div>
              <div className="stat-note">{linhasFiltradas.filter(l => l.tipo === 'trocador').length} colaboradores</div>
            </div>
            <div className="stat">
              <div className="stat-label">Gerentes</div>
              <div className="stat-value">{fmt(totalGer)}</div>
              <div className="stat-note">{linhasFiltradas.filter(l => l.tipo === 'gerente').length} colaboradores</div>
            </div>
            {qtdDesq > 0 && (
              <div className="stat">
                <div className="stat-label" style={{ color: 'var(--red)' }}>Desqualificados</div>
                <div className="stat-value" style={{ color: 'var(--red)', fontSize: 20 }}>{qtdDesq}</div>
                <div className="stat-note">comissão zerada</div>
              </div>
            )}
          </div>
        )}

        {/* ── Tabela ── */}
        {!periodoId ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            Selecione um período acima
          </div>
        ) : loading ? (
          <Spinner />
        ) : !comissoes ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            Nenhuma comissão encontrada. Verifique se as metas estão definidas e as vendas importadas.
          </div>
        ) : (
          <div className="card">
            {/* Cabeçalho print-only */}
            <div className="print-only" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>
                Relatório Financeiro de Comissões
              </div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
                <strong>Período:</strong> {periodoNome} &nbsp;|&nbsp;
                <strong>Total a pagar:</strong> {fmt(totalGeral)} &nbsp;|&nbsp;
                {linhasFiltradas.length} colaboradores
              </div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                Gerado em {new Date().toLocaleString('pt-BR')}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Posto</th>
                    <th>Nome do Posto</th>
                    <th>Funcionário</th>
                    <th>Tipo</th>
                    <th className="text-right">Comissão (R$)</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasFiltradas.map((l, i) => (
                    <tr key={i} style={l.desqualificado ? { background: 'rgba(239,68,68,0.05)' } : {}}>
                      <td>
                        <span className="badge badge-gray mono">{l.posto_codigo}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.posto_nome}</td>
                      <td style={{ fontSize: 12, fontWeight: 500 }}>{l.nome}</td>
                      <td>
                        <span className={`badge ${l.tipo === 'gerente' ? 'badge-blue' : l.tipo === 'trocador' ? 'badge-amber' : 'badge-gray'}`}>
                          {TIPO_LABEL[l.tipo] || l.tipo}
                        </span>
                      </td>
                      <td className="text-right mono bold" style={{ color: l.desqualificado ? 'var(--text-muted)' : 'var(--green)', fontSize: 13 }}>
                        {l.desqualificado ? <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{fmt(0)}</span> : fmt(l.totalComissao)}
                      </td>
                      <td>
                        {l.desqualificado ? (
                          <span className="badge badge-red" title={l.motivo_desq || ''}>
                            Desqualificado{l.motivo_desq ? ` — ${l.motivo_desq.slice(0, 40)}` : ''}
                          </span>
                        ) : (
                          <span className="badge badge-green">Qualificado</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!linhasFiltradas.length && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                        Nenhum colaborador encontrado com os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
                {linhasFiltradas.length > 0 && (
                  <tfoot>
                    <tr style={{ background: 'var(--surface2)', fontWeight: 800 }}>
                      <td colSpan={4} style={{ padding: '8px 12px', fontSize: 13 }}>
                        TOTAL — {linhasFiltradas.length} colaborador{linhasFiltradas.length !== 1 ? 'es' : ''}
                      </td>
                      <td className="text-right mono" style={{ fontSize: 14, color: 'var(--green)', padding: '8px 12px' }}>
                        {fmt(totalGeral)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Estilos de impressão ── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .sidebar, .topbar { display: none !important; }
          .main { margin: 0 !important; padding: 0 !important; }
          .page { padding: 0 !important; }
          .card { box-shadow: none !important; border: 1px solid #e2e8f0 !important; }
          table { font-size: 11px !important; }
          th, td { padding: 4px 8px !important; }
          .badge { border: 1px solid #ccc !important; font-size: 9px !important; }
        }
        @media screen {
          .print-only { display: none; }
        }
      `}</style>
    </>
  );
}
