import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import { API, useAuth } from '../contexts/AuthContext';
import { Spinner, Empty } from '../components/ui';
import { fmtQ, fmtN } from '../utils/fmt';

const STATUS_INFO = {
  critico:     { label: 'Crítico — comprar já', cls: 'badge-red' },
  comprar:     { label: 'Comprar',              cls: 'badge-amber' },
  ok:          { label: 'OK',                   cls: 'badge-green' },
  sem_config:  { label: 'Sem estoque informado', cls: 'badge-gray' },
};

function corTendencia(pct) {
  if (pct > 10) return '#22c55e';
  if (pct < -10) return '#ef4444';
  return 'var(--text-muted)';
}

function fmtTendencia(pct) {
  if (pct == null) return '—';
  const seta = pct > 2 ? '▲' : pct < -2 ? '▼' : '▬';
  return `${seta} ${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

function fmtDiasSemSaida(dias) {
  if (dias == null) return '—';
  if (dias <= 0) return 'hoje';
  return `${dias}d`;
}

function exportXLSX(produtos, postoLabel) {
  import('xlsx').then(XLSX => {
    const cabecalho = [
      ['Produto', 'Saída Total', 'Média/dia', 'Tendência (%)', 'Dias sem saída',
       'Estoque Atual', 'Prazo Reposição (d)', 'Estoque Mínimo Sugerido', 'Sugestão de Compra', 'Status'],
    ];
    const dados = produtos.map(p => [
      p.produto,
      p.qtdTotal,
      Number(p.mediaDiaria.toFixed(2)),
      Number(p.tendenciaPct.toFixed(1)),
      p.diasSemSaida ?? '',
      p.estoqueAtual ?? '',
      p.prazoReposicaoDias,
      Number(p.estoqueMinimoSugerido.toFixed(2)),
      p.sugestaoCompra != null ? Number(p.sugestaoCompra.toFixed(2)) : '',
      STATUS_INFO[p.status]?.label || p.status,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([...cabecalho, ...dados]);
    ws['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Previsão de Compras');
    XLSX.writeFile(wb, `previsao_compras_${postoLabel.replace(/\s+/g, '_')}.xlsx`);
  });
}

export default function PrevisaoComprasPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const fileRef = useRef(null);

  const [postos, setPostos]       = useState([]);
  const [postoId, setPostoId]     = useState('');
  const [nPeriodos, setNPeriodos] = useState(6);
  const [cobertura, setCobertura] = useState(7);
  const [busca, setBusca]         = useState('');
  const [ordem, setOrdem]         = useState('qtd');

  const [dados, setDados]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState('');
  const [salvandoKey, setSalvandoKey] = useState(null);
  const [importando, setImportando] = useState(false);
  const [importMsg, setImportMsg]   = useState(null);

  useEffect(() => {
    axios.get(`${API}/postos`).then(r => setPostos(r.data.filter(p => p.ativo)));
  }, []);

  const carregar = useCallback(() => {
    setLoading(true); setErro('');
    const params = new URLSearchParams({ periodos: nPeriodos, cobertura_dias: cobertura });
    if (postoId) params.set('posto_id', postoId);
    axios.get(`${API}/estoque/previsao?${params}`)
      .then(r => setDados(r.data))
      .catch(() => setErro('Erro ao carregar previsão de compras'))
      .finally(() => setLoading(false));
  }, [postoId, nPeriodos, cobertura]);

  useEffect(() => { carregar(); }, [carregar]);

  const handleImportEstoque = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportando(true); setImportMsg(null);
    const fd = new FormData();
    fd.append('arquivo', file);
    try {
      const r = await axios.post(`${API}/estoque/importar`, fd);
      setImportMsg({ ok: true, text: r.data.message });
      carregar();
    } catch (ex) {
      setImportMsg({ ok: false, text: ex.response?.data?.error || 'Erro ao importar estoque' });
    } finally {
      setImportando(false);
    }
  };

  const salvarEstoque = async (produto, campo, valor) => {
    if (!postoId) return;
    const key = produto;
    setSalvandoKey(key);
    const atual = dados.produtos.find(p => p.produto === produto);
    const body = {
      posto_id: Number(postoId),
      produto,
      estoque_atual: campo === 'estoque_atual' ? valor : (atual.estoqueAtual ?? 0),
      prazo_reposicao_dias: campo === 'prazo_reposicao_dias' ? valor : atual.prazoReposicaoDias,
    };
    try {
      await axios.put(`${API}/estoque/produto`, body);
      await carregar();
    } catch {
      setErro('Erro ao salvar estoque do produto');
    } finally {
      setSalvandoKey(null);
    }
  };

  const produtosFiltrados = useMemo(() => {
    if (!dados) return [];
    let lista = dados.produtos;
    if (busca.trim()) {
      const b = busca.trim().toLowerCase();
      lista = lista.filter(p => p.produto.toLowerCase().includes(b));
    }
    const arr = [...lista];
    if (ordem === 'qtd') arr.sort((a, b) => b.qtdTotal - a.qtdTotal);
    else if (ordem === 'sugestao') arr.sort((a, b) => (b.sugestaoCompra ?? -1) - (a.sugestaoCompra ?? -1));
    else if (ordem === 'tendencia') arr.sort((a, b) => b.tendenciaPct - a.tendenciaPct);
    else if (ordem === 'sem_giro') arr.sort((a, b) => (b.diasSemSaida ?? -1) - (a.diasSemSaida ?? -1));
    return arr;
  }, [dados, busca, ordem]);

  const postoLabel = postoId ? (postos.find(p => String(p.id) === postoId)?.codigo || 'posto') : 'todos_os_postos';

  const kpis = useMemo(() => {
    if (!dados) return null;
    const total = dados.produtos.length;
    const precisamComprar = dados.produtos.filter(p => p.status === 'comprar' || p.status === 'critico').length;
    const criticos = dados.produtos.filter(p => p.status === 'critico').length;
    const semGiro = dados.produtos.filter(p => p.diasSemSaida != null && p.diasSemSaida > cobertura * 3).length;
    return { total, precisamComprar, criticos, semGiro };
  }, [dados, cobertura]);

  return (
    <>
      <div className="topbar no-print">
        <div>
          <div className="topbar-title">Previsão de Compras</div>
          <div className="topbar-sub">Saída por período, média de venda e sugestão de compra por produto</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && (
            <>
              <button className="btn btn-primary btn-sm" disabled={importando}
                title="Colunas esperadas no arquivo: B = chave da empresa, U = produto, AA = quantidade em estoque"
                onClick={() => fileRef.current?.click()}>
                {importando ? 'Importando…' : '📂 Importar Estoque'}
              </button>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls"
                style={{ display: 'none' }} onChange={handleImportEstoque} />
            </>
          )}
          {dados?.produtos?.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => exportXLSX(produtosFiltrados, postoLabel)}>
              📊 Exportar XLSX
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
            🖨️ Exportar PDF
          </button>
        </div>
      </div>

      <div className="page">
        {importMsg && (
          <div className={`alert ${importMsg.ok ? 'alert-success' : 'alert-error'} no-print`}>
            {importMsg.ok ? '✓ ' : '❌ '}{importMsg.text}
          </div>
        )}

        {/* Filtros */}
        <div className="card no-print" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
              <label>Posto</label>
              <select value={postoId} onChange={e => setPostoId(e.target.value)}>
                <option value="">Todos os postos (só análise)</option>
                {postos.map(p => (
                  <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 160px', marginBottom: 0 }}>
              <label>Períodos analisados</label>
              <select value={nPeriodos} onChange={e => setNPeriodos(Number(e.target.value))}>
                <option value={3}>Últimos 3</option>
                <option value={6}>Últimos 6</option>
                <option value={9}>Últimos 9</option>
                <option value={12}>Últimos 12</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 160px', marginBottom: 0 }}>
              <label>Cobertura desejada (dias)</label>
              <input type="number" min={1} max={90} value={cobertura}
                onChange={e => setCobertura(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div className="form-group" style={{ flex: '2 1 220px', marginBottom: 0 }}>
              <label>Buscar produto</label>
              <input type="text" placeholder="Filtrar por nome..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
              <label>Ordenar por</label>
              <select value={ordem} onChange={e => setOrdem(e.target.value)}>
                <option value="qtd">Maior saída</option>
                {postoId && <option value="sugestao">Sugestão de compra</option>}
                <option value="tendencia">Tendência (alta → queda)</option>
                <option value="sem_giro">Mais dias sem saída</option>
              </select>
            </div>
          </div>
        </div>

        {erro && <div className="alert alert-error">{erro}</div>}
        {loading && <Spinner />}

        {!loading && dados && (
          <>
            <div className="print-only" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Previsão de Compras</div>
              <div style={{ fontSize: 12, color: '#666' }}>
                {postoId ? postos.find(p => String(p.id) === postoId)?.nome : 'Todos os postos'} ·
                {' '}Últimos {nPeriodos} períodos · Cobertura de {cobertura} dias
              </div>
            </div>

            {!dados.periodos.length ? (
              <Empty text="Nenhum período cadastrado ainda." />
            ) : (
              <>
                {/* KPIs */}
                {kpis && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
                    <div className="card" style={{ padding: '16px 18px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Produtos Analisados</div>
                      <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtN(kpis.total)}</div>
                    </div>
                    {postoId && (
                      <>
                        <div className="card" style={{ padding: '16px 18px' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Precisam de Compra</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#f59e0b' }}>{fmtN(kpis.precisamComprar)}</div>
                        </div>
                        <div className="card" style={{ padding: '16px 18px' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Críticos (risco de faltar)</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#ef4444' }}>{fmtN(kpis.criticos)}</div>
                        </div>
                      </>
                    )}
                    <div className="card" style={{ padding: '16px 18px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Sem Giro (possível sobra)</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#94a3b8' }}>{fmtN(kpis.semGiro)}</div>
                    </div>
                  </div>
                )}

                {!postoId && (
                  <div className="alert alert-info">
                    ℹ️ Selecione um posto específico para informar o estoque atual e ver a sugestão exata de quanto comprar.
                    Sem posto selecionado, o relatório mostra apenas a análise de demanda (saída, média e tendência) somando todos os postos.
                  </div>
                )}

                {/* Tabela */}
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">Produtos — {postoId ? (postos.find(p => String(p.id) === postoId)?.codigo) : 'Todos os postos'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dados.totalDias} dias analisados</div>
                  </div>
                  <div className="table-wrap">
                    <table style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 28 }}>#</th>
                          <th>Produto</th>
                          <th className="text-right">Saída Total</th>
                          <th className="text-right">Média/dia</th>
                          <th className="text-right">Tendência</th>
                          <th className="text-right">Sem saída há</th>
                          {postoId && <th className="text-right">Estoque Atual</th>}
                          {postoId && <th className="text-right">Prazo Reposição</th>}
                          <th className="text-right">Estoque Mín. Sugerido</th>
                          {postoId && <th className="text-right">Sugestão de Compra</th>}
                          {postoId && <th>Status</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {produtosFiltrados.map((p, i) => {
                          const st = STATUS_INFO[p.status];
                          return (
                            <tr key={p.produto}>
                              <td style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}</td>
                              <td style={{ fontWeight: 600 }}>{p.produto}</td>
                              <td className="text-right mono">{fmtQ(p.qtdTotal)}</td>
                              <td className="text-right mono">{fmtQ(p.mediaDiaria)}</td>
                              <td className="text-right mono" style={{ fontWeight: 700, color: corTendencia(p.tendenciaPct) }}>
                                {fmtTendencia(p.tendenciaPct)}
                              </td>
                              <td className="text-right mono" style={{ color: p.diasSemSaida > cobertura * 3 ? '#ef4444' : 'var(--text-dim)' }}>
                                {fmtDiasSemSaida(p.diasSemSaida)}
                              </td>
                              {postoId && (
                                <td className="text-right no-print">
                                  <input
                                    type="number" min={0} step="0.01"
                                    defaultValue={p.estoqueAtual ?? ''}
                                    placeholder="0"
                                    disabled={salvandoKey === p.produto}
                                    onBlur={e => {
                                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                                      if (v !== (p.estoqueAtual ?? 0)) salvarEstoque(p.produto, 'estoque_atual', v);
                                    }}
                                    style={{ width: 90, textAlign: 'right', fontSize: 12 }}
                                  />
                                </td>
                              )}
                              {postoId && <td className="text-right mono print-only">{p.estoqueAtual != null ? fmtQ(p.estoqueAtual) : '—'}</td>}
                              {postoId && (
                                <td className="text-right no-print">
                                  <input
                                    type="number" min={0} step="1"
                                    defaultValue={p.prazoReposicaoDias}
                                    disabled={salvandoKey === p.produto}
                                    onBlur={e => {
                                      const v = Number(e.target.value) || 3;
                                      if (v !== p.prazoReposicaoDias) salvarEstoque(p.produto, 'prazo_reposicao_dias', v);
                                    }}
                                    style={{ width: 60, textAlign: 'right', fontSize: 12 }}
                                  />
                                </td>
                              )}
                              {postoId && <td className="text-right mono print-only">{p.prazoReposicaoDias}d</td>}
                              <td className="text-right mono">{fmtQ(p.estoqueMinimoSugerido)}</td>
                              {postoId && (
                                <td className="text-right mono" style={{ fontWeight: 700, color: p.sugestaoCompra > 0 ? '#f59e0b' : 'var(--text-dim)' }}>
                                  {p.sugestaoCompra != null ? fmtQ(p.sugestaoCompra) : '—'}
                                </td>
                              )}
                              {postoId && (
                                <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!produtosFiltrados.length && <Empty text="Nenhum produto encontrado nos períodos selecionados." />}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
