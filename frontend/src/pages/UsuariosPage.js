import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../contexts/AuthContext';
import { Modal, ConfirmModal, Spinner } from '../components/ui';

const roleLabel = { admin: 'Administrador', viewer: 'Visualizador' };
const roleColor = { admin: 'badge-red', viewer: 'badge-gray' };

export default function UsuariosPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', name: '', role: 'viewer', ativo: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = () => { setLoading(true); axios.get(`${API}/auth/users`).then(r => setUsers(r.data)).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditUser(null); setForm({ username: '', password: '', name: '', role: 'viewer', ativo: true }); setError(''); setShowModal(true); };
  const openEdit = u => { setEditUser(u); setForm({ username: u.username, password: '', name: u.name, role: u.role, ativo: u.ativo }); setError(''); setShowModal(true); };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (editUser) await axios.put(`${API}/auth/users/${editUser.id}`, payload);
      else {
        if (!payload.password) { setError('Senha obrigatória para novo usuário'); setSaving(false); return; }
        await axios.post(`${API}/auth/users`, payload);
      }
      setShowModal(false); load();
    } catch (e) { setError(e.response?.data?.error || 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  const doDelete = async () => {
    await axios.delete(`${API}/auth/users/${confirmDelete.id}`);
    setConfirmDelete(null); load();
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Usuários do Sistema</div>
          <div className="topbar-sub">{users.length} usuários cadastrados</div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ Novo Usuário</button>
      </div>

      <div className="page">
        <div className="alert alert-info mb-4" style={{ marginBottom: 16 }}>
          <strong>Perfis:</strong> <strong>Administrador</strong> — acesso total, pode editar tudo &nbsp;|&nbsp;
          <strong>Visualizador</strong> — pode ver tudo mas não editar
        </div>

        {loading ? <Spinner /> : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Status</th><th>Criado em</th><th></th></tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td className="muted mono">{u.id}</td>
                      <td style={{ fontWeight: 600 }}>{u.name}</td>
                      <td className="mono">{u.username}</td>
                      <td><span className={`badge ${roleColor[u.role]}`}>{roleLabel[u.role]}</span></td>
                      <td><span className={`badge ${u.ativo ? 'badge-green' : 'badge-gray'}`}>{u.ativo ? 'Ativo' : 'Inativo'}</span></td>
                      <td className="muted mono">{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
                      <td>
                        <div className="flex gap-8">
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>Editar</button>
                          {u.username !== 'admin' && <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(u)}>Remover</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <Modal title={editUser ? 'Editar Usuário' : 'Novo Usuário'} onClose={() => setShowModal(false)}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Nome completo</label>
              <input placeholder="Ex: João Silva" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Usuário (login)</label>
              <input placeholder="Ex: joao.silva" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} disabled={!!editUser} />
            </div>
            <div className="form-group">
              <label>{editUser ? 'Nova senha (em branco = manter)' : 'Senha'}</label>
              <input type="password" placeholder={editUser ? 'Deixe em branco para não alterar' : 'Mínimo 6 caracteres'} value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Perfil</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                  <option value="viewer">Visualizador</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              {editUser && (
                <div className="form-group">
                  <label>Status</label>
                  <select value={form.ativo ? 'true' : 'false'} onChange={e => setForm({ ...form, ativo: e.target.value === 'true' })}>
                    <option value="true">Ativo</option>
                    <option value="false">Inativo</option>
                  </select>
                </div>
              )}
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancelar</button>
            <button className="btn btn-primary" disabled={saving || !form.name || !form.username} onClick={save}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmModal title="Remover Usuário"
          message={`Tem certeza que deseja remover "${confirmDelete.name}"? Esta ação não pode ser desfeita.`}
          onConfirm={doDelete} onClose={() => setConfirmDelete(null)} />
      )}
    </>
  );
}
