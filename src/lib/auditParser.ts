import type { AuditAction, AuditEntry } from '@/context/AuditContext';
import { normalizeBedLabel } from '@/lib/bedSync';
import { extractRoomNumber } from '@/lib/facilityCapacity';

export type AuditCategory = 'all' | 'sensitive' | 'qr' | 'bed' | 'facility' | 'account' | 'anomaly';
export type AuditSeverity = 'normal' | 'warning' | 'critical';
export type QuickDatePreset = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'this_month';

export interface AuditActionMeta {
  action: AuditAction;
  labelVi: string;
  shortVi: string;
  category: Exclude<AuditCategory, 'all' | 'anomaly'>;
  severity: AuditSeverity;
  isTechnical?: boolean;
}

export const AUDIT_ACTION_META: Record<AuditAction, AuditActionMeta> = {
  CREATE: { action: 'CREATE', labelVi: 'Thêm công nhân', shortVi: 'Thêm mới', category: 'qr', severity: 'normal' },
  'Thêm': { action: 'Thêm', labelVi: 'Thêm mới (cũ)', shortVi: 'Thêm mới', category: 'qr', severity: 'normal' },
  UPDATE: { action: 'UPDATE', labelVi: 'Cập nhật hồ sơ', shortVi: 'Cập nhật', category: 'bed', severity: 'normal' },
  'Sửa': { action: 'Sửa', labelVi: 'Cập nhật (cũ)', shortVi: 'Cập nhật', category: 'bed', severity: 'normal' },
  DELETE: { action: 'DELETE', labelVi: 'Xóa công nhân', shortVi: 'Xóa hồ sơ', category: 'sensitive', severity: 'critical' },
  'Xóa': { action: 'Xóa', labelVi: 'Xóa hồ sơ (cũ)', shortVi: 'Xóa hồ sơ', category: 'sensitive', severity: 'critical' },
  IMPORT: { action: 'IMPORT', labelVi: 'Nhập từ Excel', shortVi: 'Nhập Excel', category: 'qr', severity: 'normal' },
  Import: { action: 'Import', labelVi: 'Nhập Excel (cũ)', shortVi: 'Nhập Excel', category: 'qr', severity: 'normal' },
  CHECKOUT_REQUEST: { action: 'CHECKOUT_REQUEST', labelVi: 'Yêu cầu check-out', shortVi: 'Yêu cầu trả phòng', category: 'sensitive', severity: 'warning' },
  CHECKOUT_APPROVED: { action: 'CHECKOUT_APPROVED', labelVi: 'Duyệt check-out', shortVi: 'Duyệt check-out', category: 'sensitive', severity: 'critical' },
  WORKER_HARD_DELETE: { action: 'WORKER_HARD_DELETE', labelVi: 'Xác minh xóa triệt để', shortVi: 'Xóa triệt để', category: 'sensitive', severity: 'critical', isTechnical: true },
  BED_REASSIGN: { action: 'BED_REASSIGN', labelVi: 'Đổi / Gán giường', shortVi: 'Đổi giường', category: 'bed', severity: 'warning' },
  'Chuyển phòng': { action: 'Chuyển phòng', labelVi: 'Chuyển phòng', shortVi: 'Chuyển phòng', category: 'bed', severity: 'warning' },
  'Đổi trạng thái tạm trú': { action: 'Đổi trạng thái tạm trú', labelVi: 'Đổi trạng thái tạm trú', shortVi: 'Tạm trú', category: 'bed', severity: 'normal' },
  BED_INSPECT_CONFIRM: { action: 'BED_INSPECT_CONFIRM', labelVi: 'Kiểm tra giường QR', shortVi: 'Kiểm tra QR', category: 'qr', severity: 'normal' },
  APPROVE_REGISTRATION: { action: 'APPROVE_REGISTRATION', labelVi: 'Duyệt hồ sơ QR', shortVi: 'Duyệt hồ sơ QR', category: 'qr', severity: 'normal' },
  FACILITY_CREATE: { action: 'FACILITY_CREATE', labelVi: 'Thêm phòng / CSVC', shortVi: 'Thêm CSVC', category: 'facility', severity: 'normal' },
  FACILITY_UPDATE: { action: 'FACILITY_UPDATE', labelVi: 'Cập nhật CSVC', shortVi: 'Sửa CSVC', category: 'facility', severity: 'normal' },
  FACILITY_DELETE: { action: 'FACILITY_DELETE', labelVi: 'Xóa phòng / CSVC', shortVi: 'Xóa CSVC', category: 'facility', severity: 'critical' },
  ATTENDANCE_SESSION: { action: 'ATTENDANCE_SESSION', labelVi: 'Phiên điểm danh', shortVi: 'Điểm danh', category: 'qr', severity: 'normal' },
  ATTENDANCE_UPDATE: { action: 'ATTENDANCE_UPDATE', labelVi: 'Cập nhật điểm danh', shortVi: 'Sửa điểm danh', category: 'qr', severity: 'normal' },
  USER_PASSWORD_RESET: { action: 'USER_PASSWORD_RESET', labelVi: 'Đặt lại mật khẩu', shortVi: 'Đặt lại MK', category: 'account', severity: 'critical' },
  AUDIT_ARCHIVE_PURGE: { action: 'AUDIT_ARCHIVE_PURGE', labelVi: 'Lưu trữ & dọn nhật ký', shortVi: 'Dọn nhật ký', category: 'account', severity: 'warning' },
  MAINTENANCE_TICKET_CREATE: { action: 'MAINTENANCE_TICKET_CREATE', labelVi: 'Tạo phiếu báo hỏng', shortVi: 'Báo hỏng', category: 'facility', severity: 'normal' },
  MAINTENANCE_TICKET_UPDATE: { action: 'MAINTENANCE_TICKET_UPDATE', labelVi: 'Tiếp nhận / cập nhật phiếu bảo trì', shortVi: 'Cập nhật BT', category: 'facility', severity: 'normal' },
  MAINTENANCE_TICKET_RESOLVE: { action: 'MAINTENANCE_TICKET_RESOLVE', labelVi: 'Hoàn thành sửa chữa', shortVi: 'Hoàn thành BT', category: 'facility', severity: 'normal' },
  MAINTENANCE_TICKET_DELETE: { action: 'MAINTENANCE_TICKET_DELETE', labelVi: 'Xóa bản ghi phiếu bảo trì', shortVi: 'Xóa phiếu BT', category: 'facility', severity: 'warning' },
  SYSTEM_BACKUP: { action: 'SYSTEM_BACKUP', labelVi: 'Sao lưu toàn hệ thống', shortVi: 'Sao lưu HT', category: 'account', severity: 'warning' },
  SYSTEM_RESTORE: { action: 'SYSTEM_RESTORE', labelVi: 'Khôi phục dữ liệu từ Backup', shortVi: 'Khôi phục HT', category: 'account', severity: 'critical' },
  DISCIPLINE_CREATE: { action: 'DISCIPLINE_CREATE', labelVi: 'Lập biên bản vi phạm KTX', shortVi: 'Biên bản VP', category: 'sensitive', severity: 'warning' },
  BLACKLIST_ADD: { action: 'BLACKLIST_ADD', labelVi: 'Đưa vào Danh sách Đen', shortVi: 'Blacklist', category: 'sensitive', severity: 'critical' },
  BLACKLIST_REVOKE: { action: 'BLACKLIST_REVOKE', labelVi: 'Gỡ khỏi Danh sách Đen', shortVi: 'Gỡ Blacklist', category: 'sensitive', severity: 'warning' },
  ROOM_CONSOLIDATION: { action: 'ROOM_CONSOLIDATION', labelVi: 'Thực thi Dồn phòng thông minh', shortVi: 'Dồn phòng', category: 'bed', severity: 'warning' },
  BATCH_CHECKOUT: { action: 'BATCH_CHECKOUT', labelVi: 'Check-out hàng loạt / Đối soát', shortVi: 'Check-out loạt', category: 'sensitive', severity: 'critical' },
  SWAP_BEDS: { action: 'SWAP_BEDS', labelVi: 'Hoán đổi giường 2 công nhân', shortVi: 'Hoán đổi giường', category: 'bed', severity: 'warning' },
  RESERVE_BED: { action: 'RESERVE_BED', labelVi: 'Đặt giữ chỗ giường cho đoàn', shortVi: 'Giữ chỗ giường', category: 'bed', severity: 'normal' },
  CANCEL_RESERVE_BED: { action: 'CANCEL_RESERVE_BED', labelVi: 'Hủy giữ chỗ giường', shortVi: 'Hủy giữ chỗ', category: 'bed', severity: 'normal' },
};

