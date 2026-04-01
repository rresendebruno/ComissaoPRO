/**
 * MOTOR DE CÁLCULO DE COMISSÕES v2.1
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
 *   Posto não atingiu meta_posto_prorata → 0% gerencial
 *   Posto atingiu  meta_posto_prorata    → 3% do total vendido do posto
 *
 *   ACUMULAÇÃO: se o gerente também vendeu como trocador (tipo_acumulado = 'trocador'),
 *   ele recebe AMBAS as comissões:
 *     - comissão de trocador sobre suas próprias vendas (usando meta_trocador)
 *     - comissão de gerente (3% do total do posto, se meta atingida)
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
 */
function calcularProRata(periodo) {
  if (periodo.status === 'fechado') {
    return { fator: 1, diasCorridos: null, diasTotais: null, proRata: false };
  }

  const inicio = new Date(periodo.data_inicio);
  const fim    = new Date(periodo.data_fim);
  const hoje   = new Date();

  const diasTotais = Math.round((fim - inicio) / 86400000) + 1;
  const referencia = hoje < fim ? hoje : fim;
  const diasCorridos = Math.max(1, Math.round((referencia - inicio) / 86400000) + 1);
  const fator = diasCorridos / diasTotais;

  return { fator, diasCorridos, diasTotais, proRata: true };
}

/**
 * Calcula comissões completas de um período
 *
 * @param {Array}  vendas              - vendas do período
 * @param {Array}  metas               - [{posto_id, meta_frentista, meta_trocador, meta_posto}]
 * @param {Array}  produtosEspeciais   - [{posto_id, nome_produto, comissao_frentista, ...}]
 * @param {Array}  periodoFuncionarios - [{posto_id, nome, tipo}] gerentes/trocadores cadastrados
 * @param {Object} periodo             - {status, data_inicio, data_fim}
 */
