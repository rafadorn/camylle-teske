# Segurança do portfólio e do painel

## Proteções implementadas

- O GitHub Pages fornece HTTPS. Manter **Enforce HTTPS** ativo.
- O painel bloqueia login e edição em HTTP fora do desenvolvimento local e oferece a versão HTTPS.
- O cliente em uma origem HTTP de produção não restaura, persiste nem renova sessões e não consome tokens de recuperação.
- As páginas usam Content Security Policy com scripts/estilos locais e conexões apenas para a origem do Supabase configurada. Scripts inline, objetos e formulários para outra origem são bloqueados. A política é enviada por meta HTML; ela não substitui todos os cabeçalhos HTTP de segurança nem fornece `frame-ancestors`.
- RLS exige uma conta autorizada para editar. O bucket de novas imagens é privado e rascunhos nunca publicados não têm acesso público nas políticas fornecidas.
- Textos são escapados antes de entrar no HTML; uploads aceitam somente JPG, PNG e WebP, até 8 MB por arquivo.
- A saída ou expiração da sessão remove o editor. Erros de autenticação e recuperação liberam os controles para tentar novamente.
- O build rejeita chaves secretas. A chave publicável do Supabase é intencionalmente pública.
- O CI usa Actions com versões fixadas por SHA. O build tem acesso de leitura; apenas o deploy recebe permissão de publicar. Auditoria de dependências de produção, testes e build precedem a publicação.

## Confirmar nas contas de produção

O ambiente de desenvolvimento não consegue consultar o banco ou as configurações administrativas do Supabase. Os testes locais não confirmam que o SQL aplicado continua igual ao arquivo do repositório.

1. No SQL Editor do projeto correto, executar **somente** `supabase/security-check.sql`. A transação é de leitura e retorna verificações agregadas, sem projetos, tokens, senhas ou UUIDs de usuários. Investigar os resultados `AUSENTE`, `DIVERGENTE` e `REVISAR`; uma policy adicional pode ampliar acesso. Não apagar policies automaticamente.
2. Confirmar **Authentication → Sign In / Providers → Allow new users to sign up** desativado. O painel não oferece cadastro; usuários comuns continuam sem permissão pelas regras RLS.
3. Confirmar **Site URL** `https://camylle-teske.com.br/` e o retorno exato `https://camylle-teske.com.br/admin/?senha=alterar`. Evitar curingas abrangentes em produção.
4. Entrar com a conta da Camy, salvar um rascunho e verificar em uma janela anônima que ele não aparece. Conferir publicação, retirada do ar e recuperação de senha.
5. Ativar autenticação em duas etapas nas contas administrativas do GitHub, Supabase, Registro.br e e-mail. A interface da Camy ainda usa e-mail/senha: segundo fator no painel exige uma implementação e cadastro próprios, não é fornecido pela opção de 2FA do dashboard.
6. Usar senhas exclusivas. Em computador compartilhado, clicar **Sair**; fechar a aba não encerra a sessão.
7. Configurar backup/exportação **do banco e do armazenamento**, e verificar a restauração. O GitHub guarda código e imagens originais; os novos trabalhos e uploads ficam no Supabase.

## Limites de privacidade

Um trabalho público e suas imagens podem ser copiados. Despublicar bloqueia novas leituras permitidas pelas políticas, mas URLs já assinadas podem continuar válidas até expirar. Os cinco minutos usados pela interface não são um limite de revogação garantido pelo servidor. Os originais incluídos neste repositório sempre foram públicos.

Uploads preservam o arquivo original, inclusive metadados que ele contenha. Antes de publicar fotos pessoais, remover localização e demais dados pessoais de EXIF. O painel não faz remoção automática: uma conversão sem tratar orientação, cor e animação poderia alterar os trabalhos.

## Verificação e manutenção

Rodar `npm test`, `npm run test:browser` e `npm audit`. O navegador usa uma API simulada para testar falhas e permissões na interface; os testes SQL validam as regras em um banco local. Atualizar dependências e SHAs de Actions em alterações revisadas, mantendo o lockfile.

Caso uma senha ou chave **secreta** seja exposta, revogá-la no provedor e encerrar sessões afetadas. Apagar um arquivo do último commit não remove uma credencial do histórico. A chave `sb_publishable_...` não é uma chave secreta e não deve ser usada como mecanismo de controle de acesso.
