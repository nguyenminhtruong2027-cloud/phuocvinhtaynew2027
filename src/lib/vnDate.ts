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

/** Parses DD/MM/YYYY or ISO YYYY-MM-DD into a UTC Date representing that calendar date. */
export function parseVNDateSafe(raw?: string | null): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const d = parseInt(ddmmyyyy[1], 10);
    const m = parseInt(ddmmyyyy[2], 10) - 1;
    const y = parseInt(ddmmyyyy[3], 10);
    const dt = new Date(Date.UTC(y, m, d));
    return isNaN(dt.getTime()) ? null : dt;
  }

  const yyyymmdd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (yyyymmdd) {
    const y = parseInt(yyyymmdd[1], 10);
    const m = parseInt(yyyymmdd[2], 10) - 1;
    const d = parseInt(yyyymmdd[3], 10);
    const dt = new Date(Date.UTC(y, m, d));
    return isNaN(dt.getTime()) ? null : dt;
  }

  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** Returns whole calendar days elapsed in Asia/Ho_Chi_Minh (UTC+7) since rawDate. */
export function daysSinceVN(rawDate?: string | null): number | null {
  const dt = parseVNDateSafe(rawDate);
  if (!dt) return null;
  const nowVN = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const todayUtc = Date.UTC(nowVN.getUTCFullYear(), nowVN.getUTCMonth(), nowVN.getUTCDate());
  const targetUtc = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  return Math.floor((todayUtc - targetUtc) / (24 * 60 * 60 * 1000));
}
