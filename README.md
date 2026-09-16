# Rynex — bot Discord com IA

O Rynex é um bot Discord em Node.js preparado para hospedagem no Railway. Ele responde quando é mencionado, em canais de dúvidas configurados, ou no canal administrativo configurado. Mensagens com `@everyone` e `@here` são ignoradas.

## Recursos incluídos

- Respostas com IA generativa real do Pollinations, usando o endpoint comunitário gratuito ou uma chave gratuita do próprio Pollinations.
- Restrição do canal administrativo por cargo e por canal.
- Configuração via API do painel: ativar/desativar IA, cargo de administrador, canal administrativo, canais de dúvidas e usuários bloqueados.
- Criação de cargos e canais a partir do canal administrativo.
- Criação de sorteios simples com botão de participação.
- Memória recente por servidor, salva em `data/config.json`.
- Endpoint `/health` para monitoramento da hospedagem.

## Publicação no Railway

1. Crie um repositório no GitHub e envie estes arquivos, ou use o botão de deploy/importação do Railway.
2. Crie um serviço a partir do repositório.
3. Adicione `DISCORD_TOKEN` e `ADMIN_PANEL_KEY`. Opcionalmente, adicione `POLLINATIONS_API_KEY` e `POLLINATIONS_MODEL=openai/gpt-oss-20b` para usar a API unificada autenticada. Sem chave, o bot tenta o endpoint comunitário gratuito.
4. O comando de inicialização é `npm start`.
5. No Discord Developer Portal, ative **Message Content Intent**, **Server Members Intent** e **Guilds/Guild Messages** conforme necessário.
6. Convide o bot com os escopos `bot` e `applications.commands`, concedendo somente as permissões necessárias. Para criar cargos e canais, ele precisa de `Manage Roles` e `Manage Channels`.

O Pollinations oferece acesso gratuito, mas sujeito a capacidade, limites e mudanças do serviço; não é possível garantir disponibilidade ou uso ilimitado. O teste gratuito do Railway oferece um crédito único de US$ 5 válido por até 30 dias; depois, a conta volta ao plano Free com US$ 1 mensal. Verifique os dois painéis de uso e não adicione um plano pago se deseja evitar cobrança.

## Painel de configuração

O backend expõe:

- `GET /api/config/:guildId`
- `POST /api/config/:guildId`

Use o cabeçalho `Authorization: Bearer SUA_ADMIN_PANEL_KEY`. Exemplo de payload:

```json
{
  "enabled": true,
  "adminRoleId": "ID_DO_CARGO",
  "adminChannelId": "ID_DO_CANAL_ADMIN",
  "qaChannelIds": ["ID_DO_CANAL_DUVIDAS"]
}
```

Este projeto entrega a API de configuração; uma interface visual pode ser adicionada depois sem mudar o bot.

## Segurança

Nunca publique `DISCORD_TOKEN` no GitHub, em mensagens ou no frontend. Use somente a variável secreta do Railway. Troque imediatamente qualquer token que tenha sido exposto.
