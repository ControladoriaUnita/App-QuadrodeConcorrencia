/**
 * Vercel Function única para /api/* (ver rewrites em vercel.json).
 * Mantém a camada HTTP fina: toda regra está em server/application e shared/domain.
 */
import { handle } from '../server/http/router'

export const config = { maxDuration: 30 }

export default {
  fetch(request: Request): Promise<Response> {
    return handle(request)
  },
}
