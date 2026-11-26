'use client';

import { createClient } from '@/lib/supabase/client';
import type { Worker } from '@/data/workers';
import { normalizeRoomLabel } from '@/lib/facilityCapacity';
import { getVNDateString, parseVNDateSafe } from '@/lib/vnDate';

export type DisciplineCategory =
  | 'alcohol'
  | 'fighting'
  | 'fire_safety'
  | 'property_damage'
  | 'curfew'
  | 'hygiene'
  | 'other';

export type DisciplineSeverity = 'reminder' | 'warning' | 'record' | 'expulsion';

export interface DisciplineRecord {
  id: string;
  worker_id?: string | null;
  ho_va_ten: string;
  ma_nv: string;
  cccd: string;
  so_dien_thoai: string;
  don_vi: string;
  ktx: string;
  day: string;
  phong_so: string;
  category: DisciplineCategory;
  severity: DisciplineSeverity;
  title: string;
  description: string;
  action_taken: string;
  incident_date: string;
  status: 'open' | 'resolved';
  recorded_by: string;
  recorded_by_email?: string;
  created_at: string;
}

export interface BlacklistRecord {
  id: string;
  cccd: string;
  ma_nv: string;
  ho_va_ten: string;
  don_vi: string;
  reason: string;
  severity: 'permanent' | 'temporary';
  banned_until?: string | null;
  is_active: boolean;
  banned_by: string;
  banned_by_email?: string;
  revoked_by?: string | null;
  revoked_at?: string | null;
  revoke_note?: string | null;
  created_at: string;
}

export interface BlacklistCheckResult {
  isBanned: boolean;
  reason: string;
  severity: 'permanent' | 'temporary' | '';
  bannedUntil: string | null;
  matchedRecord?: BlacklistRecord;
}

export interface GhostWorkerCandidate {
  worker: Worker;
  totalSessionsInScope: number;
  missedCount: number;
  consecutiveMissed: number;
  lastPresentDate: string | null;
  riskLevel: 'high' | 'medium';
}

export const DISCIPLINE_CATEGORY_META: Record<
  DisciplineCategory,
  { label: string; shortLabel: string }
> = {
  alcohol: { label: 'Uống rượu bia / Say xỉn gây rối', shortLabel: 'Rượu bia' },
  fighting: { label: 'Gây gổ / Đánh nhau / Mất ANTT', shortLabel: 'Gây gổ / ANTT' },
  fire_safety: { label: 'Vi phạm PCCC (Nấu ăn, hút thuốc, câu điện)', shortLabel: 'Vi phạm PCCC' },
  property_damage: { label: 'Phá hoại / Làm hư hỏng tài sản KTX', shortLabel: 'Hư hỏng CSVC' },
  curfew: { label: 'Vi phạm giờ giấc / Dẫn người lạ vào phòng', shortLabel: 'Giờ giấc / Người lạ' },
  hygiene: { label: 'Mất vệ sinh chung / Xả rác bừa bãi', shortLabel: 'Vệ sinh' },
  other: { label: 'Vi phạm nội quy khác', shortLabel: 'Khác' },
};

export const DISCIPLINE_SEVERITY_META: Record<
  DisciplineSeverity,
  { label: string; tone: 'blue' | 'amber' | 'rose' }
> = {
  reminder: { label: 'Nhắc nhở', tone: 'blue' },
  warning: { label: 'Cảnh cáo', tone: 'amber' },
  record: { label: 'Lập biên bản', tone: 'amber' },
  expulsion: { label: 'Buộc rời KTX', tone: 'rose' },
};

const LOCAL_DISCIPLINES_KEY = 'ktx_worker_disciplines_v1';
const LOCAL_BLACKLIST_KEY = 'ktx_worker_blacklist_v1';

export function normalizeIdCode(raw?: string | null): string {
  return (raw || '').trim().replace(/\s+/g, '');
}

export function normalizeMaNvKey(raw?: string | null): string {
  const s = (raw || '').trim().toLowerCase();
  if (!s || s === '-' || s === 'chờ mã' || s === 'cho ma') return '';
  return s;
}

