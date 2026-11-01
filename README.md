# 🩺 Consultas Médicas

Secretária eletrônica para acompanhar as consultas médicas da família.

## Funcionalidades
- **Cadastro individual**: cada integrante cria a própria conta (nome, e-mail, senha e WhatsApp). Os dados de saúde (tipo sanguíneo, alergias, convênio etc.) são opcionais.
- **Perfis**: a primeira pessoa cadastrada vira **admin**. O admin vê as consultas de todos e pode promover outros membros. Cada membro vê só as próprias consultas.
- **Consultas**: data/hora, médico, especialidade, local, motivo, o que levar, status e quantos dias antes avisar.
- **Médicos e clínicas**: cadastro para reaproveitar nas consultas.
- **Lembretes no WhatsApp (só admin)**: quando chega o dia do aviso, o admin vê "Você tem X lembretes para enviar". Ao clicar em 📲 Enviar, o WhatsApp abre com a mensagem pronta (link `wa.me`, sem API e sem token). Depois é só marcar como enviado. Lembretes atrasados ficam em vermelho.

## Como rodar
Requer Node.js 22.13 ou mais novo (usa o SQLite embutido do Node).

```bash
npm install
npm start
```

Acesse http://localhost:3000 e crie a primeira conta (ela será o admin).

Variáveis opcionais:
- `PORT`: porta (padrão 3000)
- `SESSION_SECRET`: segredo da sessão (defina em produção para não deslogar todos a cada reinício)
- `DB_PATH`: caminho do banco (padrão `data/consultas.db`)
- `TZ`: fuso horário (padrão `America/Sao_Paulo`)
