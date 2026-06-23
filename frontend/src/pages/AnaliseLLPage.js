import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../contexts/AuthContext';
import { Spinner } from '../components/ui';
import { fmt } from '../utils/fmt';

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const labelMes = (mes) => {
  const [y, m] = mes.split('-');
  return `${MESES_PT[parseInt(m)-1]}/${y.slice(2)}`;
};

const labelMesLongo = (mes) => {
  const NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                 'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const [y, m] = mes.split('-');
  return `${NOMES[parseInt(m)-1]} ${y}`;
};

const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

const CORES = [
  '#4f6ef7','#22c55e','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#ec4899','#14b8a6','#f97316','#6366f1',
];

function KpiCard({ label, value, sub, color = 'var(--accent)', icon }) {
  return (
    <div className="card" style={{ padding: '18px 20px', display: 'flex', gap: 14, alignItems: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
        background: `${color}18`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 20,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

function BarRow({ label, value, maxValue, pct, cor, badge }) {
  const barPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
          {badge != null && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 99,
              background: pct >= 20 ? 'rgba(34,197,94,0.12)' : pct >= 10 ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
              color: pct >= 20 ? '#22c55e' : pct >= 10 ? '#f59e0b' : '#ef4444',
              fontWeight: 700,
            }}>{fmtPct(badge)} margem</span>
          )}
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
          {fmt(value)}
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--surface2)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${barPct}%`, borderRadius: 99,
          background: cor, transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  );
}

export default function AnaliseLLPage() {
  const [meses, setMeses]     = useState([]);
  const [mesSel, setMesSel]   = useState(null);
  const [dados, setDados]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState('');

  useEffect(() => {
    axios.get(`${API}/lucro-liquido/meses`).then(r => {
      setMeses(r.data);
      if (r.data.length) setMesSel(r.data[0]);
    });
  }, []);

  useEffect(() => {
    if (!mesSel) return;
    setLoading(true); setErro(''); setDados(null);
    axios.get(`${API}/lucro-liquido/bi?mes=${mesSel}`)
      .then(r => setDados(r.data))
      .catch(() => setErro('Erro ao carregar dados'))
      .finally(() => setLoading(false));
  }, [mesSel]);

  const { kpis, porCategoria = [], porPosto = [], topProdutos = [], evolucao = [] } = dados || {};

  const maxCat    = Math.max(...porCategoria.map(r => r.lucro), 1);
  const maxPosto  = Math.max(...porPosto.map(r => r.lucro), 1);
  const maxProd   = Math.max(...topProdutos.map(r => r.lucro), 1);
  const maxEvolucao = Math.max(...evolucao.map(r => r.lucro), 1);

  return (
    <>
      <div className="topbar no-print">
        <div>
          <div className="topbar-title">Análise de Lucro Bruto</div>
          <div className="topbar-sub">Visão analítica por categoria, produto e posto</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
          🖨️ Exportar PDF
        </button>
      </div>

      <div className="page">
        {!meses.length && !loading && (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
            <div style={{ fontWeight: 700 }}>Nenhum dado importado ainda</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>Importe arquivos CSV na página Lucro Líquido para começar.</div>
          </div>
        )}

        {meses.length > 0 && (
          <>
            {/* Seletor de mês */}
            <div className="tabs no-print" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
              {meses.map(m => (
                <button key={m} className={`tab${mesSel === m ? ' active' : ''}`}
                  onClick={() => setMesSel(m)}>{labelMes(m)}</button>
              ))}
            </div>

            {loading && <Spinner />}
            {erro && <div className="alert alert-error">{erro}</div>}

            {!loading && dados && (
              <>
                {/* Título para print */}
                <div className="print-only" style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>Análise de Lucro Bruto</div>
                  <div style={{ fontSize: 12, color: '#666' }}>{labelMesLongo(mesSel)}</div>
                </div>

                {/* KPIs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
                  <KpiCard icon="💰" label="Venda Bruta"   value={fmt(kpis.totalBruto)}   color="#4f6ef7" />
                  <KpiCard icon="📦" label="Custo Total"   value={fmt(kpis.totalCusto)}   color="#ef4444" />
                  <KpiCard icon="✅" label="Lucro Bruto"   value={fmt(kpis.totalLucro)}   color="#22c55e"
                    sub={`${kpis.registros} registros`} />
                  <KpiCard icon="📈" label="Margem Média"
                    value={fmtPct(kpis.margem)}
                    color={kpis.margem >= 20 ? '#22c55e' : kpis.margem >= 10 ? '#f59e0b' : '#ef4444'}
                    sub="lucro / venda bruta" />
                </div>

                {/* Categorias + Postos */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

                  {/* Por Categoria */}
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">Lucro por Categoria</div>
                    </div>
                    <div style={{ padding: '12px 20px 16px' }}>
                      {porCategoria.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                          Categorize os produtos na aba Produtos para ver este gráfico.
                        </div>
                      ) : porCategoria.map((r, i) => (
                        <BarRow key={r.categoria}
                          label={r.categoria}
                          value={r.lucro}
                          maxValue={maxCat}
                          badge={r.margem}
                          pct={r.margem}
                          cor={CORES[i % CORES.length]}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Por Posto */}
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">Lucro por Posto</div>
                    </div>
                    <div style={{ padding: '12px 20px 16px' }}>
                      {porPosto.map((r, i) => (
                        <BarRow key={r.codigo}
                          label={r.codigo}
                          value={r.lucro}
                          maxValue={maxPosto}
                          badge={r.margem}
                          pct={r.margem}
                          cor={CORES[i % CORES.length]}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Evolução mensal */}
                {evolucao.length > 1 && (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header">
                      <div className="card-title">Evolução Mensal — Lucro Bruto</div>
                    </div>
                    <div style={{ padding: '12px 20px 16px', display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
                      {evolucao.map(e => {
                        const h = Math.max((e.lucro / maxEvolucao) * 80, 2);
                        const ativo = e.mes === mesSel;
                        return (
                          <div key={e.mes} onClick={() => setMesSel(e.mes)}
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                              {fmt(e.lucro, 0)}
                            </span>
                            <div style={{
                              width: '100%', height: `${h}px`, borderRadius: '4px 4px 0 0',
                              background: ativo ? 'var(--accent)' : 'var(--surface2)',
                              border: ativo ? '2px solid var(--accent)' : '1px solid var(--border)',
                              transition: 'height 0.4s ease',
                            }} />
                            <span style={{
                              fontSize: 9, color: ativo ? 'var(--accent)' : 'var(--text-muted)',
                              fontWeight: ativo ? 800 : 400,
                            }}>{labelMes(e.mes)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Categorias detalhado */}
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">Categorias — Detalhe</div>
                  </div>
                  <div className="table-wrap">
                    <table style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 28 }}>#</th>
                          <th>Categoria</th>
                          <th className="text-right">Venda Bruta</th>
                          <th className="text-right">Lucro Bruto</th>
                          <th className="text-right">% do Total</th>
                          <th style={{ width: 160 }}>Margem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {porCategoria.map((r, i) => {
                          const barW = maxCat > 0 ? (r.lucro / maxCat) * 100 : 0;
                          const pctTotal = kpis.totalLucro > 0 ? (r.lucro / kpis.totalLucro * 100) : 0;
                          const corMargem = r.margem >= 20 ? '#22c55e' : r.margem >= 10 ? '#f59e0b' : '#ef4444';
                          return (
                            <tr key={r.categoria}>
                              <td style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}</td>
                              <td style={{ fontWeight: 700 }}>{r.categoria}</td>
                              <td className="text-right mono">{fmt(r.vbruto)}</td>
                              <td className="text-right mono" style={{ fontWeight: 700 }}>{fmt(r.lucro)}</td>
                              <td className="text-right mono" style={{ color: 'var(--text-muted)' }}>{pctTotal.toFixed(1)}%</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 99 }}>
                                    <div style={{ height: '100%', width: `${barW}%`, borderRadius: 99, background: CORES[i % CORES.length] }} />
                                  </div>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: corMargem, minWidth: 36 }}>
                                    {fmtPct(r.margem)}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {porCategoria.length > 0 && (
                        <tfoot>
                          <tr>
                            <td colSpan={2} style={{ fontWeight: 800 }}>TOTAL</td>
                            <td className="text-right mono" style={{ fontWeight: 800 }}>{fmt(kpis.totalBruto)}</td>
                            <td className="text-right mono" style={{ fontWeight: 800 }}>{fmt(kpis.totalLucro)}</td>
                            <td className="text-right mono" style={{ fontWeight: 800 }}>100%</td>
                            <td style={{ fontWeight: 800, color: kpis.margem >= 20 ? '#22c55e' : kpis.margem >= 10 ? '#f59e0b' : '#ef4444' }}>
                              {fmtPct(kpis.margem)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
