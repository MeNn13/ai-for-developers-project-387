import type { ProblemDetails } from '../api/generated/booking'

// Клиент orval не бросает исключений на HTTP-ошибках: статус в unions разрешает
// только объявленные в контракте коды, но в рантайме там бывает что угодно
// (5xx, пустое или неразобранное тело), поэтому тело ошибки проверяем до разбора.
export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const problem = value as ProblemDetails
  return (
    typeof problem.type === 'string' &&
    typeof problem.title === 'string' &&
    typeof problem.status === 'number' &&
    typeof problem.detail === 'string'
  )
}
