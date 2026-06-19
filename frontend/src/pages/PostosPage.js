import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { Modal, ConfirmModal, Spinner } from '../components/ui';

export default function PostosPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [postos, setPostos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editPosto, setEditPosto] = useState(null);
  const [form, setForm] = useState({ codigo: '', nome: '', whatsapp_group_id: '', chave_empresa: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => {
    setLoading(true);
    axios.get(`${API}/postos`).then(r => setPostos(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditPosto(null);
    setForm({ codigo: '', nome: '', whatsapp_group_id: '', chave_empresa: '' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (p) => {
    setEditPosto(p);
    setForm({ codigo: p.codigo, nome: p.nome, whatsapp_group_id: p.whatsapp_group_id || '', chave_empresa: p.chave_empresa || '' });
    setError('');
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = {
        nome: form.nome,
        whatsapp_group_id: form.whatsapp_group_id.trim() || null,
        chave_empresa: form.chave_empresa.trim() || null,
      };
      if (editPosto) {
        await axios.put(`${API}/postos/${editPosto.id}`, payload);
      } else {
        await axios.post(`${API}/postos`, { ...payload, codigo: form.codigo });
      }
      setShowModal(false);
      load();
    } catch (e) { setError(e.response?.data?.error || 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  const toggleAtivo = async (p) => {
    await axios.put(`${API}/postos/${p.id}`, {
      ativo: !p.ativo,
      whatsapp_group_id: p.whatsapp_group_id || null,
    });
    load();
  };

  const doDelete = async () => {
    try {
      await axios.delete(`${API}/postos/${confirmDelete.id}`);
      setConfirmDelete(null);
      load();
    } catch (e) {
      alert(e.response?.data?.error || 'Erro ao excluir');
    }
  };

  const isAdmin = user?.role === 'admin';

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Postos</div>
          <div className="topbar-sub">Cadastro de empresas / postos de combustível</div>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={openCreate}>+ Novo Posto</button>}
      </div>

      <div className="page">
        {loading ? <Spinner /> : (
          <div className="card">
            {!postos.length ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🏪</div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Nenhum posto cadastrado</div>
                {isAdmin && <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={openCreate}>Cadastrar Posto</button>}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Nome</th>
                      <th>Chave Empresa</th>
                      <th>Produtos Esp.</th>
                      <th>WhatsApp</th>
                      <th>Status</th>
                      {isAdmin && <th>Ações</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {postos.map(p => (
                      <tr key={p.id}>
                        <td>
                          <span className="badge badge-blue mono" style={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/postos/${p.id}`)}>
                            {p.codigo}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{p.nome}</td>
                        <td>
                          {p.chave_empresa
                            ? <span className="badge badge-blue mono">{p.chave_empresa}</span>
                            : <span className="badge badge-gray">—</span>}
                        </td>
                        <td>
                          <span className="muted" style={{ fontSize: 12, cursor: 'pointer', color: 'var(--accent)' }}
                            onClick={() => navigate(`/postos/${p.id}`)}>
                            ver produtos →
                          </span>
                        </td>
                        <td>
                          {p.whatsapp_group_id ? (
                            <span className="badge badge-green" title={p.whatsapp_group_id}>
                              ✓ Configurado
                            </span>
                          ) : (
                            <span className="badge badge-gray">Não configurado</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${p.ativo ? 'badge-green' : 'badge-gray'}`}>
                            {p.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        {isAdmin && (
                          <td>
                            <div className="flex gap-8">
                              <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>Editar</button>
                              <button className="btn btn-ghost btn-sm" onClick={() => toggleAtivo(p)}>
                                {p.ativo ? 'Desativar' : 'Ativar'}
                              </button>
                              <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(p)}>Excluir</button>
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
      </div>

      {showModal && (
        <Modal title={editPosto ? 'Editar Posto' : 'Novo Posto'} onClose={() => setShowModal(false)}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-row">
              <div className="form-group">
                <label>Código</label>
                <input
                  placeholder="Ex: P1, P21…"
                  value={form.codigo}
                  onChange={e => setForm({ ...form, codigo: e.target.value })}
                  disabled={!!editPosto}
                />
                <div className="form-hint">Código único (maiúsculo automaticamente)</div>
              </div>
              <div className="form-group">
                <label>Nome / Razão Social</label>
                <input
                  placeholder="Ex: Auto Posto Central Ltda"
                  value={form.nome}
                  onChange={e => setForm({ ...form, nome: e.target.value })}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Chave Empresa (CSV)</label>
              <input
                placeholder="Ex: 001, EMP-001, código do sistema…"
                value={form.chave_empresa}
                onChange={e => setForm({ ...form, chave_empresa: e.target.value })}
              />
              <div className="form-hint">
                Identificador que aparece na <strong>coluna B</strong> do CSV exportado pelo sistema.
                Usado para vincular as linhas do CSV a este posto na importação.
              </div>
            </div>

            <div className="form-group">
              <label>
                <span style={{ marginRight: 6 }}>📱</span>
                ID do Grupo WhatsApp
              </label>
              <input
                placeholder="Ex: 120363XXXXXXXXXX-group"
                value={form.whatsapp_group_id}
                onChange={e => setForm({ ...form, whatsapp_group_id: e.target.value })}
              />
              <div className="form-hint">
                ID do grupo WhatsApp. Deixe em branco para não enviar relatório para este posto.
              </div>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={saving || !form.codigo || !form.nome} onClick={save}>
              {saving ? 'Salvando…' : editPosto ? 'Salvar Alterações' : 'Criar Posto'}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Excluir Posto"
          message={`Tem certeza que deseja excluir o posto "${confirmDelete.nome}" (${confirmDelete.codigo})? Esta ação removerá todos os dados vinculados.`}
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}
