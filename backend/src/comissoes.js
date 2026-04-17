/**
 * MOTOR DE CÁLCULO DE COMISSÕES v5.5
 *
 * FIX v5.5:
 * - Gerente: expõe itensEspFrentista (itens especiais que ele próprio vendeu
 *   como frentista) separado de itensEspeciais (itens gerenciais do posto divididos).
 */

// ── Helpers de precisão ───────────────────────────────────────────────────────

function N(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  var s = String(v).trim().replace(/[R$\s]/g, '');
  return Number(s) || 0;
}

function n2(v)     { return Math.round(N(v) * 100) / 100; }
function n3(v)     { return Math.round(N(v) * 1000) / 1000; }
function add2(a,b) { return Math.round((N(a) + N(b)) * 100) / 100; }
function add3(a,b) { return Math.round((N(a) + N(b)) * 1000) / 1000; }
function mul2(a,b) { return Math.round(N(a) * N(b) * 100) / 100; }
function div2(a,b) { return b === 0 ? 0 : Math.round((N(a) / N(b)) * 100) / 100; }

// ── Faixas de comissão ────────────────────────────────────────────────────────

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

// ── Pro rata ──────────────────────────────────────────────────────────────────

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
    proRata: true,
  };
}

// ── Motor principal ───────────────────────────────────────────────────────────

