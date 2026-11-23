<div align="center">

<img src="public/vinqueta.svg" width="88" height="88" alt="Símbolo do Vinqueta" />

# Vinqueta

**Do pedido à impressão, em um só aplicativo.**

Aplicativo desktop independente para fornecedores da Havan gerarem, conferirem e imprimirem etiquetas de **volume** e **preço**.

[![Baixar versão estável](https://img.shields.io/badge/Baixar-vers%C3%A3o%20est%C3%A1vel-143B2B?style=for-the-badge&logo=github&logoColor=white)](https://github.com/kelvinmattosdev/vinqueta/releases/latest)

![Distribuição estável: Linux](https://img.shields.io/badge/est%C3%A1vel-Linux-204d3b)
![Electron + React](https://img.shields.io/badge/desktop-Electron_%2B_React-253449)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-204d3b)](LICENSE)

[Fluxo de uso](#fluxo-de-uso) · [Instalação](#instalação) · [Desenvolvimento](#desenvolvimento) · [Segurança](SECURITY.md)

</div>

## Por que este projeto existe?

O projeto nasceu de uma rotina de fornecedor: as etiquetas de volume exigiam um ajuste manual no ZPL para encaixar no papel usado na operação, e as de preço dependiam de uma segunda ferramenta, embora o XML de integração já trouxesse os dados necessários. Era fácil perder tempo alternando entre programas ou precisar gerar de novo algo que já estava pronto.

O Vinqueta reúne essas tarefas. Ajusta a posição das etiquetas de volume sem alterar seus identificadores, prepara etiquetas de preço diretamente a partir do XML e mantém os lotes no computador para exportar ou imprimir novamente, sem solicitar novos códigos à Havan.

## Fluxo de uso

1. **Entre uma vez.** Use o CNPJ e a senha do portal da Havan no painel inicial. A navegação só aparece após a autenticação, e **Pedidos** abre com a consulta do ano atual. **Lembrar acesso neste computador** é opcional.
2. **Escolha o que preparar.** Em **Pedidos**, selecione os itens e solicite os volumes. Em **Etiquetas de preço**, consulte a integração no portal, importe um XML/RAR/ZIP existente ou preencha os dados manualmente.
3. **Confira e gere.** Nos preços, revise EAN, preço de venda e quantidade antes de gerar. Nos volumes, a Central preserva o original e aplica o ajuste. Nada é impresso só por gerar ou baixar a integração.
4. **Exporte ou imprima.** Abra o lote para inspecionar o ZPL, exportar **TXT/ZIP** ou enviar a uma fila compatível. Lotes já salvos não precisam ser consultados novamente na Havan.

Em **Configurações**, escolha tema claro, escuro ou do sistema e restaure os avisos de confirmação. O tema não muda as etiquetas.

### Atualizações

Depois do login, o topo consulta as releases estáveis de [`kelvinmattosdev/vinqueta`](https://github.com/kelvinmattosdev/vinqueta/releases).
No AppImage gravável e na instalação local por usuário no Linux, **Atualizar para…** baixa a imagem oficial, mostra o progresso, verifica o SHA-256 anunciado pelo GitHub e reabre o Vinqueta. O perfil local é preservado. Em instalações `.deb` ou sem pacote compatível, o botão abre a release no navegador para instalação manual. Se não for possível verificar, o Vinqueta não afirma que está atualizado.
Ao abrir uma versão nova, o histórico reúne as notas das versões intermediárias conhecidas, incluindo correções de segurança quando publicadas.
O modal volta apenas após outra atualização quando a leitura é confirmada. Em uma instalação sem histórico anterior, a versão em uso é o ponto de partida.

Para manter o histórico disponível sem internet, adicione cada versão estável ao [`CHANGELOG.md`](CHANGELOG.md) antes de empacotar e publique a release com a tag `vMAJOR.MINOR.PATCH`.

## Instalação

| Plataforma | Situação |
|---|---|
| **Linux** | Estável para x86-64: `.deb` e AppImage na [release mais recente](https://github.com/kelvinmattosdev/vinqueta/releases/latest). |
| **Windows** | Instalador `.exe` x64 em validação. |
| **macOS** | `.dmg` para Apple Silicon e Intel em validação. |

No Linux, é preciso ter um cofre compatível com Secret Service, `gjs` com libsecret e, para imprimir, CUPS. No Debian e Ubuntu: `sudo apt install gjs gir1.2-secret-1 cups-client`. Na sessão gráfica, mantenha o cofre de login desbloqueado. Para compilar a partir do código-fonte:

```bash
npm ci
npm run install:local   # instala para o usuário atual e registra o atalho, sem sudo
npm run dist:linux      # alternativa: gera .deb e AppImage em release/
npm run dist:win        # no Windows; gera .exe
npm run dist:mac        # no macOS; gera .dmg para a arquitetura do host
```

O build do ícone usa Chrome (`CHROME_PATH` aponta para outro executável compatível). A versão empacotada não exige Node.js nem terminal para abrir. A operação online exige uma conta de fornecedor habilitada.

Por padrão, builds a partir do código-fonte não trazem a configuração de volumes. Use **Importar configuração local** no painel de acesso para guardá-la no cofre do sistema. Em instalações existentes, o Vinqueta tenta migrar o `protocol.json` local para o cofre sem apagar o original.

Para preparar um pacote de distribuição com configuração inicial, forneça ao empacotador o **caminho** de um arquivo privado, fora do repositório:

```bash
VINQUETA_PROTOCOL_FILE=/caminho/privado/protocol.json npm run dist:linux
```

Na primeira abertura o app guarda a configuração incluída no pacote no cofre. Nas próximas, usa o cofre sem ler novamente o recurso empacotado. O pacote não inclui o JSON original, mas a configuração ofuscada pode ser recuperada por quem tiver acesso ao instalador.

## Arquitetura

**React + TypeScript** para a interface, **Electron** para autenticação, arquivos e impressão, e módulos locais para ler integrações e processar ZPL. A interface acessa somente as operações expostas pelo preload.

```mermaid
flowchart LR
    U["Interface React"] -->|"IPC restrito"| E["Processo principal Electron"]
    E -->|"Login, pedidos e volumes"| H["Serviço de impressão da Havan"]
    E -->|"Login, lista e download de integração"| P["Portal do Fornecedor Havan"]
    E -->|"Ler XML e gerar ou ajustar ZPL"| Z["Processamento local"]
    Z --> L["Lotes e exportações"]
    E -->|"Somente se solicitado"| I["Fila RAW / CUPS"]
    E -.->|"Prévia opcional e autorizada"| R["Labelary"]
    E -.->|"Configuração e acesso opcional"| C["Cofre do sistema"]
```

| Pasta | Responsabilidade |
|---|---|
| [`src/`](src/) | Login, pedidos, editor de preço, histórico e configurações. |
| [`electron/`](electron/) | IPC, clientes da Havan, cofre, integração de arquivos, lotes e impressão. |
| [`shared/`](shared/) | Validação, geração de preços e ajuste de volumes em ZPL. |
| [`tests/`](tests/) e [`scripts/`](scripts/) | Testes, verificações da interface e empacotamento. |
| [`docs/`](docs/) | Documentação complementar e diagramas. |

### Integrações

| Serviço | O que faz |
|---|---|
| **Havan** | Os clientes acessam por HTTPS o serviço usado pelo aplicativo oficial de etiquetas e o Portal do Fornecedor. Não há servidor intermediário do projeto. Os contratos de integração usados aqui não são apresentados como APIs públicas ou documentadas pela Havan. |
| **Labelary** | Prévia PNG opcional. Recebe uma fileira do ZPL de preço, com EAN e preço, somente mediante ação explícita. Não recebe senha, cookies da Havan nem o XML completo. |
| **Impressão e cofre do sistema** | CUPS no Linux/macOS ou spooler RAW no Windows. Secret Service no Linux, Gerenciador de Credenciais no Windows e Keychain no macOS. A senha só é guardada se o usuário optar por lembrar. |

Não há API pública própria. A integração entre interface e processo principal está definida em [`electron/preload.cjs`](electron/preload.cjs) e [`src/types.ts`](src/types.ts). Consulte [Segurança e privacidade](SECURITY.md) para saber o que é salvo ou enviado.

## Desenvolvimento

```bash
npm ci
npm run desktop         # abre o app Electron
npm run check           # testes, verificação TypeScript e build
npm run test:desktop    # fluxo real no Electron com serviços simulados
```

`npm run dev -- --port 5174` serve a interface para desenvolvimento visual. Nesse modo, o navegador não tem os serviços do Electron. Para verificar os temas e o layout, use `npm run test:theme` e `VINQUETA_UI_URL=http://127.0.0.1:5174 npm run test:ui` com o servidor rodando.

## Limites atuais

- **Volume:** o ajuste histórico desloca posições em **−30 dots** a partir da linha de referência, preservando os dados da etiqueta. Não converte DPI nem substitui a gravação de RFID.
- **Preço:** perfil atual de **33 × 22 mm**, três colunas, EAN em texto e sem parcelas. A integração usa `PrecoVenda`, não custo do fornecedor. Os exemplos da interface são fictícios.
- **Impressão:** requer uma fila compatível com ZPL bruto. Enviar à fila não confirma a impressão física. Confira calibração e resolução com um lote de teste.
- **Windows e macOS:** o [workflow de validação](https://github.com/kelvinmattosdev/vinqueta/actions/workflows/desktop.yml) gera pacotes de teste sem a configuração oficial. Antes da distribuição estável, faltam validar a instalação e a impressão física; no macOS, também é preciso assinar com Developer ID e notarizar para a distribuição fora da App Store.

## Documentação adicional

- [Segurança, privacidade e reporte de vulnerabilidades](SECURITY.md)
- [Histórico de versões](CHANGELOG.md)
- [Temas e verificação de contraste](docs/theme.md)
- [Fluxograma editável — referência histórica](docs/fluxo-atual.drawio) (diagrams.net)
- [Licença MIT](LICENSE)

Desenvolvido por **[Kelvin Mattos](https://github.com/kelvinmattosdev)**. Projeto independente, sem afiliação ou endosso da Havan. A licença MIT cobre o código próprio; nomes, marcas, serviços e componentes de terceiros mantêm suas respectivas condições.