function calcularComissoes(vendas, metas, produtosEspeciais, periodoFuncionarios, periodo) {
  const proRata = calcularProRata(periodo);

  // Índice de produtos especiais
  const especiaisIdx = {};
  for (const pe of produtosEspeciais) {
    especiaisIdx[`${pe.posto_id}|${pe.nome_produto.trim().toLowerCase()}`] = pe;
  }

  // Índice de metas
  const metasIdx = {};
  for (const m of metas) metasIdx[m.posto_id] = m;

  // Índice de tipo cadastrado no período: "posto_id|nome_lower" → tipo
  const funcIdx = {};
  for (const f of periodoFuncionarios) {
    if (!funcIdx[f.posto_id]) funcIdx[f.posto_id] = {};
    funcIdx[f.posto_id][f.nome.trim().toLowerCase()] = f.tipo;
  }

  // Estrutura base por posto → funcionário
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

  // Pré-popular gerentes cadastrados (mesmo sem vendas)
  for (const f of periodoFuncionarios) {
    if (f.tipo === 'gerente') {
      ensurePosto(f.posto_id);
      ensureFunc(porPosto[f.posto_id].gerentes, f.nome.trim());
    }
  }

  // Acumular vendas
  for (const v of vendas) {
    ensurePosto(v.posto_id);
    const posto = porPosto[v.posto_id];
    posto.totalPosto += Number(v.valor_final);

    const tipo  = v.tipo_funcionario;
    const grupo = tipo === 'gerente'  ? posto.gerentes
                : tipo === 'trocador' ? posto.trocadores
                : posto.frentistas;

    ensureFunc(grupo, v.funcionario);
    grupo[v.funcionario].totalVendas += Number(v.valor_final);

    // Itens especiais
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

  // Calcular resultado por posto
  const resultado = {};

  for (const [postoId, dados] of Object.entries(porPosto)) {
    const meta = metasIdx[postoId] || { meta_frentista: 0, meta_trocador: 0, meta_posto: 0 };

    const metaFrentistaEfetiva = Number(meta.meta_frentista) * proRata.fator;
    const metaTrocadorEfetiva  = Number(meta.meta_trocador)  * proRata.fator;
    const metaPostoEfetiva     = Number(meta.meta_posto)     * proRata.fator;

    resultado[postoId] = {
      funcionarios: [],
      totalComissoes: 0,
      totalVendasPosto: dados.totalPosto,
      metaFrentista: Number(meta.meta_frentista),
      metaTrocador:  Number(meta.meta_trocador),
      metaPosto:     Number(meta.meta_posto),
      metaFrentistaEfetiva,
      metaTrocadorEfetiva,
      metaPostoEfetiva,
      proRata: proRata.proRata,
      fatorProRata: proRata.fator,
      diasCorridos: proRata.diasCorridos,
      diasTotais: proRata.diasTotais,
    };

    const res = resultado[postoId];

    // ── FRENTISTAS ──────────────────────────────────────────────────────
    for (const [nome, f] of Object.entries(dados.frentistas)) {
      const pctIndividual = metaFrentistaEfetiva > 0 ? f.totalVendas / metaFrentistaEfetiva : 0;
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

    // ── TROCADORES ──────────────────────────────────────────────────────
    for (const [nome, f] of Object.entries(dados.trocadores)) {
      const pctIndividual = metaTrocadorEfetiva > 0 ? f.totalVendas / metaTrocadorEfetiva : 0;
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

    // ── GERENTES ────────────────────────────────────────────────────────
    // Meta do posto com pro rata
    const pctPosto = metaPostoEfetiva > 0 ? dados.totalPosto / metaPostoEfetiva : 0;
    const gerenteAtingiuMeta = pctPosto >= 1.0;

    for (const [nome, f] of Object.entries(dados.gerentes)) {
      // Comissão gerencial: 3% do total do posto se meta atingida
      const comissaoGerencial    = gerenteAtingiuMeta ? dados.totalPosto * 0.03 : 0;

      // ── ACUMULAÇÃO: verifica se este gerente também aparece como trocador nas vendas ──
      // Buscamos suas vendas no grupo de trocadores (mesmo nome)
      const vendaTrocador = dados.trocadores[nome] || null;
      let comissaoTrocadorAcumulada  = 0;
      let itensEspeciaisTrocador     = [];
      let taxaTrocadorAcumulada      = 0;
      let pctTrocadorAcumulado       = 0;
      let vendasComoTrocador         = 0;

      if (vendaTrocador) {
        pctTrocadorAcumulado      = metaTrocadorEfetiva > 0 ? vendaTrocador.totalVendas / metaTrocadorEfetiva : 0;
        taxaTrocadorAcumulada     = getFaixaTrocador(pctTrocadorAcumulado);
        comissaoTrocadorAcumulada = vendaTrocador.totalVendas * taxaTrocadorAcumulada;
        itensEspeciaisTrocador    = vendaTrocador.itensEspeciais;
        vendasComoTrocador        = vendaTrocador.totalVendas;
      }

      // Especiais do gerente (nas vendas registradas como gerente)
      const comissaoEspeciaisGerente  = f.itensEspeciais.reduce((s, i) => s + i.comissao_total, 0);
      const comissaoEspeciaisTrocador = itensEspeciaisTrocador.reduce((s, i) => s + i.comissao_total, 0);

      const totalComissaoGerencial = comissaoGerencial + comissaoEspeciaisGerente;
      const totalComissaoTrocador  = comissaoTrocadorAcumulada + comissaoEspeciaisTrocador;
      const totalComissao          = totalComissaoGerencial + totalComissaoTrocador;

      res.funcionarios.push({
        nome, tipo: 'gerente',
        // Vendas do gerente (registradas como gerente)
        totalVendas: dados.totalPosto,   // base gerencial = total do posto
        vendasProprias: f.totalVendas,   // o que ele mesmo lançou como gerente
        vendasComoTrocador,              // vendas lançadas como trocador
        metaEfetiva: metaPostoEfetiva,
        pctMeta: pctPosto,
        taxaComissao: gerenteAtingiuMeta ? 0.03 : 0,
        comissaoAgregados: comissaoGerencial,
        itensEspeciais: f.itensEspeciais,
        comissaoEspeciais: comissaoEspeciaisGerente,
        totalComissaoGerencial,
        // Acumulação trocador
        acumulaTrocador: !!vendaTrocador,
        pctTrocadorAcumulado,
        taxaTrocadorAcumulada,
        comissaoTrocadorAcumulada,
        itensEspeciaisTrocador,
        comissaoEspeciaisTrocador,
        totalComissaoTrocador,
        // Total final
        totalComissao,
        metaAtingida: gerenteAtingiuMeta,
        semVendas: f.totalVendas === 0 && !vendaTrocador,
      });
      res.totalComissoes += totalComissao;
    }

    // Gerentes que acumularam como trocadores NÃO devem aparecer duas vezes
    // Remove do grupo de trocadores os nomes que já são gerentes
    // (já somados acima — sem double-count)
    const nomesGerentes = new Set(Object.keys(dados.gerentes).map(n => n));
    for (const nome of nomesGerentes) {
      // Se aparecia como trocador, já foi computado dentro do gerente — desconta do total
      // (o total foi adicionado dentro do loop de trocadores anteriormente — precisamos remover)
      if (dados.trocadores[nome]) {
        // Remover o funcionário já adicionado na lista como 'trocador' com o mesmo nome
        const idx = res.funcionarios.findIndex(f => f.nome === nome && f.tipo === 'trocador');
        if (idx !== -1) {
          res.totalComissoes -= res.funcionarios[idx].totalComissao;
          res.funcionarios.splice(idx, 1);
        }
      }
    }

    res.pctMetaPosto = pctPosto;
  }

  return resultado;
}

module.exports = { calcularComissoes, getFaixaFrentista, getFaixaTrocador, calcularProRata };
