'use client'

import { ReactNode } from 'react'

/* =====================================================================
   Cleenzo Admin — shared UI kit (dense, data-focused)
   Import from '@/app/(admin)/_ui' in any admin page.
   ===================================================================== */

/* ---- Page header: compact title bar for each page ---- */
export function PageHeader({
  title,
  subtitle,
  icon,
  accent = '#0891B2',
  right,
}: {
  title: string
  subtitle?: string
  icon?: string
  accent?: string
  right?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-5">
      <div className="flex items-center gap-3">
        {icon && (
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: `${accent}14`, border: `1px solid ${accent}25` }}
          >
            {icon}
          </div>
        )}
        <div>
          <h1 className="text-lg font-black text-slate-900 leading-tight">{title}</h1>
          {subtitle && (
            <p className="text-xs text-slate-400 font-medium mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  )
}

/* ---- Dense KPI tile ---- */
export function StatTile({
  label,
  value,
  icon,
  sub,
  accent = '#0891B2',
  trend,
}: {
  label: string
  value: string | number
  icon?: string
  sub?: string
  accent?: string
  trend?: { dir: 'up' | 'down'; text: string }
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
          {label}
        </span>
        {icon && (
          <span
            className="w-6 h-6 rounded-md flex items-center justify-center text-sm"
            style={{ background: `${accent}14` }}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="text-2xl font-black text-slate-900 leading-none">{value}</p>
      <div className="flex items-center gap-2 mt-1.5 min-h-[16px]">
        {trend && (
          <span
            className={`text-[11px] font-bold ${
              trend.dir === 'up' ? 'text-emerald-600' : 'text-red-500'
            }`}
          >
            {trend.dir === 'up' ? '▲' : '▼'} {trend.text}
          </span>
        )}
        {sub && <span className="text-[11px] text-slate-400">{sub}</span>}
      </div>
    </div>
  )
}

/* ---- Card shell with optional header ---- */
export function Card({
  title,
  subtitle,
  right,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 overflow-hidden ${className}`}
    >
      {(title || right) && (
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            {title && (
              <h2 className="font-bold text-slate-900 text-sm">{title}</h2>
            )}
            {subtitle && (
              <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          {right}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  )
}

/* ---- Status badge ---- */
const BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-blue-50 text-blue-700 border-blue-200',
  in_progress: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-50 text-red-600 border-red-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: keyof typeof BADGE | string
}) {
  const cls = BADGE[tone] ?? BADGE.neutral
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-bold capitalize ${cls}`}
    >
      {String(children).replace(/_/g, ' ')}
    </span>
  )
}

/* ---- Dense table primitives ---- */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  )
}

export function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-slate-100">
        {cols.map((c) => (
          <th
            key={c}
            className="text-left px-4 py-2.5 text-[11px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap"
          >
            {c}
          </th>
        ))}
      </tr>
    </thead>
  )
}

export function TRow({
  children,
  onClick,
}: {
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/70 transition-colors ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      {children}
    </tr>
  )
}

export function TD({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <td className={`px-4 py-2.5 text-slate-700 whitespace-nowrap ${className}`}>
      {children}
    </td>
  )
}

/* ---- Empty state ---- */
export function Empty({
  icon = '📭',
  title,
  sub,
}: {
  icon?: string
  title: string
  sub?: string
}) {
  return (
    <div className="py-12 text-center">
      <div className="text-3xl mb-2">{icon}</div>
      <p className="text-sm font-bold text-slate-600">{title}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

/* ---- Toast (controlled) ---- */
export function Toast({
  msg,
  type = 'success',
}: {
  msg: string
  type?: 'success' | 'error'
}) {
  return (
    <div
      className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white max-w-sm ${
        type === 'error' ? 'bg-red-500' : 'bg-emerald-500'
      }`}
    >
      {msg}
    </div>
  )
}