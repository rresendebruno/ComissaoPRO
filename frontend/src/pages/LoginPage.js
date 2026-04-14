import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { API } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState({ nome: 'ComissõesPRO', logo: null });

  // Carrega config do banco (endpoint público via auth — ainda precisa do token,
  // mas na tela de login fazemos sem token e o backend não exige auth para /config GET
  // — ajuste: vamos buscar sem auth header)
  useEffect(() => {
    axios.get(`${API}/config`).then(r => {
      setBranding(r.data);
      document.title = r.data.nome || 'ComissõesPRO';
    }).catch(() => {});

    const handler = (e) => {
      if (e.detail) {
        setBranding(e.detail);
        document.title = e.detail.nome || 'ComissõesPRO';
      }
    };
    window.addEventListener('config-updated', handler);
    return () => window.removeEventListener('config-updated', handler);
  }, []);

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
