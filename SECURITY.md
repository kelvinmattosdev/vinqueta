# Segurança e privacidade

A Central é um cliente desktop independente. Não há servidor da Central recebendo credenciais, pedidos ou etiquetas, nem telemetria ou gravação de tela implementadas pelo aplicativo. A senha só é persistida com autorização expressa. As outras gravações abaixo são efeitos das operações solicitadas ou das preferências que o usuário escolhe.

## O que é tratado e onde fica

| Dado | Quando é usado | Destino e persistência |
|---|---|---|
| **CNPJ e senha** | Ao entrar ou na reautenticação autorizada pelo usuário com **Lembrar acesso neste computador**. | Enviados diretamente, por HTTPS, aos serviços da Havan que validam o acesso. Com a opção marcada, ficam no Secret Service (Linux), Gerenciador de Credenciais (Windows) ou Keychain (macOS). Sem cofre disponível, não há gravação alternativa em texto simples. |
| **Sessão e cookies** | Depois de validar o login. A consulta inicial de pedidos do ano atual é automática. | Sessão do serviço de volumes em memória; cookies do portal em partição não persistente e separada. Sair da conta encerra a sessão local e desativa a entrada automática. Se o cofre impedir a remoção da credencial, a Central avisa. |
| **Arquivo de integração** | Ao selecionar um XML/RAR/ZIP ou clicar para ler a integração no portal. | O conteúdo é processado localmente. RAR e ZIP são tratados em memória, sem executar comandos embutidos no XML. O arquivo completo não é copiado para o histórico; lotes gerados podem guardar número do pedido, versão, códigos de origem e hash do XML. |
| **Lotes e ZPL** | A geração solicitada salva automaticamente os arquivos para conferência e reimpressão. | No perfil local da Central, junto com o manifesto. Podem conter dados comerciais. Em volumes, o ZPL original pode permanecer mesmo se o ajuste falhar. Não há sincronização com a Havan nem criptografia própria dos lotes em repouso. |
| **Tema, avisos e consentimento de acesso salvo** | Ao mudar o tema, confirmar que não quer ver um tipo de aviso de novo ou autorizar o acesso salvo. | Preferências locais. O arquivo `acesso-salvo` é somente um indicador, sem CNPJ ou senha. **Configurações → Avisos de confirmação** reativa os avisos. |
| **Configuração de compatibilidade** | No primeiro uso de um pacote provisionado, na migração de uma instalação antiga ou por importação manual. | O app guarda a configuração em uma entrada separada no cofre do sistema. O JSON legado não é apagado. Não compartilhe nem publique esse arquivo. |
| **Exportação e impressão** | Ao escolher um arquivo de destino ou enviar um lote para a impressora. | A exportação grava no local selecionado. A impressão usa CUPS ou o spooler do Windows e um ZPL temporário que a Central tenta remover ao terminar; o spooler e a impressora podem manter cópias segundo suas próprias configurações. |

**O histórico e as preferências não são apagados ao sair da conta.** No Linux, o perfil fica normalmente em `~/.config/vinqueta/` ou em `$XDG_CONFIG_HOME/vinqueta/`. A pasta `lotes/` é compartilhada pelas contas de fornecedor que usem o mesmo perfil local; o app não separa esse histórico por CNPJ. Use perfis separados do sistema para usuários ou empresas diferentes. Proteja backups, exportações e cópias da fila da mesma forma que os arquivos de origem.

## Conexões externas

- **GitHub — `api.github.com`:** após o login, consulta pública por versões e notas do Vinqueta. Não envia credenciais, sessão, pedidos ou dados de etiquetas. Nas instalações Linux compatíveis, um clique explícito baixa o AppImage do repositório oficial pelo GitHub e suas CDNs, valida o tamanho e o SHA-256 da release e só então troca o arquivo. Não eleva privilégios. Nas demais instalações, abre a release no navegador.

- **Havan — `impressaofornecedordmz.apps.havan.com.br`:** autenticação, pedidos, itens e solicitação de ZPL de volume no serviço usado pelo aplicativo oficial.
- **Havan — `cliente.havan.com.br`:** autenticação e consulta ao Portal do Fornecedor. O download usa um link retornado na consulta do próprio portal e pode marcar o pedido como **visualizado/baixado**. Solicitar novos volumes também pode produzir efeitos no serviço da Havan; essas operações não são repetidas automaticamente.
- **Labelary — `api.labelary.com`:** a imagem de prévia só é pedida quando o operador clica para enviar e renderizar. O serviço recebe o ZPL de uma fileira, incluindo EAN e preço, mas não senha, dados de sessão, pedido ou XML completo. A política de retenção é do Labelary; o aplicativo não garante que os dados sejam descartados pelo terceiro. É possível gerar, exportar e imprimir sem usar essa prévia.

O projeto não é oficial nem endossado pela Havan. Conectar-se aos serviços operados pela Havan não implica uma API pública, documentada ou com garantia de estabilidade. As operações usam a conta de fornecedor e não substituem as etapas exigidas pelo portal.

## Controles e limites

- As chamadas da integração saem do processo principal para destinos HTTPS predefinidos. O renderer usa sandbox, isolamento de contexto e IPC restrito. Operações da área de trabalho exigem acesso validado.
- A Central trata conteúdo recebido como dados. O importador limita tamanhos e entradas, não resolve DTDs externas e confere se o XML baixado pertence ao pedido selecionado. O ZPL de preço é gerado localmente a partir dos campos validados.
- As permissões do sistema restringem arquivos locais. O hash do ZPL processado ajuda a detectar alterações acidentais; não é uma assinatura e não protege contra alguém com acesso de escrita ao perfil inteiro.
- A camada de compatibilidade com o serviço de volumes usa um protocolo legado sobre TLS. Ela não substitui o HTTPS e não é usada para proteger os lotes em disco.
- Pacotes provisionados incluem um recurso ofuscado, não o JSON original. A ofuscação dificulta leitura casual, mas não impede a extração do valor por alguém com acesso ao instalador. Ela não protege credenciais de fornecedores, que nunca são incluídas no pacote.

## Reportar uma vulnerabilidade

Quando o repositório estiver publicado, prefira **Security → Report a vulnerability** se o reporte privado estiver habilitado. Caso contrário, solicite ao mantenedor um canal privado antes de enviar detalhes.

Inclua versão do app, sistema operacional, impacto, passos de reprodução com dados fictícios e, se úteis, logs já revisados. **Não inclua senhas, CNPJ reais, cookies, chaves, `protocol.json` ou arquivos reais de pedidos e etiquetas** em issues, screenshots ou relatórios públicos.
