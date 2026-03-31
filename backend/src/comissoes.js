/**
 * MOTOR DE CÁLCULO DE COMISSÕES v2
 *
 * FRENTISTAS — avaliados individualmente:
 *   < 50%          → 0%
 *   50%  – 75%     → 3%   do valor vendido individual
 *   75%  – 100%    → 4,5% do valor vendido individual
 *   100% – 150%    → 6%   do valor vendido individual
 *   ≥ 150%         → 10%  do valor vendido individual
 *
 * TROCADORES — avaliados individualmente:
 *   < 50%          → 0%
 *   50%  – 75%     → 5%
 *   75%  – 100%    → 7%
 *   100% – 150%    → 10%
 *   ≥ 150%         → 15%
 *
 * GERENTE — avaliado pelo total do posto vs meta_posto (com pro rata):
 *   Posto não atingiu meta_posto_prorata → 0%
 *   Posto atingiu  meta_posto_prorata    → 3% do total vendido do posto
 *   Gerente pode não aparecer nas vendas — é sempre incluído via cadastro do período
 *
 * PRO RATA:
 *   Se período ABERTO: meta efetiva = meta * (dias_corridos / dias_totais)
 *   Se período FECHADO: meta efetiva = meta (100%)
 */

function getFaixaFrentista(pct) {
  if (pct >= 1.50) return 0.10;
  if (pct >= 1.00) return 0.06;
  if (pct >= 0.75) return 0.045;
  if (pct >= 0.50) return 0.03;
  return 0;
}

function getFaixaTrocador(pct) {
  if (pct >= 1.50) return 0.15;
  if (pct >= 1.00) return 0.10;
  if (pct >= 0.75) return 0.07;
  if (pct >= 0.50) return 0.05;
  return 0;
}

/**
 * Calcula o fator pro rata de um período
 * @returns { fator: Number, diasCorridos: Number, diasTotais: Number, proRata: Boolean }
 */
function calcularProRata(periodo) {
  if (periodo.status === 'fechado') {
    return { fator: 1, diasCorridos: null, diasTotais: null, proRata: false };
  }

  const inicio = new Date(periodo.data_inicio);
  const fim    = new Date(periodo.data_fim);
  const hoje   = new Date();

  // dias totais do período (inclusive)
  const diasTotais = Math.round((fim - inicio) / 86400000) + 1;

  // dias corridos até hoje (ou até fim se já passou)
  const referencia = hoje < fim ? hoje : fim;
  const diasCorridos = Math.max(1, Math.round((referencia - inicio) / 86400000) + 1);

  const fator = diasCorridos / diasTotais;

  return { fator, diasCorridos, diasTotais, proRata: true };
}

/**
 * Calcula comissões completas de um período
 *
 * @param {Array}  vendas             - vendas do período
 * @param {Array}  metas              - [{posto_id, meta_frentista, meta_trocador, meta_posto}]
 * @param {Array}  produtosEspeciais  - [{posto_id, nome_produto, comissao_frentista, ...}]
 * @param {Array}  periodoFuncionarios- [{posto_id, nome, tipo}] gerentes/trocadores cadastrados no período
 * @param {Object} periodo            - {status, data_inicio, data_fim}
 */
