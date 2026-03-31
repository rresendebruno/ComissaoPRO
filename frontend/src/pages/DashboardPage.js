import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { API } from '../contexts/AuthContext';
import { fmt, fmtPct, statusMeta } from '../utils/fmt';
import { Spinner } from '../components/ui';
import { useNavigate } from 'react-router-dom';

export default function DashboardPage() {
  const [periodos, setPeriodos] = useState([]);
  const [periodo, setPeriodo] = useState(null);
  const [comissoes, setComissoes] = useState(null);
  const [metas, setMetas] = useState({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`${API}/periodos`).then(r => {
      setPeriodos(r.data);
      if (r.data.length) setPeriodo(r.data[0]);
      else setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!periodo) return;
    setLoading(true);
    axios.get(`${API}/periodos/${periodo.id}/comissoes`).then(r => {
      setComissoes(r.data.comissoes);
      setMetas(r.data.metas);
    }).finally(() => setLoading(false));
  }, [periodo]);

  const postoIds = comissoes ? Object.keys(comissoes) : [];

  const chartData = postoIds.map(pid => {
    const d = comissoes[pid];
    const meta = d.metaFrentista || 0;
    const totalFrent = d.funcionarios.filter(f => f.tipo === 'frentista').reduce((s, f) => s + f.totalVendas, 0);
    return {
      posto: `P${pid}`,
      realizado: totalFrent,
      meta,
      pct: meta > 0 ? totalFrent / meta : 0,
      totalComissoes: d.totalComissoes
    };
  }).sort((a, b) => a.posto.localeCompare(b.posto));

  const totalRealizado = chartData.reduce((s, d) => s + d.realizado, 0);
  const totalMeta = chartData.reduce((s, d) => s + d.meta, 0);
  const totalComissoes = chartData.reduce((s, d) => s + d.totalComissoes, 0);
  const postosAcima = chartData.filter(d => d.pct >= 1).length;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
        {payload.map(p => <div key={p.name} style={{ color: p.color }}>{p.name}: {fmt(p.value)}</div>)}
      </div>
    );
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Dashboard</div>
          <div className="topbar-sub">Visão geral do período</div>
        </div>
        <div className="flex items-center gap-8">
          <select value={periodo?.id || ''} onChange={e => setPeriodo(periodos.find(p => p.id === parseInt(e.target.value)))}
            style={{ maxWidth: 220 }}>
            {periodos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="page">
        {!periodos.length ? (
          <div className="card" style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Nenhum período cadastrado</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>Crie um período de apuração para começar</div>
            <button className="btn btn-primary" onClick={() => navigate('/periodos')}>Ir para Períodos</button>
          </div>
        ) : loading ? <Spinner /> : (
          <>
            {/* Stats */}
            <div className="stats">
              <div className="stat">
                <div className="stat-label">Total Vendido (Frentistas)</div>
                <div className="stat-value" style={{ color: 'var(--text)' }}>{fmt(totalRealizado)}</div>
                <div className="stat-note">{fmtPct(totalMeta > 0 ? totalRealizado / totalMeta : 0)} da meta</div>
              </div>
              <div className="stat">
                <div className="stat-label">Meta Consolidada</div>
                <div className="stat-value">{fmt(totalMeta)}</div>
                <div className="stat-note">{chartData.length} postos</div>
              </div>
              <div className="stat">
                <div className="stat-label">Total Comissões</div>
                <div className="stat-value" style={{ color: 'var(--green)' }}>{fmt(totalComissoes)}</div>
                <div className="stat-note">frentistas + trocadores + gerentes</div>
              </div>
              <div className="stat">
                <div className="stat-label">Postos na Meta</div>
                <div className="stat-value" style={{ color: postosAcima > 0 ? 'var(--green)' : 'var(--amber)' }}>{postosAcima}</div>
                <div className="stat-note">de {chartData.length} postos</div>
              </div>
            </div>

            {/* Charts */}
            <div className="grid-2 mb-4" style={{ marginBottom: 16 }}>
              <div className="card">
                <div className="card-header">
                  <div><div className="card-title">Realizado vs Meta</div><div className="card-sub">Por posto — frentistas</div></div>
                </div>
                <div style={{ padding: '16px 4px 8px' }}>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={chartData} margin={{ left: 0, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="posto" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="meta" name="Meta" fill="var(--border-light)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="realizado" name="Realizado" radius={[4, 4, 0, 0]}>
                        {chartData.map((d, i) => <Cell key={i} fill={d.pct >= 1 ? 'var(--green)' : d.pct >= 0.75 ? 'var(--amber)' : 'var(--accent)'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div><div className="card-title">% Atingimento da Meta</div><div className="card-sub">Por posto</div></div>
                </div>
                <div style={{ padding: '16px 4px 8px' }}>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={chartData} margin={{ left: 0, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="posto" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip formatter={v => `${v.toFixed(1)}%`} content={({ active, payload, label }) => active && payload?.length ? (
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                          <div style={{ color: payload[0].fill }}>{payload[0].value.toFixed(1)}% da meta</div>
                        </div>
                      ) : null} />
                      <Bar dataKey={d => d.pct * 100} name="% Meta" radius={[4, 4, 0, 0]}>
                        {chartData.map((d, i) => <Cell key={i} fill={d.pct >= 1 ? 'var(--green)' : d.pct >= 0.75 ? 'var(--amber)' : 'var(--red)'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Ranking table */}
            <div className="card">
              <div className="card-header">
                <div><div className="card-title">Ranking de Postos</div></div>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/comissoes')}>Ver comissões detalhadas →</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th><th>Posto</th><th className="text-right">Meta Frent.</th>
                      <th className="text-right">Realizado</th><th>Atingimento</th>
                      <th className="text-right">Total Comissões</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...chartData].sort((a, b) => b.pct - a.pct).map((d, i) => {
                      const st = statusMeta(d.pct);
                      return (
                        <tr key={d.posto}>
                          <td style={{ color: i < 3 ? 'var(--amber)' : 'var(--text-muted)', fontWeight: 700, width: 32 }}>{i + 1}</td>
                          <td><span className="badge badge-gray mono">{d.posto}</span></td>
                          <td className="text-right mono">{fmt(d.meta)}</td>
                          <td className="text-right mono bold">{fmt(d.realizado)}</td>
                          <td style={{ minWidth: 140 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div className="prog-track" style={{ flex: 1 }}>
                                <div className="prog-fill" style={{ width: `${Math.min(d.pct * 100, 100)}%`, background: d.pct >= 1 ? 'var(--green)' : d.pct >= 0.75 ? 'var(--amber)' : 'var(--red)' }} />
                              </div>
                              <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', width: 40, textAlign: 'right' }}>{(d.pct * 100).toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="text-right mono" style={{ color: 'var(--green)' }}>{fmt(d.totalComissoes)}</td>
                          <td><span className={`badge ${st.color}`}>{st.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
