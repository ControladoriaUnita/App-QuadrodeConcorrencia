/**
 * Nova concorrência em duas etapas:
 *  1. Objeto + IPs de planejamento (um ou vários).
 *  2. Linhas do orçamento desses IPs, escolhidas linha a linha, com o % de cada linha a
 *     comprometer (verba puxada). Padrão: as linhas com saldo, com o % ainda livre.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Search } from 'lucide-react'
import type { BudgetPackageDTO, WorkDTO } from '@shared/contracts'
import { Decimal } from '@shared/domain/decimal'
import { Alert, Button, Dialog, Field, Input, Skeleton } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatBRL, formatPercent } from '@/utils/format'
import { BudgetLinesTable, freeShare, pulledValue } from '@/features/works/BudgetLinesTable'
import { useBudgetLines } from '@/features/works/api'
import { useCreateCompetition } from './api'

export interface PackageOption extends BudgetPackageDTO {
  /** razão já comprometida/projetada do IP (0..1) */
  consumption: Decimal | null
}

interface Props {
  open: boolean
  work: WorkDTO
  packages: PackageOption[]
  onClose: () => void
  onCreated: (id: string) => void
}

export function NewCompetitionDialog({ open, work, packages, onClose, onCreated }: Props) {
  const create = useCreateCompetition()
  const [step, setStep] = useState<1 | 2>(1)
  const [title, setTitle] = useState('')
  const [requestedOn, setRequestedOn] = useState(new Date().toISOString().slice(0, 10))
  const [pkgs, setPkgs] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<Map<string, string>>(new Map())
  const [touched, setTouched] = useState(false)

  const lines = useBudgetLines(work.id, { packages: pkgs }, step === 2 && pkgs.length > 0)

  useEffect(() => {
    if (!open) {
      setStep(1)
      setTitle('')
      setPkgs([])
      setSearch('')
      setSelection(new Map())
      setTouched(false)
      create.reset()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pré-seleciona as linhas com saldo, cada uma com o % ainda livre
  useEffect(() => {
    if (step === 2 && lines.data) {
      setSelection(new Map(lines.data.filter((l) => freeShare(l).isPositive()).map((l) => [l.id, freeShare(l).toFixed(6)])))
    }
  }, [step, lines.data])

  const filteredPkgs = useMemo(() => {
    const q = search.trim().toLowerCase()
    return packages.filter((p) => !q || `${p.packageCode} ${p.description}`.toLowerCase().includes(q))
  }, [packages, search])

  const togglePkg = (code: string) => {
    setPkgs((p) => (p.includes(code) ? p.filter((x) => x !== code) : [...p, code]))
    if (!title.trim() && !pkgs.length) setTitle(packages.find((p) => p.packageCode === code)?.description ?? '')
  }

  const selectedLines = (lines.data ?? []).filter((l) => selection.has(l.id))
  const selectedBudget = Decimal.sum(selectedLines.map((l) => pulledValue(l, selection.get(l.id)!)))
  const overLines = selectedLines.filter((l) => Decimal.from(selection.get(l.id)!).gt(freeShare(l)))
  const zeroLines = selectedLines.filter((l) => !Decimal.from(selection.get(l.id)!).isPositive())
  const titleError = touched && title.trim().length < 3 ? 'Descreva o objeto' : null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={step === 1 ? 'min(94vw, 40rem)' : 'min(96vw, 84rem)'}
      title={step === 1 ? 'Nova concorrência — objeto e IPs' : 'Nova concorrência — linhas do orçamento'}
      description={
        step === 1
          ? 'Selecione um ou mais IPs de planejamento. Na próxima etapa você escolhe as linhas do orçamento, uma a uma.'
          : 'Informe, em cada linha, o percentual que esta contratação vai comprometer — ele define a verba puxada do orçamento. Por padrão vem o percentual ainda livre. Itens são agrupados por insumo, mantendo o vínculo de cada linha.'
      }
      footer={
        step === 1 ? (
          <>
            <Button variant="ghost" className="mr-auto" onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              icon={<ArrowRight className="size-4" />}
              disabled={!pkgs.length}
              onClick={() => {
                setTouched(true)
                if (title.trim().length >= 3) setStep(2)
              }}
            >
              Escolher linhas
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" icon={<ArrowLeft className="size-4" />} className="mr-auto" onClick={() => setStep(1)}>
              Voltar
            </Button>
            <span className="tabular self-center text-sm text-text-muted">
              {selection.size} linha(s) · verba puxada {formatBRL(selectedBudget)}
            </span>
            <Button
              variant="primary"
              disabled={!selection.size || overLines.length > 0 || zeroLines.length > 0}
              loading={create.isPending}
              onClick={async () => {
                const r = await create.mutateAsync({
                  workId: work.id,
                  title: title.trim(),
                  requestedOn,
                  packageCodes: pkgs,
                  lineIds: [...selection.keys()],
                  lineShares: Object.fromEntries(selection),
                })
                onCreated(r.competitionId)
              }}
            >
              Criar concorrência
            </Button>
          </>
        )
      }
    >
      {step === 1 ? (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Field label="Objeto" required error={titleError}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Data da solicitação" required>
              <Input type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
            </Field>
          </div>
          <div className="rounded-card border border-border">
            <div className="flex items-center gap-3 border-b border-border px-3 py-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
                <Input aria-label="Buscar IP" placeholder="Buscar IP de planejamento" className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <span className="text-xs text-text-muted">{pkgs.length} selecionado(s)</span>
            </div>
            <ul className="max-h-80 overflow-auto">
              {filteredPkgs.map((p) => {
                const on = pkgs.includes(p.packageCode)
                const full = p.consumption && p.consumption.gte(1)
                return (
                  <li key={p.packageCode}>
                    <label className={cn('flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm hover:bg-ink-50', on && 'bg-primary-soft/60')}>
                      <input type="checkbox" className="size-4 accent-primary" checked={on} onChange={() => togglePkg(p.packageCode)} />
                      <span className="w-20 shrink-0 font-medium">{p.packageCode}</span>
                      <span className="min-w-0 flex-1 truncate">{p.description}</span>
                      <span className="tabular shrink-0 text-xs text-text-muted">{p.inputs} linhas</span>
                      <span className="tabular w-32 shrink-0 text-right">{formatBRL(p.total)}</span>
                      <span className={cn('tabular w-16 shrink-0 text-right text-xs', full ? 'font-semibold text-error' : 'text-text-muted')}>
                        {p.consumption ? formatPercent(p.consumption, 0) : '0%'}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
          <p className="text-xs text-text-muted">A última coluna mostra quanto do IP já está comprometido/projetado em concorrências.</p>
        </div>
      ) : lines.isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : (
        <>
          <div className="-mx-6 border-y border-border">
            <BudgetLinesTable lines={lines.data ?? []} selectable selection={selection} onSelectionChange={setSelection} maxHeight="55vh" />
          </div>
          {overLines.length > 0 && (
            <Alert tone="error" className="mt-4">
              {overLines.length} linha(s) com percentual acima do saldo livre. Ajuste o % a comprometer.
            </Alert>
          )}
          {zeroLines.length > 0 && (
            <Alert tone="warning" className="mt-4">{zeroLines.length} linha(s) selecionada(s) com 0%. Informe o percentual ou desmarque.</Alert>
          )}
        </>
      )}
      {create.error && <Alert tone="error" className="mt-4">{(create.error as Error).message}</Alert>}
    </Dialog>
  )
}
