/**
 * MOTOR DE CÁLCULO DE COMISSÕES v3.0
 *
 * FIX 2: Desqualificados — comissão zerada, motivo exibido no relatório
 *
 * FIX 3: GERENTE — comissão cumulativa:
 *   - Recebe a soma das comissões de TODOS os frentistas e trocadores do posto (por faixa)
 *   - + 3% do total do posto (somente se meta ≥ 100%)
 *   - + comissão especial gerente (por unidades totais do produto no posto)
 *   - + comissões dos itens especiais vendidos pelos funcionários do posto (como gerente)
 *   Se acumula trocador: também recebe comissão de trocador pelas próprias vendas
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

function calcularProRata(periodo) {
  if (periodo.status === 'fechado') {
    return { fator: 1, diasCorridos: null, diasTotais: null, proRata: false };
  }
  var inicio = new Date(periodo.data_inicio);
  var fim    = new Date(periodo.data_fim);
  var hoje   = new Date();
  var diasTotais   = Math.round((fim - inicio) / 86400000) + 1;
  var referencia   = hoje < fim ? hoje : fim;
  var diasCorridos = Math.max(1, Math.round((referencia - inicio) / 86400000) + 1);
  return { fator: diasCorridos / diasTotais, diasCorridos: diasCorridos, diasTotais: diasTotais, proRata: true };
}

/**
 * @param {Array} vendas
 * @param {Array} metas
 * @param {Array} produtosEspeciais
 * @param {Array} periodoFuncionarios
 * @param {Object} periodo
 * @param {Array} desqualificados  — lista de { posto_id, nome, tipo, motivo }
 */
