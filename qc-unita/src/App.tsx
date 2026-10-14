import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui'
import { LoginPage } from '@/features/auth/LoginPage'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { SuppliersPage } from '@/features/catalog/SuppliersPage'
import { UauCatalogPage } from '@/features/catalog/UauCatalogPage'
import { CompetitionPage } from '@/features/competitions/CompetitionPage'
import { CompetitionsBoardPage } from '@/features/competitions/CompetitionsBoardPage'
import { NewCompetitionPage } from '@/features/competitions/NewCompetitionPage'
import { useWorks } from '@/features/competitions/api'
import { ContractPage } from '@/features/contracts/ContractPage'
import { ContractsListPage } from '@/features/contracts/ContractsListPage'
import { BudgetPage } from '@/features/works/BudgetPage'
import { getLastWorkId, workPath } from '@/features/works/currentWork'
import { WorkSelectPage } from '@/features/works/WorkSelectPage'
import { IntegrationPage } from '@/features/integration/IntegrationPage'
import { useAuth } from '@/lib/auth'

const loading = (
  <div className="flex h-full items-center justify-center text-primary">
    <Spinner />
  </div>
)

function Protected() {
  const { hasSession, recovering, loading: busy } = useAuth()
  // Link de "esqueci minha senha" caiu na página inicial: leva para definir a senha
  if (recovering) return <Navigate to="/redefinir-senha" replace />
  if (!hasSession) return <Navigate to="/entrar" replace />
  if (busy) return loading
  return <AppShell />
}

/** Tela inicial = orçamento da obra (a última usada, ou a única disponível); senão, a seleção de obras. */
function Home() {
  const works = useWorks()
  if (works.isLoading) return loading
  const list = works.data ?? []
  const last = getLastWorkId()
  const target = list.find((w) => w.id === last) ?? (list.length === 1 ? list[0] : undefined)
  return <Navigate to={target ? workPath.budget(target.id) : '/obras'} replace />
}

/** Endereços antigos (/obras/:id?aba=…) → abas novas */
function LegacyWorkRedirect() {
  const { workId = '' } = useParams()
  const [params] = useSearchParams()
  const aba = params.get('aba')
  const to = aba === 'contratos' ? workPath.contracts(workId) : aba === 'servicos' ? workPath.competitions(workId) : workPath.budget(workId)
  return <Navigate to={params.get('importar') ? `${to}?importar=1` : to} replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route element={<Protected />}>
        <Route index element={<Home />} />
        <Route path="/obras" element={<WorkSelectPage />} />
        <Route path="/obras/:workId" element={<LegacyWorkRedirect />} />
        <Route path="/obras/:workId/orcamento" element={<BudgetPage />} />
        <Route path="/obras/:workId/concorrencias" element={<CompetitionsBoardPage />} />
        <Route path="/obras/:workId/concorrencias/nova" element={<NewCompetitionPage />} />
        <Route path="/obras/:workId/qc/:id" element={<CompetitionPage />} />
        <Route path="/concorrencias/:id" element={<CompetitionPage />} />
        <Route path="/obras/:workId/contratos" element={<ContractsListPage />} />
        <Route path="/obras/:workId/contratos/:id" element={<ContractPage />} />
        <Route path="/fornecedores" element={<SuppliersPage />} />
        <Route path="/consulta-uau" element={<UauCatalogPage />} />
        <Route path="/integracao" element={<IntegrationPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
