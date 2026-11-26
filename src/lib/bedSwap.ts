'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBedLabel, reconcileBedsWithWorkers } from '@/lib/bedSync';
import { formatRoomDisplay, normalizeRoomLabel } from '@/lib/facilityCapacity';

export interface SwapWorkerParticipant {
  id: string;
  hoVaTen: string;
  maNV?: string | null;
  cccd?: string | null;
  gioiTinh?: string | null;
  donVi?: string | null;
  ktx: string;
  day: string;
  phongSo: string;
  giuong: string;
}

export interface BedSwapResult {
  ok: boolean;
  error?: string;
  summaryText: string;
  auditDetailJson: string;
}

function formatSlotShort(p: Pick<SwapWorkerParticipant, 'ktx' | 'day' | 'phongSo' | 'giuong'>): string {
  const room = formatRoomDisplay(p.phongSo);
  const bed = normalizeBedLabel(p.giuong);
  return `${p.ktx} · ${p.day} · ${room} · G${bed || p.giuong}`;
}

/**
 * Atomically swaps room/bed coordinates between two occupied workers across `workers` and `beds`.
 * Clears both beds first (avoiding unique-slot collisions), updates both worker rows, then reconciles `beds`.
 */
export async function swapWorkerBeds(
  supabase: SupabaseClient,
  workerA: SwapWorkerParticipant,
  workerB: SwapWorkerParticipant
): Promise<BedSwapResult> {
  if (!workerA.id || !workerB.id) {
    return { ok: false, error: 'Thiếu thông tin công nhân để hoán đổi.', summaryText: '', auditDetailJson: '' };
  }
  if (workerA.id === workerB.id) {
    return { ok: false, error: 'Không thể hoán đổi cùng một công nhân.', summaryText: '', auditDetailJson: '' };
  }

  const slotA = {
    ktx: workerA.ktx.trim(),
    day: workerA.day.trim(),
    phong_so: normalizeRoomLabel(workerA.phongSo) || workerA.phongSo.trim(),
    giuong: normalizeBedLabel(workerA.giuong) || workerA.giuong.trim(),
  };
  const slotB = {
    ktx: workerB.ktx.trim(),
    day: workerB.day.trim(),
    phong_so: normalizeRoomLabel(workerB.phongSo) || workerB.phongSo.trim(),
    giuong: normalizeBedLabel(workerB.giuong) || workerB.giuong.trim(),
  };

  if (!slotA.ktx || !slotA.day || !slotA.phong_so || !slotA.giuong || !slotB.ktx || !slotB.day || !slotB.phong_so || !slotB.giuong) {
    return {
      ok: false,
      error: 'Cả hai công nhân cần có đủ thông tin KTX, Dãy, Phòng và Giường để hoán đổi.',
      summaryText: '',
      auditDetailJson: '',
    };
  }

  // Step 1: Temporarily clear worker references on both beds so no unique constraint conflict occurs
  const { error: clearErr } = await supabase
    .from('beds')
    .update({ status: 'empty', worker_id: null, ma_nv: null, ho_va_ten: null })
    .in('worker_id', [workerA.id, workerB.id]);

  if (clearErr) {
    return {
      ok: false,
      error: `Không thể chuẩn bị giường hoán đổi: ${clearErr.message}`,
      summaryText: '',
      auditDetailJson: '',
    };
  }

  // Step 2: Update Worker A -> Slot B and Worker B -> Slot A
  const updateA = supabase
    .from('workers')
    .update({
      ktx: slotB.ktx,
      day: slotB.day,
      phong_so: slotB.phong_so,
      giuong: slotB.giuong,
      khoa_tra_cuu: `${slotB.ktx}|${slotB.day}|${slotB.phong_so}`,
    })
    .eq('id', workerA.id);

  const updateB = supabase
    .from('workers')
    .update({
      ktx: slotA.ktx,
      day: slotA.day,
      phong_so: slotA.phong_so,
      giuong: slotA.giuong,
      khoa_tra_cuu: `${slotA.ktx}|${slotA.day}|${slotA.phong_so}`,
    })
    .eq('id', workerB.id);

  const [resA, resB] = await Promise.all([updateA, updateB]);

  if (resA.error || resB.error) {
    // Attempt rollback of whichever succeeded
    if (!resA.error && resB.error) {
      await supabase
        .from('workers')
        .update({
          ktx: slotA.ktx,
          day: slotA.day,
          phong_so: slotA.phong_so,
          giuong: slotA.giuong,
          khoa_tra_cuu: `${slotA.ktx}|${slotA.day}|${slotA.phong_so}`,
        })
        .eq('id', workerA.id);
    } else if (resA.error && !resB.error) {
      await supabase
        .from('workers')
        .update({
          ktx: slotB.ktx,
          day: slotB.day,
          phong_so: slotB.phong_so,
          giuong: slotB.giuong,
          khoa_tra_cuu: `${slotB.ktx}|${slotB.day}|${slotB.phong_so}`,
        })
        .eq('id', workerB.id);
    }
    await reconcileBedsWithWorkers(supabase);
    return {
      ok: false,
      error: `Hoán đổi thất bại: ${resA.error?.message || resB.error?.message}`,
      summaryText: '',
      auditDetailJson: '',
    };
  }

  // Step 3: Reconcile `beds` table so both bed rows reflect their swapped occupants accurately
  await reconcileBedsWithWorkers(supabase);

  const locA = formatSlotShort(workerA);
  const locB = formatSlotShort(workerB);
  const summaryText = `Hoán đổi giường: ${workerA.hoVaTen} (${locA}) ⇄ ${workerB.hoVaTen} (${locB})`;
  const auditDetailJson = JSON.stringify({
    event: 'SWAP_BEDS',
    worker_a: {
      id: workerA.id,
      ho_va_ten: workerA.hoVaTen,
      ma_nv: workerA.maNV || '',
      from: locA,
      to: locB,
    },
    worker_b: {
      id: workerB.id,
      ho_va_ten: workerB.hoVaTen,
      ma_nv: workerB.maNV || '',
      from: locB,
      to: locA,
    },
    ho_va_ten: `${workerA.hoVaTen} ⇄ ${workerB.hoVaTen}`,
    before: `${workerA.hoVaTen}: ${locA} | ${workerB.hoVaTen}: ${locB}`,
    after: `${workerA.hoVaTen}: ${locB} | ${workerB.hoVaTen}: ${locA}`,
    is_swap: true,
    summary: summaryText,
  });

  return { ok: true, summaryText, auditDetailJson };
}