export const CATEGORY_ACTIONS: Record<Exclude<AuditCategory, 'all' | 'anomaly'>, AuditAction[]> = {
  sensitive: ['DELETE', 'Xóa', 'CHECKOUT_REQUEST', 'CHECKOUT_APPROVED', 'BATCH_CHECKOUT', 'WORKER_HARD_DELETE', 'DISCIPLINE_CREATE', 'BLACKLIST_ADD', 'BLACKLIST_REVOKE'],
  qr: ['APPROVE_REGISTRATION', 'BED_INSPECT_CONFIRM', 'ATTENDANCE_SESSION', 'ATTENDANCE_UPDATE', 'CREATE', 'Thêm', 'IMPORT', 'Import'],
  bed: ['BED_REASSIGN', 'SWAP_BEDS', 'RESERVE_BED', 'CANCEL_RESERVE_BED', 'Chuyển phòng', 'UPDATE', 'Sửa', 'Đổi trạng thái tạm trú', 'ROOM_CONSOLIDATION'],
  facility: [
    'FACILITY_CREATE',
    'FACILITY_UPDATE',
    'FACILITY_DELETE',
    'MAINTENANCE_TICKET_CREATE',
    'MAINTENANCE_TICKET_UPDATE',
    'MAINTENANCE_TICKET_RESOLVE',
    'MAINTENANCE_TICKET_DELETE',
  ],
  account: ['USER_PASSWORD_RESET', 'AUDIT_ARCHIVE_PURGE', 'SYSTEM_BACKUP', 'SYSTEM_RESTORE'],
};

