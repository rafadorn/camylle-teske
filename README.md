# Camylle Teske — portfólio e painel

Layout aprovado: capa com Camylle Teske em Bogue-Light, Sobre e Projetos em páginas separadas, grade assimétrica e capas estáticas. Apenas o fundo do menu acompanha o mouse e o foco do teclado. Os trabalhos continuam sendo publicados pelo painel, sem recompilar o site. As fontes e imagens são servidas pelo próprio site; DM Sans cobre os caracteres ausentes dos subconjuntos do PDF.

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

**Estado:** site e painel publicados pelo GitHub Pages em `camylle-teske.com.br`. O usuário confirmou a ativação de HTTPS e o recebimento do e-mail de recuperação. O projeto Supabase foi criado e a conta da Camy foi liberada pelo usuário. A configuração contém somente URL e chave publicável. O repositório é [rafadorn/camylle-teske](https://github.com/rafadorn/camylle-teske). Os testes locais usam um banco e um contrato de API isolados; não comprovam as permissões da instância real, que este ambiente não consegue consultar. A revisão de produção usa a consulta somente leitura `supabase/security-check.sql` e as instruções em `SECURITY.md`.

- [Abrir portfólio](https://camylle-teske.com.br/)
- [Abrir painel da Camy](https://camylle-teske.com.br/admin/)

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
6. Em **Authentication > URL Configuration**, definir **Site URL** como `https://camylle-teske.com.br/` e adicionar o endereço exato da recuperação de senha a **Redirect URLs**:
   - Sem domínio: `https://rafadorn.github.io/camylle-teske/admin/?senha=alterar`
   - Com domínio: `https://camylle-teske.com.br/admin/?senha=alterar`
7. Verificar o envio dos e-mails de recuperação. Para entrega regular em produção, configurar SMTP próprio conforme a [documentação de e-mail do Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

As regras do banco liberam edição apenas aos UUIDs explicitamente cadastrados. Um visitante autenticado não ganha permissão. O bucket de novas imagens é privado; somente imagens referenciadas por projetos publicados recebem URLs de leitura temporárias. A interface pede URLs com cinco minutos de validade, mas esse prazo é um parâmetro do cliente, não um teto imposto pelas regras do banco. Links já emitidos podem continuar acessíveis até expirar, e um visitante pode pedir validade maior enquanto a imagem está publicada. Retirar um trabalho do ar impede novas leituras autorizadas pelas regras, mas não recolhe cópias já baixadas. As imagens originais continuam públicas no repositório.

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

### 3. Domínio próprio

O domínio do portfólio é **camylle-teske.com.br**. Para conectá-lo ao GitHub Pages, configurar o domínio no GitHub, os registros DNS no Registro.br e as URLs de autenticação no Supabase.

1. Verificar a propriedade do domínio nas configurações de Pages do GitHub.
2. No repositório, ir a **Settings > Pages > Custom domain**, adicionar `camylle-teske.com.br` e salvar antes de configurar o DNS.
3. No painel DNS do registrador, adicionar os quatro registros A para o domínio raiz:

   | Nome | Tipo | Valor |
   | --- | --- | --- |
   | (vazio) | A | `185.199.108.153` |
   | (vazio) | A | `185.199.109.153` |
   | (vazio) | A | `185.199.110.153` |
   | (vazio) | A | `185.199.111.153` |
   | `www` | CNAME | `rafadorn.github.io` |

   No editor DNS do Registro.br, deixar o campo Nome vazio nas quatro entradas A: o caractere `@` não é aceito. No CNAME, usar `www` como Nome e `rafadorn.github.io` como valor, sem `https://` e sem o nome do repositório. Se a zona estiver em transição, aguardar sua liberação antes de adicionar as entradas.
4. Depois de salvar o domínio no Pages, iniciar uma nova execução em **Actions > Publicar portfólio > Run workflow**. O workflow calcula o caminho base `/` automaticamente. Uma nova execução usa seus próprios artefatos; reexecutar o build de uma execução já concluída pode gerar artefatos duplicados e impedir o deploy.
5. Após a verificação do DNS, habilitar **Enforce HTTPS** no Pages.
6. Em **Supabase > Authentication > URL Configuration**, usar `https://camylle-teske.com.br/` como **Site URL** e adicionar `https://camylle-teske.com.br/admin/?senha=alterar` em **Redirect URLs**. Testar o login e a recuperação de senha no domínio novo.

Com o domínio raiz configurado, o GitHub pode redirecionar `www` para o endereço sem `www`. Não é necessário comprar hospedagem junto com o domínio para esta estrutura.

Referência para os valores DNS: [documentação oficial do GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## Uso da Camy

### Disposição aprovada

A capa fica em `/`, o catálogo em `/projetos/`, o Sobre em `/sobre/` e o Contato em `/contato/`. Os links antigos de trabalhos e a rota dinâmica `/projeto/?trabalho=...` continuam disponíveis. A composição se repete a cada seis projetos e se adapta a grupos menores, rascunhos e novas publicações. O painel mantém seu visual e seus controles anteriores.

### Estatísticas e preferências de privacidade

O site pede autorização antes de enviar estatísticas. **Aceitar estatísticas** e
**Recusar** têm o mesmo destaque; o rodapé permite mudar a escolha depois. A
preferência é salva em `localStorage` como `accepted` ou `refused`, sem criar ID
de visitante nem cookie de rastreamento. Sem autorização, não há requisição ao
coletor. Login e a área `/admin/` ficam fora da contagem.

No painel, abrir **Estatísticas de acesso** para consultar hoje, os últimos sete
e trinta dias, páginas mais acessadas e totais por dia. São visualizações de
páginas autorizadas, não pessoas únicas. Não há histórico anterior à ativação;
visitantes que recusam não entram nos totais.

O coletor `record-portfolio-view` valida origem, chave publicável, consentimento
e caminho canônico. Não recebe parâmetros da URL, fragmentos, referrer, sessão
de login ou identificador de visitante no payload. Nunca encaminha IP ou
User-Agent ao banco. A Edge Function recebe as credenciais de servidor somente
pelas variáveis automáticas do Supabase; nenhuma chave privilegiada vai ao site.
Os provedores podem processar metadados técnicos de conexão fora deste relatório,
conforme descrito na página `/privacidade/`.

As tabelas `private.portfolio_daily_views` e `private.portfolio_analytics_budget`
guardam, respectivamente, totais por dia/página (relatórios de até 365 dias) e um limite global
por minuto (janela de dois minutos, limpa na próxima coleta). Não há tabela de visitas individuais. A limpeza das contagens antigas ocorre
a cada nova coleta; não há um agendamento de limpeza.
RLS e permissões impedem leitura pública, escrita direta do visitante e leitura
por contas fora da lista de administradores. A gravação é `SECURITY INVOKER`,
executável apenas por `service_role`, e valida novamente as páginas publicadas.

Para uma instalação nova, executar primeiro `supabase/schema.sql`, depois a
migração `privacy_analytics` em `supabase/migrations/`, e publicar a função em
`supabase/functions/record-portfolio-view`. Ela usa `verify_jwt = false` porque
verifica a chave publicável no próprio código, compatível com `sb_publishable_`.
Não há mudança de plano ou novo agendamento. Os limites normais do Supabase
continuam aplicáveis.

O pipeline de publicação executa `scripts/check-analytics.mjs`: `HEAD` verifica
coletor e RPC sem criar um acesso; requisições sem consentimento e chamadas
anônimas às funções privilegiadas precisam ser rejeitadas. Esse teste não deve
ser usado como contagem de visita nem como substituto da checagem de saúde dos
trabalhos publicados.

### Navegar pelo site e pelo painel

O menu **Início** volta à capa. Os botões **Voltar / Avançar** indicam o destino nas páginas e permitem passar entre trabalhos publicados. No painel, **Início do painel** retorna à lista, e o editor permite abrir o trabalho anterior ou seguinte. Sair de uma edição sem salvar pede confirmação.

### Montar o layout pelo painel

Em **Trabalhos > Montar layout da grade**, arrastar as capas ou usar **Antes / Depois**, escolher pequena, larga, alta, destaque ou largura inteira e conferir a prévia de celular. **Salvar layout da grade** aplica ordem e tamanhos juntos; sair sem salvar descarta a montagem. Rascunhos ficam fora da prévia pública. **Usar tamanhos automáticos** recupera a composição aprovada sem mudar a ordem escolhida.

Em **Editar trabalho > Imagens > Montar layout das imagens**, a montagem abre em uma área ampla. Clicar na foto ou na miniatura seleciona a imagem; os botões de tamanho e alinhamento mudam a prévia imediatamente. Arrastar na montagem ou usar **Antes / Depois** reorganiza as imagens. **Uma / Duas / Três por linha** aplica uma organização inicial ao conjunto, e a prévia de celular mostra a coluna única. **Voltar aos dados do trabalho** preserva a montagem em edição; os botões de salvar do trabalho a aplicam ao site. Abrir a prévia ou trocar seu dispositivo não altera os dados.

Nos controles da lista de imagens, cada imagem tem largura inteira, metade ou um terço e alinhamento na sequência, à esquerda, ao centro ou à direita. A prévia aparece abaixo dos controles. Arrastar ou usar **Subir / Descer** muda a ordem da galeria; a escolha da capa é independente. **Salvar como rascunho** ou **Salvar e manter publicado** guarda essa montagem. A disposição automática existente é preservada até editar esses controles, e pode ser restaurada pelo botão da prévia. No celular, as imagens ficam em uma coluna para continuar legíveis.

As escolhas são valores predefinidos, sem HTML, CSS ou scripts enviados pelo painel. A migração `visual_layout_editor` adiciona somente metadados de apresentação e uma gravação atômica sob as regras de administrador existentes. Uma aba antiga precisa atualizar antes de sobrescrever uma versão mais recente. As prévias de rascunhos usam a sessão do administrador, não ficam salvas no navegador e desaparecem ao sair.

### Publicar e editar trabalhos

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

Os testes de segurança executam o SQL em Postgres via PGlite, com papéis anon/authenticated e identidade simulada. Verificam leitura pública, isolamento de rascunhos e mídias, bloqueio de usuários sem permissão, escrita, publicação, retirada do ar, exclusão, ordenação e a consulta de auditoria. Os testes de navegador geram um bundle de produção separado com um contrato controlado do Supabase. Verificam CSP, bloqueio do painel em HTTP, menus, contato, recuperação, saída entre abas e telas de 320, 390 e 430 pixels. A configuração de teste nunca é publicada. A ativação final deve confirmar os fluxos na instância real do Supabase.

Dados novos ficam no Supabase, não em commits Git. Fazer backup/exportação do banco e armazenamento conforme o plano contratado. Os limites e condições dos serviços devem ser conferidos nas contas de vocês.

Os trabalhos e fotografias pertencem a Camylle Teske. A fonte DM Sans acompanha sua licença OFL em `public/fonts/OFL-dm-sans.txt`.
