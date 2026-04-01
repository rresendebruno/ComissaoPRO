import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getConfig } from '../../pages/ConfiguracoesPage';

const IC = {
  dash: <svg className="icon" viewBox="0 0 20 20" fill="currentColor"><path d="M2 4a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2V4zm9 0a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V4zM2 11a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2v-3zm9 0a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2v-3z"/></svg>,
  periodos: <svg className="icon" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>,
  postos: <svg className="icon" viewBox="0 0 20 20" fill="currentColor"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>,
  comissoes: <svg className="icon" viewBox="0 0 20 20" fill="currentColor"><path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z"/><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd"/></svg>,
  users: <svg className="icon" viewBox="0 0 20 20" fill="currentColor"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>,
  config: <svg className="icon" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/></svg>,
  out: <svg className="icon" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd"/></svg>
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sysConfig, setSysConfig] = useState(getConfig());

  const initials = user?.name?.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase() || '?';

  // Escuta atualizações de config sem recarregar a página
  useEffect(() => {
    const handler = () => setSysConfig(getConfig());
    window.addEventListener('config-updated', handler);
    return () => window.removeEventListener('config-updated', handler);
  }, []);

  // Atualiza o título da aba
  useEffect(() => {
    document.title = sysConfig.nome || 'ComissõesPRO';
  }, [sysConfig.nome]);

  const link = (to, icon, label, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
      {icon} {label}
    </NavLink>
  );

  return (
    <div>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo">
            <div className="logo-icon" style={sysConfig.logo ? { background: 'transparent', padding: 0, overflow: 'hidden' } : {}}>
              {sysConfig.logo
                ? <img src={sysConfig.logo} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : '⛽'
              }
            </div>
            <div>
              <h1>{sysConfig.nome || 'ComissõesPRO'}</h1>
              <p>v2.0</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group">
            <div className="nav-label">Principal</div>
            {link('/', IC.dash, 'Dashboard', true)}
          </div>
          <div className="nav-group">
            <div className="nav-label">Apuração</div>
            {link('/periodos', IC.periodos, 'Períodos')}
            {link('/comissoes', IC.comissoes, 'Comissões')}
          </div>
          <div className="nav-group">
            <div className="nav-label">Cadastros</div>
            {link('/postos', IC.postos, 'Postos')}
            {user?.role === 'admin' && link('/usuarios', IC.users, 'Usuários')}
          </div>
          {user?.role === 'admin' && (
            <div className="nav-group">
              <div className="nav-label">Sistema</div>
              {link('/configuracoes', IC.config, 'Configurações')}
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">{initials}</div>
            <div>
              <div className="user-name">{user?.name?.split(' ').slice(0, 2).join(' ')}</div>
              <div className="user-role">{user?.role === 'admin' ? 'Administrador' : 'Visualizador'}</div>
            </div>
          </div>
          <button className="btn-logout" onClick={() => { logout(); navigate('/login'); }}>
            {IC.out} Sair
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
