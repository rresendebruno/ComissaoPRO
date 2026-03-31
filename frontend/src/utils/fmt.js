export const fmt = (v, dec = 2) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);

export const fmtPct = (v, dec = 1) =>
  v == null ? '—' : `${(v * 100).toFixed(dec)}%`;

export const fmtN = (v) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR').format(v);

export function faixaLabel(pct, tipo) {
  const p = pct * 100;
  if (p >= 150) return { label: '≥150%', color: 'badge-green', taxa: tipo === 'trocador' ? '15%' : tipo === 'gerente' ? '3%' : '10%' };
  if (p >= 100) return { label: '100–150%', color: 'badge-blue', taxa: tipo === 'trocador' ? '10%' : tipo === 'gerente' ? '3%' : '6%' };
  if (p >= 75)  return { label: '75–100%', color: 'badge-amber', taxa: tipo === 'trocador' ? '7%' : '4.5%' };
  if (p >= 50)  return { label: '50–75%', color: 'badge-gray', taxa: tipo === 'trocador' ? '5%' : '3%' };
  return { label: '<50%', color: 'badge-red', taxa: '0%' };
}

export function statusMeta(pct) {
  const p = pct * 100;
  if (p >= 150) return { label: 'Excepcional', color: 'badge-green' };
  if (p >= 100) return { label: 'Meta atingida', color: 'badge-blue' };
  if (p >= 75)  return { label: 'Próximo', color: 'badge-amber' };
  if (p >= 50)  return { label: 'Abaixo', color: 'badge-red' };
  return { label: 'Crítico', color: 'badge-red' };
}