function calcularComissoes(vendas, metas, produtosEspeciais, periodoFuncionarios, periodo, desqualificados) {
  var proRata = calcularProRata(periodo);

  // FIX 2: build desqualificados index { "postoId|nome_lower|tipo": motivo }
  var desqIdx = {};
  if (desqualificados && desqualificados.length) {
    for (var di = 0; di < desqualificados.length; di++) {
      var d = desqualificados[di];
      var dk = d.posto_id + '|' + d.nome.trim().toLowerCase() + '|' + d.tipo;
      desqIdx[dk] = d.motivo || 'Desqualificado';
    }
  }

  // Produtos especiais index
  var especiaisIdx = {};
  for (var pi = 0; pi < produtosEspeciais.length; pi++) {
    var pe = produtosEspeciais[pi];
    var peKey = pe.posto_id + '|' + pe.nome_produto.trim().toLowerCase();
    especiaisIdx[peKey] = pe;
  }

  var metasIdx = {};
  for (var mi = 0; mi < metas.length; mi++) {
    metasIdx[metas[mi].posto_id] = metas[mi];
  }

  var porPosto = {};

  function ensurePosto(postoId) {
    if (!porPosto[postoId]) {
      porPosto[postoId] = {
        frentistas: {},
        trocadores: {},
        gerentes: {},
        totalPosto: 0,
        especialPostoTotais: {}
      };
    }
  }

  function ensureFunc(grupo, nome) {
    if (!grupo[nome]) {
      grupo[nome] = { totalVendas: 0, itensEspeciaisProprios: [] };
    }
  }

  // Pre-seed gerentes from periodoFuncionarios so they appear even with 0 vendas
  // Also build index of gerentes that also accumulate trocador (tipo='ambos' cadastrado como dois registros)
  var gerenteTrocadorIdx = {};
  for (var pfi = 0; pfi < periodoFuncionarios.length; pfi++) {
    var pf = periodoFuncionarios[pfi];
    if (pf.tipo === 'gerente') {
      ensurePosto(pf.posto_id);
      ensureFunc(porPosto[pf.posto_id].gerentes, pf.nome.trim());
    }
    if (pf.tipo === 'trocador') {
      var gtKey = String(pf.posto_id) + '|' + pf.nome.trim().toLowerCase();
      gerenteTrocadorIdx[gtKey] = true;
    }
  }

  // Accumulate vendas
  for (var vi = 0; vi < vendas.length; vi++) {
    var v = vendas[vi];
    ensurePosto(v.posto_id);
    var posto = porPosto[v.posto_id];
    posto.totalPosto += Number(v.valor_final);

    var tipo  = v.tipo_funcionario;
    var grupo = tipo === 'gerente'  ? posto.gerentes
              : tipo === 'trocador' ? posto.trocadores
              : posto.frentistas;

    ensureFunc(grupo, v.funcionario);
    grupo[v.funcionario].totalVendas += Number(v.valor_final);

    var peKey2 = v.posto_id + '|' + v.produto.trim().toLowerCase();
    var pe2    = especiaisIdx[peKey2];
    if (pe2) {
      var qtd = Number(v.quantidade);

      if (!posto.especialPostoTotais[peKey2]) {
        posto.especialPostoTotais[peKey2] = { pe: pe2, quantidadeTotal: 0 };
      }
      posto.especialPostoTotais[peKey2].quantidadeTotal += qtd;

      var comUnitVendedor =
        tipo === 'gerente'  ? Number(pe2.comissao_gerente)  :
        tipo === 'trocador' ? Number(pe2.comissao_trocador) :
                              Number(pe2.comissao_frentista);

      if (comUnitVendedor > 0) {
        grupo[v.funcionario].itensEspeciaisProprios.push({
          produto: v.produto,
          quantidade: qtd,
          comissao_unit: comUnitVendedor,
          comissao_total: qtd * comUnitVendedor
        });
      }
    }
  }

  var resultado = {};

  var postoIds = Object.keys(porPosto);
  for (var postoIdx2 = 0; postoIdx2 < postoIds.length; postoIdx2++) {
    var postoId = postoIds[postoIdx2];
    var dados   = porPosto[postoId];
    var meta    = metasIdx[postoId] || { meta_frentista: 0, meta_trocador: 0, meta_posto: 0 };

    var metaFrentistaEfetiva = Number(meta.meta_frentista) * proRata.fator;
    var metaTrocadorEfetiva  = Number(meta.meta_trocador)  * proRata.fator;
    var metaPostoEfetiva     = Number(meta.meta_posto)     * proRata.fator;

    resultado[postoId] = {
      funcionarios: [],
      totalComissoes: 0,
      totalVendasPosto: dados.totalPosto,
      metaFrentista: Number(meta.meta_frentista),
      metaTrocador:  Number(meta.meta_trocador),
      metaPosto:     Number(meta.meta_posto),
      metaFrentistaEfetiva: metaFrentistaEfetiva,
      metaTrocadorEfetiva:  metaTrocadorEfetiva,
      metaPostoEfetiva:     metaPostoEfetiva,
      proRata:      proRata.proRata,
      fatorProRata: proRata.fator,
      diasCorridos: proRata.diasCorridos,
      diasTotais:   proRata.diasTotais
    };

    var res = resultado[postoId];

    // ── Produtos especiais: comissão do gerente sobre TODOS os itens do posto ──
    var itensEspeciaisGerentePosto = [];
    var totalEspecialGerentePosto  = 0;
    var epKeys = Object.keys(dados.especialPostoTotais);
    for (var ek = 0; ek < epKeys.length; ek++) {
      var entry = dados.especialPostoTotais[epKeys[ek]];
      var comGUnit = Number(entry.pe.comissao_gerente);
      if (comGUnit > 0) {
        var comGTotal = entry.quantidadeTotal * comGUnit;
        itensEspeciaisGerentePosto.push({
          produto: entry.pe.nome_produto,
          quantidade: entry.quantidadeTotal,
          comissao_unit: comGUnit,
          comissao_total: comGTotal
        });
        totalEspecialGerentePosto += comGTotal;
      }
    }

    // Monta set de nomes que são gerentes (para excluir da pool de trocadores)
    var nomesGer = Object.keys(dados.gerentes);
    var nomesGerentesSet = {};
    for (var gsi = 0; gsi < nomesGer.length; gsi++) {
      nomesGerentesSet[nomesGer[gsi].trim().toLowerCase()] = true;
    }

    // ── FRENTISTAS ──────────────────────────────────────────────────────────────
    var totalComissaoFrentistas = 0;
    var totalComissaoTrocadores = 0; // apenas trocadores puros (não-gerentes)

    var nomesFrent = Object.keys(dados.frentistas);
    for (var fi2 = 0; fi2 < nomesFrent.length; fi2++) {
      var nf = nomesFrent[fi2];

      // Se este frentista também é gerente, NÃO entra como linha separada nem na pool
      // (pode ocorrer quando importação salva vendas do gerente como 'frentista'
      //  porque o nome da planilha não bateu com o cadastro em periodo_funcionarios)
      if (nomesGerentesSet[nf.trim().toLowerCase()]) continue;

      var ff = dados.frentistas[nf];
      var pctF = metaFrentistaEfetiva > 0 ? ff.totalVendas / metaFrentistaEfetiva : 0;
      var taxaF = getFaixaFrentista(pctF);
      var comAgrF = ff.totalVendas * taxaF;
      var comEspF = 0;
      for (var ie = 0; ie < ff.itensEspeciaisProprios.length; ie++) {
        comEspF += ff.itensEspeciaisProprios[ie].comissao_total;
      }
      var totF = comAgrF + comEspF;

      var desqKeyF = postoId + '|' + nf.trim().toLowerCase() + '|frentista';
      var desqMotivoF = desqIdx[desqKeyF];
      var isDesqF = !!desqMotivoF;

      res.funcionarios.push({
        nome: nf, tipo: 'frentista',
        totalVendas: ff.totalVendas, metaEfetiva: metaFrentistaEfetiva,
        pctMeta: pctF, taxaComissao: isDesqF ? 0 : taxaF,
        comissaoAgregados: isDesqF ? 0 : comAgrF,
        itensEspeciais: ff.itensEspeciaisProprios,
        comissaoEspeciais: isDesqF ? 0 : comEspF,
        totalComissao: isDesqF ? 0 : totF,
        desqualificado: isDesqF,
        motivoDesqualificacao: desqMotivoF || null,
      });
      res.totalComissoes += isDesqF ? 0 : totF;
      if (!isDesqF) totalComissaoFrentistas += comAgrF;
    }

    // ── TROCADORES PUROS (exclui quem também é gerente) ───────────────────────
    var nomesTroc = Object.keys(dados.trocadores);
    for (var ti2 = 0; ti2 < nomesTroc.length; ti2++) {
      var nt = nomesTroc[ti2];

      // Se este trocador também é gerente, NÃO entra como linha separada nem na pool
      // (será tratado dentro do bloco de gerentes como acumulação própria)
      if (nomesGerentesSet[nt.trim().toLowerCase()]) continue;

      var ft = dados.trocadores[nt];
      var pctT = metaTrocadorEfetiva > 0 ? ft.totalVendas / metaTrocadorEfetiva : 0;
      var taxaT = getFaixaTrocador(pctT);
      var comAgrT = ft.totalVendas * taxaT;
      var comEspT = 0;
      for (var ie2 = 0; ie2 < ft.itensEspeciaisProprios.length; ie2++) {
        comEspT += ft.itensEspeciaisProprios[ie2].comissao_total;
      }
      var totT = comAgrT + comEspT;

      var desqKeyT = postoId + '|' + nt.trim().toLowerCase() + '|trocador';
      var desqMotivoT = desqIdx[desqKeyT];
      var isDesqT = !!desqMotivoT;

      res.funcionarios.push({
        nome: nt, tipo: 'trocador',
        totalVendas: ft.totalVendas, metaEfetiva: metaTrocadorEfetiva,
        pctMeta: pctT, taxaComissao: isDesqT ? 0 : taxaT,
        comissaoAgregados: isDesqT ? 0 : comAgrT,
        itensEspeciais: ft.itensEspeciaisProprios,
        comissaoEspeciais: isDesqT ? 0 : comEspT,
        totalComissao: isDesqT ? 0 : totT,
        desqualificado: isDesqT,
        motivoDesqualificacao: desqMotivoT || null,
      });
      res.totalComissoes += isDesqT ? 0 : totT;
      // Entra na pool da comissão gerencial
      if (!isDesqT) totalComissaoTrocadores += comAgrT;
    }

    // ── GERENTES ────────────────────────────────────────────────────────────────
    var pctPosto       = metaPostoEfetiva > 0 ? dados.totalPosto / metaPostoEfetiva : 0;
    var gerenteAtingiu = pctPosto >= 1.0;

    for (var gi3 = 0; gi3 < nomesGer.length; gi3++) {
      var ng = nomesGer[gi3];
      var fg = dados.gerentes[ng];

      // Se o gerente tem vendas salvas como frentista no banco
      // (ocorre quando nome da planilha não bateu na importação),
      // mescla essas vendas em fg para que sejam contadas corretamente
      if (dados.frentistas[ng]) {
        fg.totalVendas += dados.frentistas[ng].totalVendas;
        // Mescla itens especiais próprios também
        for (var mfi = 0; mfi < dados.frentistas[ng].itensEspeciaisProprios.length; mfi++) {
          fg.itensEspeciaisProprios.push(dados.frentistas[ng].itensEspeciaisProprios[mfi]);
        }
      }

      var desqKeyG = postoId + '|' + ng.trim().toLowerCase() + '|gerente';
      var desqMotivoG = desqIdx[desqKeyG];
      var isDesqG = !!desqMotivoG;

      // 1) Soma das comissões por faixa dos subordinados (frentistas + trocadores PUROS)
      var comissaoSubordinados = totalComissaoFrentistas + totalComissaoTrocadores;

      // 2) 3% do total do posto (se meta atingida)
      var comissaoPercentualPosto = gerenteAtingiu ? dados.totalPosto * 0.03 : 0;

      // 3) Comissão especial gerente (por qtd total de cada produto especial no posto)
      var comEspGerente = totalEspecialGerentePosto;

      // Base gerencial = subordinados + %posto + especiais gerente
      var comissaoGerencialBase = comissaoSubordinados + comissaoPercentualPosto + comEspGerente;

      // ── Acumulação própria como trocador ─────────────────────────────────
      // O gerente que também acumula trocador recebe comissão de trocador pelas suas vendas.
      // CASO 1: importação separou vendas — dados.trocadores[ng] tem as vendas como trocador
      // CASO 2: importação salvou tudo como 'gerente' (funcEspIdx prioriza gerente) —
      //   neste caso usamos fg.totalVendas (todas as vendas do gerente) como base de trocador
      //   desde que ele esteja em periodoFuncionarios como trocador (gerenteTrocadorIdx)
      var vendaTroc   = dados.trocadores[ng] || null;
      var gtIdxKey    = String(postoId) + '|' + ng.trim().toLowerCase();
      var isAmbos     = !!gerenteTrocadorIdx[gtIdxKey];

      var comTrocAcum = 0;
      var itensTroc   = [];
      var comEspTroc  = 0;
      var taxaTrocAcum = 0;
      var pctTrocAcum  = 0;
      var vendasTroc   = 0;

      if (vendaTroc) {
        // Caso 1: tem vendas separadas como trocador
        pctTrocAcum  = metaTrocadorEfetiva > 0 ? vendaTroc.totalVendas / metaTrocadorEfetiva : 0;
        taxaTrocAcum = getFaixaTrocador(pctTrocAcum);
        comTrocAcum  = vendaTroc.totalVendas * taxaTrocAcum;
        itensTroc    = vendaTroc.itensEspeciaisProprios;
        vendasTroc   = vendaTroc.totalVendas;
        for (var ie3 = 0; ie3 < itensTroc.length; ie3++) {
          comEspTroc += itensTroc[ie3].comissao_total;
        }
      } else if (isAmbos && fg.totalVendas > 0) {
        // Caso 2: importação salvou tudo como 'gerente', mas ele é ambos —
        // aplica comissão de trocador sobre TODAS as suas vendas próprias.
        // Os itensEspeciaisProprios foram calculados com comissao_gerente na importação,
        // então recalculamos aqui usando comissao_trocador do produto especial.
        pctTrocAcum  = metaTrocadorEfetiva > 0 ? fg.totalVendas / metaTrocadorEfetiva : 0;
        taxaTrocAcum = getFaixaTrocador(pctTrocAcum);
        comTrocAcum  = fg.totalVendas * taxaTrocAcum;
        vendasTroc   = fg.totalVendas;

        // Recalcula itens especiais com taxa de trocador (não de gerente)
        var itensGer = fg.itensEspeciaisProprios || [];
        itensTroc = [];
        for (var ie3b = 0; ie3b < itensGer.length; ie3b++) {
          var igItem   = itensGer[ie3b];
          var peKeyTroc = String(postoId) + '|' + igItem.produto.trim().toLowerCase();
          var peTroc    = especiaisIdx[peKeyTroc];
          var comTrocUnit = peTroc ? Number(peTroc.comissao_trocador) : igItem.comissao_unit;
          var comTrocTotal = igItem.quantidade * comTrocUnit;
          if (comTrocUnit > 0) {
            itensTroc.push({
              produto: igItem.produto,
              quantidade: igItem.quantidade,
              comissao_unit: comTrocUnit,
              comissao_total: comTrocTotal
            });
            comEspTroc += comTrocTotal;
          }
        }
      }

      // acumulaTrocador é true se tem vendas como trocador OU se é cadastrado como ambos
      var acumulaTrocador = !!(vendaTroc || isAmbos);

      var totTroc = isDesqG ? 0 : (comTrocAcum + comEspTroc);
      var totGer  = isDesqG ? 0 : (comissaoGerencialBase + totTroc);

      res.funcionarios.push({
        nome: ng, tipo: 'gerente',
        totalVendas: dados.totalPosto,
        vendasProprias: fg.totalVendas,
        vendasComoTrocador: vendasTroc,
        metaEfetiva: metaPostoEfetiva,
        pctMeta: pctPosto,
        taxaComissao: gerenteAtingiu ? 0.03 : 0,

        comissaoSubordinados: isDesqG ? 0 : comissaoSubordinados,
        comissaoFrentistasBase: isDesqG ? 0 : totalComissaoFrentistas,
        comissaoTrocadoresBase: isDesqG ? 0 : totalComissaoTrocadores,
        comissaoPercentualPosto: isDesqG ? 0 : comissaoPercentualPosto,

        comissaoAgregados: isDesqG ? 0 : comissaoGerencialBase,
        itensEspeciais: itensEspeciaisGerentePosto,
        comissaoEspeciais: isDesqG ? 0 : comEspGerente,
        totalComissaoGerencial: isDesqG ? 0 : comissaoGerencialBase,

        acumulaTrocador: acumulaTrocador,
        pctTrocadorAcumulado: pctTrocAcum,
        taxaTrocadorAcumulada: taxaTrocAcum,
        comissaoTrocadorAcumulada: isDesqG ? 0 : comTrocAcum,
        itensEspeciaisTrocador: itensTroc,
        comissaoEspeciaisTrocador: isDesqG ? 0 : comEspTroc,
        totalComissaoTrocador: totTroc,

        totalComissao: totGer,
        metaAtingida: gerenteAtingiu,
        semVendas: fg.totalVendas === 0 && !vendaTroc,

        desqualificado: isDesqG,
        motivoDesqualificacao: desqMotivoG || null,
      });
      res.totalComissoes += totGer;
    }

    res.pctMetaPosto = pctPosto;
  }

  return resultado;
}

module.exports = { calcularComissoes: calcularComissoes, getFaixaFrentista: getFaixaFrentista, getFaixaTrocador: getFaixaTrocador, calcularProRata: calcularProRata };
