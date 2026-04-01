/**
 * MOTOR DE CÁLCULO DE COMISSÕES v2.4
 *
 * GERENTE - Comissão especial:
 *   comissao_gerente/un é aplicada sobre TODAS as unidades vendidas do produto
 *   no posto, por qualquer funcionário, sempre (independente de meta).
 *   Se o gerente ele mesmo vendeu, recebe TAMBÉM comissao do tipo do vendedor.
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

function calcularComissoes(vendas, metas, produtosEspeciais, periodoFuncionarios, periodo) {
  var proRata = calcularProRata(periodo);

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

  for (var pfi = 0; pfi < periodoFuncionarios.length; pfi++) {
    var pf = periodoFuncionarios[pfi];
    if (pf.tipo === 'gerente') {
      ensurePosto(pf.posto_id);
      ensureFunc(porPosto[pf.posto_id].gerentes, pf.nome.trim());
    }
  }

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

    // Calcula itens especiais gerente: comissao_gerente/un x qtd total de cada produto no posto
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

    // FRENTISTAS
    var nomesFrent = Object.keys(dados.frentistas);
    for (var fi2 = 0; fi2 < nomesFrent.length; fi2++) {
      var nf = nomesFrent[fi2];
      var ff = dados.frentistas[nf];
      var pctF = metaFrentistaEfetiva > 0 ? ff.totalVendas / metaFrentistaEfetiva : 0;
      var taxaF = getFaixaFrentista(pctF);
      var comAgrF = ff.totalVendas * taxaF;
      var comEspF = 0;
      for (var ie = 0; ie < ff.itensEspeciaisProprios.length; ie++) {
        comEspF += ff.itensEspeciaisProprios[ie].comissao_total;
      }
      var totF = comAgrF + comEspF;
      res.funcionarios.push({
        nome: nf, tipo: 'frentista',
        totalVendas: ff.totalVendas, metaEfetiva: metaFrentistaEfetiva,
        pctMeta: pctF, taxaComissao: taxaF,
        comissaoAgregados: comAgrF,
        itensEspeciais: ff.itensEspeciaisProprios, comissaoEspeciais: comEspF,
        totalComissao: totF
      });
      res.totalComissoes += totF;
    }

    // TROCADORES
    var nomesTroc = Object.keys(dados.trocadores);
    for (var ti2 = 0; ti2 < nomesTroc.length; ti2++) {
      var nt = nomesTroc[ti2];
      var ft = dados.trocadores[nt];
      var pctT = metaTrocadorEfetiva > 0 ? ft.totalVendas / metaTrocadorEfetiva : 0;
      var taxaT = getFaixaTrocador(pctT);
      var comAgrT = ft.totalVendas * taxaT;
      var comEspT = 0;
      for (var ie2 = 0; ie2 < ft.itensEspeciaisProprios.length; ie2++) {
        comEspT += ft.itensEspeciaisProprios[ie2].comissao_total;
      }
      var totT = comAgrT + comEspT;
      res.funcionarios.push({
        nome: nt, tipo: 'trocador',
        totalVendas: ft.totalVendas, metaEfetiva: metaTrocadorEfetiva,
        pctT: pctT, taxaComissao: taxaT, pctMeta: pctT,
        comissaoAgregados: comAgrT,
        itensEspeciais: ft.itensEspeciaisProprios, comissaoEspeciais: comEspT,
        totalComissao: totT
      });
      res.totalComissoes += totT;
    }

    // GERENTES
    var pctPosto       = metaPostoEfetiva > 0 ? dados.totalPosto / metaPostoEfetiva : 0;
    var gerenteAtingiu = pctPosto >= 1.0;
    var nomesGer       = Object.keys(dados.gerentes);

    for (var gi3 = 0; gi3 < nomesGer.length; gi3++) {
      var ng = nomesGer[gi3];
      var fg = dados.gerentes[ng];

      var comGerencial   = gerenteAtingiu ? dados.totalPosto * 0.03 : 0;
      var comEspGerente  = totalEspecialGerentePosto; // sobre todo o posto, sempre

      var vendaTroc = dados.trocadores[ng] || null;
      var comTrocAcum    = 0;
      var itensTroc      = [];
      var comEspTroc     = 0;
      var taxaTrocAcum   = 0;
      var pctTrocAcum    = 0;
      var vendasTroc     = 0;

      if (vendaTroc) {
        pctTrocAcum  = metaTrocadorEfetiva > 0 ? vendaTroc.totalVendas / metaTrocadorEfetiva : 0;
        taxaTrocAcum = getFaixaTrocador(pctTrocAcum);
        comTrocAcum  = vendaTroc.totalVendas * taxaTrocAcum;
        itensTroc    = vendaTroc.itensEspeciaisProprios;
        vendasTroc   = vendaTroc.totalVendas;
        for (var ie3 = 0; ie3 < itensTroc.length; ie3++) {
          comEspTroc += itensTroc[ie3].comissao_total;
        }
      }

      var totGerencial = comGerencial + comEspGerente;
      var totTroc      = comTrocAcum + comEspTroc;
      var totGer       = totGerencial + totTroc;

      res.funcionarios.push({
        nome: ng, tipo: 'gerente',
        totalVendas: dados.totalPosto,
        vendasProprias: fg.totalVendas,
        vendasComoTrocador: vendasTroc,
        metaEfetiva: metaPostoEfetiva,
        pctMeta: pctPosto,
        taxaComissao: gerenteAtingiu ? 0.03 : 0,
        comissaoAgregados: comGerencial,
        itensEspeciais: itensEspeciaisGerentePosto,
        comissaoEspeciais: comEspGerente,
        totalComissaoGerencial: totGerencial,
        acumulaTrocador: !!vendaTroc,
        pctTrocadorAcumulado: pctTrocAcum,
        taxaTrocadorAcumulada: taxaTrocAcum,
        comissaoTrocadorAcumulada: comTrocAcum,
        itensEspeciaisTrocador: itensTroc,
        comissaoEspeciaisTrocador: comEspTroc,
        totalComissaoTrocador: totTroc,
        totalComissao: totGer,
        metaAtingida: gerenteAtingiu,
        semVendas: fg.totalVendas === 0 && !vendaTroc
      });
      res.totalComissoes += totGer;
    }

    // Remove trocadores ja contabilizados dentro do gerente
    for (var gi4 = 0; gi4 < nomesGer.length; gi4++) {
      var ngr = nomesGer[gi4];
      if (dados.trocadores[ngr]) {
        for (var xi = 0; xi < res.funcionarios.length; xi++) {
          if (res.funcionarios[xi].nome === ngr && res.funcionarios[xi].tipo === 'trocador') {
            res.totalComissoes -= res.funcionarios[xi].totalComissao;
            res.funcionarios.splice(xi, 1);
            break;
          }
        }
      }
    }

    res.pctMetaPosto = pctPosto;
  }

  return resultado;
}

module.exports = { calcularComissoes: calcularComissoes, getFaixaFrentista: getFaixaFrentista, getFaixaTrocador: getFaixaTrocador, calcularProRata: calcularProRata };
