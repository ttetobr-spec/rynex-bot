# Rynex — bot Discord com IA e atendimento

O Rynex é um bot Discord em Node.js com IA via Pollinations, painel administrativo e sistema privado de tickets.

## Sistema de tickets

Publique o painel em um canal autorizado usando:

```text
!ticket painel
```

O painel apresenta categorias de atendimento — suporte geral, compras e pedidos, denúncia e parceria — em uma interface visual com embed e menu seletor.

Quando um usuário escolhe uma categoria, o Rynex cria um canal privado com acesso apenas ao autor e ao cargo autorizado. Dentro do ticket, a equipe pode assumir o atendimento, notificar o autor por mensagem privada e fechar o ticket. O encerramento pode registrar autor, categoria e responsável em um canal de logs.

O cargo configurado em `ADMIN_ROLE_ID` é o único autorizado a publicar o painel, assumir tickets, notificar usuários e executar ações administrativas.

## Comando principal

```text
!painel
```

O comando abre o painel geral do Rynex. O bot só responde a mensagens quando é mencionado com `@Rynex` e ignora mensagens de bots, `@everyone` e `@here`.

## Ativação e comprovantes

O comando `/pix` publica a chave Pix configurada e um botão para abrir um ticket privado. O usuário pode anexar o comprovante no ticket. O bot encaminha a imagem para o canal de logs configurado e menciona o cargo de análise `1518349199110967568`.

Somente a equipe autorizada pode usar `/aceitar` ou `/recusar` dentro do ticket de ativação. O resultado é registrado e uma confirmação relacionada ao próprio atendimento pode ser enviada por DM. O fluxo não solicita nem armazena senhas, tokens, códigos de autenticação ou links de recuperação.

## Recursos profissionais adicionais

Os tickets agora exibem controles de staff para assumir, notificar, fechar, adicionar participante, renomear, pedir ajuda e criar uma call. Ao fechar um ticket, o bot tenta gerar um transcript em texto no canal de logs e envia ao autor uma avaliação de uma a cinco estrelas.

O painel ADM concentra as funções administrativas em botões privados: **Relatório por ID**, **Ver logs**, **Enviar DM** e **Enviar no canal**. O relatório consulta apenas dados que o bot registrou no servidor, como mensagens observadas e tickets do usuário informado; ele não acessa DMs privadas. As mensagens enviadas pelo painel ficam sem menções automáticas e as ações são registradas no histórico administrativo.

## Loja, produtos, cupom e pedidos

O painel mostra o botão **Loja, pedidos e cupom** com os comandos rápidos. O cargo administrativo pode usar `/produto-adicionar`, `/produto-editar`, `/produto-remover` e `/produto-listar`. Cada produto aceita nome, preço, categoria, imagem, URL e descrição. `/config-categorias`, `/config-site` e `/config-categoria-pedidos` ajustam o catálogo, os textos públicos e a categoria Discord dos canais privados. `/config-pix chave:... cidade:...` guarda a chave e a cidade em resposta privada; a chave fica no armazenamento do bot, não no GitHub. Configure a marca pelo comando `/config-site marca:...`.

`RYNEX-TEST` vem habilitado com 100% de desconto para teste. Para desligá-lo antes da operação real, use `/config-cupom codigo:RYNEX-TEST desconto:100 ativo:false`. Quando o checkout usa o cupom, o pedido fica pago e o bot tenta abrir um canal privado `pedido-...`. Pedidos pagos em Pix exibem no site um QR estático e o código copia-e-cola. `/gerarpix valor:10 nome:usuario` gera um QR e o código para compartilhar. Como o QR é estático, o bot não recebe uma confirmação automática do banco: um administrador usa `/pedido-pendentes` para ver os IDs, confere o recebimento no banco e então executa `/pedido-aceitar id:RX-...` para confirmar o pedido e abrir o canal privado. Pedidos podem ser recusados com `/pedido-recusar`.

