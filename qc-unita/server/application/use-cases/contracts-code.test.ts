/**
 * Dois pedidos ao mesmo tempo calculavam o mesmo número de solicitação; o banco recusava o segundo
 * (código único) e o usuário recebia um erro 500. Agora tenta de novo com o próximo número.
 */
import { describe, expect, it } from 'vitest'
import type { NewContractRequest, Repositories } from '../ports'
import { createWithFreshCode } from './contracts'

function fakeRepos(failures: number) {
  const codes = ['SC-1-001', 'SC-1-002', 'SC-1-003', 'SC-1-004']
  let n = 0
  const saved: string[] = []
  const repos = {
    contracts: {
      nextCode: async () => codes[n]!,
      create: async (d: NewContractRequest) => {
        if (n++ < failures) throw new Error('duplicate key value violates unique constraint "contract_requests_code_key"')
        saved.push(d.code)
        return `id-${d.code}`
      },
    },
  } as unknown as Repositories
  return { repos, saved }
}

describe('número da solicitação sem colisão', () => {
  it('número repetido pelo banco: tenta com o próximo', async () => {
    const { repos, saved } = fakeRepos(1)
    expect(await createWithFreshCode(repos, 'w', '1', 'u', {} as Omit<NewContractRequest, 'code'>)).toEqual({ id: 'id-SC-1-002', code: 'SC-1-002' })
    expect(saved).toEqual(['SC-1-002'])
  })

  it('desiste depois de três colisões e outros erros sobem direto', async () => {
    await expect(createWithFreshCode(fakeRepos(3).repos, 'w', '1', 'u', {} as Omit<NewContractRequest, 'code'>)).rejects.toThrow(/contract_requests_code_key/)
  })
})