function isMissingTableErr(err?: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === 'PGRST205' ||
    err.code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find the table') ||
    msg.includes('could not find the function')
  );
}

function readLocal<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal<T>(key: string, data: T[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
}

export function isBlacklistRecordEffective(rec: BlacklistRecord): boolean {
  if (!rec.is_active) return false;
  if (rec.severity === 'temporary' && rec.banned_until) {
    const today = getVNDateString();
    if (rec.banned_until < today) return false;
  }
  return true;
}

export async function fetchDisciplines(): Promise<{
  data: DisciplineRecord[];
  tableMissing: boolean;
}> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase
      .from('worker_disciplines')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      return {
        data: readLocal<DisciplineRecord>(LOCAL_DISCIPLINES_KEY),
        tableMissing: isMissingTableErr(error),
      };
    }

    const list = (data || []) as DisciplineRecord[];
    writeLocal(LOCAL_DISCIPLINES_KEY, list);
    return { data: list, tableMissing: false };
  } catch {
    return {
      data: readLocal<DisciplineRecord>(LOCAL_DISCIPLINES_KEY),
      tableMissing: false,
    };
  }
}

export async function createDisciplineRecord(
  input: Omit<DisciplineRecord, 'id' | 'created_at' | 'status'>
): Promise<{ record: DisciplineRecord | null; error?: string; tableMissing?: boolean }> {
  const supabase = createClient();
  const payload = {
    worker_id: input.worker_id || null,
    ho_va_ten: input.ho_va_ten.trim(),
    ma_nv: (input.ma_nv || '').trim(),
    cccd: normalizeIdCode(input.cccd),
    so_dien_thoai: (input.so_dien_thoai || '').trim(),
    don_vi: (input.don_vi || '').trim(),
    ktx: (input.ktx || '').trim(),
    day: (input.day || '').trim(),
    phong_so: (input.phong_so || '').trim(),
    category: input.category,
    severity: input.severity,
    title: input.title.trim(),
    description: (input.description || '').trim(),
    action_taken: (input.action_taken || '').trim(),
    incident_date: input.incident_date || getVNDateString(),
    status: 'open' as const,
    recorded_by: input.recorded_by,
    recorded_by_email: input.recorded_by_email || '',
  };

  try {
    const { data, error } = await supabase
      .from('worker_disciplines')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      if (isMissingTableErr(error)) {
        const localRec: DisciplineRecord = {
          ...payload,
          id: `local-disc-${Date.now()}`,
          created_at: new Date().toISOString(),
        };
        const existing = readLocal<DisciplineRecord>(LOCAL_DISCIPLINES_KEY);
        writeLocal(LOCAL_DISCIPLINES_KEY, [localRec, ...existing]);
        return { record: localRec, tableMissing: true };
      }
      return { record: null, error: error.message };
    }

    const rec = data as DisciplineRecord;
    const existing = readLocal<DisciplineRecord>(LOCAL_DISCIPLINES_KEY);
    writeLocal(LOCAL_DISCIPLINES_KEY, [rec, ...existing.filter(r => r.id !== rec.id)]);
    return { record: rec };
  } catch (err) {
    return {
      record: null,
      error: err instanceof Error ? err.message : 'Lỗi kết nối Supabase',
    };
  }
}

export async function updateDisciplineStatus(
  id: string,
  status: 'open' | 'resolved'
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const local = readLocal<DisciplineRecord>(LOCAL_DISCIPLINES_KEY);
  const updatedLocal = local.map(r => (r.id === id ? { ...r, status } : r));
  writeLocal(LOCAL_DISCIPLINES_KEY, updatedLocal);

  if (id.startsWith('local-disc-')) return { ok: true };

  try {
    const { error } = await supabase
      .from('worker_disciplines')
      .update({ status })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Lỗi kết nối' };
  }
}

