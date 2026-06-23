import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API } from '../contexts/AuthContext';
import { Spinner } from '../components/ui';

export default function IgnoradosPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [novoProd, setNovoProd] = useState('');
  const [novoFunc, setNovoFunc] = useState('');
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    axios.get(`${API}/ignorados`).then(r => setItems(r.data)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const add = async (tipo, nome, setNome) => {
    if (!nome.trim()) return;
    setSaving(tipo); setError('');
    try {
      await axios.post(`${API}/ignorados`, { tipo, nome: nome.trim() });
      setNome('');
      load();
    } catch (e) { setError(e.response?.data?.error || 'Erro ao adicionar'); }
    finally { setSaving(''); }
  };

  const remove = async (id) => {
    await axios.delete(`${API}/ignorados/${id}`);
    load();
  };

  const produtos     = items.filter(i => i.tipo === 'produto');
  const funcionarios = items.filter(i => i.tipo === 'funcionario');

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Itens Ignorados</div>
          <div className="topbar-sub">Produtos e funcionários excluídos do cálculo de comissões e da importação CSV</div>
        </div>
      </div>

      <div className="page">
        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        {loading ? <Spinner /> : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

            {/* Produtos ignorados */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Produtos Ignorados</div>
              </div>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                <input
                  placeholder="Nome exato do produto…"
                  value={novoProd}
                  onChange={e => setNovoProd(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && add('produto', novoProd, setNovoProd)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={saving === 'produto' || !novoProd.trim()}
                  onClick={() => add('produto', novoProd, setNovoProd)}
                >
                  {saving === 'produto' ? '…' : '+ Adicionar'}
                </button>
              </div>
              {!produtos.length ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Nenhum produto ignorado
                </div>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: '8px 0' }}>
                  {produtos.map(p => (
                    <li key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px', borderBottom: '1px solid var(--border)' }}>
                      <span className="mono" style={{ fontSize: 13 }}>{p.nome}</span>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(p.id)}>Remover</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Funcionários ignorados */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Funcionários Ignorados</div>
              </div>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                <input
                  placeholder="Nome exato do funcionário…"
                  value={novoFunc}
                  onChange={e => setNovoFunc(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && add('funcionario', novoFunc, setNovoFunc)}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={saving === 'funcionario' || !novoFunc.trim()}
                  onClick={() => add('funcionario', novoFunc, setNovoFunc)}
                >
                  {saving === 'funcionario' ? '…' : '+ Adicionar'}
                </button>
              </div>
              {!funcionarios.length ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Nenhum funcionário ignorado
                </div>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: '8px 0' }}>
                  {funcionarios.map(f => (
                    <li key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 20px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13 }}>{f.nome}</span>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(f.id)}>Remover</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

          </div>
        )}
      </div>
    </>
  );
}
