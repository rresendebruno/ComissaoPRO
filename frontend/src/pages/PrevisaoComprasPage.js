import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import { API, useAuth } from '../contexts/AuthContext';
import { Modal, Spinner, Empty } from '../components/ui';
import { fmtN } from '../utils/fmt';

const fmtQ = (v) => fmtN(Math.round(Number(v) || 0));

const STATUS_INFO = {
  critico:     { label: 'Crítico — comprar já', cls: 'badge-red' },
  comprar:     { label: 'Comprar',              cls: 'badge-amber' },
  ok:          { label: 'OK',                   cls: 'badge-green' },
  sem_config:  { label: 'Sem estoque informado', cls: 'badge-gray' },
};

// Constrói árvore a partir de lista flat (categorias)
function buildTree(cats) {
  const map = {};
  cats.forEach(c => map[c.id] = { ...c, filhos: [] });
  const raizes = [];
  cats.forEach(c => {
    if (c.pai_id) map[c.pai_id]?.filhos.push(map[c.id]);
    else raizes.push(map[c.id]);
  });
  return raizes;
}

// Lista plana com indentação, para usar em <select>
function flattenCategorias(tree, prefix = '', out = []) {
  for (const node of tree) {
    out.push({ id: node.id, label: prefix + node.nome });
    if (node.filhos?.length) flattenCategorias(node.filhos, prefix + node.nome + ' › ', out);
  }
  return out;
}

function CatNode({ node, onDelete, onAdd, nivel = 0 }) {
  const [addNome, setAddNome] = useState('');
  const [adicionando, setAdicionando] = useState(false);

  return (
    <div style={{ marginLeft: nivel * 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: nivel === 0 ? 700 : 500 }}>{node.nome}</span>
        {nivel === 0 && (
          <button className="btn btn-ghost btn-sm" title="Adicionar subcategoria"
            onClick={() => setAdicionando(!adicionando)} style={{ fontSize: 11 }}>+ Sub</button>
        )}
        <button className="btn btn-danger btn-sm" onClick={() => onDelete(node.id)} style={{ fontSize: 11 }}>✕</button>
      </div>

      {adicionando && (
        <div style={{ display: 'flex', gap: 8, marginLeft: 18, padding: '6px 0' }}>
          <input placeholder="Nome da subcategoria…" value={addNome}
            onChange={e => setAddNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && addNome.trim()) { onAdd(addNome, node.id); setAddNome(''); setAdicionando(false); } }}
            style={{ flex: 1, fontSize: 12 }} autoFocus />
          <button className="btn btn-primary btn-sm" onClick={() => { if (addNome.trim()) { onAdd(addNome, node.id); setAddNome(''); setAdicionando(false); } }}>
            OK
          </button>
        </div>
      )}

      {node.filhos.map(f => (
        <CatNode key={f.id} node={f} onDelete={onDelete} onAdd={onAdd} nivel={nivel + 1} />
      ))}
    </div>
  );
}

function corTendencia(pct) {
  if (pct > 10) return '#22c55e';
  if (pct < -10) return '#ef4444';
  return 'var(--text-muted)';
}

