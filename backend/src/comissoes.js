/**
 * MOTOR DE CÁLCULO DE COMISSÕES v5.0
 *
 * REGRAS:
 *
 * FRENTISTA:
 *   comissão por faixa (meta individual) + itens especiais
 *
 * TROCADOR:
 *   comissão por faixa (meta individual) + itens especiais
 *
 * GERENTE:
 *   A) Se vendeu (lançou no cartão como frentista):
 *      → comissão de FRENTISTA pelas próprias vendas (usa meta e faixa de frentista)
 *   B) Se também é trocador de óleo (cadastrado como trocador em periodoFuncionarios):
 *      → comissão de TROCADOR pelas próprias vendas de trocador (usa meta e faixa de trocador)
 *   C) Sempre:
 *      → soma das comissões de faixa de TODOS os subordinados (frentistas + trocadores puros)
 *      → + 3% do total do posto SE meta posto >= 100%
 *      → + itens especiais gerente (comissao_gerente/un × qtd total do posto)
 *
 * CLASSIFICAÇÃO DAS VENDAS:
 *   - tipo_funcionario='gerente' OU cadastrado como gerente → grupo gerentes
 *   - cadastrado como trocador (e não gerente) → trocadores
 *   - tipo_funcionario='trocador' + cadastrado como gerente → vendas trocador do gerente
 *   - demais → frentistas
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
  var inicio       = new Date(periodo.data_inicio);
  var fim          = new Date(periodo.data_fim);
  var hoje         = new Date();
  var diasTotais   = Math.round((fim - inicio) / 86400000) + 1;
  var referencia   = hoje < fim ? hoje : fim;
  var diasCorridos = Math.max(1, Math.round((referencia - inicio) / 86400000) + 1);
  return {
    fator: diasCorridos / diasTotais,
    diasCorridos: diasCorridos,
    diasTotais: diasTotais,
    proRata: true
  };
}

function calcularComissoes(vendas, metas, produtosEspeciais, periodoFuncionarios, periodo, desqualificados) {
  var proRata = calcularProRata(periodo);

  // ── Índices ──────────────────────────────────────────────────────────────
  var desqIdx = {};
  if (desqualificados && desqualificados.length) {
    for (var i = 0; i < desqualificados.length; i++) {
      var dq = desqualificados[i];
      desqIdx[String(dq.posto_id) + '|' + dq.nome.trim().toLowerCase() + '|' + dq.tipo] = dq.motivo || 'Desqualificado';
    }
  }

  var espIdx = {};
  for (var i = 0; i < produtosEspeciais.length; i++) {
    var pe = produtosEspeciais[i];
    espIdx[String(pe.posto_id) + '|' + pe.nome_produto.trim().toLowerCase()] = pe;
  }

  var metasIdx = {};
  for (var i = 0; i < metas.length; i++) {
    metasIdx[String(metas[i].posto_id)] = metas[i];
  }

  // ── Conjuntos do cadastro (periodoFuncionarios) ──────────────────────────
  // gerentesSet:  "postoId|nome_lower" → true   (quem é gerente)
  // tambemTrocSet: "postoId|nome_lower" → true  (gerente que TAMBÉM é trocador)
  // trocPuroSet:  "postoId|nome_lower" → true   (trocador que NÃO é gerente)
  var gerentesSet  = {};
  var tambemTrocSet = {};
  var trocPuroSet   = {};

  for (var i = 0; i < periodoFuncionarios.length; i++) {
    var pf  = periodoFuncionarios[i];
    var pfk = String(pf.posto_id) + '|' + pf.nome.trim().toLowerCase();
    if (pf.tipo === 'gerente') gerentesSet[pfk]  = true;
    if (pf.tipo === 'trocador') tambemTrocSet[pfk] = true; // pode ser gerente também
  }
  for (var k in tambemTrocSet) {
    if (!gerentesSet[k]) trocPuroSet[k] = true;
    // se é gerente E trocador → fica só em tambemTrocSet
  }

  // ── Acumulação de vendas por posto ───────────────────────────────────────
  var porPosto = {};

  function getPosto(sid) {
    if (!porPosto[sid]) {
      porPosto[sid] = {
        frentistas: {},  // nome → { totalVendas, itensEsp }
        trocadores: {},  // nome → { totalVendas, itensEsp }  (trocadores puros)
        gerentes:   {},  // nome → { vendasFrent, vendasTroc, itensEspFrent, itensEspTroc }
        totalPosto: 0,
        espPosto:   {}   // peKey → { pe, qtdTotal }
      };
    }
    return porPosto[sid];
  }

  function getSimple(grupo, nome) {
    if (!grupo[nome]) grupo[nome] = { totalVendas: 0, itensEsp: [] };
    return grupo[nome];
  }

  function getGerente(grupo, nome) {
    if (!grupo[nome]) grupo[nome] = {
      vendasFrent: 0, itensEspFrent: [],
      vendasTroc:  0, itensEspTroc:  []
    };
    return grupo[nome];
  }

  // Pre-seed gerentes cadastrados (aparecem mesmo sem vendas)
  for (var i = 0; i < periodoFuncionarios.length; i++) {
    var pf = periodoFuncionarios[i];
    if (pf.tipo === 'gerente') {
      getGerente(getPosto(String(pf.posto_id)).gerentes, pf.nome.trim());
    }
  }

  // Acumula vendas
  for (var i = 0; i < vendas.length; i++) {
    var v    = vendas[i];
    var sid  = String(v.posto_id);
    var p    = getPosto(sid);
    var nome = v.funcionario;
    var vf   = Number(v.valor_final);
    var qtd  = Number(v.quantidade);
    var tipo = v.tipo_funcionario;

    p.totalPosto += vf;

    var fnKey = sid + '|' + nome.trim().toLowerCase();

    // Decide grupo e subcategoria
    var isGerente   = tipo === 'gerente' || gerentesSet[fnKey];
    var isTrocPuro  = !isGerente && (tipo === 'trocador' || trocPuroSet[fnKey]);
    // isTrocGer: gerente que também é trocador E esta venda específica é de trocador
    // (tipo_funcionario='trocador' na venda)
    var isTrocGer   = isGerente && tipo === 'trocador' && tambemTrocSet[fnKey];

    if (isGerente) {
      var fg = getGerente(p.gerentes, nome);
      if (isTrocGer) {
        // Venda de trocador do gerente
        fg.vendasTroc += vf;
        // item especial com taxa de trocador
        var peT = espIdx[sid + '|' + v.produto.trim().toLowerCase()];
        if (peT) {
          var cu = Number(peT.comissao_trocador);
          if (cu > 0) fg.itensEspTroc.push({ produto: v.produto, quantidade: qtd, comissao_unit: cu, comissao_total: qtd * cu });
        }
      } else {
        // Venda de frentista do gerente
        fg.vendasFrent += vf;
        // item especial com taxa de frentista (ou gerente se configurado assim)
        var peF = espIdx[sid + '|' + v.produto.trim().toLowerCase()];
        if (peF) {
          var cu = Number(peF.comissao_frentista);
          if (cu > 0) fg.itensEspFrent.push({ produto: v.produto, quantidade: qtd, comissao_unit: cu, comissao_total: qtd * cu });
        }
      }
    } else if (isTrocPuro) {
      var ft = getSimple(p.trocadores, nome);
      ft.totalVendas += vf;
      var peT2 = espIdx[sid + '|' + v.produto.trim().toLowerCase()];
      if (peT2) {
        var cu2 = Number(peT2.comissao_trocador);
        if (cu2 > 0) ft.itensEsp.push({ produto: v.produto, quantidade: qtd, comissao_unit: cu2, comissao_total: qtd * cu2 });
      }
    } else {
      var ff = getSimple(p.frentistas, nome);
      ff.totalVendas += vf;
      var peF2 = espIdx[sid + '|' + v.produto.trim().toLowerCase()];
      if (peF2) {
        var cu3 = Number(peF2.comissao_frentista);
        if (cu3 > 0) ff.itensEsp.push({ produto: v.produto, quantidade: qtd, comissao_unit: cu3, comissao_total: qtd * cu3 });
      }
    }

    // Acumula total do produto especial no posto (para comissão gerente)
    var peKey = sid + '|' + v.produto.trim().toLowerCase();
    if (espIdx[peKey]) {
      if (!p.espPosto[peKey]) p.espPosto[peKey] = { pe: espIdx[peKey], qtdTotal: 0 };
      p.espPosto[peKey].qtdTotal += qtd;
    }
  }

  // ── Calcula comissões ────────────────────────────────────────────────────
  var resultado = {};

  var postoIds = Object.keys(porPosto);
  for (var pi = 0; pi < postoIds.length; pi++) {
    var sid   = postoIds[pi];
    var dados = porPosto[sid];
    var meta  = metasIdx[sid] || { meta_frentista: 0, meta_trocador: 0, meta_posto: 0 };

    var mF = Number(meta.meta_frentista) * proRata.fator;
    var mT = Number(meta.meta_trocador)  * proRata.fator;
    var mP = Number(meta.meta_posto)     * proRata.fator;
    var pctPosto = mP > 0 ? dados.totalPosto / mP : 0;

    var res = {
      funcionarios: [],
      totalComissoes: 0,
      totalVendasPosto:      dados.totalPosto,
      metaFrentista:         Number(meta.meta_frentista),
      metaTrocador:          Number(meta.meta_trocador),
      metaPosto:             Number(meta.meta_posto),
      metaFrentistaEfetiva:  mF,
      metaTrocadorEfetiva:   mT,
      metaPostoEfetiva:      mP,
      pctMetaPosto:          pctPosto,
      proRata:               proRata.proRata,
      fatorProRata:          proRata.fator,
      diasCorridos:          proRata.diasCorridos,
      diasTotais:            proRata.diasTotais,
    };
    resultado[sid] = res;

    // Itens especiais gerente (por qtd total do posto)
    var itensEspGer = [];
    var totalEspGer = 0;
    for (var k in dados.espPosto) {
      var entry = dados.espPosto[k];
      var cGU   = Number(entry.pe.comissao_gerente);
      if (cGU > 0) {
        var cGT = entry.qtdTotal * cGU;
        itensEspGer.push({ produto: entry.pe.nome_produto, quantidade: entry.qtdTotal, comissao_unit: cGU, comissao_total: cGT });
        totalEspGer += cGT;
      }
    }

    // ── FRENTISTAS ──────────────────────────────────────────────────────────
    var totalComFrent = 0;
    var nomesFrent    = Object.keys(dados.frentistas);
    for (var fi = 0; fi < nomesFrent.length; fi++) {
      var nome = nomesFrent[fi];
      var ff   = dados.frentistas[nome];
      var pct  = mF > 0 ? ff.totalVendas / mF : 0;
      var taxa = getFaixaFrentista(pct);
      var cF   = ff.totalVendas * taxa;
      var cEsp = 0;
      for (var ii = 0; ii < ff.itensEsp.length; ii++) cEsp += ff.itensEsp[ii].comissao_total;
      var tot  = cF + cEsp;
      var dk   = sid + '|' + nome.trim().toLowerCase() + '|frentista';
      var dm   = desqIdx[dk];
      var isD  = !!dm;

      res.funcionarios.push({
        nome: nome, tipo: 'frentista',
        totalVendas: ff.totalVendas, metaEfetiva: mF, pctMeta: pct,
        taxaComissao:      isD ? 0 : taxa,
        comissaoAgregados: isD ? 0 : cF,
        itensEspeciais:    ff.itensEsp,
        comissaoEspeciais: isD ? 0 : cEsp,
        totalComissao:     isD ? 0 : tot,
        desqualificado: isD, motivoDesqualificacao: dm || null,
      });
      res.totalComissoes += isD ? 0 : tot;
      if (!isD) totalComFrent += cF;
    }

    // ── TROCADORES PUROS ────────────────────────────────────────────────────
    var totalComTroc = 0;
    var nomesTroc    = Object.keys(dados.trocadores);
    for (var ti = 0; ti < nomesTroc.length; ti++) {
      var nome = nomesTroc[ti];
      var ft   = dados.trocadores[nome];
      var pct  = mT > 0 ? ft.totalVendas / mT : 0;
      var taxa = getFaixaTrocador(pct);
      var cF   = ft.totalVendas * taxa;
      var cEsp = 0;
      for (var ii = 0; ii < ft.itensEsp.length; ii++) cEsp += ft.itensEsp[ii].comissao_total;
      var tot  = cF + cEsp;
      var dk   = sid + '|' + nome.trim().toLowerCase() + '|trocador';
      var dm   = desqIdx[dk];
      var isD  = !!dm;

      res.funcionarios.push({
        nome: nome, tipo: 'trocador',
        totalVendas: ft.totalVendas, metaEfetiva: mT, pctMeta: pct,
        taxaComissao:      isD ? 0 : taxa,
        comissaoAgregados: isD ? 0 : cF,
        itensEspeciais:    ft.itensEsp,
        comissaoEspeciais: isD ? 0 : cEsp,
        totalComissao:     isD ? 0 : tot,
        desqualificado: isD, motivoDesqualificacao: dm || null,
      });
      res.totalComissoes += isD ? 0 : tot;
      if (!isD) totalComTroc += cF;
    }

    // ── GERENTES ────────────────────────────────────────────────────────────
    var gerenteAtingiu = pctPosto >= 1.0;
    var nomesGer       = Object.keys(dados.gerentes);

    for (var gi = 0; gi < nomesGer.length; gi++) {
      var nome   = nomesGer[gi];
      var fg     = dados.gerentes[nome];
      var fnKey  = sid + '|' + nome.trim().toLowerCase();
      var isTroc = !!tambemTrocSet[fnKey]; // gerente que também é trocador
      var dk     = sid + '|' + nome.trim().toLowerCase() + '|gerente';
      var dm     = desqIdx[dk];
      var isD    = !!dm;

      // Comissão própria como trocador (se também é trocador)
      var pctT       = 0;
      var taxaT      = 0;
      var comPropT   = 0;
      var comEspT    = 0;
      if (isTroc) {
        // Caso A: vendas separadas no banco (tipo='trocador')
        var vendasTrocCalc = fg.vendasTroc;
        var itensEspTrocCalc = fg.itensEspTroc;

        // Caso B: tudo importado como 'gerente' (tipo='gerente' no banco)
        // Quando tambemTrocador, as vendas vieram como gerente mas devem ser calculadas
        // como trocador pois é o cargo acumulado
        if (vendasTrocCalc === 0 && fg.vendasFrent > 0) {
          vendasTrocCalc   = fg.vendasFrent;
          // Itens especiais precisam ser recalculados com comissao_trocador
          itensEspTrocCalc = [];
          for (var ii = 0; ii < fg.itensEspFrent.length; ii++) {
            var ig   = fg.itensEspFrent[ii];
            var peK  = sid + '|' + ig.produto.trim().toLowerCase();
            var peEn = espIdx[peK];
            var cTU  = peEn ? Number(peEn.comissao_trocador) : 0;
            if (cTU > 0) {
              itensEspTrocCalc.push({ produto: ig.produto, quantidade: ig.quantidade, comissao_unit: cTU, comissao_total: ig.quantidade * cTU });
            }
          }
          // Limpa vendasFrent pois serão contadas como trocador
          fg.vendasFrent = 0;
          fg.itensEspFrent = [];
        }

        pctT     = mT > 0 ? vendasTrocCalc / mT : 0;
        taxaT    = getFaixaTrocador(pctT);
        comPropT = vendasTrocCalc * taxaT;
        fg.vendasTroc    = vendasTrocCalc;
        fg.itensEspTroc  = itensEspTrocCalc;
        for (var ii = 0; ii < itensEspTrocCalc.length; ii++) comEspT += itensEspTrocCalc[ii].comissao_total;
      }

      // Comissão própria como frentista (vendas que não são de trocador)
      var pctF       = mF > 0 ? fg.vendasFrent / mF : 0;
      var taxaF      = getFaixaFrentista(pctF);
      var comPropF   = fg.vendasFrent * taxaF;
      var comEspF    = 0;
      for (var ii = 0; ii < fg.itensEspFrent.length; ii++) comEspF += fg.itensEspFrent[ii].comissao_total;

      // 3% posto (se meta atingida) + especiais gerente + próprias
      // NÃO soma comissões dos subordinados
      var com3P      = gerenteAtingiu ? dados.totalPosto * 0.03 : 0;
      var comEspGer  = isD ? 0 : totalEspGer;
      var comBase    = com3P + comEspGer;

      var totPropF   = isD ? 0 : (comPropF + comEspF);
      var totPropT   = isD ? 0 : (comPropT + comEspT);
      var totGer     = isD ? 0 : (comBase + totPropF + totPropT);

      res.funcionarios.push({
        nome: nome, tipo: 'gerente',
        totalVendas:        dados.totalPosto,
        vendasPropFrentista: fg.vendasFrent,
        vendasPropTrocador:  fg.vendasTroc,
        metaEfetiva:        mP,
        pctMeta:            pctPosto,
        taxaComissao:       gerenteAtingiu ? 0.03 : 0,

        // Próprio como frentista
        pctMetaFrentista:    pctF,
        taxaFrentista:       isD ? 0 : taxaF,
        comissaoPropFrent:   isD ? 0 : comPropF,
        itensEspFrentista:   fg.itensEspFrent,
        comissaoEspFrent:    isD ? 0 : comEspF,
        totalPropFrentista:  totPropF,

        // Próprio como trocador (só se tambemTroc)
        tambemTrocador:      isTroc,
        pctMetaTrocador:     pctT,
        taxaTrocador:        isD ? 0 : taxaT,
        comissaoPropTroc:    isD ? 0 : comPropT,
        itensEspTrocador:    fg.itensEspTroc,
        comissaoEspTroc:     isD ? 0 : comEspT,
        totalPropTrocador:   totPropT,

        // Gerencial
        comissaoPercentualPosto: isD ? 0 : com3P,
        comissaoAgregados:       isD ? 0 : comBase,
        itensEspeciais:          itensEspGer,
        comissaoEspeciais:       comEspGer,
        totalComissaoGerencial:  isD ? 0 : comBase,

        totalComissao:  totGer,
        metaAtingida:   gerenteAtingiu,
        semVendas:      fg.vendasFrent === 0 && fg.vendasTroc === 0,

        desqualificado:        isD,
        motivoDesqualificacao: dm || null,

        // Campos de compatibilidade com frontend existente
        acumulaTrocador:           isTroc,
        comissaoTrocadorAcumulada: isD ? 0 : comPropT,
        itensEspeciaisTrocador:    fg.itensEspTroc,
        comissaoEspeciaisTrocador: isD ? 0 : comEspT,
        totalComissaoTrocador:     totPropT,
        pctTrocadorAcumulado:      pctT,
        taxaTrocadorAcumulada:     taxaT,
      });
      res.totalComissoes += totGer;
    }
  }

  return resultado;
}

module.exports = { calcularComissoes, getFaixaFrentista, getFaixaTrocador, calcularProRata };
