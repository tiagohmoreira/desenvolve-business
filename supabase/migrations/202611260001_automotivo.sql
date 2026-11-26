begin;

create schema automotivo_privado;
grant usage on schema automotivo_privado to anon, authenticated;

alter table public.empresas
  add column auto_whatsapp text not null default '' check (auto_whatsapp ~ '^[0-9]{0,15}$'),
  add column auto_plano text not null default '29,90' check (auto_plano in ('29,90', '59,90', '99,90')),
  add column auto_ativa boolean not null default true;

alter table public.produtos
  add column auto_foto text unique,
  add constraint auto_foto_empresa check (
    auto_foto is null or (
      empresa_id is not null and
      auto_foto like empresa_id::text || '/%' and
      auto_foto ~ '^[^/]+/[a-f0-9-]{36}\.(jpg|png|webp)$'
    )
  );

create function automotivo_privado.auto_acesso_produto(empresa text, exige_ativa boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.empresas e
    where e.id::text = empresa
      and (e.segmento is distinct from 'automotivo'
        or (e.proprietario_id = (select auth.uid()) and (not exige_ativa or e.auto_ativa)))
  );
$$;

revoke all on function automotivo_privado.auto_acesso_produto(text, boolean) from public;
grant execute on function automotivo_privado.auto_acesso_produto(text, boolean) to anon, authenticated;

-- Restrições adicionais. As políticas permissivas existentes continuam necessárias.
create policy auto_empresa_proprietario on public.empresas
  as restrictive for all to anon, authenticated
  using (segmento is distinct from 'automotivo' or proprietario_id = (select auth.uid()))
  with check (segmento is distinct from 'automotivo' or proprietario_id = (select auth.uid()));

create policy auto_produto_leitura on public.produtos
  as restrictive for select to anon, authenticated
  using (empresa_id is null or automotivo_privado.auto_acesso_produto(empresa_id::text, false));

create policy auto_produto_insercao on public.produtos
  as restrictive for insert to anon, authenticated
  with check (empresa_id is null or automotivo_privado.auto_acesso_produto(empresa_id::text, true));

create policy auto_produto_edicao on public.produtos
  as restrictive for update to anon, authenticated
  using (empresa_id is null or automotivo_privado.auto_acesso_produto(empresa_id::text, true))
  with check (empresa_id is null or automotivo_privado.auto_acesso_produto(empresa_id::text, true));

create policy auto_produto_exclusao on public.produtos
  as restrictive for delete to anon, authenticated
  using (empresa_id is null or automotivo_privado.auto_acesso_produto(empresa_id::text, true));

create function automotivo_privado.auto_validar_produto()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.empresa_id is distinct from new.empresa_id then
    if exists (
      select 1 from public.empresas e
      where e.segmento = 'automotivo' and e.id in (old.empresa_id, new.empresa_id)
    ) then
      raise exception 'Não é possível transferir um produto automotivo entre empresas.'
        using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1 from public.empresas e
    where e.id = new.empresa_id and e.segmento = 'automotivo'
  ) and (
    new.estoque is null or new.estoque < 0 or new.preco is null or new.preco < 0
    or new.custo is null or new.custo < 0
    or new.preco::text in ('NaN', 'Infinity', '-Infinity')
    or new.custo::text in ('NaN', 'Infinity', '-Infinity')
  ) then
    raise exception 'Estoque, custo e preço do produto devem ser valores válidos e não negativos.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function automotivo_privado.auto_validar_produto() from public;
create trigger auto_validar_produto
  before insert or update of empresa_id, estoque, preco, custo on public.produtos
  for each row execute function automotivo_privado.auto_validar_produto();

create function public.auto_vitrine(empresa text default null, pagina integer default 0)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id::text, 'nome', q.nome, 'whatsapp', q.auto_whatsapp,
    'produtos', q.produtos
  ) order by q.id), '[]'::jsonb)
  from (
    select e.id, e.nome, e.auto_whatsapp,
      case when empresa is null then '[]'::jsonb else (
        select coalesce(jsonb_agg(jsonb_build_object(
          'nome', p.nome, 'descricao', p.descricao, 'preco', p.preco, 'foto', p.auto_foto
        ) order by p.id), '[]'::jsonb)
        from (
          select p.id, p.nome, p.descricao, p.preco, p.auto_foto
          from public.produtos p
          where p.empresa_id = e.id and p.ativo and p.estoque > 0
          order by p.id
          limit 50 offset greatest(pagina, 0)::bigint * 50
        ) p
      ) end as produtos
    from public.empresas e
    where e.segmento = 'automotivo' and e.auto_ativa
      and (empresa is null or e.id::text = empresa)
    order by e.id
    limit 50 offset case when empresa is null then greatest(pagina, 0)::bigint * 50 else 0 end
  ) q;
$$;

revoke all on function public.auto_vitrine(text, integer) from public;
grant execute on function public.auto_vitrine(text, integer) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('automotivo-fotos', 'automotivo-fotos', false, 1500000, array['image/jpeg', 'image/png', 'image/webp']);

create function automotivo_privado.auto_foto_permitida(caminho text, operacao text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.empresas e
    where e.id::text = split_part(caminho, '/', 1) and e.segmento = 'automotivo'
      and (
        (operacao = 'ler' and (
          e.proprietario_id = (select auth.uid()) or (
            e.auto_ativa and exists (
              select 1 from public.produtos p
              where p.empresa_id = e.id and p.auto_foto = caminho and p.ativo and p.estoque > 0
            )
          )
        ))
        or (e.proprietario_id = (select auth.uid()) and (
          (operacao = 'criar' and e.auto_ativa and caminho ~ '^[^/]+/[a-f0-9-]{36}\.(jpg|png|webp)$')
          or (operacao = 'excluir' and not exists (
            select 1 from public.produtos p where p.auto_foto = caminho
          ))
        ))
      )
  );
$$;

revoke all on function automotivo_privado.auto_foto_permitida(text, text) from public;
grant execute on function automotivo_privado.auto_foto_permitida(text, text) to anon, authenticated;

create policy auto_foto_leitura on storage.objects for select to anon, authenticated
  using (bucket_id = 'automotivo-fotos' and automotivo_privado.auto_foto_permitida(name, 'ler'));
create policy auto_foto_leitura_limite on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id <> 'automotivo-fotos' or automotivo_privado.auto_foto_permitida(name, 'ler'));

create policy auto_foto_insercao on storage.objects for insert to authenticated
  with check (bucket_id = 'automotivo-fotos' and automotivo_privado.auto_foto_permitida(name, 'criar'));
create policy auto_foto_insercao_limite on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'automotivo-fotos' or automotivo_privado.auto_foto_permitida(name, 'criar'));

create policy auto_foto_exclusao on storage.objects for delete to authenticated
  using (bucket_id = 'automotivo-fotos' and automotivo_privado.auto_foto_permitida(name, 'excluir'));
create policy auto_foto_exclusao_limite on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'automotivo-fotos' or automotivo_privado.auto_foto_permitida(name, 'excluir'));

create policy auto_foto_imutavel on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'automotivo-fotos') with check (bucket_id <> 'automotivo-fotos');

notify pgrst, 'reload schema';
commit;