export async function deleteDisciplineRecord(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const local = readLocal<DisciplineRecord>(LOCAL_DISCIPLINES_KEY);
  writeLocal(LOCAL_DISCIPLINES_KEY, local.filter(r => r.id !== id));

  if (id.startsWith('local-disc-')) return { ok: true };

  try {
    const { error } = await supabase.from('worker_disciplines').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Lỗi kết nối' };
  }
}

export async function fetchBlacklist(): Promise<{
  data: BlacklistRecord[];
  tableMissing: boolean;
}> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase
      .from('worker_blacklist')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      return {
        data: readLocal<BlacklistRecord>(LOCAL_BLACKLIST_KEY),
        tableMissing: isMissingTableErr(error),
      };
    }

    const list = (data || []) as BlacklistRecord[];
    writeLocal(LOCAL_BLACKLIST_KEY, list);
    return { data: list, tableMissing: false };
  } catch {
    return {
      data: readLocal<BlacklistRecord>(LOCAL_BLACKLIST_KEY),
      tableMissing: false,
    };
  }
}

export async function addToBlacklist(input: {
  cccd: string;
  ma_nv?: string;
  ho_va_ten: string;
  don_vi?: string;
  reason: string;
  severity: 'permanent' | 'temporary';
  banned_until?: string | null;
  banned_by: string;
  banned_by_email?: string;
}): Promise<{ record: BlacklistRecord | null; error?: string; tableMissing?: boolean }> {
  const supabase = createClient();
  const normCccd = normalizeIdCode(input.cccd);
  if (!normCccd) {
    return { record: null, error: 'Số CCCD là bắt buộc để chốt chặn Danh sách Đen.' };
  }

  const payload = {
    cccd: normCccd,
    ma_nv: (input.ma_nv || '').trim(),
    ho_va_ten: input.ho_va_ten.trim(),
    don_vi: (input.don_vi || '').trim(),
    reason: input.reason.trim(),
    severity: input.severity,
    banned_until: input.severity === 'temporary' && input.banned_until ? input.banned_until : null,
    is_active: true,
    banned_by: input.banned_by,
    banned_by_email: input.banned_by_email || '',
  };

  try {
    const { data, error } = await supabase
      .from('worker_blacklist')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      if (isMissingTableErr(error)) {
        const localRec: BlacklistRecord = {
          ...payload,
          id: `local-bl-${Date.now()}`,
          created_at: new Date().toISOString(),
        };
        const existing = readLocal<BlacklistRecord>(LOCAL_BLACKLIST_KEY);
        writeLocal(LOCAL_BLACKLIST_KEY, [localRec, ...existing]);
        return { record: localRec, tableMissing: true };
      }
      return { record: null, error: error.message };
    }

    const rec = data as BlacklistRecord;
    const existing = readLocal<BlacklistRecord>(LOCAL_BLACKLIST_KEY);
    writeLocal(LOCAL_BLACKLIST_KEY, [rec, ...existing.filter(r => r.id !== rec.id)]);
    return { record: rec };
  } catch (err) {
    return {
      record: null,
      error: err instanceof Error ? err.message : 'Lỗi kết nối Supabase',
    };
  }
}

export async function revokeBlacklistRecord(
  id: string,
  revokedBy: string,
  revokeNote: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient();
  const nowIso = new Date().toISOString();
  const local = readLocal<BlacklistRecord>(LOCAL_BLACKLIST_KEY);
  writeLocal(
    LOCAL_BLACKLIST_KEY,
    local.map(r =>
      r.id === id
        ? { ...r, is_active: false, revoked_by: revokedBy, revoked_at: nowIso, revoke_note: revokeNote }
        : r
    )
  );

  if (id.startsWith('local-bl-')) return { ok: true };

  try {
    const { error } = await supabase
      .from('worker_blacklist')
      .update({
        is_active: false,
        revoked_by: revokedBy,
        revoked_at: nowIso,
        revoke_note: revokeNote.trim(),
      })
      .eq('id', id);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Lỗi kết nối' };
  }
}

/**
 * Matches a worker's CCCD or MaNV against an already loaded blacklist array (fast synchronous check for Excel Import / QR Approval / Form).
 */
