import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { API } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { Modal, ConfirmModal, Spinner } from '../components/ui';
import { fmt } from '../utils/fmt';

export default function PostoDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [posto, setPosto] = useState(null);
  const [produtos, setProdutos] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showProdModal, setShowProdModal] = useState(false);
  const [prodForm, setProdForm] = useState({ nome_produto: '', comissao_frentista: '', comissao_trocador: '', comissao_gerente: '' });
  const [editProd, setEditProd] = useState(null);
  const [savingProd, setSavingProd] = useState(false);
  const [deleteProd, setDeleteProd] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      axios.get(`${API}/postos/${id}`),
      axios.get(`${API}/postos/${id}/produtos-especiais`),
    ]).then(([r1, r2]) => { setPosto(r1.data); setProdutos(r2.data); })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const saveProd = async () => {
    setSavingProd(true); setError('');
    try {
      if (editProd) {
        await axios.put(`${API}/postos/${id}/produtos-especiais/${editProd.id}`, prodForm);
      } else {
        await axios.post(`${API}/postos/${id}/produtos-especiais`, prodForm);
      }
      setShowProdModal(false);
      setProdForm({ nome_produto: '', comissao_frentista: '', comissao_trocador: '', comissao_gerente: '' });
      setEditProd(null);
      load();
    } catch (e) { setError(e.response?.data?.error || 'Erro ao salvar'); }
    finally { setSavingProd(false); }
  };

  const doDeleteProd = async () => {
    await axios.delete(`${API}/postos/${id}/produtos-especiais/${deleteProd.id}`);
    setDeleteProd(null); load();
  };

  const isAdmin = user?.role === 'admin';

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
            onClick={() => navigate('/postos')}>← Postos</div>
          <div className="topbar-title">{posto?.nome}</div>
          <div className="topbar-sub">
            <span className="badge badge-blue mono">{posto?.codigo}</span>
            {' · '}
            <span className={`badge ${posto?.ativo ? 'badge-green' : 'badge-gray'}`}>
              {posto?.ativo ? 'Ativo' : 'Inativo'}
            </span>
          </div>
        </div>
      </div>

      <div className="page">
        <div className="alert alert-info mb-4" style={{ marginBottom: 16 }}>
          💡 Os gerentes e trocadores são cadastrados dentro de cada <strong>Período de Apuração</strong>, pois podem mudar a cada ciclo.
          <span style={{ marginLeft: 8, color: 'var(--accent)', cursor: 'pointer' }}
            onClick={() => navigate('/periodos')}>Ir para Períodos →</span>
        </div>

        {/* Produtos Especiais */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Produtos com Comissão Especial</div>
              <div className="card-sub">
                Produtos que pagam valor fixo por unidade — além da comissão normal por faixa de meta
              </div>
            </div>
            {isAdmin && (
              <button className="btn btn-primary btn-sm" onClick={() => {
                setShowProdModal(true);
                setEditProd(null);
                setProdForm({ nome_produto: '', comissao_frentista: '', comissao_trocador: '', comissao_gerente: '' });
                setError('');
              }}>
                + Adicionar Produto
              </button>
            )}
          </div>

          {!produtos.length ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Nenhum produto especial cadastrado para este posto.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produto (nome exato da planilha)</th>
                    <th className="text-right">Com. Frentista</th>
                    <th className="text-right">Com. Trocador</th>
                    <th className="text-right">Com. Gerente</th>
                    <th>Status</th>
                    {isAdmin && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {produtos.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontSize: 12, maxWidth: 340, wordBreak: 'break-word' }}>{p.nome_produto}</td>
                      <td className="text-right mono" style={{ color: 'var(--green)' }}>
                        {fmt(p.comissao_frentista)}<span style={{ fontSize: 10, color: 'var(--text-muted)' }}>/un</span>
                      </td>
                      <td className="text-right mono" style={{ color: 'var(--amber)' }}>
                        {fmt(p.comissao_trocador)}<span style={{ fontSize: 10, color: 'var(--text-muted)' }}>/un</span>
                      </td>
                      <td className="text-right mono" style={{ color: 'var(--accent)' }}>
                        {fmt(p.comissao_gerente)}<span style={{ fontSize: 10, color: 'var(--text-muted)' }}>/un</span>
                      </td>
                      <td><span className={`badge ${p.ativo ? 'badge-green' : 'badge-gray'}`}>{p.ativo ? 'Ativo' : 'Inativo'}</span></td>
                      {isAdmin && (
                        <td>
                          <div className="flex gap-8">
                            <button className="btn btn-ghost btn-sm" onClick={() => {
                              setEditProd(p);
                              setProdForm({
                                nome_produto: p.nome_produto,
                                comissao_frentista: p.comissao_frentista,
                                comissao_trocador: p.comissao_trocador,
                                comissao_gerente: p.comissao_gerente,
                              });
                              setShowProdModal(true);
                              setError('');
                            }}>Editar</button>
                            <button className="btn btn-danger btn-sm" onClick={() => setDeleteProd(p)}>Remover</button>
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
      </div>

      {showProdModal && (
        <Modal title={editProd ? 'Editar Produto Especial' : 'Novo Produto Especial'} onClose={() => setShowProdModal(false)}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Nome do Produto</label>
              <input
                placeholder="Ex: ADITIVO RADIADOR ROSA AUTOSHINE 1 LT"
                value={prodForm.nome_produto}
                onChange={e => setProdForm({ ...prodForm, nome_produto: e.target.value })}
              />
              <div className="form-hint">Nome exato como aparece na coluna C da planilha</div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Comissão Frentista (R$/un)</label>
                <input type="number" min="0" step="0.01" placeholder="0,00"
                  value={prodForm.comissao_frentista}
                  onChange={e => setProdForm({ ...prodForm, comissao_frentista: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Comissão Trocador (R$/un)</label>
                <input type="number" min="0" step="0.01" placeholder="0,00"
                  value={prodForm.comissao_trocador}
                  onChange={e => setProdForm({ ...prodForm, comissao_trocador: e.target.value })} />
              </div>
            </div>
            <div className="form-group" style={{ maxWidth: '50%' }}>
              <label>Comissão Gerente (R$/un)</label>
              <input type="number" min="0" step="0.01" placeholder="0,00"
                value={prodForm.comissao_gerente}
                onChange={e => setProdForm({ ...prodForm, comissao_gerente: e.target.value })} />
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => setShowProdModal(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={savingProd || !prodForm.nome_produto} onClick={saveProd}>
              {savingProd ? 'Salvando…' : 'Salvar Produto'}
            </button>
          </div>
        </Modal>
      )}

      {deleteProd && (
        <ConfirmModal
          title="Remover Produto Especial"
          message={`Remover "${deleteProd.nome_produto}" dos produtos especiais?`}
          onConfirm={doDeleteProd}
          onClose={() => setDeleteProd(null)}
        />
      )}
    </>
  );
}
