'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { buildCanonicalBedKey, normalizeBedLabel } from '@/lib/bedSync';
import { normalizeRoomLabel } from '@/lib/facilityCapacity';
import { getVNDateString } from '@/lib/vnDate';

export type BedReservationStatus = 'active' | 'fulfilled' | 'cancelled';

export interface BedReservation {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  group_name: string;
  expected_date: string; // YYYY-MM-DD
  note: string;
  status: BedReservationStatus;
  created_by: string;
  fulfilled_worker_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BedReservationSlotInput {
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
}

export const BED_RESERVATIONS_SETUP_SQL = `-- Tạo bảng Giữ chỗ giường cho đoàn sắp vào (bed_reservations)
CREATE TABLE IF NOT EXISTS public.bed_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ktx TEXT NOT NULL,
  day TEXT NOT NULL,
  phong_so TEXT NOT NULL,
  giuong TEXT NOT NULL,
  group_name TEXT NOT NULL,
  expected_date DATE NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'cancelled')),
  created_by TEXT DEFAULT '',
  fulfilled_worker_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bed_reservations_status_date
  ON public.bed_reservations (status, expected_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bed_reservations_active_slot
  ON public.bed_reservations (ktx, day, phong_so, giuong)
  WHERE status = 'active';

ALTER TABLE public.bed_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bed_reservations_select_auth" ON public.bed_reservations;
CREATE POLICY "bed_reservations_select_auth"
  ON public.bed_reservations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "bed_reservations_write_staff" ON public.bed_reservations;
CREATE POLICY "bed_reservations_write_staff"
  ON public.bed_reservations FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'admin', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'admin', 'staff')
    )
  );`;

function isMissingTableError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('bed_reservations') && (msg.includes('does not exist') || msg.includes('schema cache'));
}

export function buildReservationSlotKey(
  ktx?: string | null,
  day?: string | null,
  phongSo?: string | null,
  giuong?: string | null
): string {
  return buildCanonicalBedKey(ktx, day, phongSo, giuong);
}

export function isReservationOverdue(reservation: Pick<BedReservation, 'expected_date' | 'status'>): boolean {
  if (reservation.status !== 'active' || !reservation.expected_date) return false;
  const todayVN = getVNDateString();
  return reservation.expected_date < todayVN;
}

export async function fetchActiveReservations(
  supabaseClient?: SupabaseClient
): Promise<{ data: BedReservation[]; missingTable: boolean; error?: string }> {
  const supabase = supabaseClient ?? createClient();
  const { data, error } = await supabase
    .from('bed_reservations')
    .select('*')
    .eq('status', 'active')
    .order('expected_date', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return { data: [], missingTable: true };
    }
    return { data: [], missingTable: false, error: error.message };
  }
  return { data: (data ?? []) as BedReservation[], missingTable: false };
}

export async function createBedReservations(
  params: {
    slots: BedReservationSlotInput[];
    groupName: string;
    expectedDate: string;
    note?: string;
    createdBy: string;
  },
  supabaseClient?: SupabaseClient
): Promise<{ created: BedReservation[]; missingTable: boolean; error?: string }> {
  const supabase = supabaseClient ?? createClient();
  const cleanGroup = params.groupName.trim();
  if (!cleanGroup) {
    return { created: [], missingTable: false, error: 'Vui lòng nhập tên đoàn hoặc đơn vị giữ chỗ.' };
  }
  if (!params.expectedDate) {
    return { created: [], missingTable: false, error: 'Vui lòng chọn ngày dự kiến vào KTX.' };
  }
  if (params.slots.length === 0) {
    return { created: [], missingTable: false, error: 'Chưa chọn giường nào để giữ chỗ.' };
  }

  const nowIso = new Date().toISOString();
  const rows = params.slots.map(s => ({
    ktx: s.ktx.trim(),
    day: s.day.trim(),
    phong_so: normalizeRoomLabel(s.phong_so) || s.phong_so.trim(),
    giuong: normalizeBedLabel(s.giuong) || s.giuong.trim(),
    group_name: cleanGroup,
    expected_date: params.expectedDate,
    note: (params.note || '').trim(),
    status: 'active' as const,
    created_by: params.createdBy || '',
    updated_at: nowIso,
  }));

  const { data, error } = await supabase
    .from('bed_reservations')
    .insert(rows)
    .select('*');

  if (error) {
    if (isMissingTableError(error)) {
      return {
        created: [],
        missingTable: true,
        error: 'Bảng bed_reservations chưa được khởi tạo trong Supabase. Vui lòng chạy SQL Migration để kích hoạt.',
      };
    }
    if (error.code === '23505') {
      return {
        created: [],
        missingTable: false,
        error: 'Một hoặc nhiều giường đã có suất giữ chỗ đang hoạt động. Vui lòng làm mới danh sách.',
      };
    }
    return { created: [], missingTable: false, error: error.message };
  }

  return { created: (data ?? []) as BedReservation[], missingTable: false };
}

export async function cancelBedReservation(
  reservationId: string,
  supabaseClient?: SupabaseClient
): Promise<{ ok: boolean; error?: string }> {
  const supabase = supabaseClient ?? createClient();
  const { error } = await supabase
    .from('bed_reservations')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', reservationId);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function cancelBedReservationsBatch(
  reservationIds: string[],
  supabaseClient?: SupabaseClient
): Promise<{ ok: boolean; count: number; error?: string }> {
  const ids = Array.from(new Set(reservationIds.filter(Boolean)));
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = supabaseClient ?? createClient();
  const { error } = await supabase
    .from('bed_reservations')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .in('id', ids);

  if (error) {
    return { ok: false, count: 0, error: error.message };
  }
  return { ok: true, count: ids.length };
}

/**
 * Automatically marks an active bed reservation as fulfilled when a real worker is placed into that bed.
 * Fails silently if table is not deployed yet so normal bed assignment is never blocked.
 */
export async function fulfillReservationForBed(
  slot: BedReservationSlotInput,
  workerId?: string | null,
  supabaseClient?: SupabaseClient
): Promise<boolean> {
  const supabase = supabaseClient ?? createClient();
  const targetKey = buildReservationSlotKey(slot.ktx, slot.day, slot.phong_so, slot.giuong);
  try {
    const { data, error } = await supabase
      .from('bed_reservations')
      .select('id, ktx, day, phong_so, giuong')
      .eq('status', 'active')
      .eq('ktx', slot.ktx.trim())
      .eq('day', slot.day.trim());

    if (error || !data || data.length === 0) return false;

    const matchingIds = data
      .filter(r => buildReservationSlotKey(r.ktx, r.day, r.phong_so, r.giuong) === targetKey)
      .map(r => String(r.id));

    if (matchingIds.length === 0) return false;

    const { error: updErr } = await supabase
      .from('bed_reservations')
      .update({
        status: 'fulfilled',
        fulfilled_worker_id: workerId || null,
        updated_at: new Date().toISOString(),
      })
      .in('id', matchingIds);

    return !updErr;
  } catch {
    return false;
  }
}
