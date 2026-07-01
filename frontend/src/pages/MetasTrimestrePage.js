import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API } from '../contexts/AuthContext';
import { Spinner } from '../components/ui';
import { fmt } from '../utils/fmt';

export default function MetasTrimestrePage() {
  const [periodos, setPeriodos]         = useState([]);
  const [fonteIds, setFonteIds]         = useState([]);
  const [destinoId, setDestinoId]       = useState('');
  const [percentual, setPercentual]     = useState(5);
  const [preview, setPreview]           = useState(null);
  const [loadingPreview, setLoadingPrev] = useState(false);
  const [applying, setApplying]         = useState(false);
  const [result, setResult]             = useState(null);
  const [erroPreview, setErroPreview]   = useState('');

  useEffect(() => {
    axios.get(`${API}/periodos`).then(r => {
      setPeriodos(r.data);
      // Seleciona automaticamente os 3 últimos como fonte
      if (r.data.length >= 3) {
        setFonteIds(r.data.slice(0, 3).map(p => p.id));
      }
    });
  }, []);

  const toggleFonte = (id) => {
    setFonteIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
    setPreview(null);
    setResult(null);
  };

  const calcPreview = useCallback(async () => {
    if (!fonteIds.length) return;
    setLoadingPrev(true); setErroPreview(''); setPreview(null); setResult(null);
    try {
      const r = await axios.get(`${API}/metas-trimestre/preview`, {
        params: { periodo_ids: fonteIds.join(','), percentual },
      });
      setPreview(r.data);
    } catch (e) {
      setErroPreview(e.response?.data?.error || 'Erro ao calcular preview');
    } finally { setLoadingPrev(false); }
  }, [fonteIds, percentual]);

  const aplicar = async (notificar) => {
    if (!destinoId) { alert('Selecione o período de destino'); return; }
    if (!fonteIds.length) { alert('Selecione ao menos 1 período de referência'); return; }
    if (!preview?.resultado?.length) { alert('Calcule o preview primeiro'); return; }
    setApplying(true); setResult(null);
    try {
      const r = await axios.post(`${API}/metas-trimestre/aplicar`, {
        periodo_ids: fonteIds,
        periodo_destino_id: Number(destinoId),
        percentual,
        notificar_whatsapp: notificar,
      });
      setResult({ ok: true, data: r.data });
    } catch (e) {
      setResult({ ok: false, msg: e.response?.data?.error || 'Erro ao aplicar metas' });
    } finally { setApplying(false); }
  };

  const nomePeriodo = (id) => periodos.find(p => p.id === id)?.nome || `#${id}`;
  const periodosDestino = periodos.filter(p => !fonteIds.includes(p.id));

  return (
    <>
      <div className="topbar no-print">
        <div>
          <div className="topbar-title">Metas Trimestrais</div>
          <div className="topbar-sub">Calcule novas metas baseadas na média histórica + ajuste percentual</div>
        </div>
      </div>

      <div className="page">
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>

          {/* ── Painel esquerdo: configuração ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Períodos de referência */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">1. Períodos de Referência</div>
              </div>
              <div style={{ padding: '12px 16px 16px' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                  Selecione os períodos para calcular a média (recomendado: últimos 3)
                </div>
                {periodos.length === 0 && <Spinner />}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {periodos.map(p => (
                    <label key={p.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      padding: '6px 10px', borderRadius: 8,
                      background: fonteIds.includes(p.id) ? 'var(--accent-soft)' : 'var(--surface2)',
                      border: `1px solid ${fonteIds.includes(p.id) ? 'var(--accent)' : 'var(--border)'}`,
                      fontSize: 13,
                    }}>
                      <input
                        type="checkbox"
                        checked={fonteIds.includes(p.id)}
                        onChange={() => toggleFonte(p.id)}
                      />
                      <span style={{ flex: 1 }}>{p.nome}</span>
                      <span className={`badge ${p.status === 'ativo' ? 'badge-green' : 'badge-gray'}`}
                        style={{ fontSize: 10 }}>{p.status}</span>
                    </label>
                  ))}
                </div>
                {fonteIds.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>
                    {fonteIds.length} período(s) selecionado(s)
                  </div>
                )}
              </div>
            </div>

            {/* Ajuste percentual */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">2. Ajuste Percentual</div>
              </div>
              <div style={{ padding: '12px 16px 16px' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Percentual adicionado sobre a média dos períodos selecionados
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="number"
                    className="input"
                    min={0} max={100} step={0.5}
                    value={percentual}
                    onChange={e => { setPercentual(parseFloat(e.target.value) || 0); setPreview(null); }}
                    style={{ width: 90 }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>%</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>sobre a média</span>
                </div>
              </div>
            </div>

            {/* Calcular preview */}
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={!fonteIds.length || loadingPreview}
              onClick={calcPreview}
            >
              {loadingPreview ? '⟳ Calculando...' : '📊 Calcular Preview'}
            </button>

            {/* Período destino */}
            {preview && (
              <div className="card">
                <div className="card-header">
                  <div className="card-title">3. Período de Destino</div>
                </div>
                <div style={{ padding: '12px 16px 16px' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Período onde as novas metas serão aplicadas
                  </div>
                  <select
                    className="input"
                    value={destinoId}
                    onChange={e => setDestinoId(e.target.value)}
                  >
                    <option value="">— Selecione o período —</option>
                    {periodos.map(p => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Botões de ação */}
            {preview && destinoId && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={applying}
                  onClick={() => aplicar(false)}
                >
                  {applying ? '⟳ Aplicando...' : '✅ Aplicar Metas'}
                </button>
                <button
                  className="btn"
                  style={{ width: '100%', background: '#25d366', color: '#fff', border: 'none' }}
                  disabled={applying}
                  onClick={() => aplicar(true)}
                >
                  {applying ? '⟳ Aplicando...' : '📱 Aplicar e Notificar WhatsApp'}
                </button>
              </div>
            )}

            {/* Resultado */}
            {result && (
              <div className={`alert ${result.ok ? 'alert-success' : 'alert-error'}`}>
                {result.ok ? result.data.message : result.msg}
                {result.ok && result.data.whatsapp?.length > 0 && (
                  <ul style={{ marginTop: 8, fontSize: 11, paddingLeft: 16 }}>
                    {result.data.whatsapp.map(w => (
                      <li key={w.posto} style={{ color: w.status === 'enviado' ? '#22c55e' : '#ef4444' }}>
                        {w.posto}: {w.status === 'enviado' ? '✓ enviado' : `✗ ${w.erro}`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* ── Painel direito: preview ── */}
          <div>
            {erroPreview && <div className="alert alert-error" style={{ marginBottom: 16 }}>{erroPreview}</div>}

            {!preview && !loadingPreview && (
              <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
                <div style={{ fontWeight: 700 }}>Selecione os períodos de referência e clique em Calcular Preview</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  O sistema calculará a média das metas e aplicará o ajuste percentual configurado.
                </div>
              </div>
            )}

            {loadingPreview && <Spinner />}

            {preview && !loadingPreview && (
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Preview das Novas Metas</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Média de {fonteIds.map(nomePeriodo).join(', ')} + {percentual}%
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Posto</th>
                        <th className="text-right">Méd. Frentistas</th>
                        <th className="text-right" style={{ color: 'var(--accent)' }}>Nova (+{percentual}%)</th>
                        <th className="text-right">Méd. Trocadores</th>
                        <th className="text-right" style={{ color: 'var(--accent)' }}>Nova (+{percentual}%)</th>
                        <th className="text-right">Méd. Posto</th>
                        <th className="text-right" style={{ color: 'var(--accent)' }}>Nova (+{percentual}%)</th>
                        <th style={{ width: 36, textAlign: 'center' }}>WPP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.resultado.map(r => (
                        <tr key={r.posto_id}>
                          <td>
                            <div style={{ fontWeight: 700 }}>{r.codigo}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.posto_nome}</div>
                          </td>
                          <td className="text-right mono" style={{ color: 'var(--text-dim)' }}>{fmt(r.avg_frentista)}</td>
                          <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmt(r.nova_frentista)}</td>
                          <td className="text-right mono" style={{ color: 'var(--text-dim)' }}>{fmt(r.avg_trocador)}</td>
                          <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmt(r.nova_trocador)}</td>
                          <td className="text-right mono" style={{ color: 'var(--text-dim)' }}>{fmt(r.avg_posto)}</td>
                          <td className="text-right mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>{fmt(r.nova_posto)}</td>
                          <td style={{ textAlign: 'center', fontSize: 16 }}>
                            {r.tem_whatsapp ? '✅' : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ fontWeight: 800 }}>TOTAL</td>
                        <td className="text-right mono" style={{ color: 'var(--text-dim)' }}>
                          {fmt(preview.resultado.reduce((s, r) => s + r.avg_frentista, 0))}
                        </td>
                        <td className="text-right mono" style={{ fontWeight: 800 }}>
                          {fmt(preview.resultado.reduce((s, r) => s + r.nova_frentista, 0))}
                        </td>
                        <td className="text-right mono" style={{ color: 'var(--text-dim)' }}>
                          {fmt(preview.resultado.reduce((s, r) => s + r.avg_trocador, 0))}
                        </td>
                        <td className="text-right mono" style={{ fontWeight: 800 }}>
                          {fmt(preview.resultado.reduce((s, r) => s + r.nova_trocador, 0))}
                        </td>
                        <td className="text-right mono" style={{ color: 'var(--text-dim)' }}>
                          {fmt(preview.resultado.reduce((s, r) => s + r.avg_posto, 0))}
                        </td>
                        <td className="text-right mono" style={{ fontWeight: 800 }}>
                          {fmt(preview.resultado.reduce((s, r) => s + r.nova_posto, 0))}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                  {preview.resultado.filter(r => r.tem_whatsapp).length} posto(s) com WhatsApp configurado •{' '}
                  {preview.resultado.length} postos no total
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
