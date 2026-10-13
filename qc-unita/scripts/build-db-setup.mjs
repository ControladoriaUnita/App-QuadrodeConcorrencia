/**
 * Junta as migrations (supabase/migrations/NNN_*.sql) num único script para colar no
 * SQL Editor do Supabase quando o projeto ainda não tem nenhuma tabela.
 *
 *   npm run db:bundle   →   supabase/setup/qc_unita_schema_completo.sql
 *
 * O script é para banco VAZIO: aborta se public.works já existir. Para um banco que já
 * recebeu parte das migrations, rode só as que faltam (na ordem) ou use `supabase db push`.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'supabase', 'migrations')
const out = join(root, 'supabase', 'setup', 'qc_unita_schema_completo.sql')

const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()
const parts = [
  `-- =============================================================================
-- Quadro de Concorrência · Unità Engenharia — schema completo
-- GERADO por scripts/build-db-setup.mjs a partir de ${files.length} migrations
-- (${files[0]} … ${files.at(-1)}). Não edite à mão: altere a migration e rode npm run db:bundle.
--
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Roda numa única transação: se algo falhar, nada fica pela metade.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.works') is not null then
    raise exception 'O schema do QC já existe neste banco (public.works). Rode só as migrations que faltam.';
  end if;
end $$;
`,
]
for (const f of files) {
  parts.push(`\n-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> ${f}\n`)
  parts.push(readFileSync(join(dir, f), 'utf8').trimEnd() + '\n')
}
parts.push(`
-- Registro das migrations aplicadas (para o Supabase CLI não reaplicar com db push)
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values
${files.map((f) => `  ('${f.slice(0, 3)}', '${f.slice(4, -4)}')`).join(',\n')}
on conflict (version) do nothing;

commit;
`)

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, parts.join(''), 'utf8')
console.log(`OK: ${files.length} migrations → ${out}`)