function calcularComissoes(vendas, metas, produtosEspeciais, periodoFuncionarios, periodo, desqualificados) {
  var proRata = calcularProRata(periodo);

  // ── Índices ───────────────────────────────────────────────────────────────
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

  // ── Conjuntos do cadastro ─────────────────────────────────────────────────
  var gerentesSet   = {};
  var tambemTrocSet = {};
  var trocPuroSet   = {};

  for (var i = 0; i < periodoFuncionarios.length; i++) {
    var pf  = periodoFuncionarios[i];
    var pfk = String(pf.posto_id) + '|' + pf.nome.trim().toLowerCase();
    if (pf.tipo === 'gerente')  gerentesSet[pfk]  = true;
    if (pf.tipo === 'trocador') tambemTrocSet[pfk] = true;
  }
  for (var k in tambemTrocSet) {
    if (!gerentesSet[k]) trocPuroSet[k] = true;
  }

  // ── Acumuladores por posto ────────────────────────────────────────────────
  var porPosto = {};

  function getPosto(sid) {
    if (!porPosto[sid]) {
      porPosto[sid] = {
        frentistas: {},
        trocadores: {},
        gerentes:   {},
        totalPosto: 0,
        espPosto:   {},
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
      vendasTroc:  0, itensEspTroc:  [],
    };
    return grupo[nome];
  }

  // Pré-carrega gerentes cadastrados (aparecem mesmo sem vendas)
  for (var i = 0; i < periodoFuncionarios.length; i++) {
    var pf = periodoFuncionarios[i];
    if (pf.tipo === 'gerente') {
      getGerente(getPosto(String(pf.posto_id)).gerentes, pf.nome.trim());
    }
  }

  // ── Acumula vendas ────────────────────────────────────────────────────────
  for (var i = 0; i < vendas.length; i++) {
    var v    = vendas[i];
    var sid  = String(v.posto_id);
    var p    = getPosto(sid);
    var nome = v.funcionario;

    var vf   = n2(v.valor_final);
    var qtd  = n3(v.quantidade);
    var tipo = v.tipo_funcionario;

    p.totalPosto = add2(p.totalPosto, vf);

    var fnKey = sid + '|' + nome.trim().toLowerCase();

    var isGerente  = tipo === 'gerente' || gerentesSet[fnKey];
    var isTrocPuro = !isGerente && (tipo === 'trocador' || trocPuroSet[fnKey]);
    var isTrocGer  = isGerente && tipo === 'trocador' && tambemTrocSet[fnKey];

    if (isGerente) {
      var fg = getGerente(p.gerentes, nome);
      if (isTrocGer) {
        fg.vendasTroc = add2(fg.vendasTroc, vf);
        var peT = espIdx[sid + '|' + v.produto.trim().toLowerCase()];
        if (peT) {
          var cu = n2(peT.comissao_trocador);
          if (cu > 0) fg.itensEspTroc.push({ produto: v.produto, quantidade: qtd, comissao_unit: cu, comissao_total: mul2(qtd, cu) });
        }
      } else {
        fg.vendasFrent = add2(fg.vendasFrent, vf);
        var peF = espIdx[sid + '|' + v.produto.trim().toLowerCase()];
        if (peF) {
          var cu = n2(peF.comissao_frentista);
          if (cu > 0) fg.itensEspFrent.push({ produto: v.produto, quantidade: qtd, comissao_unit: cu, comissao_total: mul2(qtd, cu) });
        }
      }
    } else if (isTrocPuro) {
      var ft = getSimple(p.trocadores, nome);
      ft.totalVendas = add2(ft.totalVendas, vf);
      var peT2 = espIdx[sid + '|' + v.produto.trim().toLowerCase()];
      if (peT2) {
        var cu2 = n2(peT2.comissao_trocador);
        if (cu2 > 0) ft.itensEsp.push({ produto: v.produto, quantidade: qtd, comissao_unit: cu2, comissao_total: mul2(qtd, cu2) });
      }
    } else {
      var ff = getSimple(p.frentistas, nome);
      ff.totalVendas = add2(ff.totalVendas, vf);
      var peF2 = espIdx[sid + '|' + v.produto.trim().toLowerCase()];
      if (peF2) {
        var cu3 = n2(peF2.comissao_frentista);
        if (cu3 > 0) ff.itensEsp.push({ produto: v.produto, quantidade: qtd, comissao_unit: cu3, comissao_total: mul2(qtd, cu3) });
      }
    }

    var peKey = sid + '|' + v.produto.trim().toLowerCase();
    if (espIdx[peKey]) {
      if (!p.espPosto[peKey]) p.espPosto[peKey] = { pe: espIdx[peKey], qtdTotal: 0 };
      p.espPosto[peKey].qtdTotal = add3(p.espPosto[peKey].qtdTotal, qtd);
    }
  }

  // ── Calcula comissões por posto ───────────────────────────────────────────
  var resultado = {};
  var postoIds  = Object.keys(porPosto);

  for (var pi = 0; pi < postoIds.length; pi++) {
    var sid   = postoIds[pi];
    var dados = porPosto[sid];
    var meta  = metasIdx[sid] || { meta_frentista: 0, meta_trocador: 0, meta_posto: 0 };

    var mF = n2(mul2(n2(meta.meta_frentista), proRata.fator));
    var mT = n2(mul2(n2(meta.meta_trocador),  proRata.fator));
    var mP = n2(mul2(n2(meta.meta_posto),     proRata.fator));

    var pctPosto = mP > 0 ? dados.totalPosto / mP : 0;

    var res = {
      funcionarios:          [],
      totalComissoes:        0,
      totalVendasPosto:      dados.totalPosto,
      metaFrentista:         n2(meta.meta_frentista),
      metaTrocador:          n2(meta.meta_trocador),
      metaPosto:             n2(meta.meta_posto),
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

    // Itens especiais gerente (qtd total do posto × comissao_gerente/un)
    var itensEspGer = [];
    var totalEspGer = 0;
    for (var k in dados.espPosto) {
      var entry = dados.espPosto[k];
      var cGU   = n2(entry.pe.comissao_gerente);
      if (cGU > 0) {
        var cGT = mul2(entry.qtdTotal, cGU);
        itensEspGer.push({ produto: entry.pe.nome_produto, quantidade: entry.qtdTotal, comissao_unit: cGU, comissao_total: cGT });
        totalEspGer = add2(totalEspGer, cGT);
      }
    }

    // ── FRENTISTAS ────────────────────────────────────────────────────────
    var nomesFrent = Object.keys(dados.frentistas);
    for (var fi = 0; fi < nomesFrent.length; fi++) {
      var nome = nomesFrent[fi];
      var ff   = dados.frentistas[nome];
      var pct  = mF > 0 ? ff.totalVendas / mF : 0;
      var taxa = getFaixaFrentista(pct);
      var cF   = mul2(ff.totalVendas, taxa);
      var cEsp = 0;
      for (var ii = 0; ii < ff.itensEsp.length; ii++) cEsp = add2(cEsp, ff.itensEsp[ii].comissao_total);
      var tot  = add2(cF, cEsp);
      var dk   = sid + '|' + nome.trim().toLowerCase() + '|frentista';
      var dm   = desqIdx[dk];
      var isD  = !!dm;

      res.funcionarios.push({
        nome:              nome,
        tipo:              'frentista',
        totalVendas:       ff.totalVendas,
        metaEfetiva:       mF,
        pctMeta:           pct,
        taxaComissao:      isD ? 0 : taxa,
        comissaoAgregados: isD ? 0 : cF,
        itensEspeciais:    ff.itensEsp,
        comissaoEspeciais: isD ? 0 : cEsp,
        totalComissao:     isD ? 0 : tot,
        desqualificado:        isD,
        motivoDesqualificacao: dm || null,
      });
      res.totalComissoes = add2(res.totalComissoes, isD ? 0 : tot);
    }

    // ── TROCADORES PUROS ──────────────────────────────────────────────────
    var nomesTroc = Object.keys(dados.trocadores);
    for (var ti = 0; ti < nomesTroc.length; ti++) {
      var nome = nomesTroc[ti];
      var ft   = dados.trocadores[nome];
      var pct  = mT > 0 ? ft.totalVendas / mT : 0;
      var taxa = getFaixaTrocador(pct);
      var cF   = mul2(ft.totalVendas, taxa);
      var cEsp = 0;
      for (var ii = 0; ii < ft.itensEsp.length; ii++) cEsp = add2(cEsp, ft.itensEsp[ii].comissao_total);
      var tot  = add2(cF, cEsp);
      var dk   = sid + '|' + nome.trim().toLowerCase() + '|trocador';
      var dm   = desqIdx[dk];
      var isD  = !!dm;

      res.funcionarios.push({
        nome:              nome,
        tipo:              'trocador',
        totalVendas:       ft.totalVendas,
        metaEfetiva:       mT,
        pctMeta:           pct,
        taxaComissao:      isD ? 0 : taxa,
        comissaoAgregados: isD ? 0 : cF,
        itensEspeciais:    ft.itensEsp,
        comissaoEspeciais: isD ? 0 : cEsp,
        totalComissao:     isD ? 0 : tot,
        desqualificado:        isD,
        motivoDesqualificacao: dm || null,
      });
      res.totalComissoes = add2(res.totalComissoes, isD ? 0 : tot);
    }

    // ── GERENTES ──────────────────────────────────────────────────────────
    var gerenteAtingiu = pctPosto >= 1.0;
    var nomesGer       = Object.keys(dados.gerentes);

    var qtdGerentesAtivos = 0;
    for (var gi = 0; gi < nomesGer.length; gi++) {
      var dkCheck = sid + '|' + nomesGer[gi].trim().toLowerCase() + '|gerente';
      if (!desqIdx[dkCheck]) qtdGerentesAtivos++;
    }
    if (qtdGerentesAtivos === 0) qtdGerentesAtivos = 1;

    var com3PTotal      = gerenteAtingiu ? mul2(dados.totalPosto, 0.03) : 0;
    var com3PPorGerente = div2(com3PTotal, qtdGerentesAtivos);

    var totalEspGerPorGerente = div2(totalEspGer, qtdGerentesAtivos);
    var itensEspGerDivididos  = itensEspGer.map(function(ie) {
      return Object.assign({}, ie, { comissao_total: div2(ie.comissao_total, qtdGerentesAtivos) });
    });

    for (var gi = 0; gi < nomesGer.length; gi++) {
      var nome  = nomesGer[gi];
      var fg    = dados.gerentes[nome];
      var fnKey = sid + '|' + nome.trim().toLowerCase();
      var isTroc = !!tambemTrocSet[fnKey];
      var dk     = sid + '|' + nome.trim().toLowerCase() + '|gerente';
      var dm     = desqIdx[dk];
      var isD    = !!dm;

      var pctT = 0, taxaT = 0, comPropT = 0, comEspT = 0;
      if (isTroc) {
        var vendasTrocCalc   = fg.vendasTroc;
        var itensEspTrocCalc = fg.itensEspTroc;

        if (vendasTrocCalc === 0 && fg.vendasFrent > 0) {
          vendasTrocCalc   = fg.vendasFrent;
          itensEspTrocCalc = [];
          for (var ii = 0; ii < fg.itensEspFrent.length; ii++) {
            var ig   = fg.itensEspFrent[ii];
            var peK  = sid + '|' + ig.produto.trim().toLowerCase();
            var peEn = espIdx[peK];
            var cTU  = peEn ? n2(peEn.comissao_trocador) : 0;
            if (cTU > 0) {
              itensEspTrocCalc.push({ produto: ig.produto, quantidade: ig.quantidade, comissao_unit: cTU, comissao_total: mul2(ig.quantidade, cTU) });
            }
          }
          fg.vendasFrent   = 0;
          fg.itensEspFrent = [];
        }

        pctT     = mT > 0 ? vendasTrocCalc / mT : 0;
        taxaT    = getFaixaTrocador(pctT);
        comPropT = mul2(vendasTrocCalc, taxaT);
        fg.vendasTroc   = vendasTrocCalc;
        fg.itensEspTroc = itensEspTrocCalc;
        for (var ii = 0; ii < itensEspTrocCalc.length; ii++) comEspT = add2(comEspT, itensEspTrocCalc[ii].comissao_total);
      }

      var pctF     = mF > 0 ? fg.vendasFrent / mF : 0;
      var taxaF    = getFaixaFrentista(pctF);
      var comPropF = mul2(fg.vendasFrent, taxaF);
      var comEspF  = 0;
      for (var ii = 0; ii < fg.itensEspFrent.length; ii++) comEspF = add2(comEspF, fg.itensEspFrent[ii].comissao_total);

      var comEspGer = isD ? 0 : totalEspGerPorGerente;
      var comBase   = isD ? 0 : add2(com3PPorGerente, comEspGer);

      var totPropF = isD ? 0 : add2(comPropF, comEspF);
      var totPropT = isD ? 0 : add2(comPropT, comEspT);
      var totGer   = isD ? 0 : add2(comBase, add2(totPropF, totPropT));

      var totalVendasGerente = add2(fg.vendasFrent, fg.vendasTroc);

      res.funcionarios.push({
        nome:               nome,
        tipo:               'gerente',
        totalVendas:        totalVendasGerente,
        vendasPropFrentista: fg.vendasFrent,
        vendasPropTrocador:  fg.vendasTroc,
        metaEfetiva:        mP,
        pctMeta:            pctPosto,
        taxaComissao:       gerenteAtingiu ? 0.03 : 0,

        pctMetaFrentista:   pctF,
        taxaFrentista:      isD ? 0 : taxaF,
        comissaoPropFrent:  isD ? 0 : comPropF,
        // FIX v5.5: exposto para o frontend renderizar
        itensEspFrentista:  fg.itensEspFrent,
        comissaoEspFrent:   isD ? 0 : comEspF,
        totalPropFrentista: totPropF,

        tambemTrocador:     isTroc,
        pctMetaTrocador:    pctT,
        taxaTrocador:       isD ? 0 : taxaT,
        comissaoPropTroc:   isD ? 0 : comPropT,
        itensEspTrocador:   fg.itensEspTroc,
        comissaoEspTroc:    isD ? 0 : comEspT,
        totalPropTrocador:  totPropT,

        comissaoPercentualPosto: isD ? 0 : com3PPorGerente,
        comissaoAgregados:       isD ? 0 : comBase,
        // itensEspeciais = itens gerenciais do posto (qtd total ÷ nº gerentes)
        itensEspeciais:          isD ? [] : itensEspGerDivididos,
        comissaoEspeciais:       comEspGer,
        totalComissaoGerencial:  isD ? 0 : comBase,

        totalComissao: totGer,
        metaAtingida:  gerenteAtingiu,
        semVendas:     fg.vendasFrent === 0 && fg.vendasTroc === 0,

        desqualificado:        isD,
        motivoDesqualificacao: dm || null,

        acumulaTrocador:           isTroc,
        comissaoTrocadorAcumulada: isD ? 0 : comPropT,
        itensEspeciaisTrocador:    fg.itensEspTroc,
        comissaoEspeciaisTrocador: isD ? 0 : comEspT,
        totalComissaoTrocador:     totPropT,
        pctTrocadorAcumulado:      pctT,
        taxaTrocadorAcumulada:     taxaT,
      });
      res.totalComissoes = add2(res.totalComissoes, totGer);
    }
  }

  return resultado;
}

module.exports = { calcularComissoes, getFaixaFrentista, getFaixaTrocador, calcularProRata };
