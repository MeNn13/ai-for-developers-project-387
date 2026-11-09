// Транслитерация названия типа встречи в slug идентификатора.
// Таблица и правила нормализации — спека #23, решение #17; предел длины —
// maxLength 64 из контракта (MeetingTypeCreateRequest.id).

// ъ и ь означены пустой строкой: они пропускаются, не превращаясь в дефис.
const cyrillicTable: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

// Предел идентификатора из контракта: maxLength 64.
const maxLength = 64

// Латиница и цифры проходят как есть после приведения к нижнему регистру.
const allowedPattern = /^[a-z0-9]$/

export function transliterate(value: string): string {
  let slug = ''

  for (const character of value.toLowerCase()) {
    const transliterated = cyrillicTable[character]
    if (transliterated !== undefined) {
      slug += transliterated
    } else if (allowedPattern.test(character)) {
      slug += character
    } else {
      // Любой недопустимый символ становится кандидатом в дефисы; серия
      // схлопнется в один дефис ниже.
      slug += '-'
    }
  }

  slug = slug.replace(/-+/g, '-')
  slug = slug.replace(/^-+|-+$/g, '')
  slug = slug.slice(0, maxLength)
  return slug.replace(/-+$/g, '')
}
