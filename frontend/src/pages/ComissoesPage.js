import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { API } from '../contexts/AuthContext';
import { fmt, fmtPct, faixaLabel } from '../utils/fmt';
import { Spinner, FaixaInfo } from '../components/ui';

export default function ComissoesPage() {
  const [searchParams] = useSearchParams();
  const [periodos, setPeriodos] = useState([]);
  const [periodoId, setPeriodoId] = useState(searchParams.get('periodo') || '');
  const [postos, setPostos] = useState([]);
  const [postoFiltro, setPostoFiltro] = useState('');
  const [comissoes, setComissoes] = useState(null);
  const [periodoInfo, setPeriodoInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedPosto, setExpandedPosto] = useState(null);
  const [tipoFiltro, setTipoFiltro] = useState('todos');

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/periodos`),
      axios.get(`${API}/postos`),
    ]).then(([r1, r2]) => {
      setPeriodos(r1.data);
      setPostos(r2.data);
      if (!periodoId && r1.data.length) setPeriodoId(String(r1.data[0].id));
    });
  }, []);

  const loadComissoes = useCallback(() => {
    if (!periodoId) return;
    setLoading(true);
    const params = {};
    if (postoFiltro) params.posto_id = postoFiltro;
    axios.get(`${API}/periodos/${periodoId}/comissoes`, { params }).then(r => {
      setComissoes(r.data.comissoes);
      setPeriodoInfo(r.data.periodo);
    }).finally(() => setLoading(false));
  }, [periodoId, postoFiltro]);

  useEffect(() => { loadComissoes(); }, [loadComissoes]);

  const postoIds = comissoes ? Object.keys(comissoes) : [];

  const totalGeral         = postoIds.reduce((s, pid) => s + (comissoes[pid]?.totalComissoes || 0), 0);
  const totalFrentComissao = postoIds.reduce((s, pid) =>
    s + comissoes[pid].funcionarios.filter(f => f.tipo === 'frentista').reduce((ss, f) => ss + f.totalComissao, 0), 0);
  const totalTrocComissao  = postoIds.reduce((s, pid) =>
    s + comissoes[pid].funcionarios.filter(f => f.tipo === 'trocador').reduce((ss, f) => ss + f.totalComissao, 0), 0);
  const totalGerComissao   = postoIds.reduce((s, pid) =>
    s + comissoes[pid].funcionarios.filter(f => f.tipo === 'gerente').reduce((ss, f) => ss + f.totalComissao, 0), 0);

  const tipoLabel = { frentista: 'Frentista', trocador: 'Trocador', gerente: 'Gerente' };
  const tipoColor = { frentista: 'badge-gray', trocador: 'badge-amber', gerente: 'badge-blue' };

  const proRataInfo = postoIds.length > 0 ? {
    ativo: comissoes[postoIds[0]]?.proRata,
    fator: comissoes[postoIds[0]]?.fatorProRata,
    corridos: comissoes[postoIds[0]]?.diasCorridos,
    totais: comissoes[postoIds[0]]?.diasTotais,
  } : null;

  // Determina se algum gerente no período acumula trocador
  const temGerenteAcumulador = postoIds.some(pid =>
    comissoes[pid].funcionarios.some(f => f.tipo === 'gerente' && f.acumulaTrocador)
  );

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Relatório de Comissões</div>
          <div className="topbar-sub">
            Calculado conforme faixas de atingimento — avaliação individual por colaborador
            {proRataInfo?.ativo && (
              <span style={{ marginLeft: 8, color: 'var(--amber)' }}>
                · Pro rata: {proRataInfo.corridos}/{proRataInfo.totais} dias ({(proRataInfo.fator * 100).toFixed(1)}%)
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-8">
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>🖨 Imprimir</button>
          <select value={periodoId} onChange={e => setPeriodoId(e.target.value)} style={{ maxWidth: 240 }}>
            <option value="">Selecione o período…</option>
            {periodos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="page">
        {/* Filtros */}
        <div className="card mb-4" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <div className="filters">
            <select value={postoFiltro} onChange={e => setPostoFiltro(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="">Todos os postos</option>
              {postos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
            </select>
            <div className="tabs" style={{ display: 'inline-flex' }}>
              {[['todos','Todos'],['frentista','Frentistas'],['trocador','Trocadores'],['gerente','Gerentes']].map(([k, v]) => (
                <div key={k} className={`tab ${tipoFiltro === k ? 'on' : ''}`}
                  onClick={() => setTipoFiltro(k)} style={{ fontSize: 12 }}>{v}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Resumo */}
        {!loading && comissoes && (
          <div className="stats mb-4" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="stat-label">Total Comissões</div>
              <div className="stat-value" style={{ color: 'var(--green)' }}>{fmt(totalGeral)}</div>
              <div className="stat-note">{periodoInfo?.status === 'ativo' ? '⚡ parcial (pro rata)' : '✓ fechado'}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Frentistas</div>
              <div className="stat-value">{fmt(totalFrentComissao)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Trocadores</div>
              <div className="stat-value">{fmt(totalTrocComissao)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Gerentes</div>
              <div className="stat-value">{fmt(totalGerComissao)}</div>
            </div>
          </div>
        )}

        {!periodoId ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            Selecione um período acima
          </div>
        ) : loading ? <Spinner /> : !comissoes || !postoIds.length ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            Nenhuma venda encontrada. Verifique se as metas estão definidas e a planilha importada.
          </div>
        ) : (
          postoIds.map(pid => {
            const d = comissoes[pid];
            const funcs = d.funcionarios.filter(f => tipoFiltro === 'todos' || f.tipo === tipoFiltro);
            if (!funcs.length) return null;

            const isOpen = expandedPosto === pid;
            const posto = postos.find(p => p.id === parseInt(pid));

            // Separar gerentes para tabela dedicada
            const gerentes   = funcs.filter(f => f.tipo === 'gerente');
            const naoGerentes = funcs.filter(f => f.tipo !== 'gerente');

            return (
              <div key={pid} className="card mb-4" style={{ marginBottom: 12 }}>
                {/* Cabeçalho do posto */}
                <div className="card-header" style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => setExpandedPosto(isOpen ? null : pid)}>
                  <div className="flex items-center gap-8">
                    <span className="badge badge-gray mono" style={{ fontSize: 13, padding: '3px 10px' }}>
                      {posto?.codigo || `#${pid}`}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{posto?.nome || ''}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {funcs.length} colaboradores · Comissão total:{' '}
                        <strong style={{ color: 'var(--green)' }}>{fmt(d.totalComissoes)}</strong>
                        {' · '}
                        Total posto: <strong>{fmt(d.totalVendasPosto)}</strong>
                        {d.proRata && (
                          <span style={{ color: 'var(--amber)', marginLeft: 6 }}>
                            · Meta posto efetiva: {fmt(d.metaPostoEfetiva)} ({(d.pctMetaPosto * 100).toFixed(1)}%)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-8">
                    <div style={{ textAlign: 'right', fontSize: 12 }}>
                      <div style={{ color: 'var(--text-muted)' }}>
                        Meta posto:{' '}
                        <span style={{
                          color: d.pctMetaPosto >= 1 ? 'var(--green)' : d.pctMetaPosto >= 0.75 ? 'var(--amber)' : 'var(--red)',
                          fontWeight: 600
                        }}>
                          {(d.pctMetaPosto * 100).toFixed(1)}%
                        </span>
                        {d.proRata && <span style={{ color: 'var(--amber)', marginLeft: 4 }}>(pro rata)</span>}
                      </div>
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>{isOpen ? '▾' : '▸'}</span>
                  </div>
                </div>

                {/* Faixas ativas */}
                {isOpen && (
                  <div style={{ padding: '10px 20px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', fontSize: 11, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {(tipoFiltro === 'todos' || tipoFiltro === 'frentista') && d.metaFrentistaEfetiva > 0 && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>
                          Frentistas — meta efetiva: <strong style={{ color: 'var(--text)' }}>{fmt(d.metaFrentistaEfetiva)}</strong>
                          {d.proRata && <span style={{ color: 'var(--amber)' }}> (de {fmt(d.metaFrentista)})</span>}
                        </span>
                        <FaixaInfo tipo="frentista" />
                      </div>
                    )}
                    {(tipoFiltro === 'todos' || tipoFiltro === 'trocador') && d.metaTrocadorEfetiva > 0 && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>
                          Trocadores — meta efetiva: <strong style={{ color: 'var(--text)' }}>{fmt(d.metaTrocadorEfetiva)}</strong>
                          {d.proRata && <span style={{ color: 'var(--amber)' }}> (de {fmt(d.metaTrocador)})</span>}
                        </span>
                        <FaixaInfo tipo="trocador" />
                      </div>
                    )}
                    {(tipoFiltro === 'todos' || tipoFiltro === 'gerente') && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>
                          Gerente — meta posto efetiva: <strong style={{ color: 'var(--text)' }}>{fmt(d.metaPostoEfetiva)}</strong>
                          {d.proRata && <span style={{ color: 'var(--amber)' }}> (de {fmt(d.metaPosto)})</span>}
                        </span>
                        <FaixaInfo tipo="gerente" />
                      </div>
                    )}
                  </div>
                )}

                {/* ── Tabela: Frentistas & Trocadores ── */}
                {isOpen && naoGerentes.length > 0 && (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Funcionário</th>
                          <th>Tipo</th>
                          <th className="text-right">Total Vendas</th>
                          <th className="text-right">Meta Efetiva</th>
                          <th className="text-right">% Meta</th>
                          <th className="text-right">Taxa</th>
                          <th className="text-right">Com. Agregados</th>
                          <th className="text-right">Com. Especiais</th>
                          <th className="text-right" style={{ color: 'var(--green)' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {naoGerentes.sort((a, b) => b.totalComissao - a.totalComissao).map((f, i) => {
                          const fx = faixaLabel(f.pctMeta, f.tipo);
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td style={{ fontWeight: 500, fontSize: 13 }}>{f.nome}</td>
                                <td><span className={`badge ${tipoColor[f.tipo]}`}>{tipoLabel[f.tipo]}</span></td>
                                <td className="text-right mono">{fmt(f.totalVendas)}</td>
                                <td className="text-right mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                  {f.metaEfetiva > 0 ? fmt(f.metaEfetiva) : '—'}
                                </td>
                                <td className="text-right">
                                  <span className={`badge ${fx.color}`}>{(f.pctMeta * 100).toFixed(1)}%</span>
                                </td>
                                <td className="text-right mono">{(f.taxaComissao * 100).toFixed(1)}%</td>
                                <td className="text-right mono">{fmt(f.comissaoAgregados)}</td>
                                <td className="text-right mono">
                                  {f.comissaoEspeciais > 0 ? fmt(f.comissaoEspeciais) : <span className="muted">—</span>}
                                </td>
                                <td className="text-right mono bold" style={{ color: 'var(--green)' }}>
                                  {fmt(f.totalComissao)}
                                </td>
                              </tr>
                              {f.itensEspeciais?.map((ie, j) => (
                                <tr key={`ie-${j}`} style={{ background: 'rgba(245,158,11,0.04)' }}>
                                  <td colSpan={2} style={{ paddingLeft: 32, fontSize: 11, color: 'var(--amber)' }}>★ {ie.produto}</td>
                                  <td className="text-right mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>×{ie.quantidade}</td>
                                  <td colSpan={4} />
                                  <td className="text-right mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{fmt(ie.comissao_unit)}/un</td>
                                  <td className="text-right mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{fmt(ie.comissao_total)}</td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={6} style={{ paddingLeft: 16 }}>Subtotal frentistas/trocadores</td>
                          <td className="text-right mono">{fmt(naoGerentes.reduce((s, f) => s + f.comissaoAgregados, 0))}</td>
                          <td className="text-right mono">{fmt(naoGerentes.reduce((s, f) => s + f.comissaoEspeciais, 0))}</td>
                          <td className="text-right mono" style={{ color: 'var(--green)' }}>
                            {fmt(naoGerentes.reduce((s, f) => s + f.totalComissao, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* ── Tabela dedicada: Gerentes ── */}
                {isOpen && gerentes.length > 0 && (
                  <div className="table-wrap" style={{ borderTop: naoGerentes.length > 0 ? '2px solid var(--border-light)' : 'none' }}>
                    <div style={{ padding: '8px 16px', background: 'rgba(79,110,247,0.05)', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                      Gerentes
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Gerente</th>
                          <th className="text-right">Vendas Próprias</th>
                          <th className="text-right">Total Posto</th>
                          <th className="text-right">% Meta Posto</th>
                          <th className="text-right">Com. Gerencial</th>
                          <th className="text-right">Com. Esp. Gerente</th>
                          {/* Colunas de acumulação como trocador */}
                          <th className="text-right" style={{ color: 'var(--amber)' }}>Vendas Trocador</th>
                          <th className="text-right" style={{ color: 'var(--amber)' }}>Com. Trocador</th>
                          <th className="text-right" style={{ color: 'var(--amber)' }}>Com. Esp. Trocador</th>
                          <th className="text-right" style={{ color: 'var(--green)' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gerentes.map((f, i) => {
                          const fxPosto = faixaLabel(f.pctMeta, 'gerente');
                          return (
                            <React.Fragment key={i}>
                              <tr style={f.semVendas ? { opacity: 0.75 } : {}}>
                                <td style={{ fontWeight: 500, fontSize: 13 }}>
                                  {f.nome}
                                  {f.semVendas && (
                                    <span className="badge badge-gray" style={{ marginLeft: 6, fontSize: 10 }}>sem vendas</span>
                                  )}
                                  {f.acumulaTrocador && (
                                    <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: 10 }}>+ trocador</span>
                                  )}
                                </td>

                                {/* Vendas próprias (registradas como gerente) */}
                                <td className="text-right mono" style={{ fontSize: 12 }}>
                                  {fmt(f.vendasProprias)}
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>como gerente</div>
                                </td>

                                {/* Total do posto (base da comissão gerencial) */}
                                <td className="text-right mono">
                                  {fmt(f.totalVendas)}
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>base gerencial</div>
                                </td>

                                {/* % meta posto */}
                                <td className="text-right">
                                  <span className={`badge ${fxPosto.color}`}>{(f.pctMeta * 100).toFixed(1)}%</span>
                                  {!f.metaAtingida && (
                                    <div style={{ fontSize: 10, color: 'var(--red)' }}>meta não atingida</div>
                                  )}
                                </td>

                                {/* Comissão gerencial base */}
                                <td className="text-right mono">{fmt(f.comissaoAgregados)}</td>

                                {/* Com. especiais do gerente */}
                                <td className="text-right mono">
                                  {f.comissaoEspeciais > 0 ? fmt(f.comissaoEspeciais) : <span className="muted">—</span>}
                                </td>

                                {/* Acumulação como trocador */}
                                <td className="text-right mono" style={{ color: f.acumulaTrocador ? 'var(--amber)' : 'var(--text-muted)' }}>
                                  {f.acumulaTrocador ? fmt(f.vendasComoTrocador) : '—'}
                                  {f.acumulaTrocador && (
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                      {(f.taxaTrocadorAcumulada * 100).toFixed(0)}% taxa
                                    </div>
                                  )}
                                </td>
                                <td className="text-right mono" style={{ color: f.acumulaTrocador ? 'var(--amber)' : 'var(--text-muted)' }}>
                                  {f.acumulaTrocador ? fmt(f.comissaoTrocadorAcumulada) : '—'}
                                </td>
                                <td className="text-right mono" style={{ color: f.acumulaTrocador ? 'var(--amber)' : 'var(--text-muted)' }}>
                                  {f.acumulaTrocador && f.comissaoEspeciaisTrocador > 0 ? fmt(f.comissaoEspeciaisTrocador) : '—'}
                                </td>

                                {/* Total */}
                                <td className="text-right mono bold" style={{ color: 'var(--green)' }}>
                                  {fmt(f.totalComissao)}
                                  {f.acumulaTrocador && (
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                      gerente + trocador
                                    </div>
                                  )}
                                </td>
                              </tr>

                              {/* Detalhe: itens especiais do gerente */}
                              {f.itensEspeciais?.map((ie, j) => (
                                <tr key={`ieg-${j}`} style={{ background: 'rgba(79,110,247,0.04)' }}>
                                  <td colSpan={4} style={{ paddingLeft: 32, fontSize: 11, color: 'var(--accent)' }}>
                                    ★ {ie.produto} (gerente)
                                  </td>
                                  <td colSpan={1} />
                                  <td className="text-right mono" style={{ fontSize: 11, color: 'var(--accent)' }}>
                                    ×{ie.quantidade} × {fmt(ie.comissao_unit)} = {fmt(ie.comissao_total)}
                                  </td>
                                  <td colSpan={4} />
                                </tr>
                              ))}

                              {/* Detalhe: itens especiais como trocador */}
                              {f.acumulaTrocador && f.itensEspeciaisTrocador?.map((ie, j) => (
                                <tr key={`iet-${j}`} style={{ background: 'rgba(245,158,11,0.04)' }}>
                                  <td colSpan={4} style={{ paddingLeft: 32, fontSize: 11, color: 'var(--amber)' }}>
                                    ★ {ie.produto} (trocador)
                                  </td>
                                  <td colSpan={4} />
                                  <td className="text-right mono" style={{ fontSize: 11, color: 'var(--amber)' }}>
                                    ×{ie.quantidade} × {fmt(ie.comissao_unit)} = {fmt(ie.comissao_total)}
                                  </td>
                                  <td />
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} style={{ paddingLeft: 16 }}>Subtotal gerentes</td>
                          <td className="text-right mono">{fmt(gerentes.reduce((s, f) => s + f.comissaoAgregados, 0))}</td>
                          <td className="text-right mono">{fmt(gerentes.reduce((s, f) => s + f.comissaoEspeciais, 0))}</td>
                          <td />
                          <td className="text-right mono" style={{ color: 'var(--amber)' }}>{fmt(gerentes.reduce((s, f) => s + (f.comissaoTrocadorAcumulada || 0), 0))}</td>
                          <td className="text-right mono" style={{ color: 'var(--amber)' }}>{fmt(gerentes.reduce((s, f) => s + (f.comissaoEspeciaisTrocador || 0), 0))}</td>
                          <td className="text-right mono" style={{ color: 'var(--green)' }}>
                            {fmt(gerentes.reduce((s, f) => s + f.totalComissao, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Total do posto */}
                {isOpen && (
                  <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface2)' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>
                      Total {posto?.codigo}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--green)', fontFamily: 'var(--mono)' }}>
                      {fmt(funcs.reduce((s, f) => s + f.totalComissao, 0))}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Grand total */}
        {!loading && comissoes && postoIds.length > 0 && (
          <div className="card" style={{ marginTop: 4 }}>
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  TOTAL GERAL — {periodos.find(p => p.id === parseInt(periodoId))?.nome}
                </span>
                {proRataInfo?.ativo && (
                  <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--amber)', background: 'var(--amber-bg)', padding: '2px 8px', borderRadius: 4 }}>
                    ⚡ Valor parcial — {proRataInfo.corridos}/{proRataInfo.totais} dias ({(proRataInfo.fator * 100).toFixed(1)}% do período)
                  </span>
                )}
              </div>
              <span style={{ fontWeight: 800, fontSize: 22, color: 'var(--green)', fontFamily: 'var(--mono)' }}>
                {fmt(totalGeral)}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
