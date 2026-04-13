/** Converte qualquer valor (string ou number) para Number de forma segura */
const toN = (v) => (v == null ? 0 : Number(v) || 0);

/** Formata valor monetário (R$) */
export const fmt = (v, dec = 2) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  }).format(toN(v));

/** Formata percentual */
export const fmtPct = (v, dec = 1) =>
  v == null ? '—' : `${(toN(v) * 100).toFixed(dec)}%`;

/** Formata número inteiro ou com decimais (sem símbolo) */
export const fmtN = (v) =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR').format(toN(v));

/**
 * Formata quantidade de litros/unidades.
 * Remove zeros desnecessários mas mantém até 3 casas quando relevante.
 * Ex: '39.900' → '39,9' | '1.300' → '1,3' | '2.500' → '2,5' | '1.000' → '1'
 */
export const fmtQ = (v) => {
  if (v == null) return '—';
  const n = toN(v);
  // até 3 casas decimais, sem zeros à direita
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(n);
};

/**
 * Soma segura para arrays — garante que strings do PostgreSQL
 * sejam convertidas para Number antes de somar (evita concatenação).
 * Uso: somaSegura(array, f => f.totalVendas)
 */
export const somaSegura = (arr, fn) =>
  arr.reduce((s, item) => s + toN(fn(item)), 0);

export function faixaLabel(pct, tipo) {
  const p = toN(pct) * 100;
  if (p >= 150) return { label: '≥150%', color: 'badge-green', taxa: tipo === 'trocador' ? '15%' : tipo === 'gerente' ? '3%' : '10%' };
  if (p >= 100) return { label: '100–150%', color: 'badge-blue', taxa: tipo === 'trocador' ? '10%' : tipo === 'gerente' ? '3%' : '6%' };
  if (p >= 75)  return { label: '75–100%', color: 'badge-amber', taxa: tipo === 'trocador' ? '7%' : '4.5%' };
  if (p >= 50)  return { label: '50–75%', color: 'badge-gray', taxa: tipo === 'trocador' ? '5%' : '3%' };
  return { label: '<50%', color: 'badge-red', taxa: '0%' };
}

export function statusMeta(pct) {
  const p = toN(pct) * 100;
  if (p >= 150) return { label: 'Excepcional', color: 'badge-green' };
  if (p >= 100) return { label: 'Meta atingida', color: 'badge-blue' };
  if (p >= 75)  return { label: 'Próximo', color: 'badge-amber' };
  if (p >= 50)  return { label: 'Abaixo', color: 'badge-red' };
  return { label: 'Crítico', color: 'badge-red' };
}
