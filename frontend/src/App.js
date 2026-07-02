import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PeriodosPage from './pages/PeriodosPage';
import PeriodoDetailPage from './pages/PeriodoDetailPage';
import ComissoesPage from './pages/ComissoesPage';
import PostosPage from './pages/PostosPage';
import PostoDetailPage from './pages/PostoDetailPage';
import UsuariosPage from './pages/UsuariosPage';
import ConfiguracoesPage from './pages/ConfiguracoesPage';
import RelatoriosPage from './pages/RelatoriosPage';
import RelatorioFinanceiroPage from './pages/RelatorioFinanceiroPage';
import IgnoradosPage from './pages/IgnoradosPage';
import LucroLiquidoPage from './pages/LucroLiquidoPage';
import AnaliseLLPage from './pages/AnaliseLLPage';

function Guard({ children, admin }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)', fontSize: 13 }}>
      Carregando...
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Guard><Layout /></Guard>}>
            <Route index element={<DashboardPage />} />
            <Route path="lucro-liquido" element={<LucroLiquidoPage />} />
            <Route path="analise-ll" element={<AnaliseLLPage />} />
            <Route path="periodos" element={<PeriodosPage />} />
            <Route path="periodos/:id" element={<PeriodoDetailPage />} />
            <Route path="comissoes" element={<ComissoesPage />} />
            <Route path="relatorios" element={<RelatoriosPage />} />
            <Route path="relatorio-financeiro" element={<RelatorioFinanceiroPage />} />
            <Route path="postos" element={<PostosPage />} />
            <Route path="postos/:id" element={<PostoDetailPage />} />
            <Route path="usuarios" element={<Guard admin><UsuariosPage /></Guard>} />
            <Route path="configuracoes" element={<Guard admin><ConfiguracoesPage /></Guard>} />
            <Route path="ignorados" element={<Guard admin><IgnoradosPage /></Guard>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
