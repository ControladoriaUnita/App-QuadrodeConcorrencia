-- =============================================================================
-- 026_addendum_reduce_lines.sql
-- Aditivo com acréscimo e redução na mesma solicitação (remanejamento entre linhas).
--
--   * No aditivo, cada item pode acrescentar (quantidade positiva) ou reduzir (negativa). A redução
--     é só de itens do contrato. O total do aditivo é o líquido.
--   * O distrato continua só reduzindo itens do contrato.
--   * Nada muda nas tabelas: só a regra de sinal do trigger.
-- =============================================================================

create or replace function public.check_addendum_item_sign()
returns trigger language plpgsql
as $$
declare v_kind public.addendum_kind;
begin
  select kind into v_kind from public.contract_addenda where id = new.addendum_id;
  if new.quantity_delta = 0 then
    raise exception 'ADDENDUM_SIGN: a quantidade do item % não pode ser zero', new.code using errcode = 'P0001';
  end if;
  if new.quantity_delta < 0 and new.contract_request_item_id is null then
    raise exception 'ADDENDUM_SIGN: só itens do contrato podem ser reduzidos (%)', new.code using errcode = 'P0001';
  end if;
  if v_kind = 'termination' and new.quantity_delta > 0 then
    raise exception 'ADDENDUM_SIGN: no distrato o item % deve ter quantidade negativa', new.code using errcode = 'P0001';
  end if;
  return new;
end;
$$;
