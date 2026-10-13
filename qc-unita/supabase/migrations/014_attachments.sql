-- =============================================================================
-- 014_attachments.sql
-- Upload de anexos (propostas, memoriais, planilhas do orçamento, documentos de contrato).
--
--  * O arquivo vai direto do navegador para o Storage (URL assinada gerada pela API) — o
--    binário não passa pela Vercel Function (limite de 4,5 MB por requisição).
--  * public.attachments guarda os metadados; o caminho continua
--    {work_id}/{entity_type}/{entity_id}/{uuid}-{arquivo}.
--  * Novas origens: 'work' (documentos gerais da obra) e 'budget' (planilha importada).
--  * Quem enviou pode remover o próprio anexo enquanto a revisão do QC não estiver congelada;
--    administradores removem qualquer um. Remoção de anexo fica na auditoria.
-- =============================================================================

alter table public.attachments drop constraint if exists attachments_entity_type_check;
alter table public.attachments add constraint attachments_entity_type_check check (entity_type in (
  'work', 'budget', 'competition', 'competition_revision', 'supplier_proposal', 'supplier',
  'contract_request', 'contract_addendum'));

alter table public.attachments add column if not exists description text check (description is null or length(description) <= 500);
alter table public.attachments add column if not exists competition_supplier_id uuid references public.competition_suppliers (id) on delete set null;

create index if not exists attachments_work_idx on public.attachments (work_id, uploaded_at desc);

-- Anexo vinculado a uma revisão aprovada (congelada) não pode ser removido
create or replace function public.attachment_is_frozen(p_entity_type text, p_entity_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select case p_entity_type
    when 'competition_revision' then exists (select 1 from public.competition_revisions r where r.id = p_entity_id and r.frozen_at is not null)
    else false
  end
$$;

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments for delete to authenticated
  using (
    public.auth_is_admin()
    or (uploaded_by = auth.uid()
        and public.auth_has_permission('attachment.upload', work_id)
        and not public.attachment_is_frozen(entity_type, entity_id))
  );

-- Storage: quem enviou também pode apagar o binário (o metadado é apagado em seguida pela API)
drop policy if exists qc_attachments_delete on storage.objects;
create policy qc_attachments_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'qc-attachments'
    and (public.auth_is_admin()
         or exists (select 1 from public.attachments a
                     where a.storage_path = storage.objects.name
                       and a.uploaded_by = auth.uid()
                       and not public.attachment_is_frozen(a.entity_type, a.entity_id)))
  );