export function getActionMeta(action: string): AuditActionMeta {
  const found = AUDIT_ACTION_META[action as AuditAction];
  if (found) return found;
  return {
    action: action as AuditAction,
    labelVi: action,
    shortVi: action,
    category: 'bed',
    severity: 'normal',
  };
}

export interface ParsedAuditDetail {
  isJson: boolean;
  summary: string;
  workerName: string;
  maNv: string;
  cccd: string;
  ktx: string;
  day: string;
  phong: string;
  giuong: string;
  locationText: string;
  beforeAfter: { before: string; after: string; isSwap?: boolean } | null;
  integrityVerified: boolean | null;
  sourceLabel: string;
  rawJson: Record<string, unknown> | null;
  rawText: string;
}

function cleanField(val: unknown): string {
  const s = String(val ?? '').trim();
  if (!s || ['-', '—', 'null', 'undefined', 'không mã nv', 'chưa có', 'n/a'].includes(s.toLowerCase())) {
    return '';
  }
  return s;
}

function formatLocation(ktx: string, day: string, phong: string, giuong: string): string {
  const parts: string[] = [];
  if (ktx) parts.push(ktx);
  if (day) parts.push(day);
  if (phong) {
    const num = extractRoomNumber(phong);
    parts.push(num ? `P.${num}` : phong);
  }
  if (giuong) {
    const bed = normalizeBedLabel(giuong);
    parts.push(bed ? `G${bed}` : giuong);
  }
  return parts.join(' · ');
}

