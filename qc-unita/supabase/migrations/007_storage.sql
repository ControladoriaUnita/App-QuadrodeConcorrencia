-- =============================================================================
-- 007_storage.sql
-- Bucket privado para anexos (propostas, memoriais, aditivos, documentos de fornecedores)
-- Convenção de caminho: {work_id}/{entity_type}/{entity_id}/{uuid}-{nome-do-arquivo}
-- O banco guarda apenas metadados em public.attachments.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'qc-attachments', 'qc-attachments', false, 52428800,
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/zip',
    'text/csv'
  ]
)
on conflict (id) do nothing;

-- Primeiro segmento do caminho = work_id
create or replace function public.storage_work_id(p_name text)
returns uuid language plpgsql immutable
as $$
declare v text := split_part(p_name, '/', 1);
begin
  if v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end;
$$;

create policy qc_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'qc-attachments'
         and public.auth_can_access_work(public.storage_work_id(name))
         and public.auth_has_permission('competition.read', public.storage_work_id(name)));

create policy qc_attachments_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'qc-attachments'
              and public.auth_has_permission('attachment.upload', public.storage_work_id(name)));

create policy qc_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'qc-attachments' and public.auth_is_admin());
