import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function getBranding() {
  try {
    const raw = localStorage.getItem('comissoes_config');
    if (!raw) return { nome: 'ComissõesPRO', logo: null };
    return JSON.parse(raw);
  } catch {
    return { nome: 'ComissõesPRO', logo: null };
  }
}

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState(getBranding());

  useEffect(() => {
    document.title = branding.nome || 'ComissõesPRO';
    const handler = () => setBranding(getBranding());
    window.addEventListener('config-updated', handler);
    return () => window.removeEventListener('config-updated', handler);
  }, [branding.nome]);

  if (user) { navigate('/'); return null; }

  const submit = async e => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login(form.username, form.password); navigate('/'); }
    catch (err) { setError(err.response?.data?.error || 'Usuário ou senha inválidos'); }
    finally { setLoading(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="login-logo">
          {branding.logo ? (
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
              <img src={branding.logo} alt="logo" style={{ maxHeight: 56, maxWidth: 180, objectFit: 'contain' }} />
            </div>
          ) : (
            <div className="icon">⛽</div>
          )}
          <h1>{branding.nome || 'ComissõesPRO'}</h1>
          <p>Sistema de Comissionamento</p>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Usuário</label>
            <input autoFocus placeholder="Digite seu usuário" value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Senha</label>
            <input type="password" placeholder="Digite sua senha" value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })} required />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', padding: '10px', marginTop: 4, justifyContent: 'center' }}
            type="submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
