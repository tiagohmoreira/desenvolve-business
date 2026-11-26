# desenvolve-business

## Módulo automotivo

O login empresarial usa o cliente configurado em `supabase-client.js`, com a URL e a chave publicável do projeto existente. Em `login.html`, entre e cadastre uma empresa do segmento Automotivo. Em **Meu negócio**, selecione uma empresa para gerenciar seus produtos, estoque, custo, preço e fotos.

A **Central administrativa** é acessível aos proprietários autenticados e permite suspender ou reativar as próprias empresas automotivas. Os planos continuam informativos e não geram cobrança. Uma loja suspensa sai da vitrine e tem seu estoque bloqueado para alterações até ser reativada. Produtos ocultos ou com estoque zerado ficam fora da vitrine. O link **Abrir vitrine da empresa** pode ser compartilhado, e uma vitrine aberta é atualizada a cada 30 segundos enquanto a aba está visível.

O módulo anterior armazenava os dados de demonstração no navegador. Esses dados não são importados automaticamente. O novo painel usa os produtos associados à empresa no Supabase.

### Implantação

1. Antes de publicar os arquivos do site, aplique [a migração SQL](supabase/migrations/202611260001_automotivo.sql) no projeto existente com o SQL Editor ou com o Supabase CLI já vinculado. A migração adiciona colunas, políticas restritivas e o bucket privado `automotivo-fotos`. As permissões existentes de leitura e escrita para os proprietários continuam necessárias.
2. Em um ambiente de teste, use duas contas com empresas distintas. Verifique o cadastro, a edição, a suspensão, a reativação e a exclusão. Tente abrir ou alterar os registros da primeira empresa autenticado pela segunda. Verifique a vitrine em uma aba anônima.
3. Publique os arquivos estáticos após a validação. Use as URLs de produção autorizadas na configuração de Auth do projeto, incluindo a confirmação de e-mail se estiver habilitada.

A função pública da vitrine retorna nome da empresa, WhatsApp comercial, nome, descrição, preço e caminho da imagem dos produtos disponíveis. A leitura anônima das fotos é limitada aos produtos publicados de lojas ativas. Os links assinados expiram após dois minutos.
