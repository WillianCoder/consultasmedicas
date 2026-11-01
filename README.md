# 🩺 Consultas da Família

Site simples para a família acompanhar as consultas médicas, com lembretes no WhatsApp.

- Cada pessoa cria a própria conta com **usuário e senha**.
- O usuário **barbara** já nasce **administrador**. O administrador vê e edita tudo e escolhe quem mais é administrador (aba **Família**).
- **Calendário** com 6 formas de ver: mês, mês compacto, semana, dia, agenda do mês e ano.
- **Consultas** com 6 formas de ver: lista, cartões, tabela, linha do tempo, por pessoa e por status.
- **13 temas** de cores e opção de letras maiores (aba **Aparência**).
- **Lembretes**: o administrador vê quais lembretes precisa enviar e, com um toque, abre o WhatsApp com a mensagem pronta.

É um site estático (HTML, CSS e JavaScript), sem servidor. Os dados ficam no Firebase (grátis).

## 1. Publicar no GitHub Pages

1. No GitHub, abra **Settings → General**, desça até **Danger Zone → Change visibility** e deixe o repositório **público**. O Pages grátis só funciona em repositório público. As senhas não ficam no código.
2. Abra **Settings → Pages**. Em **Source**, escolha **Deploy from a branch**, selecione o branch do site e a pasta **/ (root)** e clique em **Save**.
3. Em 1 ou 2 minutos o site fica no ar em `https://williancoder.github.io/consultasmedicas/`.

## 2. Ligar o banco de dados da família (Firebase, grátis)

Sem este passo o site funciona em **modo demonstração**: cada aparelho guarda os próprios dados e a família não compartilha nada.

1. Entre em https://console.firebase.google.com com uma conta Google e clique em **Criar projeto** (pode desativar o Google Analytics).
2. **Authentication → Começar → Método de login → E-mail/senha → Ativar → Salvar.**
3. **Firestore Database → Criar banco de dados →** escolha a região `southamerica-east1 (São Paulo)` → **modo de produção**.
4. Na aba **Regras** do Firestore, apague tudo, cole o conteúdo do arquivo [`firestore.rules`](firestore.rules) e clique em **Publicar**.
5. Em **Configurações do projeto (engrenagem) → Seus apps**, clique no ícone **Web `</>`**, dê um nome e registre. Copie os valores `apiKey`, `authDomain`, `projectId` e `appId`.
6. Cole esses valores no arquivo [`firebase-config.js`](firebase-config.js) (dá para editar direto no GitHub, no ícone de lápis) e salve.
7. Em **Authentication → Configurações → Domínios autorizados**, adicione `williancoder.github.io`.

Pronto. Abra o site, crie a conta **barbara** primeiro e depois envie o link para a família.

## Como usar

- **Familiar:** abre o link, toca em **Criar minha conta** e preenche nome, usuário, senha e WhatsApp. Os dados de saúde são opcionais.
- **Esqueceu a senha:** cada um troca a senha em **Meu perfil**. Não há recuperação por e-mail, porque o login é só por usuário. Se alguém esquecer, o administrador pode remover a pessoa em **Família**, e ela cria uma conta nova com outro nome de usuário.
- **Administrador:** na aba **Família** edita qualquer pessoa e escolhe quem é administrador. Na aba **Lembretes** envia os avisos pelo WhatsApp.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Página do site |
| `app.js` | Telas e funcionamento |
| `store.js` | Login e dados (Firebase ou modo demonstração) |
| `styles.css` | Visual e temas |
| `firebase-config.js` | Dados do seu projeto Firebase |
| `firestore.rules` | Regras de segurança do banco (quem pode ver e editar o quê) |