function calcularComissoes(vendas, metas, produtosEspeciais, periodoFuncionarios, periodo) {
  const proRata = calcularProRata(periodo);

  // índice de produtos especiais
  const especiaisIdx = {};
  for (const pe of produtosEspeciais) {
    especiaisIdx[`${pe.posto_id}|${pe.nome_produto.trim().toLowerCase()}`] = pe;
  }

  // índice de metas
  const metasIdx = {};
  for (const m of metas) metasIdx[m.posto_id] = m;

  // índice de gerentes/trocadores cadastrados no período por posto
  // { posto_id: { "nome": "gerente"|"trocador" } }
  const funcIdx = {};
  for (const f of periodoFuncionarios) {
    if (!funcIdx[f.posto_id]) funcIdx[f.posto_id] = {};
    funcIdx[f.posto_id][f.nome.trim().toLowerCase()] = f.tipo;
  }

  // estrutura base: acumular vendas por posto → funcionário
  const porPosto = {};

  const ensurePosto = (postoId) => {
    if (!porPosto[postoId]) {
      porPosto[postoId] = {
        frentistas: {},
        trocadores: {},
        gerentes: {},
        totalPosto: 0,
      };
    }
  };

  const ensureFunc = (grupo, nome) => {
    if (!grupo[nome]) grupo[nome] = { totalVendas: 0, itensEspeciais: [], vendas: [] };
  };

  // pré-popular gerentes cadastrados no período (mesmo sem vendas)
  for (const f of periodoFuncionarios) {
    if (f.tipo === 'gerente') {
      ensurePosto(f.posto_id);
      ensureFunc(porPosto[f.posto_id].gerentes, f.nome.trim());
    }
  }

  // acumular vendas
  for (const v of vendas) {
    ensurePosto(v.posto_id);
    const posto = porPosto[v.posto_id];
    posto.totalPosto += Number(v.valor_final);

    // tipo vem da tabela (já resolvido na importação)
    const tipo  = v.tipo_funcionario;
    const grupo = tipo === 'gerente' ? posto.gerentes
                : tipo === 'trocador' ? posto.trocadores
                : posto.frentistas;

    ensureFunc(grupo, v.funcionario);
    grupo[v.funcionario].totalVendas += Number(v.valor_final);

    // itens especiais
    const peKey = `${v.posto_id}|${v.produto.trim().toLowerCase()}`;
    if (especiaisIdx[peKey]) {
      const pe = especiaisIdx[peKey];
      const comUnit =
        tipo === 'gerente'  ? Number(pe.comissao_gerente) :
        tipo === 'trocador' ? Number(pe.comissao_trocador) :
                              Number(pe.comissao_frentista);
      grupo[v.funcionario].itensEspeciais.push({
        produto: v.produto,
        quantidade: Number(v.quantidade),
        comissao_unit: comUnit,
        comissao_total: Number(v.quantidade) * comUnit,
      });
    }
  }

  // calcular resultado por posto
  const resultado = {};

  for (const [postoId, dados] of Object.entries(porPosto)) {
    const meta = metasIdx[postoId] || { meta_frentista: 0, meta_trocador: 0, meta_posto: 0 };

    // metas efetivas com pro rata
    const metaFrentistaEfetiva = Number(meta.meta_frentista) * proRata.fator;
    const metaTrocadorEfetiva  = Number(meta.meta_trocador)  * proRata.fator;
    const metaPostoEfetiva     = Number(meta.meta_posto)     * proRata.fator;

    resultado[postoId] = {
      funcionarios: [],
      totalComissoes: 0,
      totalVendasPosto: dados.totalPosto,
      // metas originais
      metaFrentista: Number(meta.meta_frentista),
      metaTrocador:  Number(meta.meta_trocador),
      metaPosto:     Number(meta.meta_posto),
      // metas efetivas (com pro rata se aberto)
      metaFrentistaEfetiva,
      metaTrocadorEfetiva,
      metaPostoEfetiva,
      // info pro rata
      proRata: proRata.proRata,
      fatorProRata: proRata.fator,
      diasCorridos: proRata.diasCorridos,
      diasTotais: proRata.diasTotais,
    };

    const res = resultado[postoId];

    // ── FRENTISTAS (avaliação individual) ──────────────────────────────
    for (const [nome, f] of Object.entries(dados.frentistas)) {
      const pctIndividual = metaFrentistaEfetiva > 0
        ? f.totalVendas / metaFrentistaEfetiva
        : 0;
      const taxa = getFaixaFrentista(pctIndividual);
      const comissaoAgregados = f.totalVendas * taxa;
      const comissaoEspeciais = f.itensEspeciais.reduce((s, i) => s + i.comissao_total, 0);
      const totalComissao     = comissaoAgregados + comissaoEspeciais;

      res.funcionarios.push({
        nome, tipo: 'frentista',
        totalVendas: f.totalVendas,
        metaEfetiva: metaFrentistaEfetiva,
        pctMeta: pctIndividual,
        taxaComissao: taxa,
        comissaoAgregados,
        itensEspeciais: f.itensEspeciais,
        comissaoEspeciais,
        totalComissao,
      });
      res.totalComissoes += totalComissao;
    }

    // ── TROCADORES (avaliação individual) ──────────────────────────────
    for (const [nome, f] of Object.entries(dados.trocadores)) {
      const pctIndividual = metaTrocadorEfetiva > 0
        ? f.totalVendas / metaTrocadorEfetiva
        : 0;
      const taxa = getFaixaTrocador(pctIndividual);
      const comissaoAgregados = f.totalVendas * taxa;
      const comissaoEspeciais = f.itensEspeciais.reduce((s, i) => s + i.comissao_total, 0);
      const totalComissao     = comissaoAgregados + comissaoEspeciais;

      res.funcionarios.push({
        nome, tipo: 'trocador',
        totalVendas: f.totalVendas,
        metaEfetiva: metaTrocadorEfetiva,
        pctMeta: pctIndividual,
        taxaComissao: taxa,
        comissaoAgregados,
        itensEspeciais: f.itensEspeciais,
        comissaoEspeciais,
        totalComissao,
      });
      res.totalComissoes += totalComissao;
    }

    // ── GERENTE (avaliação pelo total do posto) ────────────────────────
    // meta do posto com pro rata
    const pctPosto = metaPostoEfetiva > 0
      ? dados.totalPosto / metaPostoEfetiva
      : 0;
    const gerenteAtingiuMeta = pctPosto >= 1.0;

    for (const [nome, f] of Object.entries(dados.gerentes)) {
      // comissão base: 3% do total do posto SE meta atingida
      const comissaoAgregados = gerenteAtingiuMeta ? dados.totalPosto * 0.03 : 0;
      // itens especiais que ele mesmo vendeu (pode ser 0 se não aparece nas vendas)
      const comissaoEspeciais = f.itensEspeciais.reduce((s, i) => s + i.comissao_total, 0);
      const totalComissao     = comissaoAgregados + comissaoEspeciais;

      res.funcionarios.push({
        nome, tipo: 'gerente',
        totalVendas: dados.totalPosto,   // base = total do posto
        metaEfetiva: metaPostoEfetiva,
        pctMeta: pctPosto,
        taxaComissao: gerenteAtingiuMeta ? 0.03 : 0,
        comissaoAgregados,
        itensEspeciais: f.itensEspeciais,
        comissaoEspeciais,
        totalComissao,
        metaAtingida: gerenteAtingiuMeta,
        semVendas: f.totalVendas === 0,  // gerente que não apareceu nas vendas
      });
      res.totalComissoes += totalComissao;
    }

    res.pctMetaPosto = pctPosto;
  }

  return resultado;
}

module.exports = { calcularComissoes, getFaixaFrentista, getFaixaTrocador, calcularProRata };
