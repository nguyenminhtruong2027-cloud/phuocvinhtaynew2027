const vnDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const vnDateTimeFmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Returns YYYY-MM-DD formatted in Asia/Ho_Chi_Minh (UTC+7).
 */
export function getVNDateString(input?: Date | string | null): string {
  const d = input ? (input instanceof Date ? input : new Date(input)) : new Date();
  if (isNaN(d.getTime())) return '';
  return vnDateFmt.format(d);
}

/**
 * Returns DD/MM/YYYY HH:mm formatted in Asia/Ho_Chi_Minh (UTC+7).
 */
export function getVNDateTimeDisplay(input?: Date | string | null): string {
  const d = input ? (input instanceof Date ? input : new Date(input)) : new Date();
  if (isNaN(d.getTime())) return '';
  return vnDateTimeFmt.format(d);
}
