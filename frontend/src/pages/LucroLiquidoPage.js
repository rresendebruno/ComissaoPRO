import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { API } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';
import { Spinner } from '../components/ui';
import { fmt } from '../utils/fmt';

const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const labelMes = (mes) => {
  const [y, m] = mes.split('-');
  return `${MESES_PT[parseInt(m)-1]} ${y}`;
};

const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const diasDoMes = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => {
    const d = String(i+1).padStart(2,'0');
    return `${y}-${String(m).padStart(2,'0')}-${d}`;
  });
};

// Constrói árvore a partir de lista flat
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

// Renderiza nó de categoria recursivamente
function CatNode({ node, onDelete, onAdd, nivel = 0 }) {
  const [expandido, setExpandido] = useState(true);
  const [addNome, setAddNome] = useState('');
  const [adicionando, setAdicionando] = useState(false);

  return (
    <div style={{ marginLeft: nivel * 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
        {node.filhos.length > 0 && (
          <button className="btn btn-ghost btn-sm" style={{ padding: '2px 4px', fontSize: 10 }}
            onClick={() => setExpandido(!expandido)}>{expandido ? '▾' : '▸'}</button>
        )}
        {!node.filhos.length && <span style={{ width: 22 }} />}
        <span style={{ flex: 1, fontSize: 13, fontWeight: nivel === 0 ? 700 : 500 }}>{node.nome}</span>
        <button className="btn btn-ghost btn-sm" title="Adicionar subcategoria"
          onClick={() => setAdicionando(!adicionando)} style={{ fontSize: 11 }}>+ Sub</button>
        <button className="btn btn-danger btn-sm" onClick={() => onDelete(node.id)} style={{ fontSize: 11 }}>✕</button>
      </div>

      {adicionando && (
        <div style={{ display: 'flex', gap: 8, marginLeft: 22, padding: '6px 0' }}>
          <input placeholder="Nome da subcategoria…" value={addNome}
            onChange={e => setAddNome(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { onAdd(addNome, node.id); setAddNome(''); setAdicionando(false); } }}
            style={{ flex: 1, fontSize: 12 }} autoFocus />
          <button className="btn btn-primary btn-sm" onClick={() => { onAdd(addNome, node.id); setAddNome(''); setAdicionando(false); }}>
            OK
          </button>
        </div>
      )}

      {expandido && node.filhos.map(f => (
        <CatNode key={f.id} node={f} onDelete={onDelete} onAdd={onAdd} nivel={nivel+1} />
      ))}
    </div>
  );
}

export default function LucroLiquidoPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const fileRef = useRef();

  const [aba, setAba] = useState('mensal');

  // ── Visão Mensal ────────────────────────────────────────────────────────────
  const [meses, setMeses]         = useState([]);
  const [mesSel, setMesSel]       = useState(null);
  const [dados, setDados]         = useState(null);
  const [loadingMes, setLoadingMes] = useState(true);

  // ── Import ─────────────────────────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState(null);

  // ── Categorias ─────────────────────────────────────────────────────────────
  const [cats, setCats]           = useState([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [novaRaiz, setNovaRaiz]   = useState('');

  // ── Produtos ────────────────────────────────────────────────────────────────
  const [produtos, setProdutos]   = useState([]);
  const [loadingProd, setLoadingProd] = useState(false);
  const [catSel, setCatSel]       = useState({});   // prodId → catId

  // ── Manutenção ──────────────────────────────────────────────────────────────
  const [postosLista, setPostosLista] = useState([]);
  const [manData, setManData]         = useState('');
  const [manPosto, setManPosto]       = useState('');
  const [manCount, setManCount]       = useState(null);
  const [manMsg, setManMsg]           = useState(null);

  // ── Carregamentos ──────────────────────────────────────────────────────────

  const carregarMeses = useCallback(() => {
    axios.get(`${API}/lucro-liquido/meses`).then(r => {
      setMeses(r.data);
      if (r.data.length && !mesSel) setMesSel(r.data[0]);
      else if (!r.data.length) setLoadingMes(false);
    });
  }, [mesSel]);

  useEffect(() => { carregarMeses(); }, []);

  useEffect(() => {
    if (!mesSel) return;
    setLoadingMes(true); setDados(null);
    axios.get(`${API}/lucro-liquido?mes=${mesSel}`)
      .then(r => setDados(r.data))
      .finally(() => setLoadingMes(false));
  }, [mesSel]);

  const carregarCats = () => {
    setLoadingCats(true);
    axios.get(`${API}/lucro-liquido/categorias`)
      .then(r => setCats(r.data))
      .finally(() => setLoadingCats(false));
  };

  const carregarProdutos = () => {
    setLoadingProd(true);
    axios.get(`${API}/lucro-liquido/produtos`)
      .then(r => {
        setProdutos(r.data);
        const init = {};
        r.data.forEach(p => { init[p.id] = p.categoria_id || ''; });
        setCatSel(init);
      })
      .finally(() => setLoadingProd(false));
  };

  useEffect(() => {
    if (aba === 'categorias') carregarCats();
    if (aba === 'produtos')   { carregarCats(); carregarProdutos(); }
    if (aba === 'manutencao') {
      axios.get(`${API}/postos`).then(r => setPostosLista(r.data));
    }
  }, [aba]);

  useEffect(() => {
    if (!manData || !manPosto) { setManCount(null); return; }
    axios.get(`${API}/lucro-liquido/manutencao/contagem?data=${manData}&posto_id=${manPosto}`)
      .then(r => setManCount(r.data.count));
  }, [manData, manPosto]);

  const excluirDiaPosto = async () => {
    if (!manData || !manPosto) return;
    const posto = postosLista.find(p => String(p.id) === manPosto);
    if (!window.confirm(`Excluir ${manCount} registro(s) de ${fmtDate(manData)} do posto ${posto?.codigo}?`)) return;
    const r = await axios.delete(`${API}/lucro-liquido/manutencao?data=${manData}&posto_id=${manPosto}`);
    setManMsg({ ok: true, text: `${r.data.removidos} registro(s) removido(s).` });
    setManCount(0);
    carregarMeses();
  };

  // ── Importar ───────────────────────────────────────────────────────────────

  const handleImport = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    e.target.value = '';
    setImporting(true); setImportMsg(null);
    const fd = new FormData();
    files.forEach(f => fd.append('arquivo', f));
    try {
      const r = await axios.post(`${API}/lucro-liquido/importar`, fd);
      setImportMsg({ ok: true, text: r.data.message });
      carregarMeses();
      if (r.data.meses?.[0]) setMesSel(r.data.meses[0]);
    } catch(ex) {
      setImportMsg({ ok: false, text: ex.response?.data?.error || 'Erro ao importar' });
    } finally { setImporting(false); }
  };

  // ── Categorias CRUD ────────────────────────────────────────────────────────

  const adicionarCat = async (nome, paiId = null) => {
    if (!nome?.trim()) return;
    await axios.post(`${API}/lucro-liquido/categorias`, { nome: nome.trim(), pai_id: paiId });
    carregarCats();
  };

  const deletarCat = async (id) => {
    if (!window.confirm('Excluir esta categoria e todas as subcategorias?')) return;
    await axios.delete(`${API}/lucro-liquido/categorias/${id}`);
    carregarCats();
  };

  // ── Atribuir categoria a produto ───────────────────────────────────────────

  const salvarCategoriaProd = async (prodId, catId) => {
    setCatSel(prev => ({ ...prev, [prodId]: catId }));
    await axios.put(`${API}/lucro-liquido/produtos/${prodId}`, { categoria_id: catId || null });
  };

  // ── Renderiza ──────────────────────────────────────────────────────────────

  const dias = mesSel ? diasDoMes(mesSel) : [];
  const postos = dados?.postos || [];
  const diasMap = dados?.diasMap || {};
  const totaisPosto = dados?.totaisPosto || {};
  const totalGeral = postos.reduce((s, p) => s + (totaisPosto[p.id] || 0), 0);

  const tree = buildTree(cats);

  // Lista flat de cats para select nos produtos
  const catFlat = [];
  const flattenCat = (node, prefix = '') => {
    catFlat.push({ id: node.id, label: prefix + node.nome });
    node.filhos?.forEach(f => flattenCat(f, prefix + node.nome + ' › '));
  };
  tree.forEach(r => flattenCat(r));

  const semCategoria = produtos.filter(p => !p.categoria_id);
  const comCategoria = produtos.filter(p => p.categoria_id);

  return (
    <>
      <div className="topbar no-print">
        <div>
          <div className="topbar-title">Lucro Bruto</div>
          <div className="topbar-sub">Resultado diário por posto</div>
        </div>
        <div className="flex items-center gap-8">
          {isAdmin && (
            <>
              <button className="btn btn-primary btn-sm" disabled={importing}
                onClick={() => fileRef.current?.click()}>
                {importing ? 'Importando…' : '📂 Importar CSV'}
              </button>
              <input ref={fileRef} type="file" accept=".csv" multiple
                style={{ display: 'none' }} onChange={handleImport} />
            </>
          )}
          {aba === 'mensal' && (
            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
              🖨️ Exportar PDF
            </button>
          )}
        </div>
      </div>

      <div className="page">
        {importMsg && (
          <div className={`alert ${importMsg.ok ? 'alert-success' : 'alert-error'} no-print`}
            style={{ marginBottom: 16 }}>
            {importMsg.text}
          </div>
        )}

        {/* Abas principais */}
        <div className="tabs no-print" style={{ marginBottom: 16 }}>
          {[
            ['mensal',     '📅 Visão Mensal'],
            ['produtos',   '📦 Produtos'],
            ['categorias', '🗂️ Categorias'],
            ...(isAdmin ? [['manutencao', '🔧 Manutenção']] : []),
          ].map(([a, label]) => (
            <button key={a} className={`tab${aba === a ? ' active' : ''}`} onClick={() => setAba(a)}>
              {label}
            </button>
          ))}
        </div>

        {/* ── ABA: Visão Mensal ── */}
        {aba === 'mensal' && (
          <>
            {!meses.length && !loadingMes && (
              <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Nenhum dado importado ainda</div>
                {isAdmin && <div style={{ fontSize: 13 }}>Clique em "Importar CSV" para começar.</div>}
              </div>
            )}

            {meses.length > 0 && (
              <div className="tabs no-print" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                {meses.map(m => (
                  <button key={m} className={`tab${mesSel === m ? ' active' : ''}`}
                    onClick={() => setMesSel(m)}>{labelMes(m)}</button>
                ))}
              </div>
            )}

            {loadingMes && meses.length > 0 && <Spinner />}

            {!loadingMes && dados && (
              <div className="card" style={{ overflowX: 'auto' }}>
                {/* Cabeçalho visível apenas no PDF */}
                <div className="ll-print-header">
                  <div>
                    <div className="ll-ph-title">Lucro Líquido</div>
                    <div className="ll-ph-sub">{mesSel ? labelMes(mesSel) : ''}</div>
                  </div>
                  <div className="ll-ph-meta">
                    Emitido em {new Date().toLocaleDateString('pt-BR')}
                  </div>
                </div>
                <div className="table-wrap">
                  <table style={{ fontSize: 11, minWidth: 'max-content' }}>
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 2, minWidth: 100 }}>DATA</th>
                        {postos.map(p => (
                          <th key={p.id} className="text-right" style={{ minWidth: 110 }}>{p.codigo}</th>
                        ))}
                        <th className="text-right" style={{ minWidth: 120, fontWeight: 800 }}>TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dias.map(dia => {
                        const vals = diasMap[dia] || {};
                        const totalDia = postos.reduce((s, p) => s + (vals[p.id] || 0), 0);
                        const temDado = postos.some(p => (vals[p.id] || 0) !== 0);
                        return (
                          <tr key={dia}
                            className={temDado ? '' : 'll-row-vazio'}
                            style={{ opacity: temDado ? 1 : 0.4 }}>
                            <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', fontWeight: 600 }}>
                              {fmtDate(dia)}
                            </td>
                            {postos.map(p => (
                              <td key={p.id} className="text-right mono">
                                {vals[p.id] ? fmt(vals[p.id]) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                              </td>
                            ))}
                            <td className="text-right mono" style={{ fontWeight: 700 }}>
                              {temDado ? fmt(totalDia) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)', fontWeight: 800 }}>
                        <td style={{ position: 'sticky', left: 0, background: 'var(--surface2)', padding: '8px 12px' }}>TOTAL</td>
                        {postos.map(p => (
                          <td key={p.id} className="text-right mono">{fmt(totaisPosto[p.id] || 0)}</td>
                        ))}
                        <td className="text-right mono">{fmt(totalGeral)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── ABA: Categorias ── */}
        {aba === 'categorias' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title">Árvore de Categorias</div>
            </div>
            <div style={{ padding: '12px 20px 6px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <input placeholder="Nova categoria raiz…" value={novaRaiz}
                onChange={e => setNovaRaiz(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { adicionarCat(novaRaiz); setNovaRaiz(''); } }}
                style={{ flex: 1 }} />
              <button className="btn btn-primary btn-sm"
                disabled={!novaRaiz.trim()}
                onClick={() => { adicionarCat(novaRaiz); setNovaRaiz(''); }}>
                + Adicionar
              </button>
            </div>
            <div style={{ padding: '8px 20px' }}>
              {loadingCats ? <Spinner /> : !tree.length ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Nenhuma categoria cadastrada ainda
                </div>
              ) : tree.map(node => (
                <CatNode key={node.id} node={node} onDelete={deletarCat} onAdd={adicionarCat} />
              ))}
            </div>
          </div>
        )}

        {/* ── ABA: Produtos ── */}
        {aba === 'produtos' && (
          <>
            {semCategoria.length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <div>
                    <div className="card-title">Sem Categoria</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{semCategoria.length} produto(s) aguardando categorização</div>
                  </div>
                </div>
                {loadingProd ? <Spinner /> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Produto</th><th style={{ minWidth: 260 }}>Categoria</th></tr>
                      </thead>
                      <tbody>
                        {semCategoria.map(p => (
                          <tr key={p.id}>
                            <td style={{ fontSize: 13 }}>{p.nome}</td>
                            <td>
                              <select value={catSel[p.id] || ''}
                                onChange={e => salvarCategoriaProd(p.id, e.target.value)}
                                style={{ width: '100%', fontSize: 12 }}>
                                <option value="">— Selecione —</option>
                                {catFlat.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {comCategoria.length > 0 && (
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Produtos Categorizados</div>
                </div>
                {loadingProd ? <Spinner /> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Produto</th><th>Categoria</th><th style={{ minWidth: 260 }}>Alterar</th></tr>
                      </thead>
                      <tbody>
                        {comCategoria.map(p => (
                          <tr key={p.id}>
                            <td style={{ fontSize: 13 }}>{p.nome}</td>
                            <td>
                              <span className="badge badge-blue" style={{ fontSize: 11 }}>
                                {p.pai_nome ? `${p.pai_nome} › ` : ''}{p.categoria_nome}
                              </span>
                            </td>
                            <td>
                              <select value={catSel[p.id] || ''}
                                onChange={e => salvarCategoriaProd(p.id, e.target.value)}
                                style={{ width: '100%', fontSize: 12 }}>
                                <option value="">— Remover categoria —</option>
                                {catFlat.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {!loadingProd && !produtos.length && (
              <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 13 }}>Importe um CSV para ver os produtos aqui.</div>
              </div>
            )}
          </>
        )}

        {/* ── ABA: Manutenção ── */}
        {aba === 'manutencao' && isAdmin && (
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="card-header">
              <div>
                <div className="card-title">Excluir registros por dia e posto</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Remove todos os itens de lucro bruto de um dia específico para um posto
                </div>
              </div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {manMsg && (
                <div className={`alert ${manMsg.ok ? 'alert-success' : 'alert-error'}`}>
                  {manMsg.text}
                </div>
              )}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Data</label>
                <input type="date" value={manData}
                  onChange={e => { setManData(e.target.value); setManMsg(null); }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Posto</label>
                <select value={manPosto}
                  onChange={e => { setManPosto(e.target.value); setManMsg(null); }}>
                  <option value="">Selecione o posto…</option>
                  {postosLista.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} — {p.nome}{!p.ativo ? ' (inativo)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {manCount !== null && manData && manPosto && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, fontSize: 13,
                  background: manCount > 0 ? 'rgba(239,68,68,0.08)' : 'var(--surface2)',
                  border: `1px solid ${manCount > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                  color: manCount > 0 ? '#ef4444' : 'var(--text-muted)',
                }}>
                  {manCount > 0
                    ? `⚠️ ${manCount} registro(s) serão removidos permanentemente`
                    : '✓ Nenhum registro encontrado para esta seleção'}
                </div>
              )}

              <button className="btn btn-danger"
                disabled={!manData || !manPosto || !manCount}
                onClick={excluirDiaPosto}
                style={{ alignSelf: 'flex-start' }}>
                🗑️ Excluir registros
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
