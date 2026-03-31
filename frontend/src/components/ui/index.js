import React from 'react';

export function Modal({ title, onClose, children, footer, size = 520 }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: size }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ text = 'Carregando...' }) {
  return (
    <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      <div style={{ marginBottom: 8 }}>⟳</div>{text}
    </div>
  );
}

export function Empty({ text = 'Nenhum dado encontrado' }) {
  return (
    <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      {text}
    </div>
  );
}

export function ConfirmModal({ title, message, onConfirm, onClose, danger = true }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-body">
        <p style={{ fontSize: 14, color: 'var(--text)' }}>{message}</p>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>Confirmar</button>
      </div>
    </Modal>
  );
}

export function FaixaInfo({ tipo }) {
  const rows = tipo === 'trocador'
    ? [['< 50%', '0%', 'badge-red'], ['50–75%', '5%', 'badge-gray'], ['75–100%', '7%', 'badge-amber'], ['100–150%', '10%', 'badge-blue'], ['≥ 150%', '15%', 'badge-green']]
    : tipo === 'gerente'
    ? [['< 100%', '0%', 'badge-red'], ['≥ 100%', '3% do total posto', 'badge-green']]
    : [['< 50%', '0%', 'badge-red'], ['50–75%', '3%', 'badge-gray'], ['75–100%', '4,5%', 'badge-amber'], ['100–150%', '6%', 'badge-blue'], ['≥ 150%', '10%', 'badge-green']];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {rows.map(([faixa, taxa, cls]) => (
        <span key={faixa} className={`badge ${cls}`}>{faixa} → {taxa}</span>
      ))}
    </div>
  );
}

export function ProgBar({ pct, color }) {
  const c = color || (pct >= 1 ? 'var(--green)' : pct >= 0.75 ? 'var(--amber)' : 'var(--red)');
  return (
    <div className="prog-track" style={{ minWidth: 80 }}>
      <div className="prog-fill" style={{ width: `${Math.min(pct * 100, 100)}%`, background: c }} />
    </div>
  );
}
