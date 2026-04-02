import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { API } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { Modal, ConfirmModal, Spinner } from '../components/ui';
import { fmt } from '../utils/fmt';

export default function PeriodoDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [periodo, setPeriodo] = useState(null);
  const [metas, setMetas] = useState([]);
  const [postos, setPostos] = useState([]);
  const [funcionarios, setFuncionarios] = useState([]);
  const [tab, setTab] = useState('metas');
  const [loading, setLoading] = useState(true);

  // Vendas
  const [vendas, setVendas] = useState([]);
  const [vendasTotal, setVendasTotal] = useState(0);
  const [filterPosto, setFilterPosto] = useState('');
  const [filterFunc, setFilterFunc] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Produtos especiais inline
  const [produtosEspeciais, setProdutosEspeciais] = useState([]);
  const [showProdModal, setShowProdModal] = useState(false);
  const [prodVenda, setProdVenda] = useState(null);
  const [prodForm, setProdForm] = useState({ comissao_frentista: '', comissao_trocador: '', comissao_gerente: '' });
  const [savingProd, setSavingProd] = useState(false);
  const [prodError, setProdError] = useState('');

  // Import
  const [importing, setImporting] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importResult, setImportResult] = useState(null);

  // Meta modal
  const [showMetaModal, setShowMetaModal] = useState(false);
  const [metaForm, setMetaForm] = useState({ posto_id: '', meta_frentista: '', meta_trocador: '', meta_posto: '' });
  const [editMeta, setEditMeta] = useState(null);
  const [savingMeta, setSavingMeta] = useState(false);

  // Funcionário modal
  const [showFuncModal, setShowFuncModal] = useState(false);
  const [funcForm, setFuncForm] = useState({ posto_id: '', nome: '', tipo: 'trocador' });
  const [editFunc, setEditFunc] = useState(null);
  const [savingFunc, setSavingFunc] = useState(false);
  const [deleteFunc, setDeleteFunc] = useState(null);
  const [funcError, setFuncError] = useState('');

  // FIX 2: Desqualificados via API
  const [todosFuncionarios, setTodosFuncionarios] = useState([]);
  const [desqualificados, setDesqualificados] = useState([]); // array of DB records
  const [loadingDesq, setLoadingDesq] = useState(false);
  const [filterDesqPosto, setFilterDesqPosto] = useState('');
  const [motivoModal, setMotivoModal] = useState(null);
  const [motivoTexto, setMotivoTexto] = useState('');

  // Excluir período
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = user?.role === 'admin';

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      axios.get(`${API}/periodos/${id}`),
      axios.get(`${API}/periodos/${id}/metas`),
      axios.get(`${API}/postos`),
      axios.get(`${API}/periodos/${id}/funcionarios`),
    ]).then(([r1, r2, r3, r4]) => {
      setPeriodo(r1.data);
      setMetas(r2.data);
      setPostos(r3.data);
      setFuncionarios(r4.data);
      setImportUrl(r1.data.sheets_url || '');
    }).finally(() => setLoading(false));
  }, [id]);

  const loadVendas = useCallback(() => {
    const params = { page, limit: pageSize };
    if (filterPosto) params.posto_id = filterPosto;
    if (filterFunc) params.funcionario = filterFunc;
    axios.get(`${API}/periodos/${id}/vendas`, { params }).then(r => {
      setVendas(r.data.data);
      setVendasTotal(r.data.total);
    });
  }, [id, page, pageSize, filterPosto, filterFunc]);

  const loadProdutosEspeciais = useCallback(() => {
    if (!postos.length) return;
    Promise.all(postos.map(p => axios.get(`${API}/postos/${p.id}/produtos-especiais`)))
      .then(results => {
        const all = results.flatMap((r, i) => r.data.map(pe => ({ ...pe, posto_codigo: postos[i].codigo })));
        setProdutosEspeciais(all);
      });
  }, [postos]);

  // FIX 2: load from API — tolerante a falha na tabela desqualificados
  const loadTodosFuncionarios = useCallback(() => {
    setLoadingDesq(true);
    axios.get(`${API}/periodos/${id}/todos-funcionarios`)
      .then(r1 => {
        setTodosFuncionarios(r1.data);
        return axios.get(`${API}/periodos/${id}/desqualificados`).catch(() => ({ data: [] }));
      })
      .then(r2 => setDesqualificados(r2.data))
      .finally(() => setLoadingDesq(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'vendas') { loadVendas(); loadProdutosEspeciais(); } }, [tab, loadVendas, loadProdutosEspeciais]);
  useEffect(() => { if (tab === 'desqualificados') loadTodosFuncionarios(); }, [tab, loadTodosFuncionarios]);

  // ── Import
  const doImport = async () => {
    setImporting(true); setImportResult(null);
    try {
      const r = await axios.post(`${API}/periodos/${id}/importar`, { sheets_url: importUrl || undefined });
      setImportResult({ ok: true, msg: r.data.message });
      load();
      if (tab === 'vendas') loadVendas();
    } catch (e) {
      setImportResult({ ok: false, msg: e.response?.data?.error || 'Erro ao importar' });
    } finally { setImporting(false); }
  };

  // ── Excluir período
  const doDelete = async () => {
    setDeleting(true);
    try {
      await axios.delete(`${API}/periodos/${id}`);
      navigate('/periodos');
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao excluir período');
      setDeleting(false);
    }
  };

  // ── Metas
  const saveMeta = async () => {
    setSavingMeta(true);
    try {
      await axios.post(`${API}/periodos/${id}/metas`, metaForm);
      setShowMetaModal(false); load();
    } catch (e) { alert(e.response?.data?.error || 'Erro'); }
    finally { setSavingMeta(false); }
  };

  // ── Funcionários
  const saveFunc = async () => {
    setSavingFunc(true); setFuncError('');
    try {
      if (funcForm.tipo === 'ambos') {
        await axios.post(`${API}/periodos/${id}/funcionarios`, { posto_id: funcForm.posto_id, nome: funcForm.nome, tipo: 'gerente' });
        await axios.post(`${API}/periodos/${id}/funcionarios`, { posto_id: funcForm.posto_id, nome: funcForm.nome, tipo: 'trocador' });
        if (editFunc && editFunc.tipo !== 'gerente' && editFunc.tipo !== 'trocador') {
          await axios.delete(`${API}/periodos/${id}/funcionarios/${editFunc.id}`);
        }
      } else if (editFunc) {
        await axios.put(`${API}/periodos/${id}/funcionarios/${editFunc.id}`, { nome: funcForm.nome, tipo: funcForm.tipo });
      } else {
        await axios.post(`${API}/periodos/${id}/funcionarios`, { posto_id: funcForm.posto_id, nome: funcForm.nome, tipo: funcForm.tipo });
      }
      setShowFuncModal(false);
      load();
    } catch (e) {
      setFuncError(e.response?.data?.error || 'Erro ao salvar');
    } finally {
      setSavingFunc(false);
    }
  };

  const doDeleteFunc = async () => {
    await axios.delete(`${API}/periodos/${id}/funcionarios/${deleteFunc.id}`);
    setDeleteFunc(null); load();
  };

  // ── FIX 2: Desqualificados via API
  const isDesqualificado = (f) =>
    desqualificados.some(d =>
      d.posto_id === f.posto_id &&
      d.nome.trim().toLowerCase() === f.nome.trim().toLowerCase() &&
      d.tipo === f.tipo
    );

  const getDesqRecord = (f) =>
    desqualificados.find(d =>
      d.posto_id === f.posto_id &&
      d.nome.trim().toLowerCase() === f.nome.trim().toLowerCase() &&
      d.tipo === f.tipo
    );

  const confirmarDesqualificacao = async () => {
    if (!motivoModal) return;
    const posto = postos.find(p => p.codigo === motivoModal.posto_codigo);
    if (!posto) return;
    try {
      await axios.post(`${API}/periodos/${id}/desqualificados`, {
        nome: motivoModal.nome,
        tipo: motivoModal.tipo,
        posto_codigo: motivoModal.posto_codigo,
        posto_id: posto.id,
        motivo: motivoTexto,
      });
      setMotivoModal(null);
      loadTodosFuncionarios();
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao desqualificar');
    }
  };

  const requalificar = async (f) => {
    const rec = getDesqRecord(f);
    if (!rec) return;
    try {
      await axios.delete(`${API}/periodos/${id}/desqualificados/${rec.id}`);
      loadTodosFuncionarios();
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao requalificar');
    }
  };

  // ── Tornar produto especial
  const tornarEspecial = (venda) => {
    const posto = postos.find(p => p.codigo === venda.posto_codigo);
    if (!posto) return;
    setProdVenda({ ...venda, posto });
    setProdForm({ comissao_frentista: '', comissao_trocador: '', comissao_gerente: '' });
    setProdError('');
    setShowProdModal(true);
  };

  const salvarProdEspecial = async () => {
    setSavingProd(true); setProdError('');
    try {
      await axios.post(`${API}/postos/${prodVenda.posto.id}/produtos-especiais`, {
        nome_produto: prodVenda.produto,
        comissao_frentista: prodForm.comissao_frentista || 0,
        comissao_trocador: prodForm.comissao_trocador || 0,
        comissao_gerente: prodForm.comissao_gerente || 0,
      });
      setShowProdModal(false);
      loadProdutosEspeciais();
    } catch (e) { setProdError(e.response?.data?.error || 'Erro ao salvar produto'); }
    finally { setSavingProd(false); }
  };

  const isProdEspecial = (venda) => {
    const posto = postos.find(p => p.codigo === venda.posto_codigo);
    if (!posto) return false;
    return produtosEspeciais.some(
      pe => pe.posto_id === posto.id &&
            pe.nome_produto.trim().toLowerCase() === venda.produto.trim().toLowerCase() &&
            pe.ativo
    );
  };

  const tipoColor = t => t === 'gerente' ? 'badge-blue' : t === 'trocador' ? 'badge-amber' : 'badge-gray';

  const diasInfo = (() => {
    if (!periodo || periodo.status === 'fechado') return null;
    const ini = new Date(periodo.data_inicio);
    const fim = new Date(periodo.data_fim);
    const hoje = new Date();
    const total = Math.round((fim - ini) / 86400000) + 1;
    const ref = hoje < fim ? hoje : fim;
    const corridos = Math.max(1, Math.round((ref - ini) / 86400000) + 1);
    return { total, corridos, fator: corridos / total };
  })();

  const funcDesqFiltrados = filterDesqPosto
    ? todosFuncionarios.filter(f => f.posto_codigo === filterDesqPosto)
    : todosFuncionarios;

  if (loading) return (
    <>
      <div className="topbar"><div className="topbar-title">Carregando…</div></div>
      <div className="page"><Spinner /></div>
    </>
  );

  return (
    <>
      <div className="topbar">
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2, cursor: 'pointer' }}
            onClick={() => navigate('/periodos')}>← Períodos</div>
          <div className="topbar-title">{periodo?.nome}</div>
          <div className="topbar-sub mono">
            {new Date(periodo?.data_inicio).toLocaleDateString('pt-BR')} → {new Date(periodo?.data_fim).toLocaleDateString('pt-BR')}
            {' · '}
            <span className={`badge ${periodo?.status === 'ativo' ? 'badge-green' : 'badge-gray'}`}>
              {periodo?.status === 'ativo' ? 'Em aberto' : 'Fechado'}
            </span>
            {diasInfo && (
              <span style={{ marginLeft: 8, color: 'var(--amber)', fontSize: 11 }}>
                Pro rata: {diasInfo.corridos}/{diasInfo.total} dias ({(diasInfo.fator * 100).toFixed(1)}%)
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-8">
          {isAdmin && (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
              🗑 Excluir Período
            </button>
          )}
          {isAdmin && periodo?.status === 'ativo' && (
            <button className="btn btn-ghost btn-sm" onClick={async () => {
              await axios.put(`${API}/periodos/${id}`, { status: 'fechado' });
              load();
            }}>
              🔒 Fechar Período
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/comissoes?periodo=' + id)}>
            Ver Comissões →
          </button>
        </div>
      </div>

      <div className="page">
        {/* Tabs */}
        <div className="tabs mb-4" style={{ marginBottom: 16, display: 'inline-flex', flexWrap: 'wrap' }}>
          {[
            ['metas', 'Metas'],
            ['funcionarios', 'Gerentes & Trocadores'],
            ['importar', 'Importar Vendas'],
            ['vendas', 'Vendas'],
            ['desqualificados', 'Desqualificados'],
          ].map(([k, v]) => (
            <div key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{v}</div>
          ))}
        </div>

        {/* ─── METAS ─── */}
        {tab === 'metas' && (
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Metas por Posto</div>
                <div className="card-sub">
                  Meta frentista e trocador = valor individual por colaborador.
                  Meta do posto = base para comissão do gerente.
                  {diasInfo && <span style={{ color: 'var(--amber)', marginLeft: 6 }}>
                    Metas efetivas com pro rata de {(diasInfo.fator * 100).toFixed(1)}% ({diasInfo.corridos}/{diasInfo.total} dias).
                  </span>}
                </div>
              </div>
              {isAdmin && (
                <button className="btn btn-primary btn-sm" onClick={() => {
                  setEditMeta(null);
                  setMetaForm({ posto_id: '', meta_frentista: '', meta_trocador: '', meta_posto: '' });
                  setShowMetaModal(true);
                }}>+ Definir Meta</button>
              )}
            </div>
            {!metas.length ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                Nenhuma meta definida.{' '}
                {isAdmin && <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => setShowMetaModal(true)}>Definir agora →</span>}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Posto</th><th>Nome</th>
                      <th className="text-right">Meta Frentista/un</th>
                      {diasInfo && <th className="text-right">Efetiva Frentista</th>}
                      <th className="text-right">Meta Trocador/un</th>
                      {diasInfo && <th className="text-right">Efetiva Trocador</th>}
                      <th className="text-right">Meta Posto</th>
                      {diasInfo && <th className="text-right">Efetiva Posto</th>}
                      {isAdmin && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {metas.map(m => (
                      <tr key={m.id}>
                        <td><span className="badge badge-gray mono">{m.codigo}</span></td>
                        <td>{m.posto_nome}</td>
                        <td className="text-right mono bold">{fmt(m.meta_frentista)}</td>
                        {diasInfo && <td className="text-right mono" style={{ color: 'var(--amber)' }}>{fmt(m.meta_frentista * diasInfo.fator)}</td>}
                        <td className="text-right mono bold">{fmt(m.meta_trocador)}</td>
                        {diasInfo && <td className="text-right mono" style={{ color: 'var(--amber)' }}>{fmt(m.meta_trocador * diasInfo.fator)}</td>}
                        <td className="text-right mono bold">{fmt(m.meta_posto)}</td>
                        {diasInfo && <td className="text-right mono" style={{ color: 'var(--amber)' }}>{fmt(m.meta_posto * diasInfo.fator)}</td>}
                        {isAdmin && (
                          <td>
                            <button className="btn btn-ghost btn-sm" onClick={() => {
                              setEditMeta(m);
                              setMetaForm({ posto_id: m.posto_id, meta_frentista: m.meta_frentista, meta_trocador: m.meta_trocador, meta_posto: m.meta_posto });
                              setShowMetaModal(true);
                            }}>Editar</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── GERENTES & TROCADORES ─── */}
        {tab === 'funcionarios' && (
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Gerentes & Trocadores deste Período</div>
                <div className="card-sub">
                  O nome deve ser <strong>exatamente igual</strong> à coluna B da planilha.
                  Use o tipo <strong>Ambos</strong> para quem acumula gerente + trocador.
                </div>
              </div>
              {isAdmin && (
                <button className="btn btn-primary btn-sm" onClick={() => {
                  setEditFunc(null);
                  setFuncForm({ posto_id: '', nome: '', tipo: 'trocador' });
                  setFuncError('');
                  setShowFuncModal(true);
                }}>+ Adicionar</button>
              )}
            </div>
            {!funcionarios.length ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Nenhum gerente ou trocador cadastrado. Os demais serão classificados como <strong>frentistas</strong>.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Posto</th><th>Nome</th><th>Tipo</th>{isAdmin && <th></th>}</tr></thead>
                  <tbody>
                    {funcionarios.map(f => (
                      <tr key={f.id}>
                        <td><span className="badge badge-gray mono">{f.codigo}</span></td>
                        <td className="mono" style={{ fontSize: 12 }}>{f.nome}</td>
                        <td><span className={`badge ${tipoColor(f.tipo)}`}>{f.tipo}</span></td>
                        {isAdmin && (
                          <td>
                            <div className="flex gap-8">
                              <button className="btn btn-ghost btn-sm" onClick={() => {
                                setEditFunc(f);
                                setFuncForm({ posto_id: f.posto_id, nome: f.nome, tipo: f.tipo });
                                setFuncError('');
                                setShowFuncModal(true);
                              }}>Editar</button>
                              <button className="btn btn-danger btn-sm" onClick={() => setDeleteFunc(f)}>Remover</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── IMPORTAR ─── */}
        {tab === 'importar' && (
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Importar Vendas do Google Sheets</div>
                <div className="card-sub">Colunas: A=Posto · B=Funcionário · C=Produto · D=Qtde · E=Vl.Unit · F=Vl.Bruto · G=Desconto · H=Acréscimo · I=Vl.Final</div>
              </div>
            </div>
            <div className="card-body">
              <div className="form-group">
                <label>URL da Planilha Google Sheets</label>
                <input placeholder="https://docs.google.com/spreadsheets/d/…" value={importUrl} onChange={e => setImportUrl(e.target.value)} />
                <div className="form-hint">Compartilhar → "Qualquer pessoa com o link" → copie a URL</div>
              </div>
              {importResult && (
                <div className={`alert ${importResult.ok ? 'alert-success' : 'alert-error'}`}>{importResult.msg}</div>
              )}
              <button className="btn btn-primary" onClick={doImport} disabled={importing || !importUrl}>
                {importing ? '⟳ Importando…' : '↓ Importar Vendas'}
              </button>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                ⚠️ A importação substitui todas as vendas existentes deste período.
              </div>
            </div>
          </div>
        )}

        {/* ─── VENDAS ─── */}
        {tab === 'vendas' && (
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Vendas Importadas</div>
                <div className="card-sub">{vendasTotal} registros no total</div>
              </div>
              <div className="filters" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={filterPosto} onChange={e => { setFilterPosto(e.target.value); setPage(1); }} style={{ maxWidth: 180 }}>
                  <option value="">Todos os postos</option>
                  {postos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
                </select>
                {/* FIX 1: placeholder updated to reflect produto search too */}
                <input
                  placeholder="🔍 Funcionário ou produto…"
                  value={filterFunc}
                  onChange={e => { setFilterFunc(e.target.value); setPage(1); }}
                  style={{ maxWidth: 220 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Por página:</span>
                  <select value={pageSize} onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }} style={{ maxWidth: 90 }}>
                    {[50, 100, 200, 500, 1000, 2000, 5000].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Posto</th><th>Funcionário</th><th>Tipo</th><th>Produto</th>
                    <th className="text-right">Qtde</th><th className="text-right">Vl. Final</th>
                    {isAdmin && <th>Ação</th>}
                  </tr>
                </thead>
                <tbody>
                  {vendas.map((v, i) => {
                    const especial = isProdEspecial(v);
                    return (
                      <tr key={i} style={especial ? { background: 'rgba(245,158,11,0.05)' } : {}}>
                        <td><span className="badge badge-gray mono">{v.posto_codigo}</span></td>
                        <td style={{ fontSize: 12 }}>{v.funcionario}</td>
                        <td><span className={`badge ${tipoColor(v.tipo_funcionario)}`}>{v.tipo_funcionario}</span></td>
                        <td style={{ fontSize: 12, maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {especial && <span style={{ color: 'var(--amber)', marginRight: 4 }}>★</span>}
                          {v.produto}
                          {especial && <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: 10 }}>especial</span>}
                        </td>
                        <td className="text-right mono">{v.quantidade}</td>
                        <td className="text-right mono bold">{fmt(v.valor_final)}</td>
                        {isAdmin && (
                          <td>
                            {!especial ? (
                              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => tornarEspecial(v)}>
                                ★ Tornar especial
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--amber)' }}>★ Especial</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!vendas.length && (
                    <tr><td colSpan={isAdmin ? 7 : 6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      Nenhuma venda encontrada.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {vendasTotal > pageSize && (
              <div className="pagination">
                <div className="pag-info">
                  Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, vendasTotal)} de {vendasTotal}
                </div>
                <div className="pag-btns">
                  <button className="pag-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
                  {Array.from({ length: Math.min(5, Math.ceil(vendasTotal / pageSize)) }, (_, i) => {
                    const pg = i + 1;
                    return <button key={pg} className={`pag-btn ${page === pg ? 'on' : ''}`} onClick={() => setPage(pg)}>{pg}</button>;
                  })}
                  {Math.ceil(vendasTotal / pageSize) > 5 && <span style={{ color: 'var(--text-muted)', padding: '0 4px' }}>…</span>}
                  <button className="pag-btn" disabled={page * pageSize >= vendasTotal} onClick={() => setPage(p => p + 1)}>›</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── DESQUALIFICADOS ─── */}
        {tab === 'desqualificados' && (
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Desqualificados</div>
                <div className="card-sub">
                  Funcionários desqualificados têm comissão zerada no relatório.
                  O motivo fica visível no relatório de comissões.
                </div>
              </div>
              <select value={filterDesqPosto} onChange={e => setFilterDesqPosto(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="">Todos os postos</option>
                {postos.map(p => <option key={p.id} value={p.codigo}>{p.codigo} — {p.nome}</option>)}
              </select>
            </div>

            {loadingDesq ? <Spinner text="Carregando funcionários…" /> : (
              <>
                {desqualificados.length > 0 && (
                  <div style={{ padding: '8px 16px', background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--red)' }}>
                    ⚠️ {desqualificados.length} funcionário(s) desqualificado(s) — comissões zeradas no relatório
                  </div>
                )}
                {funcDesqFiltrados.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Nenhum funcionário encontrado. Importe vendas ou cadastre funcionários primeiro.
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Posto</th><th>Funcionário</th><th>Tipo</th><th>Status</th><th>Motivo</th>
                          {isAdmin && <th>Ação</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {funcDesqFiltrados.map((f, i) => {
                          const desq = isDesqualificado(f);
                          const rec = getDesqRecord(f);
                          return (
                            <tr key={i} style={desq ? { background: 'rgba(239,68,68,0.05)' } : {}}>
                              <td><span className="badge badge-gray mono">{f.posto_codigo}</span></td>
                              <td style={{ fontWeight: 500 }}>{f.nome}</td>
                              <td><span className={`badge ${tipoColor(f.tipo)}`}>{f.tipo}</span></td>
                              <td>
                                {desq
                                  ? <span className="badge badge-red">Desqualificado</span>
                                  : <span className="badge badge-green">Qualificado</span>}
                              </td>
                              <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 220 }}>
                                {rec?.motivo || <span style={{ color: 'var(--border-light)' }}>—</span>}
                              </td>
                              {isAdmin && (
                                <td>
                                  {desq ? (
                                    <button className="btn btn-ghost btn-sm" onClick={() => requalificar(f)}>
                                      Requalificar
                                    </button>
                                  ) : (
                                    <button className="btn btn-danger btn-sm" onClick={() => {
                                      setMotivoModal({ nome: f.nome, tipo: f.tipo, posto_codigo: f.posto_codigo });
                                      setMotivoTexto('');
                                    }}>
                                      Desqualificar
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Modais ── */}

      {showMetaModal && (
        <Modal title={editMeta ? 'Editar Meta' : 'Definir Meta do Posto'} onClose={() => setShowMetaModal(false)}>
          <div className="modal-body">
            <div className="form-group">
              <label>Posto</label>
              <select value={metaForm.posto_id} onChange={e => setMetaForm({ ...metaForm, posto_id: e.target.value })} disabled={!!editMeta}>
                <option value="">Selecione…</option>
                {postos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Meta Frentista (R$/colaborador)</label>
                <input type="number" min="0" step="0.01" placeholder="0,00" value={metaForm.meta_frentista}
                  onChange={e => setMetaForm({ ...metaForm, meta_frentista: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Meta Trocador (R$/colaborador)</label>
                <input type="number" min="0" step="0.01" placeholder="0,00" value={metaForm.meta_trocador}
                  onChange={e => setMetaForm({ ...metaForm, meta_trocador: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Meta do Posto — base do gerente (R$ total)</label>
              <input type="number" min="0" step="0.01" placeholder="0,00" value={metaForm.meta_posto}
                onChange={e => setMetaForm({ ...metaForm, meta_posto: e.target.value })} />
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => setShowMetaModal(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={savingMeta || !metaForm.posto_id} onClick={saveMeta}>
              {savingMeta ? 'Salvando…' : 'Salvar Meta'}
            </button>
          </div>
        </Modal>
      )}

      {showFuncModal && (
        <Modal title={editFunc ? 'Editar Gerente/Trocador' : 'Adicionar Gerente ou Trocador'} onClose={() => setShowFuncModal(false)}>
          <div className="modal-body">
            {funcError && <div className="alert alert-error">{funcError}</div>}
            <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12 }}>
              O nome deve ser <strong>exatamente igual</strong> ao da coluna B da planilha.<br />
              Use <strong>Ambos</strong> para quem é gerente e também aparece como trocador nas vendas.
            </div>
            <div className="form-group">
              <label>Posto</label>
              <select value={funcForm.posto_id} onChange={e => setFuncForm({ ...funcForm, posto_id: e.target.value })} disabled={!!editFunc}>
                <option value="">Selecione…</option>
                {postos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Nome (exato como na planilha)</label>
              <input placeholder="Ex: 000006 - CARLOS ROBERTO ALVES" value={funcForm.nome}
                onChange={e => setFuncForm({ ...funcForm, nome: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Tipo</label>
              <select value={funcForm.tipo} onChange={e => setFuncForm({ ...funcForm, tipo: e.target.value })}>
                <option value="gerente">Gerente</option>
                <option value="trocador">Trocador de Óleo</option>
                <option value="ambos">Ambos (Gerente + Trocador)</option>
              </select>
              {funcForm.tipo === 'ambos' && (
                <div className="form-hint" style={{ color: 'var(--amber)' }}>
                  ⚡ Comissão gerencial (soma frentistas + trocadores + 3% posto se meta) + comissão de trocador própria
                </div>
              )}
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => setShowFuncModal(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={savingFunc || !funcForm.nome || !funcForm.posto_id} onClick={saveFunc}>
              {savingFunc ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </Modal>
      )}

      {deleteFunc && (
        <ConfirmModal
          title="Remover Gerente/Trocador"
          message={`Remover "${deleteFunc.nome}" (${deleteFunc.tipo}) deste período?`}
          onConfirm={doDeleteFunc}
          onClose={() => setDeleteFunc(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Excluir Período"
          message={`Tem certeza que deseja excluir "${periodo?.nome}"? Todos os dados (vendas, metas, funcionários) serão removidos permanentemente.`}
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}

      {/* Modal motivo desqualificação */}
      {motivoModal && (
        <Modal title={`Desqualificar: ${motivoModal.nome}`} onClose={() => setMotivoModal(null)}>
          <div className="modal-body">
            <div className="form-group">
              <label>Motivo da desqualificação</label>
              <textarea
                rows={3}
                placeholder="Ex: Afastamento por licença, desligamento…"
                value={motivoTexto}
                onChange={e => setMotivoTexto(e.target.value)}
                style={{ resize: 'vertical' }}
              />
              <div className="form-hint">Opcional — ficará visível no relatório de comissões.</div>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => setMotivoModal(null)}>Cancelar</button>
            <button className="btn btn-danger" onClick={confirmarDesqualificacao}>
              Confirmar Desqualificação
            </button>
          </div>
        </Modal>
      )}

      {/* Modal tornar produto especial */}
      {showProdModal && prodVenda && (
        <Modal title="Tornar Produto Especial" onClose={() => setShowProdModal(false)}>
          <div className="modal-body">
            {prodError && <div className="alert alert-error">{prodError}</div>}
            <div style={{ padding: '10px 14px', background: 'var(--surface2)', borderRadius: 'var(--radius)', marginBottom: 16, fontSize: 12 }}>
              <div style={{ fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4 }}>Produto</div>
              <div style={{ color: 'var(--amber)', wordBreak: 'break-word' }}>{prodVenda.produto}</div>
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>Posto: <strong>{prodVenda.posto?.codigo} — {prodVenda.posto?.nome}</strong></div>
            </div>
            <div className="alert alert-info" style={{ fontSize: 12, marginBottom: 14 }}>
              Valor de comissão por unidade vendida para cada tipo. Use <strong>0</strong> para não pagar comissão especial àquele tipo.
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Comissão Frentista (R$/un)</label>
                <input type="number" min="0" step="0.01" placeholder="0,00" value={prodForm.comissao_frentista}
                  onChange={e => setProdForm({ ...prodForm, comissao_frentista: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Comissão Trocador (R$/un)</label>
                <input type="number" min="0" step="0.01" placeholder="0,00" value={prodForm.comissao_trocador}
                  onChange={e => setProdForm({ ...prodForm, comissao_trocador: e.target.value })} />
              </div>
            </div>
            <div className="form-group" style={{ maxWidth: '50%' }}>
              <label>Comissão Gerente (R$/un)</label>
              <input type="number" min="0" step="0.01" placeholder="0,00" value={prodForm.comissao_gerente}
                onChange={e => setProdForm({ ...prodForm, comissao_gerente: e.target.value })} />
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => setShowProdModal(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={savingProd} onClick={salvarProdEspecial}>
              {savingProd ? 'Salvando…' : '★ Salvar como Especial'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
