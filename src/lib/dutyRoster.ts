'use client';

import { createClient } from '@/lib/supabase/client';

export type DutyKtx = string;

export interface DutyAssignmentRow {
  id?: string;
  duty_date: string;
  profile_id: string;
  duty_ktx: string;
  updated_by?: string | null;
  updated_at?: string;
}

export interface SpecialistWithDuty {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: 'admin' | 'staff';
  assignedBlocks: string[];
  dutyKtx: DutyKtx;
  status: 'on_duty' | 'off_duty';
}

const LOCAL_STORAGE_KEY_PREFIX = 'ktx_duty_roster_';

/**
 * Returns today's date formatted as YYYY-MM-DD in Vietnam timezone (Asia/Ho_Chi_Minh)
 */
export function getTodayDateVietnam(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const vnTime = new Date(utc + (3600000 * 7));
    return vnTime.toISOString().split('T')[0];
  }
}

/**
 * Reads local duty assignments for a specific date
 */
export function getLocalDutyAssignments(dateStr: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${dateStr}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

/**
 * Saves local duty assignments for a specific date and notifies listeners
 */
export function saveLocalDutyAssignments(dateStr: string, map: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${LOCAL_STORAGE_KEY_PREFIX}${dateStr}`, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent('ktx_duty_updated', { detail: { date: dateStr, map } }));
  } catch {}
}

/**
 * Helper to check if Supabase error is caused by missing table in schema cache
 */
export function isTableMissingError(msg?: string, code?: string): boolean {
  if (!msg && !code) return false;
  const m = (msg || '').toLowerCase();
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    m.includes('could not find the table') ||
    (m.includes('relation') && m.includes('does not exist')) ||
    m.includes('schema cache')
  );
}

/**
 * Fetches duty assignments from local cache and syncs with Supabase if available
 */
export async function fetchDutyAssignmentsFromSupabase(
  targetDate?: string
): Promise<{ data: Record<string, string> | null; isTableMissing: boolean; error: string | null }> {
  const dateStr = targetDate || getTodayDateVietnam();
  const localMap = getLocalDutyAssignments(dateStr);

  try {
    const supabase = createClient();

    // Fast timeout for Supabase
    const fetchPromise = supabase
      .from('duty_assignments')
      .select('profile_id, duty_ktx')
      .eq('duty_date', dateStr);

    const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error('timeout') }), 2500)
    );

    const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);

    if (error) {
      const isMissing = isTableMissingError(error.message, (error as any).code);
      return { data: localMap, isTableMissing: isMissing, error: null };
    }

    if (data && Array.isArray(data)) {
      const merged: Record<string, string> = { ...localMap };
      data.forEach((row: { profile_id: string; duty_ktx: string }) => {
        if (row.profile_id) {
          merged[row.profile_id] = row.duty_ktx || 'Nghỉ';
        }
      });
      saveLocalDutyAssignments(dateStr, merged);
      return { data: merged, isTableMissing: false, error: null };
    }

    return { data: localMap, isTableMissing: false, error: null };
  } catch (err: any) {
    const isMissing = isTableMissingError(err?.message);
    return { data: localMap, isTableMissing: isMissing, error: null };
  }
}

/**
 * Upserts a single specialist duty assignment (local first, background Supabase)
 */
export async function upsertDutyAssignmentToSupabase(
  profileId: string,
  dutyKtx: string,
  updatedBy?: string | null,
  targetDate?: string
): Promise<{ success: boolean; isTableMissing: boolean; error: string | null }> {
  const dateStr = targetDate || getTodayDateVietnam();
  const normalizedKtx = dutyKtx.trim() || 'Nghỉ';

  // 1. Immediately persist locally
  const localMap = getLocalDutyAssignments(dateStr);
  localMap[profileId] = normalizedKtx;
  saveLocalDutyAssignments(dateStr, localMap);

  // 2. Try to sync to Supabase in background
  try {
    const supabase = createClient();
    const payload: {
      duty_date: string;
      profile_id: string;
      duty_ktx: string;
      updated_by?: string | null;
      updated_at: string;
    } = {
      duty_date: dateStr,
      profile_id: profileId,
      duty_ktx: normalizedKtx,
      updated_at: new Date().toISOString(),
    };

    if (updatedBy) {
      payload.updated_by = updatedBy;
    }

    const { error } = await supabase
      .from('duty_assignments')
      .upsert(payload, { onConflict: 'duty_date,profile_id' });

    if (error) {
      const isMissing = isTableMissingError(error.message, error.code);
      return { success: true, isTableMissing: isMissing, error: null };
    }

    return { success: true, isTableMissing: false, error: null };
  } catch (err: any) {
    const isMissing = isTableMissingError(err?.message);
    return { success: true, isTableMissing: isMissing, error: null };
  }
}

/**
 * Batch upserts duty assignments for multiple specialists (local first, background Supabase)
 */
export async function batchUpsertDutyAssignmentsToSupabase(
  profileIds: string[],
  dutyKtx: string,
  updatedBy?: string | null,
  targetDate?: string
): Promise<{ success: boolean; isTableMissing: boolean; error: string | null }> {
  if (!profileIds || profileIds.length === 0) {
    return { success: true, isTableMissing: false, error: null };
  }

  const dateStr = targetDate || getTodayDateVietnam();
  const normalizedKtx = dutyKtx.trim() || 'Nghỉ';

  // 1. Immediately persist locally
  const localMap = getLocalDutyAssignments(dateStr);
  profileIds.forEach(id => {
    localMap[id] = normalizedKtx;
  });
  saveLocalDutyAssignments(dateStr, localMap);

  // 2. Try to sync to Supabase in background
  try {
    const supabase = createClient();
    const nowIso = new Date().toISOString();

    const payload = profileIds.map(pid => ({
      duty_date: dateStr,
      profile_id: pid,
      duty_ktx: normalizedKtx,
      updated_by: updatedBy || null,
      updated_at: nowIso,
    }));

    const { error } = await supabase
      .from('duty_assignments')
      .upsert(payload, { onConflict: 'duty_date,profile_id' });

    if (error) {
      const isMissing = isTableMissingError(error.message, error.code);
      return { success: true, isTableMissing: isMissing, error: null };
    }

    return { success: true, isTableMissing: false, error: null };
  } catch (err: any) {
    const isMissing = isTableMissingError(err?.message);
    return { success: true, isTableMissing: isMissing, error: null };
  }
}