function fmtTendencia(pct) {
  if (pct == null) return '—';
  const seta = pct > 2 ? '▲' : pct < -2 ? '▼' : '▬';
  return `${seta} ${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

function fmtDiasSemSaida(dias) {
  if (dias == null) return '—';
  if (dias <= 0) return 'hoje';
  return `${dias}d`;
}

function exportXLSX(produtos, postoLabel) {
  import('xlsx').then(XLSX => {
    const cabecalho = [
      ['Produto', 'Categoria', 'Subcategoria', 'Saída Total', 'Média/dia', 'Tendência (%)', 'Dias sem saída',
       'Estoque Atual', 'Prazo Reposição (d)', 'Estoque Mínimo Sugerido', 'Sugestão de Compra', 'Status'],
    ];
    const dados = produtos.map(p => [
      p.produto,
      p.categoria || '',
      p.subcategoria || '',
      Math.round(p.qtdTotal),
      Math.round(p.mediaDiaria),
      Math.round(p.tendenciaPct),
      p.diasSemSaida ?? '',
      p.estoqueAtual != null ? Math.round(p.estoqueAtual) : '',
      p.prazoReposicaoDias,
      Math.round(p.estoqueMinimoSugerido),
      p.sugestaoCompra != null ? Math.round(p.sugestaoCompra) : '',
      STATUS_INFO[p.status]?.label || p.status,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([...cabecalho, ...dados]);
    ws['!cols'] = [{ wch: 40 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Previsão de Compras');
    XLSX.writeFile(wb, `previsao_compras_${postoLabel.replace(/\s+/g, '_')}.xlsx`);
  });
}

export default function PrevisaoComprasPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const fileRef = useRef(null);

  const [postos, setPostos]       = useState([]);
  const [postoId, setPostoId]     = useState('');
  const [nPeriodos, setNPeriodos] = useState(6);
  const [cobertura, setCobertura] = useState(7);
  const [busca, setBusca]         = useState('');
  const [ordem, setOrdem]         = useState('qtd');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');

  const [dados, setDados]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState('');
  const [salvandoKey, setSalvandoKey] = useState(null);
  const [importando, setImportando] = useState(false);
  const [importMsg, setImportMsg]   = useState(null);

  const [categorias, setCategorias] = useState([]);
  const [catModalAberto, setCatModalAberto] = useState(false);
  const [catErro, setCatErro] = useState('');
  const [atribuindoCat, setAtribuindoCat] = useState(null);

  const [regras, setRegras] = useState([]);
  const [novaRegraPalavras, setNovaRegraPalavras] = useState('');
  const [novaRegraCategoria, setNovaRegraCategoria] = useState('');
  const [autoCatRodando, setAutoCatRodando] = useState(false);
  const [autoCatMsg, setAutoCatMsg] = useState(null);

  useEffect(() => {
    axios.get(`${API}/postos`).then(r => setPostos(r.data.filter(p => p.ativo)));
  }, []);

  const carregarCategorias = useCallback(() => {
    axios.get(`${API}/estoque/categorias`).then(r => setCategorias(r.data));
  }, []);

  useEffect(() => { carregarCategorias(); }, [carregarCategorias]);

  const arvoreCategorias = useMemo(() => buildTree(categorias), [categorias]);
  const categoriasFlat   = useMemo(() => flattenCategorias(arvoreCategorias), [arvoreCategorias]);

  const adicionarCategoria = async (nome, paiId = null) => {
    setCatErro('');
    try {
      await axios.post(`${API}/estoque/categorias`, { nome: nome.trim(), pai_id: paiId });
      carregarCategorias();
    } catch (ex) {
      setCatErro(ex.response?.data?.error || 'Erro ao criar categoria');
    }
  };

  const deletarCategoria = async (id) => {
    if (!window.confirm('Excluir esta categoria e todas as subcategorias?')) return;
    await axios.delete(`${API}/estoque/categorias/${id}`);
    carregarCategorias();
  };

  const carregarRegras = useCallback(() => {
    axios.get(`${API}/estoque/regras`).then(r => setRegras(r.data));
  }, []);

  useEffect(() => { carregarRegras(); }, [carregarRegras]);

  const adicionarRegra = async () => {
    if (!novaRegraPalavras.trim() || !novaRegraCategoria) return;
    setCatErro('');
    try {
      await axios.post(`${API}/estoque/regras`, { palavras: novaRegraPalavras.trim(), categoria_id: Number(novaRegraCategoria) });
      setNovaRegraPalavras(''); setNovaRegraCategoria('');
      carregarRegras();
    } catch (ex) {
      setCatErro(ex.response?.data?.error || 'Erro ao criar regra');
    }
  };

  const deletarRegra = async (id) => {
    await axios.delete(`${API}/estoque/regras/${id}`);
    carregarRegras();
  };

  const aplicarSugestoes = async () => {
    const r = await axios.post(`${API}/estoque/regras/sugestoes`);
    carregarCategorias();
    carregarRegras();
    setAutoCatMsg({ ok: true, text: r.data.message });
  };

  const rodarAutoCategorizar = async (sobrescrever = false) => {
    setAutoCatRodando(true); setAutoCatMsg(null);
    try {
      const r = await axios.post(`${API}/estoque/auto-categorizar`, { sobrescrever });
      setAutoCatMsg({ ok: true, text: `${r.data.categorizados} produto(s) categorizado(s). ${r.data.semCorrespondencia} sem regra correspondente.` });
      carregar();
    } catch (ex) {
      setAutoCatMsg({ ok: false, text: ex.response?.data?.error || 'Erro ao categorizar automaticamente' });
    } finally {
      setAutoCatRodando(false);
    }
  };

  const atribuirCategoria = async (produto, categoriaId) => {
    setAtribuindoCat(produto);
    try {
      await axios.put(`${API}/estoque/produto-categoria`, { produto, categoria_id: categoriaId || null });
      await carregar();
    } finally {
      setAtribuindoCat(null);
    }
  };

  const carregar = useCallback(() => {
    setLoading(true); setErro('');
    const params = new URLSearchParams({ periodos: nPeriodos, cobertura_dias: cobertura });
    if (postoId) params.set('posto_id', postoId);
    axios.get(`${API}/estoque/previsao?${params}`)
      .then(r => setDados(r.data))
      .catch(() => setErro('Erro ao carregar previsão de compras'))
      .finally(() => setLoading(false));
  }, [postoId, nPeriodos, cobertura]);

  useEffect(() => { carregar(); }, [carregar]);

  const handleImportEstoque = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';
    setImportando(true); setImportMsg(null);
    const fd = new FormData();
    files.forEach(f => fd.append('arquivo', f));
    try {
      const r = await axios.post(`${API}/estoque/importar`, fd);
      setImportMsg({ ok: true, text: r.data.message });
      carregar();
    } catch (ex) {
      setImportMsg({ ok: false, text: ex.response?.data?.error || 'Erro ao importar estoque' });
    } finally {
      setImportando(false);
    }
  };

  const salvarEstoque = async (produto, campo, valor) => {
    if (!postoId) return;
    const key = produto;
    setSalvandoKey(key);
    const atual = dados.produtos.find(p => p.produto === produto);
    const body = {
      posto_id: Number(postoId),
      produto,
      estoque_atual: campo === 'estoque_atual' ? valor : (atual.estoqueAtual ?? 0),
      prazo_reposicao_dias: campo === 'prazo_reposicao_dias' ? valor : atual.prazoReposicaoDias,
    };
    try {
      await axios.put(`${API}/estoque/produto`, body);
      await carregar();
    } catch {
      setErro('Erro ao salvar estoque do produto');
    } finally {
      setSalvandoKey(null);
    }
  };

  const produtosFiltrados = useMemo(() => {
    if (!dados) return [];
    let lista = dados.produtos;
    if (busca.trim()) {
      const b = busca.trim().toLowerCase();
      lista = lista.filter(p => p.produto.toLowerCase().includes(b));
    }
    if (categoriaFiltro === '__sem__') {
      lista = lista.filter(p => !p.categoriaId);
    } else if (categoriaFiltro) {
      const idsPermitidos = new Set([Number(categoriaFiltro), ...categorias.filter(c => c.pai_id === Number(categoriaFiltro)).map(c => c.id)]);
      lista = lista.filter(p => p.categoriaId && idsPermitidos.has(p.categoriaId));
    }
    const arr = [...lista];
    if (ordem === 'qtd') arr.sort((a, b) => b.qtdTotal - a.qtdTotal);
    else if (ordem === 'sugestao') arr.sort((a, b) => (b.sugestaoCompra ?? -1) - (a.sugestaoCompra ?? -1));
    else if (ordem === 'tendencia') arr.sort((a, b) => b.tendenciaPct - a.tendenciaPct);
    else if (ordem === 'sem_giro') arr.sort((a, b) => (b.diasSemSaida ?? -1) - (a.diasSemSaida ?? -1));
    else if (ordem === 'sem_categoria') arr.sort((a, b) => (a.categoriaId ? 1 : 0) - (b.categoriaId ? 1 : 0) || b.qtdTotal - a.qtdTotal);
    return arr;
  }, [dados, busca, ordem, categoriaFiltro, categorias]);

  const postoLabel = postoId ? (postos.find(p => String(p.id) === postoId)?.codigo || 'posto') : 'todos_os_postos';

  const kpis = useMemo(() => {
    if (!dados) return null;
    const total = dados.produtos.length;
    const precisamComprar = dados.produtos.filter(p => p.status === 'comprar' || p.status === 'critico').length;
    const criticos = dados.produtos.filter(p => p.status === 'critico').length;
    const semGiro = dados.produtos.filter(p => p.diasSemSaida != null && p.diasSemSaida > cobertura * 3).length;
    const categorizados = dados.produtos.filter(p => p.categoriaId).length;
    return { total, precisamComprar, criticos, semGiro, categorizados, semCategoria: total - categorizados };
  }, [dados, cobertura]);

  return (
    <>
      <div className="topbar no-print">
        <div>
          <div className="topbar-title">Previsão de Compras</div>
          <div className="topbar-sub">Saída por período, média de venda e sugestão de compra por produto</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={() => setCatModalAberto(true)}>
              🏷️ Categorias
            </button>
          )}
          {isAdmin && (
            <>
              <button className="btn btn-primary btn-sm" disabled={importando}
                title="Colunas esperadas no arquivo: B = chave da empresa, U = produto, AA = quantidade em estoque"
                onClick={() => fileRef.current?.click()}>
                {importando ? 'Importando…' : '📂 Importar Estoque'}
              </button>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" multiple
                style={{ display: 'none' }} onChange={handleImportEstoque} />
            </>
          )}
          {dados?.produtos?.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => exportXLSX(produtosFiltrados, postoLabel)}>
              📊 Exportar XLSX
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
            🖨️ Exportar PDF
          </button>
        </div>
      </div>

      <div className="page">
        {importMsg && (
          <div className={`alert ${importMsg.ok ? 'alert-success' : 'alert-error'} no-print`}>
            {importMsg.ok ? '✓ ' : '❌ '}{importMsg.text}
          </div>
        )}

        {/* Filtros */}
        <div className="card no-print" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: '1 1 220px', marginBottom: 0 }}>
              <label>Posto</label>
              <select value={postoId} onChange={e => setPostoId(e.target.value)}>
                <option value="">Todos os postos (só análise)</option>
                {postos.map(p => (
                  <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 160px', marginBottom: 0 }}>
              <label>Períodos analisados</label>
              <select value={nPeriodos} onChange={e => setNPeriodos(Number(e.target.value))}>
                <option value={3}>Últimos 3</option>
                <option value={6}>Últimos 6</option>
                <option value={9}>Últimos 9</option>
                <option value={12}>Últimos 12</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 160px', marginBottom: 0 }}>
              <label>Cobertura desejada (dias)</label>
              <input type="number" min={1} max={90} value={cobertura}
                onChange={e => setCobertura(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div className="form-group" style={{ flex: '2 1 220px', marginBottom: 0 }}>
              <label>Buscar produto</label>
              <input type="text" placeholder="Filtrar por nome..." value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
              <label>Categoria</label>
              <select value={categoriaFiltro} onChange={e => setCategoriaFiltro(e.target.value)}>
                <option value="">Todas as categorias</option>
                <option value="__sem__">Sem categoria</option>
                {categoriasFlat.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: '1 1 180px', marginBottom: 0 }}>
              <label>Ordenar por</label>
              <select value={ordem} onChange={e => setOrdem(e.target.value)}>
                <option value="qtd">Maior saída</option>
                {postoId && <option value="sugestao">Sugestão de compra</option>}
                <option value="tendencia">Tendência (alta → queda)</option>
                <option value="sem_giro">Mais dias sem saída</option>
                {isAdmin && <option value="sem_categoria">Sem categoria primeiro</option>}
              </select>
            </div>
          </div>
        </div>

        {erro && <div className="alert alert-error">{erro}</div>}
        {loading && <Spinner />}

        {!loading && dados && (
          <>
            <div className="print-only" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Previsão de Compras</div>
              <div style={{ fontSize: 12, color: '#666' }}>
                {postoId ? postos.find(p => String(p.id) === postoId)?.nome : 'Todos os postos'} ·
                {' '}Últimos {nPeriodos} períodos · Cobertura de {cobertura} dias
              </div>
            </div>

            {!dados.periodos.length ? (
              <Empty text="Nenhum período cadastrado ainda." />
            ) : (
              <>
                {/* KPIs */}
                {kpis && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 20 }}>
                    <div className="card" style={{ padding: '16px 18px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Produtos Analisados</div>
                      <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtN(kpis.total)}</div>
                    </div>
                    {postoId && (
                      <>
                        <div className="card" style={{ padding: '16px 18px' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Precisam de Compra</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#f59e0b' }}>{fmtN(kpis.precisamComprar)}</div>
                        </div>
                        <div className="card" style={{ padding: '16px 18px' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Críticos (risco de faltar)</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#ef4444' }}>{fmtN(kpis.criticos)}</div>
                        </div>
                      </>
                    )}
                    <div className="card" style={{ padding: '16px 18px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Sem Giro (possível sobra)</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#94a3b8' }}>{fmtN(kpis.semGiro)}</div>
                    </div>
                    {isAdmin && (
                      <div className="card no-print" style={{ padding: '16px 18px', cursor: kpis.semCategoria > 0 ? 'pointer' : 'default' }}
                        title="Clique para ver só os produtos sem categoria"
                        onClick={() => kpis.semCategoria > 0 && setCategoriaFiltro('__sem__')}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Categorizados</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: kpis.semCategoria === 0 ? '#22c55e' : '#f59e0b' }}>
                          {fmtN(kpis.categorizados)}/{fmtN(kpis.total)}
                        </div>
                        <div className="prog-track" style={{ marginTop: 6 }}>
                          <div className="prog-fill" style={{
                            width: `${kpis.total > 0 ? (kpis.categorizados / kpis.total) * 100 : 0}%`,
                            background: kpis.semCategoria === 0 ? 'var(--green)' : 'var(--amber)',
                          }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!postoId && (
                  <div className="alert alert-info">
                    ℹ️ Selecione um posto específico para informar o estoque atual e ver a sugestão exata de quanto comprar.
                    Sem posto selecionado, o relatório mostra apenas a análise de demanda (saída, média e tendência) somando todos os postos.
                  </div>
                )}

                {/* Tabela */}
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">Produtos — {postoId ? (postos.find(p => String(p.id) === postoId)?.codigo) : 'Todos os postos'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dados.totalDias} dias analisados</div>
                  </div>
                  <div className="table-wrap">
                    <table style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 28 }}>#</th>
                          <th>Produto</th>
                          <th>Categoria</th>
                          <th className="text-right">Saída Total</th>
                          <th className="text-right">Média/dia</th>
                          <th className="text-right">Tendência</th>
                          <th className="text-right">Sem saída há</th>
                          {postoId && <th className="text-right">Estoque Atual</th>}
                          {postoId && <th className="text-right">Prazo Reposição</th>}
                          <th className="text-right">Estoque Mín. Sugerido</th>
                          {postoId && <th className="text-right">Sugestão de Compra</th>}
                          {postoId && <th>Status</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {produtosFiltrados.map((p, i) => {
                          const st = STATUS_INFO[p.status];
                          const semCat = categorias.length > 0 && !p.categoriaId;
                          return (
                            <tr key={p.produto} style={semCat ? { background: 'rgba(245,158,11,0.06)' } : undefined}>
                              <td style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{i + 1}</td>
                              <td style={{ fontWeight: 600 }}>{p.produto}</td>
                              <td>
                                {isAdmin ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="no-print">
                                    <span title={p.categoriaId ? 'Categorizado' : 'Sem categoria'}
                                      style={{
                                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                        background: p.categoriaId ? '#22c55e' : '#f59e0b',
                                      }} />
                                    <select
                                      value={p.categoriaId || ''}
                                      disabled={atribuindoCat === p.produto}
                                      onChange={e => atribuirCategoria(p.produto, e.target.value ? Number(e.target.value) : null)}
                                      style={{
                                        fontSize: 11, maxWidth: 160,
                                        borderColor: p.categoriaId ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.5)',
                                        color: p.categoriaId ? 'var(--text)' : '#f59e0b',
                                        fontWeight: p.categoriaId ? 400 : 600,
                                      }}
                                    >
                                      <option value="">— Sem categoria —</option>
                                      {categoriasFlat.map(c => (
                                        <option key={c.id} value={c.id}>{c.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                ) : (
                                  <span className="no-print" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    {p.subcategoria || p.categoria || '—'}
                                  </span>
                                )}
                                <span className="print-only" style={{ fontSize: 11 }}>
                                  {p.subcategoria || p.categoria || '—'}
                                </span>
                              </td>
                              <td className="text-right mono">{fmtQ(p.qtdTotal)}</td>
                              <td className="text-right mono">{fmtQ(p.mediaDiaria)}</td>
                              <td className="text-right mono" style={{ fontWeight: 700, color: corTendencia(p.tendenciaPct) }}>
                                {fmtTendencia(p.tendenciaPct)}
                              </td>
                              <td className="text-right mono" style={{ color: p.diasSemSaida > cobertura * 3 ? '#ef4444' : 'var(--text-dim)' }}>
                                {fmtDiasSemSaida(p.diasSemSaida)}
                              </td>
                              {postoId && (
                                <td className="text-right no-print">
                                  <input
                                    type="number" min={0} step="0.01"
                                    defaultValue={p.estoqueAtual ?? ''}
                                    placeholder="0"
                                    disabled={salvandoKey === p.produto}
                                    onBlur={e => {
                                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                                      if (v !== (p.estoqueAtual ?? 0)) salvarEstoque(p.produto, 'estoque_atual', v);
                                    }}
                                    style={{ width: 90, textAlign: 'right', fontSize: 12 }}
                                  />
                                </td>
                              )}
                              {postoId && <td className="text-right mono print-only">{p.estoqueAtual != null ? fmtQ(p.estoqueAtual) : '—'}</td>}
                              {postoId && (
                                <td className="text-right no-print">
                                  <input
                                    type="number" min={0} step="1"
                                    defaultValue={p.prazoReposicaoDias}
                                    disabled={salvandoKey === p.produto}
                                    onBlur={e => {
                                      const v = Number(e.target.value) || 3;
                                      if (v !== p.prazoReposicaoDias) salvarEstoque(p.produto, 'prazo_reposicao_dias', v);
                                    }}
                                    style={{ width: 60, textAlign: 'right', fontSize: 12 }}
                                  />
                                </td>
                              )}
                              {postoId && <td className="text-right mono print-only">{p.prazoReposicaoDias}d</td>}
                              <td className="text-right mono">{fmtQ(p.estoqueMinimoSugerido)}</td>
                              {postoId && (
                                <td className="text-right mono" style={{ fontWeight: 700, color: p.sugestaoCompra > 0 ? '#f59e0b' : 'var(--text-dim)' }}>
                                  {p.sugestaoCompra != null ? fmtQ(p.sugestaoCompra) : '—'}
                                </td>
                              )}
                              {postoId && (
                                <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!produtosFiltrados.length && <Empty text="Nenhum produto encontrado nos períodos selecionados." />}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {catModalAberto && (
        <Modal title="Gerenciar Categorias" onClose={() => { setCatModalAberto(false); setCatErro(''); setAutoCatMsg(null); }} size={560}>
          <div className="modal-body">
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Ex.: crie a categoria <strong>Lubrificante</strong> e as subcategorias <strong>Primeira Linha</strong> e <strong>Segunda Linha</strong>.
              Depois atribua cada produto na coluna "Categoria" da tabela — ou use as regras automáticas abaixo.
            </div>

            {catErro && <div className="alert alert-error">{catErro}</div>}

            {arvoreCategorias.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Nenhuma categoria cadastrada ainda.</div>
            )}
            {arvoreCategorias.map(node => (
              <CatNode key={node.id} node={node} onDelete={deletarCategoria} onAdd={adicionarCategoria} />
            ))}

            <NovaCategoriaRaiz onAdd={adicionarCategoria} />

            <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Regras Automáticas</div>
                <button className="btn btn-ghost btn-sm" onClick={aplicarSugestoes}>
                  ✨ Usar sugestões (Lubrificante/Filtro/Aditivo)
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                Uma regra atribui a categoria automaticamente quando <strong>todas</strong> as palavras aparecem no nome do produto
                (sem diferenciar acento/maiúscula). Ex.: "oleo, lubrax" → Primeira Linha.
              </div>

              {regras.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {regras.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, fontSize: 12 }}>
                        <code style={{ fontSize: 11 }}>{r.palavras.split(',').join(' + ')}</code>
                        {' → '}
                        {r.categoria_pai_nome ? `${r.categoria_pai_nome} › ${r.categoria_nome}` : r.categoria_nome}
                      </span>
                      <button className="btn btn-danger btn-sm" onClick={() => deletarRegra(r.id)} style={{ fontSize: 11 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input placeholder="palavras-chave (separadas por vírgula)…" value={novaRegraPalavras}
                  onChange={e => setNovaRegraPalavras(e.target.value)}
                  style={{ flex: '2 1 160px', fontSize: 12 }} />
                <select value={novaRegraCategoria} onChange={e => setNovaRegraCategoria(e.target.value)} style={{ flex: '1 1 140px', fontSize: 12 }}>
                  <option value="">Categoria…</option>
                  {categoriasFlat.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" onClick={adicionarRegra}>+ Regra</button>
              </div>

              {autoCatMsg && (
                <div className={`alert ${autoCatMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 10 }}>
                  {autoCatMsg.text}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" disabled={autoCatRodando || !regras.length}
                  onClick={() => rodarAutoCategorizar(false)}>
                  {autoCatRodando ? 'Categorizando…' : '🤖 Categorizar Automaticamente (só os sem categoria)'}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={autoCatRodando || !regras.length}
                  title="Reaplica as regras mesmo nos produtos que já têm categoria"
                  onClick={() => rodarAutoCategorizar(true)}>
                  Reaplicar em todos
                </button>
              </div>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-primary" onClick={() => { setCatModalAberto(false); setCatErro(''); setAutoCatMsg(null); }}>Fechar</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function NovaCategoriaRaiz({ onAdd }) {
  const [nome, setNome] = useState('');
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
      <input placeholder="Nova categoria (ex: Lubrificante)…" value={nome}
        onChange={e => setNome(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && nome.trim()) { onAdd(nome); setNome(''); } }}
        style={{ flex: 1, fontSize: 13 }} />
      <button className="btn btn-primary btn-sm" onClick={() => { if (nome.trim()) { onAdd(nome); setNome(''); } }}>
        + Categoria
      </button>
    </div>
  );
}
