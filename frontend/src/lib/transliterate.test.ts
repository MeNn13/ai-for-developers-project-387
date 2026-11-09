import { describe, expect, it } from 'vitest'
import { transliterate } from './transliterate'

// Оракулы — таблица и примеры из спеки #23, решение #17, и maxLength 64 из контракта.

describe('transliterate', () => {
  it('matches the spec example titles', () => {
    expect(transliterate('Знакомство')).toBe('znakomstvo')
    expect(transliterate('Intro call')).toBe('intro-call')
    expect(transliterate('Разбор 1:1')).toBe('razbor-1-1')
  })

  it('transliterates every Cyrillic letter per the table', () => {
    const table: Array<[string, string]> = [
      ['а', 'a'],
      ['б', 'b'],
      ['в', 'v'],
      ['г', 'g'],
      ['д', 'd'],
      ['е', 'e'],
      ['ё', 'e'],
      ['ж', 'zh'],
      ['з', 'z'],
      ['и', 'i'],
      ['й', 'y'],
      ['к', 'k'],
      ['л', 'l'],
      ['м', 'm'],
      ['н', 'n'],
      ['о', 'o'],
      ['п', 'p'],
      ['р', 'r'],
      ['с', 's'],
      ['т', 't'],
      ['у', 'u'],
      ['ф', 'f'],
      ['х', 'kh'],
      ['ц', 'ts'],
      ['ч', 'ch'],
      ['ш', 'sh'],
      ['щ', 'shch'],
      ['ъ', ''],
      ['ы', 'y'],
      ['ь', ''],
      ['э', 'e'],
      ['ю', 'yu'],
      ['я', 'ya'],
    ]

    for (const [letter, expected] of table) {
      expect(transliterate(letter)).toBe(expected)
    }
  })

  it('passes latin letters and digits through in lowercase', () => {
    expect(transliterate('VIP')).toBe('vip')
    expect(transliterate('Call 42 back')).toBe('call-42-back')
  })

  it('folds uppercase Cyrillic to the lowercase slug', () => {
    expect(transliterate('ЗНАКОМСТВО')).toBe('znakomstvo')
  })

  it('collapses runs of spaces and invalid characters into a single hyphen', () => {
    expect(transliterate('Привет   --!!   мир')).toBe('privet-mir')
  })

  it('trims leading and trailing hyphens', () => {
    expect(transliterate('  !раз-бор!  ')).toBe('raz-bor')
  })

  it('skips hard and soft signs without creating a hyphen', () => {
    expect(transliterate('Объект')).toBe('obekt')
    expect(transliterate('Ателье')).toBe('atele')
    expect(transliterate('съезд')).toBe('sezd')
  })

  it('truncates to the contract maximum of 64 characters', () => {
    expect(transliterate('a'.repeat(70))).toBe('a'.repeat(64))
  })

  it('trims a trailing hyphen left after truncation', () => {
    expect(transliterate(`${'b'.repeat(63)} - c`)).toBe('b'.repeat(63))
  })

  it('returns an empty slug for empty or symbol-only titles', () => {
    expect(transliterate('')).toBe('')
    expect(transliterate('?!')).toBe('')
  })
})
