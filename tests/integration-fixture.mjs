export const integrationXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<OrdemCompra Padrao="1.4">
  <NumeroOrdemCompra>2026-12345</NumeroOrdemCompra><Versao>10/11/26 10:20:25</Versao>
  <DadosFornecedor><NomeFornecedor>Fornecedor fictício</NomeFornecedor></DadosFornecedor>
  <ItensOrdemCompra><ItemOrdemCompra>
    <CodigoProduto>123</CodigoProduto><DescricaoProduto>Vara de pesca ação rápida &amp; molinete</DescricaoProduto>
    <QuantidadeTotalItem>1200</QuantidadeTotalItem><UnidadeMedidaItem>PC</UnidadeMedidaItem>
    <PrecoFornecedor>89,7300</PrecoFornecedor><PrecoUnitarioFinal>89,7300</PrecoUnitarioFinal><PrecoVenda>199,99</PrecoVenda>
    <DetalhamentoVariacoesItem><VariacaoItem>
      <CodigoVariacao>1</CodigoVariacao><DescricaoVariacaoCompleta>DIVERSOS</DescricaoVariacaoCompleta>
      <CodigoBarrasVariacao>1234567890128</CodigoBarrasVariacao>
      <QuantidadePrimariaTotalSolicitada>1200</QuantidadePrimariaTotalSolicitada>
      <UnidadeMedidaPrimariaSolicitada>PC</UnidadeMedidaPrimariaSolicitada>
    </VariacaoItem></DetalhamentoVariacoesItem>
  </ItemOrdemCompra></ItensOrdemCompra>
  <Etiquetas><Etiqueta><Comandos><comando>Não executar este texto</comando></Comandos></Etiqueta></Etiquetas>
</OrdemCompra>`;
export const integrationBytes = () => Buffer.from(integrationXml, 'latin1');
export const gridHtml = `<link href="/layout.css" rel="stylesheet"><script>throw new Error('Não executar HTML do portal');</script>
<div class="hvn-group"><dl class="block">
<dt>Pedido: </dt><dd>2026-12345 <div class="tags-pedido-status">Liberado</div></dd>
<dt>Versão: </dt><dd>13/11/2026 17:16:29</dd>
<dt>Semana de entrega:</dt><dd>2026 - 46</dd>
<dt>Nota fiscal:</dt><dd>123 Agendada</dd><dt>Agendamento:</dt><dd>20/11/2026 06:00</dd>
<dt></dt><dd class="doc"><a href="/Fornecedor/PedidoCompra/SetaPedidoVisualizadoBaixado?idPedido=123&amp;arquivo=Arq.%20de%20integra%C3%A7%C3%A3o&amp;extensaoArquivo=XML&amp;idArquivo=456&amp;idRelacao=789">Arq. de integra&#231;&#227;o</a></dd>
</dl></div>
<div class="hvn-group"><dl><dt>Pedido:</dt><dd>2025-12345-1 <span class="tags-pedido-status">Fechado</span></dd><dt></dt><dd class="doc"></dd></dl></div>`;
