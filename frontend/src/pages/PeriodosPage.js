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

  const postosComGrupo = postos.filter(p => p.whatsapp_group_id);
  const postosSemGrupo = postos.filter(p => !p.whatsapp_group_id);

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

        <div className="alert alert-info" style={{ fontSize: 12, marginBottom: 14 }}>
          Será gerado um PDF de comissões para cada posto selecionado e enviado automaticamente
          ao grupo WhatsApp correspondente via Evolution API.
        </div>

        {postosComGrupo.length > 0 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>
                Postos com grupo configurado ({postosComGrupo.length})
              </label>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={toggleAll}>
                {selecionados.length === postosComGrupo.length ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 12 }}>
              {postosComGrupo.map((p, i) => (
                <label key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', cursor: 'pointer',
                  background: selecionados.includes(p.id) ? 'rgba(79,110,247,0.08)' : 'transparent',
                  borderBottom: i < postosComGrupo.length - 1 ? '1px solid var(--border)' : 'none',
                  transition: 'background 0.1s',
                }}>
                  <input type="checkbox" checked={selecionados.includes(p.id)} onChange={() => toggle(p.id)}
                    style={{ accentColor: 'var(--accent)', width: 15, height: 15, flexShrink: 0 }} />
                  <span className="badge badge-gray mono" style={{ fontSize: 11 }}>{p.codigo}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{p.nome}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{p.whatsapp_group_id}</span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--surface2)', borderRadius: 'var(--radius)', marginBottom: 12 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhum posto com grupo configurado</div>
            <div style={{ fontSize: 12 }}>Cadastre o ID do grupo WhatsApp em cada posto para habilitar o disparo automático.</div>
          </div>
        )}

        {postosSemGrupo.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            <strong style={{ color: 'var(--amber)' }}>⚠ Sem grupo configurado:</strong>{' '}
            {postosSemGrupo.map(p => p.codigo).join(', ')} — não serão disparados.
            <span style={{ color: 'var(--accent)', cursor: 'pointer', marginLeft: 6 }} onClick={() => window.location.href = '/postos'}>
              Configurar →
            </span>
          </div>
        )}

        {progresso.length > 0 && (
          <div style={{ background: 'var(--surface2)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 12, fontFamily: 'var(--mono)', fontSize: 12 }}>
            {progresso.map((p, i) => (
              <div key={i} style={{ color: p.startsWith('✅') ? 'var(--green)' : p.startsWith('❌') ? 'var(--red)' : 'var(--text-muted)' }}>{p}</div>
            ))}
            {disparando && <div style={{ color: 'var(--accent)', marginTop: 4 }}>⟳ Gerando PDFs e enviando…</div>}
          </div>
        )}

        {resultado && (
          <div className={`alert ${resultado.success ? 'alert-success' : 'alert-error'}`}>
            <strong>{resultado.message}</strong>
            {resultado.detalhes?.enviados?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11 }}>
                {resultado.detalhes.enviados.map((e, i) => <div key={i}>✅ {e.posto} — {e.nome}</div>)}
              </div>
            )}
            {resultado.detalhes?.erros?.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11 }}>
                {resultado.detalhes.erros.map((e, i) => <div key={i} style={{ color: 'var(--red)' }}>❌ {e.posto || e.nome} — {e.erro}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>{resultado ? 'Fechar' : 'Cancelar'}</button>
        {!resultado && (
          <button className="btn btn-primary" disabled={disparando || !selecionados.length} onClick={disparar}
            style={{ background: '#25d366', gap: 6 }}>
            {disparando ? <>⟳ Enviando…</> : <>📱 Disparar para {selecionados.length} posto(s)</>}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ── Modal Criar Período — 2 steps ─────────────────────────────────────────────

function CriarPeriodoModal({ periodos, onClose, onCreated }) {
  // Step 1: dados do período
  const [form, setForm]     = useState({ nome: '', data_inicio: '', data_fim: '', sheets_url: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Step 2: replicação
  const [step, setStep]             = useState(1); // 1 = dados, 2 = replicar
  const [periodoCriado, setPeriodoCriado] = useState(null);
  const [origemId, setOrigemId]     = useState('');
  const [replicando, setReplicando] = useState(false);
  const [replicResult, setReplicResult] = useState(null);
  const [replicError, setReplicError]   = useState('');

  // Períodos disponíveis para replicar (todos exceto o recém-criado)
  const periodosDisponiveis = periodos.filter(p =>
    periodoCriado ? String(p.id) !== String(periodoCriado.id) : true
  );

  const suggestDates = () => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const ini = new Date(y, m - 1, 26);
    const fim = new Date(y, m, 25);
    const fmt = d => d.toISOString().split('T')[0];
    const nomeMes = fim.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    setForm(f => ({
      ...f,
      data_inicio: fmt(ini),
      data_fim: fmt(fim),
      nome: f.nome || `Apuração ${nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)}`,
    }));
  };

  // Sugere datas ao abrir
  useEffect(() => { suggestDates(); }, []); // eslint-disable-line

  const criarPeriodo = async () => {
    setSaving(true); setError('');
    try {
      const { data } = await axios.post(`${API}/periodos`, form);
      setPeriodoCriado(data);
      // Pré-seleciona o período mais recente como origem (1º da lista)
      if (periodosDisponiveis.length > 0) setOrigemId(String(periodosDisponiveis[0].id));
      setStep(2);
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao criar período');
    } finally {
      setSaving(false);
    }
  };

  const replicar = async () => {
    if (!origemId) return;
    setReplicando(true); setReplicError('');
    try {
      const { data } = await axios.post(`${API}/periodos/${periodoCriado.id}/replicar`, {
        origem_id: parseInt(origemId),
      });
      setReplicResult(data);
    } catch (e) {
      setReplicError(e.response?.data?.error || 'Erro ao replicar');
    } finally {
      setReplicando(false);
    }
  };

  const concluir = () => {
    onCreated();
    onClose();
  };

  const pularReplicar = () => {
    onCreated();
    onClose();
  };

  // ── Step 1: Dados do período ────────────────────────────────────────────────
  if (step === 1) {
    return (
      <Modal title="Novo Período de Apuração" onClose={onClose}>
        <div className="modal-body">
          {/* Indicador de steps */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: 'var(--accent)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}>1</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Dados do Período</div>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: 'var(--border)', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}>2</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Replicar Configurações</div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label>Nome do Período</label>
            <input placeholder="Ex: Apuração Março 2026" value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Data Início</label>
              <input type="date" value={form.data_inicio}
                onChange={e => setForm({ ...form, data_inicio: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Data Fim</label>
              <input type="date" value={form.data_fim}
                onChange={e => setForm({ ...form, data_fim: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label>URL da Planilha Google Sheets <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(opcional)</span></label>
            <input placeholder="https://docs.google.com/spreadsheets/d/..." value={form.sheets_url}
              onChange={e => setForm({ ...form, sheets_url: e.target.value })} />
            <div className="form-hint">Cole o link de compartilhamento. A planilha deve estar pública para leitura.</div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary"
            onClick={criarPeriodo}
            disabled={saving || !form.nome || !form.data_inicio || !form.data_fim}>
            {saving ? 'Criando…' : 'Criar e Continuar →'}
          </button>
        </div>
      </Modal>
    );
  }

  // ── Step 2: Replicar configurações ─────────────────────────────────────────
  const origemSel = periodos.find(p => String(p.id) === origemId);

  return (
    <Modal title="Replicar Configurações" onClose={concluir} size={560}>
      <div className="modal-body">
        {/* Indicador de steps */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: 'var(--green)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>✓</div>
          <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>Período criado</div>
          <div style={{ flex: 1, height: 1, background: 'var(--accent)' }} />
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: 'var(--accent)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>2</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Replicar Configurações</div>
        </div>

        {/* Período criado */}
        <div style={{
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: 'var(--radius)',
          padding: '10px 14px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>✅</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>{periodoCriado?.nome}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {new Date(periodoCriado?.data_inicio).toLocaleDateString('pt-BR')} →{' '}
              {new Date(periodoCriado?.data_fim).toLocaleDateString('pt-BR')}
            </div>
          </div>
        </div>

        {/* Resultado de replicação já feita */}
        {replicResult ? (
          <div style={{
            background: 'rgba(79,110,247,0.08)',
            border: '1px solid rgba(79,110,247,0.2)',
            borderRadius: 'var(--radius)',
            padding: '16px 18px',
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)', marginBottom: 12 }}>
              ✓ Replicação concluída com sucesso
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { icon: '🎯', label: 'Metas replicadas', val: replicResult.metas.replicadas, color: 'var(--accent)' },
                { icon: '👥', label: 'Funcionários copiados', val: replicResult.funcionarios.replicados, color: 'var(--green)' },
                { icon: '⏭', label: 'Já existiam', val: replicResult.funcionarios.ignorados, color: 'var(--text-muted)' },
                { icon: '📋', label: 'Origem', val: replicResult.origem.nome, color: 'var(--text-dim)', small: true },
              ].map(item => (
                <div key={item.label} style={{
                  background: 'var(--surface2)', borderRadius: 6,
                  padding: '10px 12px',
                }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</div>
                  <div style={{ fontSize: item.small ? 11 : 20, fontWeight: 700, color: item.color }}>
                    {item.val}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              💡 As metas e equipe foram copiadas. Você ainda pode editar dentro do período.
            </div>
          </div>
        ) : (
          <>
            {/* Explicação do que será replicado */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 10 }}>
                O que será copiado do período selecionado:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { icon: '🎯', text: 'Metas de frentistas, trocadores e posto (por posto)' },
                  { icon: '👔', text: 'Gerentes cadastrados no período' },
                  { icon: '🔧', text: 'Trocadores de óleo cadastrados no período' },
                ].map(item => (
                  <div key={item.text} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    background: 'var(--surface2)',
                    borderRadius: 6, fontSize: 12, color: 'var(--text-dim)',
                  }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
                    {item.text}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                ⚠ Vendas e desqualificações <strong>não</strong> são copiadas.
              </div>
            </div>

            {/* Seleção do período origem */}
            {periodosDisponiveis.length === 0 ? (
              <div style={{
                padding: 20, textAlign: 'center', background: 'var(--surface2)',
                borderRadius: 'var(--radius)', color: 'var(--text-muted)', fontSize: 13,
              }}>
                Nenhum período anterior disponível para replicar.
              </div>
            ) : (
              <>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label>Copiar configurações de:</label>
                  <select value={origemId} onChange={e => setOrigemId(e.target.value)}>
                    <option value="">Selecione o período de origem…</option>
                    {periodosDisponiveis.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.nome} — {new Date(p.data_inicio).toLocaleDateString('pt-BR')} → {new Date(p.data_fim).toLocaleDateString('pt-BR')}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Preview do período selecionado */}
                {origemSel && (
                  <div style={{
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: '10px 14px',
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 4,
                  }}>
                    <span style={{ fontSize: 16 }}>📅</span>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>{origemSel.nome}</div>
                      <div>
                        {new Date(origemSel.data_inicio).toLocaleDateString('pt-BR')} →{' '}
                        {new Date(origemSel.data_fim).toLocaleDateString('pt-BR')}
                        {' · '}
                        <span className={`badge ${origemSel.status === 'ativo' ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 10 }}>
                          {origemSel.status === 'ativo' ? 'Aberto' : 'Fechado'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {replicError && (
              <div className="alert alert-error" style={{ marginTop: 8 }}>{replicError}</div>
            )}
          </>
        )}
      </div>

      <div className="modal-foot">
        {replicResult ? (
          <button className="btn btn-primary" onClick={concluir}>
            Concluir →
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={pularReplicar}>
              Pular, criar sem replicar
            </button>
            {periodosDisponiveis.length > 0 && (
              <button
                className="btn btn-primary"
                onClick={replicar}
                disabled={replicando || !origemId}
                style={{ gap: 6 }}
              >
                {replicando ? '⟳ Replicando…' : '📋 Replicar Configurações'}
              </button>
            )}
          </>
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
  const [postos, setPostos]     = useState([]);
  const [loading, setLoading]   = useState(true);

  // Modal criar (novo — 2 steps)
  const [showModal, setShowModal] = useState(false);

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editPeriodo, setEditPeriodo]     = useState(null);
  const [editForm, setEditForm]           = useState({ nome: '', data_inicio: '', data_fim: '', sheets_url: '', status: '' });
  const [savingEdit, setSavingEdit]       = useState(false);
  const [editError, setEditError]         = useState('');

  // WhatsApp modal
  const [showWppModal, setShowWppModal] = useState(false);
  const [wppPeriodo, setWppPeriodo]     = useState(null);

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
  const postosAtivos   = postos.filter(p => p.ativo);
  const postosComGrupo = postosAtivos.filter(p => p.whatsapp_group_id);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Períodos de Apuração</div>
          <div className="topbar-sub">Ciclo: dia 26 ao dia 25 do mês seguinte</div>
        </div>
        {user?.role === 'admin' && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
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
              <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                Criar Primeiro Período
              </button>
            )}
          </div>
        ) : (
          <>
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

      {/* Modal criar — 2 steps */}
      {showModal && (
        <CriarPeriodoModal
          periodos={periodos}
          onClose={() => setShowModal(false)}
          onCreated={load}
        />
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
              <input placeholder="https://docs.google.com/spreadsheets/d/..." value={editForm.sheets_url}
                onChange={e => setEditForm({ ...editForm, sheets_url: e.target.value })} />
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
            <button className="btn btn-primary" onClick={saveEdit}
              disabled={savingEdit || !editForm.nome || !editForm.data_inicio || !editForm.data_fim}>
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
