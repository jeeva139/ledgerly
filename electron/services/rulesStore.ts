// Read access to saved categorisation rules, shared by imports, Category Finder and the Rules page.
import { getDb } from '../database/db'
import { compileRules, sortRulesByPriority, type CompiledRule } from '../../shared/matching'
import type { Rule, RuleMatchType } from '../../shared/types'

export interface RuleRow {
  id: string
  whenText: string
  thenText: string
  enabled: number
  priority: number
  matchType: string
  source: string
  createdAt: string
  updatedAt: string
}

export const RULE_COLUMNS = 'id, whenText, thenText, enabled, priority, matchType, source, createdAt, updatedAt'

export function rowToRule(r: RuleRow): Rule {
  return {
    id: r.id,
    whenText: r.whenText,
    thenText: r.thenText,
    enabled: r.enabled === 1,
    priority: r.priority,
    matchType: (['contains', 'word', 'starts_with', 'equals'].includes(r.matchType) ? r.matchType : 'contains') as RuleMatchType,
    source: r.source === 'category-finder' ? 'category-finder' : 'manual',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }
}

/** All rules in evaluation order (explicit priority, then earlier-created first). */
export function listRules(): Rule[] {
  return sortRulesByPriority(getDb().all<RuleRow>(`SELECT ${RULE_COLUMNS} FROM rules`).map(rowToRule))
}

/** Enabled rules, compiled and ready to run against many transactions. */
export function loadCompiledRules(): CompiledRule[] {
  return compileRules(listRules())
}