O servidor HTTP expõe o catálogo, cadastro/login, pedidos e mensagens do atendimento. Minha conta aceita foto PNG/JPG/WEBP; o navegador reduz a imagem e a API valida formato e tamanho antes de guardar o avatar. No checkout, o backend chama o mesmo gerador Pix de `/gerarpix`, calcula a cobrança na criação do pedido e persiste QR e copia-e-cola para que o link de acompanhamento possa recuperá-los após login. Se a chave ainda não estiver configurada, a página permite tentar gerar o QR novamente depois que a equipe configurar `/config-pix`. O link compartilhável acompanha o pedido; não é uma URL de pagamento de provedor. O Pix desta etapa é estático: um administrador deve conferir o crédito no banco e confirmar no Discord, pois não há confirmação automática via webhook. O chat atualiza automaticamente e as mensagens da equipe no canal Discord aparecem no site. O backend calcula preços a partir do próprio catálogo e ignora valores enviados pelo navegador. Em produção, hospede o bot/API em um ambiente persistente com HTTPS, defina `ALLOWED_SITE_ORIGINS` e compile o site com `VITE_RYNEX_API_URL` apontando para essa API.

## Conta e histórico no site

O frontend mantém páginas separadas para `/login`, `/register`, `/account`, `/settings` e `/orders`, além de `/cart`. O endpoint `GET /api/store/orders` exige a sessão do cliente e retorna somente um resumo dos pedidos dessa própria conta; dados de pagamento detalhados e mensagens permanecem na rota autorizada do pedido individual. A troca de senha exige a senha atual. Recuperação por e-mail precisa de um serviço de envio seguro configurado pelo responsável pelo site.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```text
DISCORD_TOKEN=token_do_bot
POLLINATIONS_API_KEY=chave_do_pollinations
POLLINATIONS_MODEL=openai/gpt-oss-20b
ADMIN_ROLE_ID=1533477047144419612
ADMIN_PANEL_KEY=chave_forte_do_painel
BOT_INTERNAL_KEY=chave_interna_opcional_para_integracoes
ALLOWED_SITE_ORIGINS=https://seu-dominio.example
PIX_KEY=chave_pix_real
PIX_MERCHANT_NAME=nome_da_loja_opcional
PIX_MERCHANT_CITY=cidade_da_conta_recebedora
DISCORD_GUILD_ID=id_do_servidor_principal
ORDER_CATEGORY_ID=opcional_id_da_categoria_de_pedidos
TEST_COUPON_CODE=RYNEX-TEST
TICKET_CATEGORY_ID=opcional_id_da_categoria_de_tickets
TICKET_LOG_CHANNEL_ID=opcional_id_do_canal_de_logs
PORT=3000
DATA_DIR=./data
```

Os valores de token e chave devem permanecer somente no `.env` local ou nos segredos do host. Nunca publique `.env` no GitHub nem envie o token do bot em mensagem. O canal só é criado no Discord depois que `DISCORD_TOKEN` estiver configurado e o bot estiver online.

## Executar no Windows

Instale o Node.js 20 ou superior, abra a pasta do projeto, crie o `.env` e dê duplo clique em:

```text
iniciar-rynex.bat
```

O script instala as dependências na primeira execução e reinicia o bot automaticamente se o processo encerrar. Para manter o bot online, o computador precisa permanecer ligado e conectado à internet.

## Permissões do Discord

Ative **Message Content Intent** e **Server Members Intent** no Developer Portal. Para o sistema completo, o bot precisa de **View Channels**, **Send Messages**, **Embed Links**, **Read Message History**, **Manage Channels** e, se for criar cargos, **Manage Roles**. O cargo do bot deve estar acima dos cargos que ele precisa gerenciar.

## Hospedagem

O comando de inicialização é `npm start`. Para execução 24 horas independente do computador, use um worker pago ou uma máquina sempre ligada. Hospedagens gratuitas podem dormir, reiniciar ou impor limites.
