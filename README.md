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

Os comandos `/produto`, `/resposta`, `/pedido`, `/limpar` e `/relatorio` permitem, respectivamente, manter um catálogo oficial de preços, cadastrar respostas rápidas, abrir tickets de pedido, apagar mensagens com permissão adequada e consultar estatísticas básicas. A IA recebe o catálogo oficial junto com a base de conhecimento para responder preços de forma mais consistente.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```text
DISCORD_TOKEN=token_do_bot
POLLINATIONS_API_KEY=chave_do_pollinations
POLLINATIONS_MODEL=openai/gpt-oss-20b
ADMIN_ROLE_ID=1533477047144419612
ADMIN_PANEL_KEY=chave_forte_do_painel
TICKET_CATEGORY_ID=opcional_id_da_categoria_de_tickets
TICKET_LOG_CHANNEL_ID=opcional_id_do_canal_de_logs
PORT=3000
```

Os valores de token e chave devem permanecer somente no `.env` local ou nos segredos do host. Nunca publique `.env` no GitHub.

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
