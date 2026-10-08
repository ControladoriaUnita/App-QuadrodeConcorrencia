import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui'
import { LoginPage } from '@/features/auth/LoginPage'
import { SuppliersPage } from '@/features/catalog/SuppliersPage'
import { CompetitionPage } from '@/features/competitions/CompetitionPage'
import { ContractPage } from '@/features/contracts/ContractPage'
import { WorkPage } from '@/features/works/WorkPage'
import { WorkSelectPage } from '@/features/works/WorkSelectPage'
import { IntegrationPage } from '@/features/integration/IntegrationPage'
import { useAuth } from '@/lib/auth'

function Protected() {
  const { hasSession, loading } = useAuth()
  if (!hasSession) return <Navigate to="/entrar" replace />
  if (loading)
    return (
      <div className="flex h-full items-center justify-center text-primary">
        <Spinner />
      </div>
    )
  return <AppShell />
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route element={<Protected />}>
        <Route index element={<Navigate to="/obras" replace />} />
        <Route path="/obras" element={<WorkSelectPage />} />
        <Route path="/obras/:workId" element={<WorkPage />} />
        <Route path="/obras/:workId/qc/:id" element={<CompetitionPage />} />
        <Route path="/concorrencias/:id" element={<CompetitionPage />} />
        <Route path="/obras/:workId/contratos/:id" element={<ContractPage />} />
        <Route path="/fornecedores" element={<SuppliersPage />} />
        <Route path="/integracao" element={<IntegrationPage />} />
        <Route path="*" element={<Navigate to="/obras" replace />} />
      </Route>
    </Routes>
  )
}
