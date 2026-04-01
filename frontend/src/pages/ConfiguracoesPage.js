import React, { useState, useRef, useEffect } from 'react';

const CONFIG_KEY = 'comissoes_config';

export function getConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { nome: 'ComissõesPRO', logo: null };
    return JSON.parse(raw);
  } catch {
    return { nome: 'ComissõesPRO', logo: null };
  }
}

export function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event('config-updated'));
}

export default function ConfiguracoesPage() {
  const [config, setConfig] = useState(getConfig());
  const [preview, setPreview] = useState(config.logo || null);
  const [nome, setNome] = useState(config.nome || 'ComissõesPRO');
  const [saved, setSaved] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    if (!file.type.includes('png') && !file.type.includes('image/')) {
      alert('Use um arquivo PNG (de preferência sem fundo).');
      return;
    }
    if (file.size > 512 * 1024) {
      alert('A imagem deve ter menos de 512KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const handleSave = () => {
    const next = { nome: nome.trim() || 'ComissõesPRO', logo: preview };
    saveConfig(next);
    setConfig(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleRemoveLogo = () => {
    setPreview(null);
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Configurações</div>
          <div className="topbar-sub">Personalize a identidade visual do sistema</div>
        </div>
        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? '✓ Salvo!' : 'Salvar Configurações'}
        </button>
      </div>

      <div className="page">
        <div className="card" style={{ maxWidth: 600 }}>
          <div className="card-header">
            <div className="card-title">Identidade Visual</div>
          </div>
          <div className="card-body">
            {/* Nome do sistema */}
            <div className="form-group">
              <label>Nome do Sistema</label>
              <input
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex: ComissõesPRO"
                maxLength={40}
              />
              <div className="form-hint">Este nome aparece no menu lateral e na aba do navegador.</div>
            </div>

            {/* Upload logo */}
            <div className="form-group" style={{ marginTop: 24 }}>
              <label>Logo (PNG sem fundo, máx. 512KB)</label>

              {/* Drop zone */}
              <div
                onClick={() => fileRef.current.click()}
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                style={{
                  border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border-light)'}`,
                  borderRadius: 'var(--radius)',
                  padding: 32,
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragOver ? 'var(--accent-glow)' : 'var(--surface2)',
                  transition: 'all 0.15s',
                  marginBottom: 16,
                }}
              >
                {preview ? (
                  <img
                    src={preview}
                    alt="Logo"
                    style={{ maxHeight: 80, maxWidth: 200, objectFit: 'contain', display: 'block', margin: '0 auto 10px' }}
                  />
                ) : (
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🖼</div>
                )}
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {preview ? 'Clique ou arraste para trocar a logo' : 'Clique ou arraste um PNG aqui'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  PNG transparente recomendado
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/*"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])}
              />

              {preview && (
                <button className="btn btn-danger btn-sm" onClick={handleRemoveLogo}>
                  Remover logo
                </button>
              )}
            </div>

            {/* Preview sidebar */}
            <div style={{ marginTop: 28 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Preview — como aparece no menu
              </div>
              <div style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '14px 16px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: preview ? 'transparent' : 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: preview ? undefined : 16,
                  flexShrink: 0,
                  overflow: 'hidden',
                }}>
                  {preview
                    ? <img src={preview} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : '⛽'
                  }
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>
                    {nome || 'ComissõesPRO'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 1 }}>v2.0</div>
                </div>
              </div>
            </div>

            {saved && (
              <div className="alert alert-success" style={{ marginTop: 20 }}>
                ✓ Configurações salvas! O menu lateral será atualizado automaticamente.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
