import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { Modal, Spinner } from '../components/ui';

// ── Modal de disparo WhatsApp ─────────────────────────────────────────────────

function WhatsAppModal({ periodo, postos, onClose }) {
  const [selecionados, setSelecionados] = useState(
    postos.filter(p => p.whatsapp_group_id).map(p => p.id)
  );
  const [disparando, setDisparando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [progresso, setProgresso] = useState([]);

  const postosComGrupo    = postos.filter(p => p.whatsapp_group_id);
  const postosSemGrupo    = postos.filter(p => !p.whatsapp_group_id);

  const toggle = (id) => {
    setSelecionados(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    setSelecionados(
      selecionados.length === postosComGrupo.length
        ? []
        : postosComGrupo.map(p => p.id)
    );
  };

  const disparar = async () => {
    if (!selecionados.length) return;
    setDisparando(true);
    setResultado(null);
    setProgresso([`Iniciando disparo para ${selecionados.length} posto(s)…`]);

    try {
      const r = await axios.post(`${API}/whatsapp/disparar/${periodo.id}`, {
        posto_ids: selecionados,
      });
      setResultado(r.data);
      setProgresso(prev => [
        ...prev,
        `✅ ${r.data.enviados} enviado(s)`,
        ...(r.data.erros > 0 ? [`❌ ${r.data.erros} erro(s)`] : []),
      ]);
    } catch (e) {
      const msg = e.response?.data?.error || 'Erro ao disparar relatórios';
      setResultado({ success: false, message: msg, enviados: 0, erros: selecionados.length });
      setProgresso(prev => [...prev, `❌ ${msg}`]);
    } finally {
      setDisparando(false);
    }
  };

  return (
    <Modal title="📱 Disparar Relatório no WhatsApp" onClose={onClose} size={580}>
      <div className="modal-body">
        {/* Período info */}
        <div style={{
          background: 'var(--surface2)', borderRadius: 'var(--radius)',
          padding: '10px 14px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>📅</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{periodo.nome}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {new Date(periodo.data_inicio).toLocaleDateString('pt-BR')} →{' '}
              {new Date(periodo.data_fim).toLocaleDateString('pt-BR')}
              {' · '}
              <span className={`badge ${periodo.status === 'ativo' ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 10 }}>
                {periodo.status === 'ativo' ? 'Aberto' : 'Fechado'}
              </span>
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="alert alert-info" style={{ fontSize: 12, marginBottom: 14 }}>
          Será gerado um PDF de comissões para cada posto selecionado e enviado automaticamente
          ao grupo WhatsApp correspondente via Evolution API.
        </div>

        {/* Lista postos com grupo */}
        {postosComGrupo.length > 0 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>
                Postos com grupo configurado ({postosComGrupo.length})
              </label>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11 }}
                onClick={toggleAll}
              >
                {selecionados.length === postosComGrupo.length ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            </div>

            <div style={{
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              overflow: 'hidden', marginBottom: 12,
            }}>
              {postosComGrupo.map((p, i) => (
                <label
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', cursor: 'pointer',
                    background: selecionados.includes(p.id) ? 'rgba(79,110,247,0.08)' : 'transparent',
                    borderBottom: i < postosComGrupo.length - 1 ? '1px solid var(--border)' : 'none',
                    transition: 'background 0.1s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selecionados.includes(p.id)}
                    onChange={() => toggle(p.id)}
                    style={{ accentColor: 'var(--accent)', width: 15, height: 15, flexShrink: 0 }}
                  />
                  <span className="badge badge-gray mono" style={{ fontSize: 11 }}>{p.codigo}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{p.nome}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                    {p.whatsapp_group_id}
                  </span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <div style={{
            padding: 24, textAlign: 'center', color: 'var(--text-muted)',
            background: 'var(--surface2)', borderRadius: 'var(--radius)', marginBottom: 12,
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhum posto com grupo configurado</div>
            <div style={{ fontSize: 12 }}>
              Cadastre o ID do grupo WhatsApp em cada posto para habilitar o disparo automático.
            </div>
          </div>
        )}

        {/* Postos sem grupo (info) */}
        {postosSemGrupo.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            <strong style={{ color: 'var(--amber)' }}>⚠ Sem grupo configurado:</strong>{' '}
            {postosSemGrupo.map(p => p.codigo).join(', ')} — não serão disparados.
            <span
              style={{ color: 'var(--accent)', cursor: 'pointer', marginLeft: 6 }}
              onClick={() => window.location.href = '/postos'}
            >
              Configurar →
            </span>
          </div>
        )}

        {/* Progresso / resultado */}
        {progresso.length > 0 && (
          <div style={{
            background: 'var(--surface2)', borderRadius: 'var(--radius)',
            padding: '10px 14px', marginBottom: 12, fontFamily: 'var(--mono)', fontSize: 12,
          }}>
            {progresso.map((p, i) => (
              <div key={i} style={{ color: p.startsWith('✅') ? 'var(--green)' : p.startsWith('❌') ? 'var(--red)' : 'var(--text-muted)' }}>
                {p}
              </div>
            ))}
            {disparando && (
              <div style={{ color: 'var(--accent)', marginTop: 4 }}>
                ⟳ Gerando PDFs e enviando…
              </div>
            )}
          </div>
        )}

        {/* Resultado detalhado */}
        {resultado && (
          <div className={`alert ${resultado.success ? 'alert-success' : 'alert-error'}`}>
            <strong>{resultado.message}</strong>
            {resultado.detalhes?.enviados?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11 }}>
                {resultado.detalhes.enviados.map((e, i) => (
                  <div key={i}>✅ {e.posto} — {e.nome}</div>
                ))}
              </div>
            )}
            {resultado.detalhes?.erros?.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11 }}>
                {resultado.detalhes.erros.map((e, i) => (
                  <div key={i} style={{ color: 'var(--red)' }}>❌ {e.posto || e.nome} — {e.erro}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>
          {resultado ? 'Fechar' : 'Cancelar'}
        </button>
        {!resultado && (
          <button
            className="btn btn-primary"
            disabled={disparando || !selecionados.length}
            onClick={disparar}
            style={{ background: '#25d366', gap: 6 }}
          >
            {disparando ? (
              <>⟳ Enviando…</>
            ) : (
              <>📱 Disparar para {selecionados.length} posto(s)</>
            )}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ── Página Principal ──────────────────────────────────────────────────────────

export default function PeriodosPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [periodos, setPeriodos] = useState([]);
  const [postos, setPostos] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ nome: '', data_inicio: '', data_fim: '', sheets_url: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editPeriodo, setEditPeriodo] = useState(null);
  const [editForm, setEditForm] = useState({ nome: '', data_inicio: '', data_fim: '', sheets_url: '', status: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // WhatsApp modal
  const [showWppModal, setShowWppModal] = useState(false);
  const [wppPeriodo, setWppPeriodo] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      axios.get(`${API}/periodos`),
      axios.get(`${API}/postos`),
    ]).then(([r1, r2]) => {
      setPeriodos(r1.data);
      setPostos(r2.data);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

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
      setShowModal(false);
      setForm({ nome: '', data_inicio: '', data_fim: '', sheets_url: '' });
      load();
    } catch (e) { setError(e.response?.data?.error || 'Erro ao salvar'); }
    finally { setSaving(false); }
  };

  const openEdit = (p, e) => {
    e.stopPropagation();
    setEditPeriodo(p);
    setEditForm({
      nome: p.nome,
      data_inicio: p.data_inicio?.split('T')[0] || '',
      data_fim: p.data_fim?.split('T')[0] || '',
      sheets_url: p.sheets_url || '',
      status: p.status,
    });
    setEditError('');
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    setSavingEdit(true); setEditError('');
    try {
      await axios.put(`${API}/periodos/${editPeriodo.id}`, editForm);
      setShowEditModal(false);
      load();
    } catch (e) { setEditError(e.response?.data?.error || 'Erro ao salvar'); }
    finally { setSavingEdit(false); }
  };

  const openWpp = (p, e) => {
    e.stopPropagation();
    setWppPeriodo(p);
    setShowWppModal(true);
  };

  const statusColor = s => s === 'ativo' ? 'badge-green' : 'badge-gray';
  const postosAtivos = postos.filter(p => p.ativo);
  const postosComGrupo = postosAtivos.filter(p => p.whatsapp_group_id);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Períodos de Apuração</div>
          <div className="topbar-sub">Ciclo: dia 26 ao dia 25 do mês seguinte</div>
        </div>
        {user?.role === 'admin' && (
          <button className="btn btn-primary" onClick={() => { setShowModal(true); suggestDates(); }}>
            + Novo Período
          </button>
        )}
      </div>

      <div className="page">
        {loading ? <Spinner /> : !periodos.length ? (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Nenhum período ainda</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>Crie o primeiro período de apuração</div>
            {user?.role === 'admin' && (
              <button className="btn btn-primary" onClick={() => { setShowModal(true); suggestDates(); }}>
                Criar Primeiro Período
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Banner WhatsApp — só admin */}
            {user?.role === 'admin' && postosComGrupo.length === 0 && (
              <div className="alert alert-info" style={{ marginBottom: 16, fontSize: 12 }}>
                📱 Configure o <strong>ID do grupo WhatsApp</strong> nos postos para habilitar o disparo automático de relatórios.
                <span style={{ color: 'var(--accent)', cursor: 'pointer', marginLeft: 6 }} onClick={() => navigate('/postos')}>
                  Ir para Postos →
                </span>
              </div>
            )}

            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th>Data Início</th>
                      <th>Data Fim</th>
                      <th>Planilha</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
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
                        <td>
                          <span className={`badge ${statusColor(p.status)}`}>
                            {p.status === 'ativo' ? 'Aberto' : 'Fechado'}
                          </span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div className="flex gap-8">
                            <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/periodos/${p.id}`)}>
                              Abrir →
                            </button>
                            {user?.role === 'admin' && (
                              <>
                                <button className="btn btn-ghost btn-sm" onClick={e => openEdit(p, e)}>
                                  ✏ Editar
                                </button>
                                <button
                                  className="btn btn-sm"
                                  style={{
                                    background: postosComGrupo.length > 0 ? '#25d366' : 'var(--surface2)',
                                    color: postosComGrupo.length > 0 ? '#fff' : 'var(--text-muted)',
                                    border: postosComGrupo.length > 0 ? 'none' : '1px solid var(--border)',
                                    fontSize: 12, gap: 4,
                                  }}
                                  onClick={e => openWpp(p, e)}
                                  title={postosComGrupo.length === 0
                                    ? 'Configure grupos WhatsApp nos postos primeiro'
                                    : `Disparar relatório para ${postosComGrupo.length} posto(s)`}
                                >
                                  📱 WhatsApp
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal criar */}
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

      {/* Modal editar */}
      {showEditModal && editPeriodo && (
        <Modal title={`Editar — ${editPeriodo.nome}`} onClose={() => setShowEditModal(false)}>
          <div className="modal-body">
            {editError && <div className="alert alert-error">{editError}</div>}
            <div className="form-group">
              <label>Nome do Período</label>
              <input value={editForm.nome} onChange={e => setEditForm({ ...editForm, nome: e.target.value })} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Data Início</label>
                <input type="date" value={editForm.data_inicio} onChange={e => setEditForm({ ...editForm, data_inicio: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Data Fim</label>
                <input type="date" value={editForm.data_fim} onChange={e => setEditForm({ ...editForm, data_fim: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>URL da Planilha Google Sheets</label>
              <input placeholder="https://docs.google.com/spreadsheets/d/..." value={editForm.sheets_url} onChange={e => setEditForm({ ...editForm, sheets_url: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="ativo">Aberto</option>
                <option value="fechado">Fechado</option>
              </select>
              <div className="form-hint">
                {editForm.status === 'ativo'
                  ? '⚡ Período aberto — pro rata ativo, metas calculadas pelo dias corridos.'
                  : '🔒 Período fechado — metas usadas integralmente (100%).'}
              </div>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-ghost" onClick={() => setShowEditModal(false)}>Cancelar</button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit || !editForm.nome || !editForm.data_inicio || !editForm.data_fim}>
              {savingEdit ? 'Salvando…' : 'Salvar Alterações'}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal WhatsApp */}
      {showWppModal && wppPeriodo && (
        <WhatsAppModal
          periodo={wppPeriodo}
          postos={postosAtivos}
          onClose={() => { setShowWppModal(false); setWppPeriodo(null); }}
        />
      )}
    </>
  );
}
