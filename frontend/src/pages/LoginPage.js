import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) { navigate('/'); return null; }

  const submit = async e => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login(form.username, form.password); navigate('/'); }
    catch (err) { setError(err.response?.data?.error || 'Erro ao fazer login'); }
    finally { setLoading(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="login-logo">
          <div className="icon">⛽</div>
          <h1>ComissõesPRO</h1>
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
        <div style={{ marginTop: 20, padding: 12, background: 'var(--surface2)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-dim)' }}>Acesso padrão:</strong><br />
          admin / admin123
        </div>
      </div>
    </div>
  );
}