export function parseAuditDetail(entry: AuditEntry): ParsedAuditDetail {
  const rawText = String(entry.detail ?? '').trim();
  let rawJson: Record<string, unknown> | null = null;

  if (rawText.startsWith('{') && rawText.endsWith('}')) {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rawJson = parsed as Record<string, unknown>;
      }
    } catch {
      rawJson = null;
    }
  }

  if (rawJson) {
    const workerName = cleanField(rawJson.ho_va_ten ?? rawJson.worker_name ?? rawJson.name);
    const maNv = cleanField(rawJson.ma_nv ?? rawJson.maNV);
    const cccd = cleanField(rawJson.cccd ?? rawJson.so_cccd);
    const ktx = cleanField(rawJson.ktx);
    const day = cleanField(rawJson.day);
    const phong = extractRoomNumber(cleanField(rawJson.phong_so ?? rawJson.phong));
    const giuong = normalizeBedLabel(cleanField(rawJson.giuong));
    const locationText = formatLocation(ktx, day, phong, giuong);

    const integrityRaw = rawJson.integrity_verified ?? rawJson.verified;
    const integrityVerified =
      typeof integrityRaw === 'boolean'
        ? integrityRaw
        : typeof rawJson.remaining_workers === 'number'
          ? rawJson.remaining_workers === 0
          : null;

    const sourceLabel = cleanField(rawJson.source ?? rawJson.reason ?? rawJson.trigger);

    const parts: string[] = [];
    if (workerName) parts.push(workerName);
    if (maNv) parts.push(`Mã NV: ${maNv}`);
    else if (cccd) parts.push(`CCCD: ${cccd}`);
    if (locationText) parts.push(locationText);
    if (integrityVerified === true) parts.push('Đã xác minh xóa sạch');
    else if (integrityVerified === false) parts.push('Cần kiểm tra toàn vẹn');

    return {
      isJson: true,
      summary: parts.length > 0 ? parts.join(' · ') : 'Dữ liệu xác minh hệ thống',
      workerName,
      maNv,
      cccd,
      ktx,
      day,
      phong,
      giuong,
      locationText,
      beforeAfter: null,
      integrityVerified,
      sourceLabel,
      rawJson,
      rawText,
    };
  }

  // Parse Vietnamese free-text audit messages
  const strippedDatePrefix = rawText.replace(/^\[\d{1,2}\/\d{1,2}\/\d{4}\]\s*/, '').trim();

  // Extract Ma NV & CCCD
  const maNvMatch = strippedDatePrefix.match(/Mã\s*NV\s*[:\-]?\s*([A-Za-z0-9._-]+)/i);
  const parenCodeMatch = strippedDatePrefix.match(/\((?!Không\s*mã|Mã\s*NV)([A-Za-z0-9._-]{2,20})\)/i);
  const maNv = cleanField(maNvMatch?.[1] || (parenCodeMatch?.[1] && !/^\d{1,2}\/\d{1,2}/.test(parenCodeMatch[1]) ? parenCodeMatch[1] : ''));

  const cccdMatch = strippedDatePrefix.match(/CCCD\s*[:\-]?\s*(\d{6,15})/i);
  const cccd = cleanField(cccdMatch?.[1]);

  // Extract KTX / Day / Room / Bed
  const ktxMatch = strippedDatePrefix.match(/\b(KTX\s*[A-Za-z0-9]+)\b/i);
  const dayMatch = strippedDatePrefix.match(/\b(Dãy\s*[A-Za-z0-9]+)\b/i);
  const roomMatch = strippedDatePrefix.match(/(?:Phòng|P\.?)\s*([0-9]+[A-Za-z]?)\b/i);
  const bedMatch = strippedDatePrefix.match(/(?:Giường|G\.?)\s*([0-9]+[A-Za-z]?)\b/i);

  const ktx = cleanField(ktxMatch?.[1]?.replace(/\s+/g, ' '));
  const day = cleanField(dayMatch?.[1]?.replace(/\s+/g, ' '));
  const phong = roomMatch?.[1] ? extractRoomNumber(roomMatch[1]) : '';
  const giuong = bedMatch?.[1] ? normalizeBedLabel(bedMatch[1]) : '';
  const locationText = formatLocation(ktx, day, phong, giuong);

  // Extract worker name after common Vietnamese action prefixes
  let workerName = '';
  const namePatterns = [
    /(?:Xóa công nhân|Thêm công nhân|Cập nhật công nhân|Sửa công nhân|Duyệt check-out|Duyệt hồ sơ QR|Gán giường|Yêu cầu trả phòng|Gửi yêu cầu check-out[^:]*|Check-out[^:]*|Chuyển phòng|Hoán đổi giường)\s*:\s*([^(\[·→↔|]+)/i,
  ];
  for (const pat of namePatterns) {
    const m = strippedDatePrefix.match(pat);
    if (m?.[1]) {
      workerName = cleanField(m[1].replace(/\s+tại\s+KTX.*$/i, '').trim());
      if (workerName) break;
    }
  }

  // Extract Before → After or Swap A ↔ B
  let beforeAfter: { before: string; after: string; isSwap?: boolean } | null = null;
  if (strippedDatePrefix.includes('↔')) {
    const idx = strippedDatePrefix.indexOf(':');
    const body = idx >= 0 ? strippedDatePrefix.slice(idx + 1).trim() : strippedDatePrefix;
    const [left, right] = body.split('↔').map(s => s.trim());
    if (left && right) {
      beforeAfter = { before: left, after: right, isSwap: true };
    }
  } else if (strippedDatePrefix.includes('→')) {
    const idx = strippedDatePrefix.indexOf(':');
    const body = idx >= 0 ? strippedDatePrefix.slice(idx + 1).trim() : strippedDatePrefix;
    const arrowParts = body.split('→').map(s => s.trim());
    if (arrowParts.length >= 2 && arrowParts[0] && arrowParts[1]) {
      beforeAfter = { before: arrowParts[0], after: arrowParts.slice(1).join(' → ') };
    }
  }

  return {
    isJson: false,
    summary: strippedDatePrefix || rawText,
    workerName,
    maNv,
    cccd,
    ktx,
    day,
    phong,
    giuong,
    locationText,
    beforeAfter,
    integrityVerified: null,
    sourceLabel: '',
    rawJson: null,
    rawText,
  };
}

// ─── Unified Account Identity Resolver ──────────────────────────────────────
export interface ProfileLite {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

export interface CanonicalAccountOption {
  key: string;
  displayName: string;
  email: string;
  role: string;
  aliases: string[];
  count: number;
}

export interface ResolvedActor {
  key: string;
  displayName: string;
  email: string;
  role: string;
  rawAccount: string;
}

function normAccountStr(s: string): string {
  return String(s || '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

export function buildAccountResolver(profiles: ProfileLite[], logs: AuditEntry[]) {
  const aliasToProfile = new Map<string, ProfileLite>();

  for (const p of profiles) {
    const emailNorm = normAccountStr(p.email);
    const nameNorm = normAccountStr(p.full_name);
    if (emailNorm) aliasToProfile.set(emailNorm, p);
    if (nameNorm) aliasToProfile.set(nameNorm, p);
    // Also match "QUẢN TRỊ VIÊN - <NAME>" / "ADMIN - <NAME>" variants
    if (nameNorm) {
      aliasToProfile.set(`quản trị viên - ${nameNorm}`, p);
      aliasToProfile.set(`quản trị tối cao - ${nameNorm}`, p);
    }
  }

  const resolve = (rawAccount: string): ResolvedActor => {
    const raw = String(rawAccount || '').trim() || 'Hệ thống';
    const norm = normAccountStr(raw);

    let matched = aliasToProfile.get(norm);
    if (!matched) {
      // Fuzzy check: if raw string contains a known profile full_name or email
      for (const p of profiles) {
        const emailNorm = normAccountStr(p.email);
        const nameNorm = normAccountStr(p.full_name);
        if (
          (emailNorm && norm === emailNorm) ||
          (nameNorm && nameNorm.length >= 4 && (norm.includes(nameNorm) || nameNorm.includes(norm)))
        ) {
          matched = p;
          break;
        }
      }
    }

    if (matched) {
      return {
        key: matched.id || normAccountStr(matched.email || matched.full_name),
        displayName: (matched.full_name || matched.email || raw).trim(),
        email: (matched.email || '').trim(),
        role: matched.role || '',
        rawAccount: raw,
      };
    }

    const looksLikeEmail = raw.includes('@');
    return {
      key: norm || 'system',
      displayName: raw,
      email: looksLikeEmail ? raw : '',
      role: '',
      rawAccount: raw,
    };
  };

  // Aggregate unique canonical accounts & all raw aliases present in logs
  const optionsMap = new Map<string, CanonicalAccountOption>();
  for (const p of profiles) {
    const key = p.id || normAccountStr(p.email || p.full_name);
    const aliases = new Set<string>();
    if (p.email?.trim()) aliases.add(p.email.trim());
    if (p.full_name?.trim()) aliases.add(p.full_name.trim());
    optionsMap.set(key, {
      key,
      displayName: (p.full_name || p.email || 'Tài khoản').trim(),
      email: (p.email || '').trim(),
      role: p.role || '',
      aliases: Array.from(aliases),
      count: 0,
    });
  }

  for (const log of logs) {
    const actor = resolve(log.account);
    const existing = optionsMap.get(actor.key);
    if (existing) {
      existing.count += 1;
      if (log.account && !existing.aliases.includes(log.account)) {
        existing.aliases.push(log.account);
      }
    } else {
      optionsMap.set(actor.key, {
        key: actor.key,
        displayName: actor.displayName,
        email: actor.email,
        role: actor.role,
        aliases: log.account ? [log.account] : [],
        count: 1,
      });
    }
  }

  const options = Array.from(optionsMap.values())
    .filter(o => o.count > 0 || o.email)
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName, 'vi'));

  return { resolve, options };
}

// ─── Anomaly Detection ──────────────────────────────────────────────────────
export interface AuditAnomaly {
  isAnomalous: boolean;
  reasons: string[];
  level: 'high' | 'medium' | 'none';
}

function getVietnamHour(iso: string): number | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: 'numeric',
    hour12: false,
  }).format(d);
  const h = parseInt(hourStr, 10);
  return isNaN(h) ? null : h % 24;
}

