import { useMemo } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BucketGranularity, TimeBucket } from '@shared/api/reports'
import { useApp } from '@/app/AppContext'
import { ChartTooltip } from './ChartTooltip'
import { axisMoney, bucketLabel, bucketLabelLong, monthLabel } from './format'
import { useChartColors } from './useChartColors'

const HEIGHT = 260
const MARGIN = { top: 12, right: 16, bottom: 0, left: 0 }
/** Room above the plot for the end-of-line value label. */
const MARGIN_LABELLED = { top: 30, right: 28, bottom: 0, left: 0 }

function useAxisProps() {
  const { prefs } = useApp()
  const c = useChartColors()
  return {
    colors: c,
    currency: prefs.currency,
    xAxis: {
      tickLine: false,
      axisLine: { stroke: c.axis },
      tick: { fill: c.muted, fontSize: 12 },
      interval: 'preserveStartEnd' as const,
      minTickGap: 18,
      padding: { left: 8, right: 8 }
    },
    yAxis: {
      tickLine: false,
      axisLine: false,
      tick: { fill: c.muted, fontSize: 12 },
      width: 58,
      tickFormatter: (n: number) => axisMoney(n, prefs.currency)
    }
  }
}

interface TimeProps {
  buckets: TimeBucket[]
  granularity: BucketGranularity
}

/**
 * Cash flow: the running total of (income − spending) over time. One series on one axis, a 10% wash
 * under a 2px line, the zero line drawn when the total dips below it, and the latest value labelled.
 * The per-bucket net is in the tooltip and the table view.
 */
export function CashFlowChart({ buckets, granularity }: TimeProps) {
  const { fmt } = useApp()
  const { colors, xAxis, yAxis } = useAxisProps()
  const data = useMemo(() => buckets.map((b) => ({ ...b, label: bucketLabel(b.key, granularity) })), [buckets, granularity])
  const last = data[data.length - 1]
  const hasNegative = data.some((d) => d.cumulative < 0)
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <AreaChart data={data} margin={MARGIN_LABELLED}>
        <CartesianGrid vertical={false} stroke={colors.grid} />
        <XAxis dataKey="label" {...xAxis} />
        <YAxis {...yAxis} />
        {hasNegative && <ReferenceLine y={0} stroke={colors.axis} />}
        <Tooltip
          cursor={{ stroke: colors.axis, strokeWidth: 1 }}
          content={
            <ChartTooltip
              formatValue={(n) => fmt.money(n)}
              heading={(_l, p) => bucketLabelLong(String(p?.key ?? ''), granularity)}
              series={{ cumulative: { name: 'Running total', color: colors.accent, shape: 'line' } }}
              extra={(p) => [
                { name: 'Net this ' + (granularity === 'day' ? 'day' : 'month'), value: fmt.money(Number(p?.net ?? 0), { sign: true }), color: colors.muted, shape: 'line' }
              ]}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="cumulative"
          stroke={colors.accent}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={colors.accent}
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 5, fill: colors.accent, stroke: colors.surface, strokeWidth: 2 }}
          isAnimationActive={false}
        />
        {last && (
          <ReferenceDot
            x={last.label}
            y={last.cumulative}
            r={5}
            fill={colors.accent}
            stroke={colors.surface}
            strokeWidth={2}
            label={{ value: fmt.money(last.cumulative), position: 'top', fill: colors.text, fontSize: 12, fontWeight: 600 }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Spending per bucket as thin bars (≤ 24px, 4px rounded data-end, square at the baseline). */
export function SpendingBarsChart({ buckets, granularity }: TimeProps) {
  const { fmt } = useApp()
  const { colors, xAxis, yAxis } = useAxisProps()
  const data = useMemo(() => buckets.map((b) => ({ ...b, label: bucketLabel(b.key, granularity) })), [buckets, granularity])
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <BarChart data={data} margin={MARGIN}>
        <CartesianGrid vertical={false} stroke={colors.grid} />
        <XAxis dataKey="label" {...xAxis} />
        <YAxis {...yAxis} />
        <Tooltip
          cursor={{ fill: colors.grid, fillOpacity: 0.55 }}
          content={
            <ChartTooltip
              formatValue={(n) => fmt.money(n)}
              heading={(_l, p) => bucketLabelLong(String(p?.key ?? ''), granularity)}
              series={{ expense: { name: 'Spending', color: colors.spending } }}
            />
          }
        />
        <Bar dataKey="expense" fill={colors.spending} maxBarSize={24} radius={[4, 4, 0, 0]} activeBar={{ fillOpacity: 0.8 }} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Income and spending side by side per bucket (one axis, 2px gap between the pair). */
export function IncomeExpenseChart({ buckets, granularity }: TimeProps) {
  const { fmt } = useApp()
  const { colors, xAxis, yAxis } = useAxisProps()
  const data = useMemo(() => buckets.map((b) => ({ ...b, label: bucketLabel(b.key, granularity) })), [buckets, granularity])
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <BarChart data={data} margin={MARGIN} barGap={2} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={colors.grid} />
        <XAxis dataKey="label" {...xAxis} />
        <YAxis {...yAxis} />
        <Tooltip
          cursor={{ fill: colors.grid, fillOpacity: 0.55 }}
          content={
            <ChartTooltip
              formatValue={(n) => fmt.money(n)}
              heading={(_l, p) => bucketLabelLong(String(p?.key ?? ''), granularity)}
              series={{ income: { name: 'Income', color: colors.positive }, expense: { name: 'Spending', color: colors.spending } }}
              extra={(p) => [{ name: 'Net', value: fmt.money(Number(p?.net ?? 0), { sign: true }), color: colors.muted, shape: 'line' }]}
            />
          }
        />
        <Bar dataKey="income" fill={colors.positive} maxBarSize={24} radius={[4, 4, 0, 0]} activeBar={{ fillOpacity: 0.8 }} isAnimationActive={false} />
        <Bar dataKey="expense" fill={colors.spending} maxBarSize={24} radius={[4, 4, 0, 0]} activeBar={{ fillOpacity: 0.8 }} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Monthly spending of the top categories as lines. Colours are assigned in fixed slot order. */
export function CategoryTrendsChart({ months, series }: { months: string[]; series: { name: string; values: number[] }[] }) {
  const { fmt } = useApp()
  const { colors, xAxis, yAxis } = useAxisProps()
  const data = useMemo(
    () =>
      months.map((m, i) => {
        const row: Record<string, string | number> = { key: m, label: bucketLabel(m, 'month') }
        series.forEach((s, si) => (row[`s${si}`] = s.values[i]))
        return row
      }),
    [months, series]
  )
  const meta = Object.fromEntries(series.map((s, i) => [`s${i}`, { name: s.name.replace(':', ' › '), color: colors.series[i % colors.series.length], shape: 'line' as const }]))
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <LineChart data={data} margin={MARGIN}>
        <CartesianGrid vertical={false} stroke={colors.grid} />
        <XAxis dataKey="label" {...xAxis} />
        <YAxis {...yAxis} />
        <Tooltip
          cursor={{ stroke: colors.axis, strokeWidth: 1 }}
          content={<ChartTooltip formatValue={(n) => fmt.money(n)} heading={(_l, p) => monthLabel(String(p?.key ?? ''))} series={meta} />}
        />
        {series.map((s, i) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={`s${i}`}
            stroke={colors.series[i % colors.series.length]}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={months.length <= 2 ? { r: 4, fill: colors.series[i % colors.series.length], stroke: colors.surface, strokeWidth: 2 } : false}
            activeDot={{ r: 5, fill: colors.series[i % colors.series.length], stroke: colors.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
