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
  const [vendas, setVendas] = useState([]);
  const [vendasTotal, setVendasTotal] = useState(0);
  const [tab, setTab] = useState('metas');
  const [loading, setLoading] = useState(true);

  // Import
  const [importing, setImporting] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importResult, setImportResult] = useState(null);

  // Meta modal
  const [showMetaModal, setShowMetaModal] = useState(false);
  const [metaForm, setMetaForm] = useState({ posto_id: '', meta_frentista: '', meta_trocador: '', meta_posto: '' });
  const [editMeta, setEditMeta] = useState(null);
  const [savingMeta, setSavingMeta] = useState(false);

  // Funcionario modal
  const [showFuncModal, setShowFuncModal] = useState(false);
  const [funcForm, setFuncForm] = useState({ posto_id: '', nome: '', tipo: 'trocador' });
  const [editFunc, setEditFunc] = useState(null);
  const [savingFunc, setSavingFunc] = useState(false);
  const [deleteFunc, setDeleteFunc] = useState(null);
  const [funcError, setFuncError] = useState('');

  // Vendas filter
  const [filterPosto, setFilterPosto] = useState('');
  const [page, setPage] = useState(1);

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
    const params = { page, limit: 50 };
    if (filterPosto) params.posto_id = filterPosto;
    axios.get(`${API}/periodos/${id}/vendas`, { params }).then(r => {
      setVendas(r.data.data);
      setVendasTotal(r.data.total);
    });
  }, [id, page, filterPosto]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'vendas') loadVendas(); }, [tab, loadVendas]);

  // ── Import
  const doImport = async () => {
    setImporting(true); setImportResult(null);
    try {
      const r = await axios.post(`${API}/periodos/${id}/importar`, { sheets_url: importUrl || undefined });
      setImportResult({ ok: true, msg: r.data.message });
      load(); if (tab === 'vendas') loadVendas();
    } catch (e) {
      setImportResult({ ok: false, msg: e.response?.data?.error || 'Erro ao importar' });
    } finally { setImporting(false); }
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

  // ── Funcionarios
  const saveFunc = async () => {
    setSavingFunc(true); setFuncError('');
    try {
      if (editFunc) {
        await axios.put(`${API}/periodos/${id}/funcionarios/${editFunc.id}`, funcForm);
      } else {
        await axios.post(`${API}/periodos/${id}/funcionarios`, funcForm);
      }
      setShowFuncModal(false); load();
    } catch (e) { setFuncError(e.response?.data?.error || 'Erro ao salvar'); }
    finally { setSavingFunc(false); }
  };

  const doDeleteFunc = async () => {
    await axios.delete(`${API}/periodos/${id}/funcionarios/${deleteFunc.id}`);
    setDeleteFunc(null); load();
  };

  const tipoColor = t => t === 'gerente' ? 'badge-blue' : 'badge-amber';

  // dias corridos
  const diasInfo = (() => {
    if (!periodo) return null;
    if (periodo.status === 'fechado') return null;
    const ini = new Date(periodo.data_inicio);
    const fim = new Date(periodo.data_fim);
    const hoje = new Date();
    const total = Math.round((fim - ini) / 86400000) + 1;
    const ref = hoje < fim ? hoje : fim;
    const corridos = Math.max(1, Math.round((ref - ini) / 86400000) + 1);
    const fator = corridos / total;
    return { total, corridos, fator };
  })();

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
        <div className="tabs mb-4" style={{ marginBottom: 16, display: 'inline-flex' }}>
          {[
            ['metas', 'Metas'],
            ['funcionarios', 'Gerentes & Trocadores'],
            ['importar', 'Importar Vendas'],
            ['vendas', 'Vendas'],
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
                }}>
                  + Definir Meta
                </button>
              )}
            </div>
            {!metas.length ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                Nenhuma meta definida.{' '}
                {isAdmin && <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => setShowMetaModal(true)}>
                  Definir agora →
                </span>}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Posto</th>
                      <th>Nome</th>
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
                        {diasInfo && <td className="text-right mono" style={{ color: 'var(--amber)' }}>
                          {fmt(m.meta_frentista * diasInfo.fator)}
                        </td>}
                        <td className="text-right mono bold">{fmt(m.meta_trocador)}</td>
                        {diasInfo && <td className="text-right mono" style={{ color: 'var(--amber)' }}>
                          {fmt(m.meta_trocador * diasInfo.fator)}
                        </td>}
                        <td className="text-right mono bold">{fmt(m.meta_posto)}</td>
                        {diasInfo && <td className="text-right mono" style={{ color: 'var(--amber)' }}>
                          {fmt(m.meta_posto * diasInfo.fator)}
                        </td>}
                        {isAdmin && (
                          <td>
                            <button className="btn btn-ghost btn-sm" onClick={() => {
                              setEditMeta(m);
                              setMetaForm({
                                posto_id: m.posto_id,
                                meta_frentista: m.meta_frentista,
                                meta_trocador: m.meta_trocador,
                                meta_posto: m.meta_posto,
                              });
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
                  Cadastre aqui os gerentes e trocadores desta apuração. O nome deve ser <strong>exatamente igual</strong> à coluna B da planilha.
                  Gerentes cadastrados aqui recebem comissão mesmo que não apareçam nas vendas.
                </div>
              </div>
              {isAdmin && (
                <button className="btn btn-primary btn-sm" onClick={() => {
                  setEditFunc(null);
                  setFuncForm({ posto_id: '', nome: '', tipo: 'trocador' });
                  setFuncError('');
                  setShowFuncModal(true);
                }}>
                  + Adicionar
                </button>
              )}
            </div>
            {!funcionarios.length ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Nenhum gerente ou trocador cadastrado neste período.
                Os demais serão classificados como <strong>frentistas</strong> automaticamente.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Posto</th><th>Nome (exato como na planilha)</th><th>Tipo</th>{isAdmin && <th></th>}</tr></thead>
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
                <div className="card-sub">
                  Colunas: A=Posto · B=Funcionário · C=Produto · D=Qtde · E=Vl.Unit · F=Vl.Bruto · G=Desconto · H=Acréscimo · I=Vl.Final
                </div>
              </div>
            </div>
            <div className="card-body">
              <div className="form-group">
                <label>URL da Planilha Google Sheets</label>
                <input
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  value={importUrl}
                  onChange={e => setImportUrl(e.target.value)}
                />
                <div className="form-hint">Compartilhar → "Qualquer pessoa com o link" pode ver → copie a URL</div>
              </div>

              <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 16, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-dim)' }}>Como o tipo é detectado automaticamente:</div>
                <ul style={{ paddingLeft: 16, color: 'var(--text-muted)', lineHeight: 2 }}>
                  <li>O nome da coluna B é comparado com os <strong style={{ color: 'var(--text-dim)' }}>gerentes e trocadores cadastrados neste período</strong></li>
                  <li>Se bater exatamente → tipo definido (gerente ou trocador)</li>
                  <li>Se não bater → classificado como <strong style={{ color: 'var(--text-dim)' }}>frentista</strong></li>
                  <li>Gerentes cadastrados aqui recebem comissão <strong style={{ color: 'var(--text-dim)' }}>mesmo que não apareçam nas vendas</strong></li>
                </ul>
              </div>

              {importResult && (
                <div className={`alert ${importResult.ok ? 'alert-success' : 'alert-error'}`}>
                  {importResult.msg}
                </div>
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
              <div><div className="card-title">Vendas Importadas</div><div className="card-sub">{vendasTotal} registros</div></div>
              <div className="filters">
                <select value={filterPosto} onChange={e => { setFilterPosto(e.target.value); setPage(1); }} style={{ maxWidth: 180 }}>
                  <option value="">Todos os postos</option>
                  {postos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
                </select>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Posto</th><th>Funcionário</th><th>Tipo</th><th>Produto</th><th className="text-right">Qtde</th><th className="text-right">Vl. Final</th></tr>
                </thead>
                <tbody>
                  {vendas.map((v, i) => (
                    <tr key={i}>
                      <td><span className="badge badge-gray mono">{v.posto_codigo}</span></td>
                      <td style={{ fontSize: 12 }}>{v.funcionario}</td>
                      <td><span className={`badge ${tipoColor(v.tipo_funcionario)}`}>{v.tipo_funcionario}</span></td>
                      <td style={{ fontSize: 12, maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.produto}</td>
                      <td className="text-right mono">{v.quantidade}</td>
                      <td className="text-right mono bold">{fmt(v.valor_final)}</td>
                    </tr>
                  ))}
                  {!vendas.length && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      Nenhuma venda. Importe uma planilha primeiro.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {vendasTotal > 50 && (
              <div className="pagination">
                <div className="pag-info">Mostrando {(page-1)*50+1}–{Math.min(page*50, vendasTotal)} de {vendasTotal}</div>
                <div className="pag-btns">
                  <button className="pag-btn" disabled={page===1} onClick={() => setPage(p => p-1)}>‹</button>
                  <button className="pag-btn" disabled={page*50 >= vendasTotal} onClick={() => setPage(p => p+1)}>›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal meta */}
      {showMetaModal && (
        <Modal title={editMeta ? 'Editar Meta' : 'Definir Meta do Posto'} onClose={() => setShowMetaModal(false)}>
          <div className="modal-body">
            <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12 }}>
              <strong>Meta Frentista/Trocador</strong> = valor que <em>cada colaborador individualmente</em> precisa atingir.<br />
              <strong>Meta do Posto</strong> = base para comissão do gerente (total do posto).
              {diasInfo && <span style={{ color: 'var(--amber)', display: 'block', marginTop: 4 }}>
                ⚡ Pro rata ativo: {diasInfo.corridos}/{diasInfo.total} dias = {(diasInfo.fator*100).toFixed(1)}% da meta.
              </span>}
            </div>
            <div className="form-group">
              <label>Posto</label>
              <select value={metaForm.posto_id} onChange={e => setMetaForm({ ...metaForm, posto_id: e.target.value })} disabled={!!editMeta}>
                <option value="">Selecione…</option>
                {postos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Meta Frentista (R$ / por colaborador)</label>
                <input type="number" min="0" step="0.01" placeholder="0,00"
                  value={metaForm.meta_frentista}
                  onChange={e => setMetaForm({ ...metaForm, meta_frentista: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Meta Trocador (R$ / por colaborador)</label>
                <input type="number" min="0" step="0.01" placeholder="0,00"
                  value={metaForm.meta_trocador}
                  onChange={e => setMetaForm({ ...metaForm, meta_trocador: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>Meta do Posto — base do gerente (R$ total do posto)</label>
              <input type="number" min="0" step="0.01" placeholder="0,00"
                value={metaForm.meta_posto}
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

      {/* Modal funcionário */}
      {showFuncModal && (
        <Modal title={editFunc ? 'Editar Gerente/Trocador' : 'Adicionar Gerente ou Trocador'} onClose={() => setShowFuncModal(false)}>
          <div className="modal-body">
            {funcError && <div className="alert alert-error">{funcError}</div>}
            <div className="alert alert-info" style={{ marginBottom: 14, fontSize: 12 }}>
              O nome deve ser <strong>exatamente igual</strong> ao da coluna B da planilha.<br />
              Ex: <code style={{ fontFamily: 'var(--mono)', background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>000006 - CARLOS ROBERTO ALVES</code>
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
              <input placeholder="Ex: 000006 - CARLOS ROBERTO ALVES"
                value={funcForm.nome}
                onChange={e => setFuncForm({ ...funcForm, nome: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Tipo</label>
              <select value={funcForm.tipo} onChange={e => setFuncForm({ ...funcForm, tipo: e.target.value })}>
                <option value="gerente">Gerente</option>
                <option value="trocador">Trocador de Óleo</option>
              </select>
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
    </>
  );
}
