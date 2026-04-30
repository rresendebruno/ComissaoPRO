import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../contexts/AuthContext';
import { Spinner } from '../components/ui';

const TIPOS = [
  {
    id: 'postos',
    icon: '🏪',
    label: 'Vendas por Posto',
    desc: 'Total vendido, meta, atingimento e comissões agrupados por posto.',
    cols: ['Posto', 'Total Vendas', 'Meta', '% Meta', 'Frentistas', 'Trocadores', 'Gerentes', 'Total Comissões'],
  },
  {
    id: 'funcionarios',
    icon: '👤',
    label: 'Vendas por Funcionário',
    desc: 'Vendas individuais, faixas de comissão e totais por colaborador.',
    cols: ['Funcionário', 'Tipo', 'Total Vendas', 'Meta', '% Meta', 'Taxa', 'Com. Faixa', 'Com. Especiais', 'Total'],
  },
  {
    id: 'detalhado',
    icon: '📋',
    label: 'Detalhado por Funcionário',
    desc: 'Todos os produtos vendidos por colaborador, destacando itens especiais e suas comissões unitárias.',
    cols: ['Funcionário', 'Produto', 'Especial', 'Qtde', 'Vl. Unit.', 'Vl. Total', 'Com./un', 'Com. Especial'],
  },
];