export function detectAuditAnomaly(entry: AuditEntry, parsed?: ParsedAuditDetail): AuditAnomaly {
  const p = parsed ?? parseAuditDetail(entry);
  const reasons: string[] = [];
  let level: 'high' | 'medium' | 'none' = 'none';
  const detailLower = entry.detail.toLowerCase();

  // 1. Bulk / mass delete
  if (
    (entry.action === 'DELETE' || entry.action === 'Xóa') &&
    (detailLower.includes('xóa tất cả') ||
      detailLower.includes('xóa toàn bộ') ||
      detailLower.includes('xóa hàng loạt') ||
      /xóa\s+(\d+)\s+công nhân/i.test(entry.detail))
  ) {
    const countMatch = entry.detail.match(/xóa\s+(\d+)\s+công nhân/i);
    const n = countMatch ? parseInt(countMatch[1], 10) : 99;
    if (n >= 5 || detailLower.includes('tất cả') || detailLower.includes('toàn bộ') || detailLower.includes('hàng loạt')) {
      reasons.push('Xóa hàng loạt nhiều hồ sơ');
      level = 'high';
    }
  }

  // 2. Password reset
  if (entry.action === 'USER_PASSWORD_RESET') {
    reasons.push('Thao tác đặt lại mật khẩu tài khoản');
    level = level === 'high' ? 'high' : 'medium';
  }

  // 3. Facility room deletion
  if (entry.action === 'FACILITY_DELETE') {
    reasons.push('Xóa phòng / cấu trúc cơ sở vật chất');
    level = level === 'high' ? 'high' : 'medium';
  }

  // 4. Integrity check failed
  if (p.integrityVerified === false) {
    reasons.push('Xác minh toàn vẹn xóa chưa đạt 100%');
    level = 'high';
  }

  // 5. After-hours sensitive deletion / checkout (22:00 - 05:59 UTC+7)
  if (
    ['DELETE', 'Xóa', 'CHECKOUT_APPROVED', 'FACILITY_DELETE', 'USER_PASSWORD_RESET'].includes(entry.action)
  ) {
    const vnHour = getVietnamHour(entry.timestamp);
    if (vnHour !== null && (vnHour >= 22 || vnHour < 6)) {
      reasons.push(`Thao tác nhạy cảm ngoài giờ (${String(vnHour).padStart(2, '0')}h)`);
      if (level === 'none') level = 'medium';
    }
  }

  return {
    isAnomalous: reasons.length > 0,
    reasons,
    level,
  };
}

