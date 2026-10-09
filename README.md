# Camylle Teske — portfólio e painel

Site branco com texto preto, DM Sans e efeito de hover verde `#AEB400`. Preserva os seis projetos, as imagens originais, a foto, os textos e a composição do portfólio aprovado.

O código e as versões ficam no GitHub. O GitHub Pages serve o site e o painel `/admin/`. O Supabase guarda login, projetos e novas imagens. A Camy publica pelo painel, sem acessar GitHub, Wix ou arquivos de código.

## O que já está preparado

- Login com e-mail/senha e recuperação de senha.
- Criar, editar, excluir e ordenar trabalhos.
- Enviar JPG, PNG e WebP, escolher capa e ordenar a galeria.
- Salvar rascunho, publicar e retirar um trabalho do portfólio.
- Capa única ou três primeiras imagens lado a lado.
- Grade e páginas atualizadas pelo banco, sem reconstruir o site a cada trabalho.
- Importar os seis projetos iniciais pelo próprio painel.
- Publicação automática pelo GitHub Actions e suporte a domínio próprio.

**Estado:** site e painel publicados pelo GitHub Pages, com os 10 testes aprovados também no GitHub Actions. O projeto Supabase foi criado e a conta da Camy foi liberada pelo usuário. A URL e a chave publicável recebida estão configuradas em `supabase/public-config.json`. O repositório é [rafadorn/camylle-teske](https://github.com/rafadorn/camylle-teske). Ainda falta verificar o primeiro login na conta real e importar os seis trabalhos pelo painel. O ambiente de desenvolvimento não tem acesso direto ao Supabase, e a ferramenta de navegação não conseguiu abrir o novo endereço; a publicação foi confirmada pelo resultado de sucesso do GitHub. Nenhuma edição é simulada ou salva no navegador.

- [Abrir portfólio](https://rafadorn.github.io/camylle-teske/)
- [Abrir painel da Camy](https://rafadorn.github.io/camylle-teske/admin/)

## Ativação única

### 1. Supabase

1. Criar um projeto dedicado em [Supabase](https://supabase.com/dashboard). Guardar a senha do banco no gerenciador de senhas de vocês.
2. No **SQL Editor**, executar o conteúdo de `supabase/schema.sql`.
3. Em **Authentication > Users**, criar a conta da Camy com e-mail confirmado e senha. Desabilitar cadastro público em **Authentication > Sign In / Providers**. O painel não oferece cadastro.
4. Copiar o UUID dessa conta e executar no SQL Editor:

   ```sql
   insert into private.portfolio_admins (user_id)
   values ('UUID-DA-CONTA-DA-CAMY')
   on conflict do nothing;
   ```

5. A URL e a chave **Publishable** (`sb_publishable_...`) da Camy já estão em `supabase/public-config.json`. Para outra instância, atualizar esse arquivo ou fornecer o par de variáveis de ambiente. A chave `anon` legada também funciona. Não usar `service_role` ou `sb_secret_...` no site.
6. Em **Authentication > URL Configuration**, definir **Site URL** como `https://rafadorn.github.io/camylle-teske/` e adicionar o endereço exato da recuperação de senha a **Redirect URLs**:
   - Sem domínio: `https://rafadorn.github.io/camylle-teske/admin/?senha=alterar`
   - Com domínio: `https://camylle-teske.com.br/admin/?senha=alterar`
7. Verificar o envio dos e-mails de recuperação. Para entrega regular em produção, configurar SMTP próprio conforme a [documentação de e-mail do Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

As regras do banco liberam edição apenas aos UUIDs explicitamente cadastrados. Um visitante autenticado não ganha permissão. O bucket de novas imagens é privado; somente imagens referenciadas por projetos publicados recebem URLs de leitura temporárias. Ao retirar um projeto do ar, URLs já emitidas podem funcionar por até cinco minutos. Os arquivos originais deste pacote já eram conteúdo público e continuam no repositório; não são arquivos privados.

### 2. GitHub Pages

1. Criar um repositório chamado `camylle-teske` e subir este projeto para a branch `main`, incluindo `.github/workflows/pages.yml` e `package-lock.json`. Não subir `.env.local`, `node_modules` nem `test-results`.
2. Em **Settings > Pages > Build and deployment**, escolher **GitHub Actions**.
3. A conexão do Supabase já está configurada no projeto; não é necessário copiar as chaves novamente. Para substituir a conexão em outro ambiente, é possível definir o par em **Settings > Secrets and variables > Actions > Variables**:

   | Variável | Valor |
   | --- | --- |
   | `VITE_SUPABASE_URL` | URL do projeto Supabase |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave publicável ou anon |

4. Em **Actions**, executar **Publicar portfólio**. As próximas alterações na branch `main` publicam automaticamente. O caminho base é calculado pela configuração do Pages.
5. Abrir `/admin/`, entrar com a conta da Camy e clicar **Importar os 6 trabalhos preparados**. A importação envia as dez imagens e grava os seis projetos no banco; não altera arquivos já existentes com o mesmo ID. Se a conexão interromper a importação, a tela permite continuar com os projetos restantes.

O [GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages) está disponível para repositórios públicos no GitHub Free; repositórios privados exigem um plano compatível. Não tornar um repositório privado público sem decidir isso com vocês.

### 3. Domínio depois da compra

O nome considerado é **camylle-teske.com.br** — “Teske”, como o nome da Camy. Confirmar a grafia antes da compra. O endereço não foi registrado nem sua disponibilidade foi confirmada aqui.

1. Verificar a propriedade do domínio nas configurações de Pages do GitHub.
2. No repositório, ir a **Settings > Pages > Custom domain**, adicionar `camylle-teske.com.br` e salvar antes de configurar o DNS.
3. No painel DNS do registrador, adicionar os quatro registros A para o domínio raiz:

   | Nome | Tipo | Valor |
   | --- | --- | --- |
   | `@` / raiz | A | `185.199.108.153` |
   | `@` / raiz | A | `185.199.109.153` |
   | `@` / raiz | A | `185.199.110.153` |
   | `@` / raiz | A | `185.199.111.153` |
   | `www` | CNAME | `rafadorn.github.io` |

   O campo da raiz pode ficar vazio no editor DNS do Registro.br. Usar o usuário real do repositório no CNAME e não incluir o nome do repositório nesse valor.
4. Após a verificação do DNS, habilitar **Enforce HTTPS** no Pages e executar novamente o workflow para publicar com o caminho base `/`.
5. Atualizar as URLs de autenticação do Supabase para o domínio comprado e testar a recuperação de senha.

Com o domínio raiz configurado, o GitHub pode redirecionar `www` para o endereço sem `www`. Não é necessário comprar hospedagem junto com o domínio para esta estrutura.

Referência para os valores DNS: [documentação oficial do GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## Uso da Camy

1. Acessar `https://DOMINIO/admin/` e entrar.
2. Clicar **Novo trabalho**.
3. Preencher título, categoria e descrição. O endereço é gerado pelo título.
4. Adicionar imagens, marcar a capa e ajustar a ordem com **Subir** / **Descer**.
5. Escolher **Salvar como rascunho** ou **Salvar e publicar**.

Para editar, clicar **Editar** na lista. Para retirar um projeto do ar, salvar como rascunho. Para ajustar a ordem do portfólio, usar **Subir** / **Descer** na lista.

As páginas de novos projetos usam `/projeto/?trabalho=nome-do-projeto`. Essa rota funciona diretamente no GitHub Pages sem depender de redirecionamentos de erro 404. As seis rotas anteriores `/projetos/.../` também foram preservadas. As páginas dinâmicas exigem JavaScript para carregar novos trabalhos; o GitHub Pages não oferece renderização de servidor.

## Desenvolvimento

Requer Node.js 24 e npm.

```sh
npm ci
npm run dev
```

O projeto usa a configuração publicável em `supabase/public-config.json`. Para desenvolvimento com outro backend, copiar `.env.example` para `.env.local` e preencher as duas variáveis. Um override substitui o par inteiro; configurações incompletas ou chaves secretas bloqueiam o build.

Para um site de projeto no Pages, definir `VITE_BASE_PATH=/camylle-teske/`. Para um domínio próprio, usar `/`. O workflow calcula isso automaticamente; essa variável é para desenvolvimento ou builds manuais.

```sh
npm test
npm run build
npm run preview
```

Teste completo da interface (Chromium instalado; caminho configurável por `CHROMIUM_PATH`):

```sh
npm run test:browser
TEST_BASE_PATH=/camylle-teske/ npm run test:browser
```

Os testes de segurança executam o SQL em Postgres via PGlite, com papéis anon/authenticated e identidade simulada. Verificam leitura pública, isolamento de rascunhos e mídias, bloqueio de usuários sem permissão, escrita, publicação, retirada do ar, exclusão e ordenação. Os testes de navegador usam um contrato HTTP controlado do Supabase para verificar a interface. A ativação final deve confirmar esses fluxos na instância real do Supabase, incluindo o e-mail de recuperação.

Dados novos ficam no Supabase, não em commits Git. Fazer backup/exportação do banco e armazenamento conforme o plano contratado. Os limites e condições dos serviços devem ser conferidos nas contas de vocês.

Os trabalhos e fotografias pertencem a Camylle Teske. A fonte DM Sans acompanha sua licença OFL em `public/fonts/OFL-dm-sans.txt`.
