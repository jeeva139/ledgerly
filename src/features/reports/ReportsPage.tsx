import { useState } from 'react'
import { useApp } from '@/app/AppContext'
import { PageHeader, Tabs } from '@/components/layout'
import { periodLabel } from './ReportParts'
import {
  AccountsView, CategoryTrendsView, IncomeVsSpendingView, MonthlyView, SpendingByCategoryView, TagsView, TopMerchantsView
} from './ReportViews'
import './reports.css'

type ReportTab = 'category' | 'monthly' | 'income-spending' | 'trends' | 'merchants' | 'accounts' | 'tags'

const TABS: { id: ReportTab; label: string }[] = [
  { id: 'category', label: 'Spending by category' },
  { id: 'monthly', label: 'Monthly spending' },
  { id: 'income-spending', label: 'Income vs spending' },
  { id: 'trends', label: 'Category trends' },
  { id: 'merchants', label: 'Top merchants' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'tags', label: 'Tags' }
]

export function ReportsPage() {
  const { period, route } = useApp()
  const initial = TABS.some((t) => t.id === route.params.tab) ? (route.params.tab as ReportTab) : 'category'
  const [tab, setTab] = useState<ReportTab>(initial)

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        subtitle={`Built from the transactions stored on this computer · ${periodLabel(period)}. Change the period at the top right.`}
      />
      <Tabs value={tab} onChange={setTab} tabs={TABS} label="Reports" />
      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {tab === 'category' && <SpendingByCategoryView period={period} />}
        {tab === 'monthly' && <MonthlyView period={period} />}
        {tab === 'income-spending' && <IncomeVsSpendingView period={period} />}
        {tab === 'trends' && <CategoryTrendsView period={period} />}
        {tab === 'merchants' && <TopMerchantsView period={period} />}
        {tab === 'accounts' && <AccountsView period={period} />}
        {tab === 'tags' && <TagsView period={period} />}
      </div>
    </div>
  )
}
