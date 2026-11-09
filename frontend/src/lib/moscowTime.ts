// Время на странице владельца показывается по Москве: данные приходят со
// смещением +03:00, поэтому форматируем их через Intl с явным поясом, а не
// через локальный пояс браузера.
const MOSCOW_TIME_ZONE = 'Europe/Moscow'

function formatTime(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

// «Пн, 2 ноября, 10:00–10:30» — колонка «Когда» в таблице встреч.
export function formatMeetingWhen(start: string, end: string, timeZone = MOSCOW_TIME_ZONE): string {
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(new Date(start))

  return `${date.charAt(0).toUpperCase()}${date.slice(1)}, ${formatTime(start, timeZone)}–${formatTime(end, timeZone)}`
}

// «14:32» — подпись «Обновлено в …» по Москве.
export function formatTimeOfDay(value: Date, timeZone = MOSCOW_TIME_ZONE): string {
  return formatTime(value, timeZone)
}

// «10:00–10:30» — подпись слота в списке выбранного дня.
export function formatTimeRange(start: string, end: string, timeZone = MOSCOW_TIME_ZONE): string {
  return `${formatTime(start, timeZone)}–${formatTime(end, timeZone)}`
}

// «Пн, 2 ноября, 10:00–10:30 (МСК)» — подтверждение бронирования.
export function formatMeetingConfirmation(
  start: string,
  end: string,
  timeZone = MOSCOW_TIME_ZONE,
): string {
  return `${formatMeetingWhen(start, end, timeZone)} (МСК)`
}
