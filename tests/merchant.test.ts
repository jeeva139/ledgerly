import { describe, expect, it } from 'vitest'
import { extractPayee, normalizeMerchantKey, prettyMerchant } from '../shared/merchant'
import { LONG_UPI } from './helpers'

describe('extractPayee', () => {
  it('pulls the payee name out of UPI narrations', () => {
    expect(extractPayee(LONG_UPI)).toBe('MR A MANIKANDAN')
    expect(extractPayee('UPI-SWIGGY-swiggy@icici-ICIC0000001-123456789012-PAYMENT')).toBe('SWIGGY')
    expect(extractPayee('UPI/DR/412345678901/ZOMATO/YESB/zomato@yesb')).toBe('ZOMATO')
  })

  it('returns plain text unchanged', () => {
    expect(extractPayee('  NETFLIX.COM  ')).toBe('NETFLIX.COM')
    expect(extractPayee('7-ELEVEN')).toBe('7-ELEVEN')
  })
})

describe('normalizeMerchantKey', () => {
  it('drops reference numbers and punctuation', () => {
    expect(normalizeMerchantKey('SWIGGY ORDER #4482913')).toBe('swiggy order')
    expect(normalizeMerchantKey('Swiggy Order #12')).toBe('swiggy order')
    expect(normalizeMerchantKey('NETFLIX.COM 800-585-3898 CA')).toBe('netflix com ca')
    expect(normalizeMerchantKey('  Amazon   Prime  ')).toBe('amazon prime')
  })

  it('groups UPI narrations by payee regardless of the changing references', () => {
    const a = normalizeMerchantKey('UPI-NETFLIX-netflix@icici-ICIC0000001-123456789012-PAYMENT')
    const b = normalizeMerchantKey('UPI-NETFLIX-netflix@icici-ICIC0000001-998877665544-SUBSCRIPTION')
    expect(a).toBe('netflix')
    expect(b).toBe(a)
    expect(normalizeMerchantKey(LONG_UPI)).toBe('mr a manikandan')
  })

  it('removes masked card numbers, leading channel words and company suffixes', () => {
    expect(normalizeMerchantKey('POS 4567XXXXXX1234 AMAZON PAY')).toBe('amazon pay')
    expect(normalizeMerchantKey('PAYMENT TO NETFLIX')).toBe('netflix')
    expect(normalizeMerchantKey('Swiggy Ltd')).toBe(normalizeMerchantKey('SWIGGY'))
    expect(normalizeMerchantKey('Zomato Pvt Ltd.')).toBe('zomato')
  })

  it('does not collapse unrelated merchants together', () => {
    expect(normalizeMerchantKey('Big Bazaar')).not.toBe(normalizeMerchantKey('Big Basket'))
    expect(normalizeMerchantKey('7 Eleven')).toBe('7 eleven')
  })

  it('never returns an empty key for non-empty input', () => {
    expect(normalizeMerchantKey('1234567')).toBe('1234567')
    expect(normalizeMerchantKey('###')).toBe('###')
  })
})

describe('prettyMerchant', () => {
  it('title-cases a key for display', () => {
    expect(prettyMerchant('mr a manikandan')).toBe('Mr A Manikandan')
    expect(prettyMerchant('swiggy order')).toBe('Swiggy Order')
  })
})