export function matchBlacklistInMemory(
  blacklist: BlacklistRecord[],
  cccd?: string | null,
  maNv?: string | null
): BlacklistCheckResult {
  const normCccd = normalizeIdCode(cccd);
  const normMa = normalizeMaNvKey(maNv);
  if (!normCccd && !normMa) {
    return { isBanned: false, reason: '', severity: '', bannedUntil: null };
  }

  for (const rec of blacklist) {
    if (!isBlacklistRecordEffective(rec)) continue;
    const recCccd = normalizeIdCode(rec.cccd);
    const recMa = normalizeMaNvKey(rec.ma_nv);
    if ((normCccd && recCccd && normCccd === recCccd) || (normMa && recMa && normMa === recMa)) {
      return {
        isBanned: true,
        reason: rec.reason,
        severity: rec.severity,
        bannedUntil: rec.banned_until || null,
        matchedRecord: rec,
      };
    }
  }
  return { isBanned: false, reason: '', severity: '', bannedUntil: null };
}

/**
 * Public-safe Blacklist check using SECURITY DEFINER RPC `check_blacklist_cccd`
 * for anonymous `/register` gate without exposing any PII.
 */
export async function checkBlacklistPublic(
  cccd?: string | null,
  maNv?: string | null
): Promise<BlacklistCheckResult> {
  const normCccd = normalizeIdCode(cccd);
  const normMa = normalizeMaNvKey(maNv);
  if (!normCccd && !normMa) {
    return { isBanned: false, reason: '', severity: '', bannedUntil: null };
  }

  const supabase = createClient();
  try {
    const { data, error } = await supabase.rpc('check_blacklist_cccd', {
      p_cccd: normCccd,
      p_ma_nv: normMa,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      const row = data[0] as {
        is_banned?: boolean;
        reason?: string;
        severity?: 'permanent' | 'temporary';
        banned_until?: string | null;
      };
      if (row.is_banned) {
        return {
          isBanned: true,
          reason: row.reason || 'Thuộc danh sách hạn chế lưu trú KTX',
          severity: row.severity || 'permanent',
          bannedUntil: row.banned_until || null,
        };
      }
      return { isBanned: false, reason: '', severity: '', bannedUntil: null };
    }
  } catch {
    // RPC may not be migrated yet — check local cache fallback for same-device testing
  }

  const localList = readLocal<BlacklistRecord>(LOCAL_BLACKLIST_KEY);
  return matchBlacklistInMemory(localList, normCccd, normMa);
}

/**
 * Ghost Worker Detector:
 * Compares active residents against recent `attendance_sessions` & `attendance_records`.
 * Identifies workers who have been assigned a bed since before the sessions,
 * match each session's scope (KTX / Day / Room), yet were absent repeatedly.
 */
export async function detectGhostWorkers(
  workers: Worker[],
  minMissedThreshold = 2
): Promise<{
  candidates: GhostWorkerCandidate[];
  sessionsAnalyzed: number;
  latestSessionDate: string | null;
  error?: string;
}> {
  const supabase = createClient();
  try {
    const { data: sessions, error: sessErr } = await supabase
      .from('attendance_sessions')
      .select('id, session_date, zone_ktx, zone_day, zone_phong')
      .order('session_date', { ascending: false })
      .limit(12);

    if (sessErr) {
      return {
        candidates: [],
        sessionsAnalyzed: 0,
        latestSessionDate: null,
        error: isMissingTableErr(sessErr) ? undefined : sessErr.message,
      };
    }

    const sessionList = (sessions || []) as {
      id: string;
      session_date: string;
      zone_ktx: string;
      zone_day: string;
      zone_phong: string;
    }[];

    if (sessionList.length === 0) {
      return { candidates: [], sessionsAnalyzed: 0, latestSessionDate: null };
    }

    const sessionIds = sessionList.map(s => s.id);
    const { data: records, error: recErr } = await supabase
      .from('attendance_records')
      .select('session_id, ma_nv, ho_va_ten')
      .in('session_id', sessionIds)
      .limit(15000);

    if (recErr) {
      return {
        candidates: [],
        sessionsAnalyzed: sessionList.length,
        latestSessionDate: sessionList[0]?.session_date || null,
        error: recErr.message,
      };
    }

    // Build set of checked-in identifiers per session
    const presentBySession = new Map<string, Set<string>>();
    (records || []).forEach((r: { session_id: string; ma_nv?: string | null; ho_va_ten?: string | null }) => {
      if (!presentBySession.has(r.session_id)) {
        presentBySession.set(r.session_id, new Set<string>());
      }
      const set = presentBySession.get(r.session_id)!;
      const ma = normalizeMaNvKey(r.ma_nv);
      const name = (r.ho_va_ten || '').trim().toLowerCase();
      if (ma) set.add(`ma:${ma}`);
      if (name) set.add(`name:${name}`);
    });

    const activeWorkers = workers.filter(
      w =>
        !w.ngayRaKTX &&
        !w.ghiChu?.includes('[Đã Check-out') &&
        !w.ghiChu?.includes('[CHECKOUT]')
    );

    const candidates: GhostWorkerCandidate[] = [];

    for (const w of activeWorkers) {
      const wKtx = (w.ktx || '').trim().toLowerCase();
      const wDay = (w.day || '').trim().toLowerCase();
      const wRoom = normalizeRoomLabel(w.phongSo);
      const wMa = normalizeMaNvKey(w.maNV);
      const wName = (w.hoVaTen || '').trim().toLowerCase();
      const enteredDate = parseVNDateSafe(w.ngayVaoKTX || w.createdAt);

      let totalSessionsInScope = 0;
      let missedCount = 0;
      let consecutiveMissed = 0;
      let streakOpen = true;
      let lastPresentDate: string | null = null;

      for (const s of sessionList) {
        // Skip sessions before worker entered KTX
        if (enteredDate && s.session_date) {
          const sDate = new Date(`${s.session_date}T23:59:59+07:00`);
          if (!Number.isNaN(sDate.getTime()) && enteredDate.getTime() > sDate.getTime()) {
            continue;
          }
        }

        // Check if worker is in this session's target zone
        const zKtx = (s.zone_ktx || '').trim().toLowerCase();
        const zDay = (s.zone_day || '').trim().toLowerCase();
        const zRoom = normalizeRoomLabel(s.zone_phong);
        if (zKtx && zKtx !== wKtx) continue;
        if (zDay && zDay !== wDay) continue;
        if (zRoom && zRoom !== wRoom) continue;

        totalSessionsInScope++;
        const presentSet = presentBySession.get(s.id);
        const isPresent = Boolean(
          presentSet &&
            ((wMa && presentSet.has(`ma:${wMa}`)) || (wName && presentSet.has(`name:${wName}`)))
        );

        if (isPresent) {
          if (!lastPresentDate) lastPresentDate = s.session_date;
          streakOpen = false;
        } else {
          missedCount++;
          if (streakOpen) consecutiveMissed++;
        }
      }

      if (consecutiveMissed >= minMissedThreshold) {
        candidates.push({
          worker: w,
          totalSessionsInScope,
          missedCount,
          consecutiveMissed,
          lastPresentDate,
          riskLevel: consecutiveMissed >= 3 ? 'high' : 'medium',
        });
      }
    }

    candidates.sort((a, b) => {
      if (b.consecutiveMissed !== a.consecutiveMissed) {
        return b.consecutiveMissed - a.consecutiveMissed;
      }
      return b.missedCount - a.missedCount;
    });

    return {
      candidates,
      sessionsAnalyzed: sessionList.length,
      latestSessionDate: sessionList[0]?.session_date || null,
    };
  } catch (err) {
    return {
      candidates: [],
      sessionsAnalyzed: 0,
      latestSessionDate: null,
      error: err instanceof Error ? err.message : 'Lỗi quét dữ liệu điểm danh',
    };
  }
}
