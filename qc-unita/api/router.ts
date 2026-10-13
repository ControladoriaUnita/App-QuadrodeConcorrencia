/**
 * Vercel Function única para /api/* (ver rewrites em vercel.json).
 * Mantém a camada HTTP fina: toda regra está em server/application e shared/domain.
 */
import { handle } from '../server/http/router'

// 60 s (teto do plano Hobby): a sincronização de fornecedores da UAU lê ~8,5 mil pessoas em faixas (~15 s, até 45 s) e grava em lotes
export const config = { maxDuration: 60 }

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request)
  },
}
