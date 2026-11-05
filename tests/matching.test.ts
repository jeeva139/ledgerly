import { describe, expect, it } from 'vitest'
import {
  compileKeywords, compileMatcher, compileRules, findFirstKeyword, findKeywordHits, firstMatchingRule,
  normalizeText, parseKeywords, ruleSpecificity, snippetAround, sortRulesByPriority, sortRulesBySpecificity
} from '../shared/matching'
import type { Rule } from '../shared/types'
import { LONG_UPI } from './helpers'

const KW = parseKeywords('Tea, Briyani, Dosa, Dinner, Lunch, Breakfast')

describe('parseKeywords', () => {
  it('splits on commas, trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(KW).toEqual(['Tea', 'Briyani', 'Dosa', 'Dinner', 'Lunch', 'Breakfast'])
    expect(parseKeywords('Tea, tea, TEA')).toEqual(['Tea'])
    expect(parseKeywords(' ,  , a ,, b, ')).toEqual(['a', 'b'])
    expect(parseKeywords('')).toEqual([])
  })
})

describe('keyword matching (substring, case-insensitive)', () => {
  const matchers = compileKeywords(KW)

  it('finds LUNCH and TEA inside the very long UPI narration', () => {
    const hits = findKeywordHits(LONG_UPI, matchers)
    expect(hits.map((h) => h.keyword).sort()).toEqual(['Lunch', 'Tea'])
  })

  it('matches keywords glued to other words, numbers and identifiers', () => {
    const cases: [string, string][] = [
      ['LUNCHUPI', 'Lunch'],
      ['TEA-12345', 'Tea'],
      ['Briyani@Restaurant', 'Briyani'],
      ['xxDOSAyy', 'Dosa'],
      ['paid for breakfast today', 'Breakfast']
    ]
    for (const [text, kw] of cases) expect(findFirstKeyword(text, matchers)?.keyword).toBe(kw)
  })

  it('does not match unrelated text', () => {
    expect(findKeywordHits('ELECTRICITY BILL PAYMENT 2026', matchers)).toEqual([])
    expect(findFirstKeyword('', matchers)).toBeNull()
  })

  it('reports offsets into the original text for highlighting', () => {
    const hit = findFirstKeyword('abc LUNCH def', compileKeywords(['lunch']))!
    expect('abc LUNCH def'.slice(hit.start, hit.end)).toBe('LUNCH')
    const s = snippetAround(LONG_UPI, hit.start, hit.end, 10)
    expect(s.before.length).toBeLessThanOrEqual(11)
  })

  it('multi-word keywords tolerate any separators', () => {
    const m = compileKeywords(['uber eats'])
    for (const t of ['UBER EATS', 'UBER-EATS', 'ubereats', 'uber__eats order']) expect(findFirstKeyword(t, m)).not.toBeNull()
    expect(findFirstKeyword('uber cab', m)).toBeNull()
  })

  it('whole-word mode avoids matching inside other words', () => {
    const m = compileKeywords(['tea'], 'word')
    expect(findFirstKeyword('STEAK HOUSE', m)).toBeNull()
    expect(findFirstKeyword('TEA-12345', m)).not.toBeNull()
    expect(findFirstKeyword('morning tea 20', m)).not.toBeNull()
    expect(findFirstKeyword('TEAM LUNCH', m)).toBeNull()
  })

  it('starts_with and equals', () => {
    expect(compileMatcher('swiggy', 'starts_with')!.regex.test('  SWIGGY ORDER 12')).toBe(true)
    expect(compileMatcher('swiggy', 'starts_with')!.regex.test('PAID SWIGGY')).toBe(false)
    expect(compileMatcher('rent', 'equals')!.regex.test('RENT')).toBe(true)
    expect(compileMatcher('rent', 'equals')!.regex.test('RENT PAID')).toBe(false)
  })

  it('escapes regex characters in keywords', () => {
    expect(compileMatcher('a.b*c(d')!.regex.test('xx a.b*c(d yy')).toBe(true)
    expect(compileMatcher('a.b')!.regex.test('aXb')).toBe(false)
  })
})

describe('normalizeText', () => {
  it('lowercases, normalises separators and collapses spaces', () => {
    expect(normalizeText('  UPI-LUNCH@YBL   ')).toBe('upi lunch ybl')
  })
})

describe('rules ordering', () => {
  const mk = (id: string, whenText: string, thenText: string, priority: number, createdAt: string, enabled = true, matchType: Rule['matchType'] = 'contains'): Rule => ({
    id, whenText, thenText, enabled, priority, matchType, source: 'manual', createdAt, updatedAt: createdAt
  })
  const rules = [
    mk('a', 'tea', 'Food', 2, '2026-01-03'),
    mk('b', 'tea house', 'Dining', 1, '2026-01-02'),
    mk('c', 'uber', 'Transportation', 3, '2026-01-01', false)
  ]

  it('evaluates by explicit priority then creation time; disabled rules are skipped', () => {
    expect(sortRulesByPriority(rules).map((r) => r.id)).toEqual(['b', 'a', 'c'])
    const compiled = compileRules(rules)
    expect(compiled.map((c) => c.rule.id)).toEqual(['b', 'a'])
    expect(firstMatchingRule('TEA HOUSE 22', compiled)?.rule.thenText).toBe('Dining')
    expect(firstMatchingRule('hot tea', compiled)?.rule.thenText).toBe('Food')
    expect(firstMatchingRule('UBER TRIP', compiled)).toBeNull()
  })

  it('specificity ordering puts the most specific first, ties by earlier creation', () => {
    const sorted = sortRulesBySpecificity(rules).map((r) => r.id)
    expect(sorted[0]).toBe('b')
    expect(ruleSpecificity({ whenText: 'tea', matchType: 'equals' })).toBeGreaterThan(ruleSpecificity({ whenText: 'tea house', matchType: 'contains' }))
  })
})
