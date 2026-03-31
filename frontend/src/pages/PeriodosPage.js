import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { Modal, Spinner, Empty } from '../components/ui';

export default function PeriodosPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [periodos, setPeriodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ nome: '', data_inicio: '', data_fim: '', sheets_url: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => { setLoading(true); axios.get(`${API}/periodos`).then(r => setPeriodos(r.data)).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  // Suggest next period dates (26 prev → 25 curr)
  const suggestDates = () => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const ini = new Date(y, m - 1, 26);
    const fim = new Date(y, m, 25);
    const fmt = d => d.toISOString().split('T')[0];
    const nomeMes = fim.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    setForm(f => ({ ...f, data_inicio: fmt(ini), data_fim: fmt(fim), nome: f.nome || `Apuração ${nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)}` }));
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      await axios.post(`${API}/periodos`, form);
      setShowModal(false); setForm({ nome: '', data_inicio: '', data_fim: '', sheets_url: '' }); load();
    } catch (e) { setError(e.response?.data?.error || 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  const statusColor = s => s === 'ativo' ? 'badge-green' : 'badge-gray';

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Períodos de Apuração</div>
          <div className="topbar-sub">Ciclo: dia 26 ao dia 25 do mês seguinte</div>
        </div>
        {user?.role === 'admin' && <button className="btn btn-primary" onClick={() => { setShowModal(true); suggestDates(); }}>+ Novo Período</button>}
      </div>

      <div className="page">
        {loading ? <Spinner /> : !periodos.length ? (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Nenhum período ainda</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>Crie o primeiro período de apuração</div>
            {user?.role === 'admin' && <button className="btn btn-primary" onClick={() => { setShowModal(true); suggestDates(); }}>Criar Primeiro Período</button>}
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Período</th><th>Data Início</th><th>Data Fim</th><th>Planilha</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {periodos.map(p => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/periodos/${p.id}`)}>
                      <td style={{ fontWeight: 600 }}>{p.nome}</td>
                      <td className="mono">{new Date(p.data_inicio).toLocaleDateString('pt-BR')}</td>
                      <td className="mono">{new Date(p.data_fim).toLocaleDateString('pt-BR')}</td>
                      <td>
                        {p.sheets_url
                          ? <span className="badge badge-green">✓ Vinculada</span>
                          : <span className="badge badge-gray">Sem planilha</span>}
                      </td>
                      <td><span className={`badge ${statusColor(p.status)}`}>{p.status === 'ativo' ? 'Ativo' : 'Fechado'}</span></td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/periodos/${p.id}`)}>Abrir →</button>
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
        <Modal title="Novo Período de Apuração" onClose={() => setShowModal(false)}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>Nome do Período</label>
              <input placeholder="Ex: Apuração Março 2026" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Data Início</label>
                <input type="date" value={form.data_inicio} onChange={e => setForm({ ...form, data_inicio: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Data Fim</label>
                <input type="date" value={form.data_fim} onChange={e => setForm({ ...form, data_fim: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>URL da Planilha Google Sheets (opcional)</label>
              <input placeholder="https://docs.google.com/spreadsheets/d/..." value={form.sheets_url} onChange={e => setForm({ ...form, sheets_url: e.target.value })} />
              <div className="form-hint">Cole o link de compartilhamento. A planilha deve estar pública para leitura.</div>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !form.nome || !form.data_inicio || !form.data_fim}>
              {saving ? 'Salvando…' : 'Criar Período'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