// ─── Pair Grouping (CHECKOUT_APPROVED / DELETE + WORKER_HARD_DELETE) ─────────
export interface GroupedAuditRow {
  primary: AuditEntry;
  parsed: ParsedAuditDetail;
  anomaly: AuditAnomaly;
  pairedTechnical: AuditEntry[];
}

export function groupAuditEntries(
  entries: AuditEntry[],
  options: { groupPairs: boolean; hideTechnical: boolean }
): GroupedAuditRow[] {
  const result: GroupedAuditRow[] = [];
  const consumedIds = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (consumedIds.has(entry.id)) continue;

    const meta = getActionMeta(entry.action);
    if (options.hideTechnical && meta.isTechnical) {
      continue;
    }

    const parsed = parseAuditDetail(entry);
    const pairedTechnical: AuditEntry[] = [];

    // Look ahead up to 4 entries within 15 seconds for matching WORKER_HARD_DELETE
    if (
      options.groupPairs &&
      (entry.action === 'CHECKOUT_APPROVED' || entry.action === 'DELETE' || entry.action === 'Xóa')
    ) {
      const primaryTs = new Date(entry.timestamp).getTime();
      for (let j = i + 1; j < Math.min(entries.length, i + 6); j++) {
        const cand = entries[j];
        if (consumedIds.has(cand.id) || cand.action !== 'WORKER_HARD_DELETE') continue;
        const candTs = new Date(cand.timestamp).getTime();
        if (isNaN(primaryTs) || isNaN(candTs) || Math.abs(primaryTs - candTs) > 15_000) continue;

        const candParsed = parseAuditDetail(cand);
        const sameName =
          Boolean(parsed.workerName && candParsed.workerName) &&
          parsed.workerName.toLowerCase() === candParsed.workerName.toLowerCase();
        const sameMaNv =
          Boolean(parsed.maNv && candParsed.maNv) &&
          parsed.maNv.toLowerCase() === candParsed.maNv.toLowerCase();
        const sameLocation =
          Boolean(parsed.locationText && candParsed.locationText) &&
          parsed.locationText.toLowerCase() === candParsed.locationText.toLowerCase();

        if (sameName || sameMaNv || sameLocation) {
          pairedTechnical.push(cand);
          consumedIds.add(cand.id);
        }
      }
    }

    const anomaly = detectAuditAnomaly(entry, parsed);
    result.push({
      primary: entry,
      parsed,
      anomaly,
      pairedTechnical,
    });
  }

  return result;
}

