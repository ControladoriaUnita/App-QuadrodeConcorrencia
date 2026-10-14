-- =============================================================================
-- 021_work_archive.sql
-- Arquivar obra (administrador): a obra sai das listas, mas nada é apagado.
--
-- Separado da situação da obra (ativa, concluída...) para que desarquivar a devolva como estava.
-- =============================================================================

alter table public.works
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id);

create index if not exists works_archived_idx on public.works (archived_at) where archived_at is not null;