const FORMATOS = [
  { id: 'pdf',  icon: '📄', label: 'PDF',  color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.25)' },
  { id: 'xlsx', icon: '📊', label: 'XLSX', color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.25)' },
  { id: 'csv',  icon: '📝', label: 'CSV',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' },
];

export default function RelatoriosPage() {
  const [periodos, setPeriodos]   = useState([]);
  const [postos, setPostos]       = useState([]);
  const [periodoId, setPeriodoId] = useState('');
  const [postoId, setPostoId]     = useState('');
  const [tipo, setTipo]           = useState('postos');
  const [formato, setFormato]     = useState('pdf');
  const [loading, setLoading]     = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const [erro, setErro]           = useState('');
  const [sucesso, setSucesso]     = useState('');

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/periodos`),
      axios.get(`${API}/postos`),
    ]).then(([r1, r2]) => {
      setPeriodos(r1.data);
      setPostos(r2.data.filter(p => p.ativo));
      if (r1.data.length) setPeriodoId(String(r1.data[0].id));
    }).finally(() => setLoadingInit(false));
  }, []);

  const exportar = async () => {
    if (!periodoId) { setErro('Selecione um período.'); return; }
    setLoading(true);
    setErro('');
    setSucesso('');

    const params = new URLSearchParams({ periodo_id: periodoId, formato });
    if (postoId) params.set('posto_id', postoId);

    try {
      const resp = await axios.get(`${API}/relatorios/${tipo}?${params}`, {
        responseType: 'blob',
        timeout: 120000,
      });

      const cd     = resp.headers['content-disposition'] || '';
      const match  = cd.match(/filename="?([^"]+)"?/);
      const ext    = formato === 'xlsx' ? '.xlsx' : formato === 'csv' ? '.csv' : '.pdf';
      const fname  = match ? match[1] : `relatorio_${tipo}${ext}`;

      const url  = URL.createObjectURL(new Blob([resp.data], { type: resp.headers['content-type'] }));
      const link = document.createElement('a');
      link.href  = url;
      link.download = fname;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const tipoLabel = TIPOS.find(t => t.id === tipo)?.label || tipo;
      setSucesso(`${tipoLabel} exportado como ${formato.toUpperCase()} com sucesso!`);
      setTimeout(() => setSucesso(''), 4000);
    } catch (e) {
      // Blob de erro pode ter JSON dentro
      if (e.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text();
          const json = JSON.parse(text);
          setErro(json.error || 'Erro ao exportar');
        } catch {
          setErro('Erro ao exportar relatório');
        }
      } else {
        setErro(e.response?.data?.error || 'Erro ao exportar relatório');
      }
    } finally {
      setLoading(false);
    }
  };

  const periodoSel = periodos.find(p => String(p.id) === periodoId);
  const tipoSel    = TIPOS.find(t => t.id === tipo);
  const formatoSel = FORMATOS.find(f => f.id === formato);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Relatórios</div>
          <div className="topbar-sub">Exporte dados em PDF, Excel ou CSV</div>
        </div>
      </div>

      <div className="page">
        {loadingInit ? <Spinner /> : (
          <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* ── Seleção de Período + Posto ── */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">1 — Selecione o Período</div>
              </div>
              <div className="card-body" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '2 1 220px', marginBottom: 0 }}>
                  <label>Período de Apuração</label>
                  <select value={periodoId} onChange={e => setPeriodoId(e.target.value)}>
                    <option value="">Selecione…</option>
                    {periodos.map(p => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
                  <label>Filtrar por Posto <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(opcional)</span></label>
                  <select value={postoId} onChange={e => setPostoId(e.target.value)}>
                    <option value="">Todos os postos</option>
                    {postos.map(p => (
                      <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>
                    ))}
                  </select>
                </div>

                {periodoSel && (
                  <div style={{
                    flex: '1 1 180px',
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: '8px 12px',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: 3,
                    alignSelf: 'flex-end',
                    marginBottom: 0,
                  }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-dim)', fontSize: 12 }}>{periodoSel.nome}</div>
                    <div>
                      {new Date(periodoSel.data_inicio).toLocaleDateString('pt-BR')} →{' '}
                      {new Date(periodoSel.data_fim).toLocaleDateString('pt-BR')}
                    </div>
                    <div>
                      <span className={`badge ${periodoSel.status === 'ativo' ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 10 }}>
                        {periodoSel.status === 'ativo' ? 'Em aberto' : 'Fechado'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Tipo de Relatório ── */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">2 — Tipo de Relatório</div>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {TIPOS.map(t => (
                  <div
                    key={t.id}
                    onClick={() => setTipo(t.id)}
                    style={{
                      flex: '1 1 220px',
                      border: `2px solid ${tipo === t.id ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 10,
                      padding: '16px 18px',
                      cursor: 'pointer',
                      background: tipo === t.id ? 'var(--accent-glow)' : 'var(--surface2)',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{t.icon}</div>
                    <div style={{
                      fontWeight: 700, fontSize: 13,
                      color: tipo === t.id ? 'var(--accent)' : 'var(--text)',
                      marginBottom: 6,
                    }}>
                      {t.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {t.desc}
                    </div>

                    {/* Preview das colunas */}
                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {t.cols.map(c => (
                        <span key={c} style={{
                          fontSize: 9, padding: '1px 5px', borderRadius: 3,
                          background: tipo === t.id ? 'rgba(79,110,247,0.2)' : 'var(--surface)',
                          color: tipo === t.id ? 'var(--accent)' : 'var(--text-muted)',
                          fontFamily: 'var(--mono)',
                        }}>{c}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Formato de Exportação ── */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">3 — Formato de Exportação</div>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {FORMATOS.map(f => (
                  <div
                    key={f.id}
                    onClick={() => setFormato(f.id)}
                    style={{
                      flex: '1 1 160px',
                      border: `2px solid ${formato === f.id ? f.border : 'var(--border)'}`,
                      borderRadius: 10,
                      padding: '18px 20px',
                      cursor: 'pointer',
                      background: formato === f.id ? f.bg : 'var(--surface2)',
                      transition: 'all 0.15s',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 28, marginBottom: 8 }}>{f.icon}</div>
                    <div style={{
                      fontWeight: 700, fontSize: 15,
                      color: formato === f.id ? f.color : 'var(--text)',
                      marginBottom: 4,
                    }}>
                      {f.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {f.id === 'pdf'  && 'Formatado, pronto para imprimir'}
                      {f.id === 'xlsx' && 'Editável no Excel / Sheets'}
                      {f.id === 'csv'  && 'Compatível com qualquer app'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Resumo + Botão ── */}
            <div className="card">
              <div style={{
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}>
                {/* Resumo da seleção */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Exportando:</div>

                  {/* Tipo */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'var(--accent-glow)', border: '1px solid rgba(79,110,247,0.25)',
                    borderRadius: 6, padding: '4px 10px',
                  }}>
                    <span style={{ fontSize: 13 }}>{tipoSel?.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                      {tipoSel?.label}
                    </span>
                  </div>

                  <span style={{ color: 'var(--text-muted)' }}>→</span>

                  {/* Formato */}
                  {formatoSel && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: formatoSel.bg,
                      border: `1px solid ${formatoSel.border}`,
                      borderRadius: 6, padding: '4px 10px',
                    }}>
                      <span style={{ fontSize: 13 }}>{formatoSel.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: formatoSel.color }}>
                        {formatoSel.label}
                      </span>
                    </div>
                  )}

                  {/* Período */}
                  {periodoSel && (
                    <>
                      <span style={{ color: 'var(--text-muted)' }}>·</span>
                      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        {periodoSel.nome}
                        {postoId && ` · ${postos.find(p => String(p.id) === postoId)?.codigo}`}
                      </span>
                    </>
                  )}
                </div>

                {/* Botão */}
                <button
                  className="btn btn-primary"
                  style={{ gap: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600 }}
                  onClick={exportar}
                  disabled={loading || !periodoId}
                >
                  {loading ? (
                    <>⟳ Gerando {formato.toUpperCase()}…</>
                  ) : (
                    <>{formatoSel?.icon} Exportar {formato.toUpperCase()}</>
                  )}
                </button>
              </div>

              {/* Alertas */}
              {erro && (
                <div style={{ padding: '0 20px 16px' }}>
                  <div className="alert alert-error" style={{ marginBottom: 0 }}>❌ {erro}</div>
                </div>
              )}
              {sucesso && (
                <div style={{ padding: '0 20px 16px' }}>
                  <div className="alert alert-success" style={{ marginBottom: 0 }}>✓ {sucesso}</div>
                </div>
              )}
            </div>

            {/* ── Dicas ── */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 10,
            }}>
              {[
                { icon: '📄', titulo: 'PDF', cor: '#ef4444', dica: 'Ideal para enviar por WhatsApp ou imprimir. Layout formatado com cabeçalho e totais.' },
                { icon: '📊', titulo: 'XLSX', cor: '#22c55e', dica: 'Abra no Excel ou Google Sheets. Inclui larguras de coluna e valores numéricos para cálculo.' },
                { icon: '📝', titulo: 'CSV', cor: '#f59e0b', dica: 'Formato universal. Use para importar em qualquer sistema, banco de dados ou BI.' },
              ].map(d => (
                <div key={d.titulo} style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '12px 14px',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                }}>
                  <span style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>{d.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12, color: d.cor, marginBottom: 4 }}>{d.titulo}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{d.dica}</div>
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}
      </div>
    </>
  );
}