// ─── Date Utilities (UTC+7 Vietnam) ─────────────────────────────────────────
function formatYmdVN(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getQuickDateRange(preset: QuickDatePreset): { from: string; to: string } {
  const now = new Date();
  const today = formatYmdVN(now);
  if (preset === 'all') return { from: '', to: '' };
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') {
    const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yStr = formatYmdVN(y);
    return { from: yStr, to: yStr };
  }
  if (preset === '7d') {
    const d = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    return { from: formatYmdVN(d), to: today };
  }
  if (preset === '30d') {
    const d = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    return { from: formatYmdVN(d), to: today };
  }
  // this_month
  const [yr, mo] = today.split('-');
  return { from: `${yr}-${mo}-01`, to: today };
}

export function formatTimestampVN(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatRelativeTimeVN(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} ngày trước`;
  return `${Math.floor(diffDay / 30)} tháng trước`;
}

// ─── Structured Excel Export Rows ───────────────────────────────────────────
export function buildStructuredExportRows(
  entries: AuditEntry[],
  resolveActor: (account: string) => ResolvedActor
) {
  return entries.map((entry, idx) => {
    const meta = getActionMeta(entry.action);
    const parsed = parseAuditDetail(entry);
    const actor = resolveActor(entry.account);
    const anomaly = detectAuditAnomaly(entry, parsed);

    return {
      STT: idx + 1,
      'Thời gian (UTC+7)': formatTimestampVN(entry.timestamp),
      'Người thực hiện': actor.displayName,
      'Email tài khoản': actor.email || '—',
      'Hành động': meta.labelVi,
      'Mã hành động': entry.action,
      'Mức độ':
        meta.severity === 'critical'
          ? 'Nhạy cảm'
          : meta.severity === 'warning'
            ? 'Cảnh báo'
            : 'Thông thường',
      'Cảnh báo bất thường': anomaly.isAnomalous ? anomaly.reasons.join('; ') : '',
      'Tên công nhân': parsed.workerName || '',
      'Mã NV': parsed.maNv || '',
      CCCD: parsed.cccd || '',
      KTX: parsed.ktx || '',
      Dãy: parsed.day || '',
      Phòng: parsed.phong ? `P.${parsed.phong}` : '',
      Giường: parsed.giuong ? `G${parsed.giuong}` : '',
      'Thay đổi (Trước → Sau)': parsed.beforeAfter
        ? `${parsed.beforeAfter.before} ${parsed.beforeAfter.isSwap ? '↔' : '→'} ${parsed.beforeAfter.after}`
        : '',
      'Tóm tắt chi tiết': parsed.summary,
      'Dữ liệu gốc': entry.detail,
    };
  });
}
