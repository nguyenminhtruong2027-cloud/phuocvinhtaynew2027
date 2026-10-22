'use client';

import { createClient } from '@/lib/supabase/client';
import type { Worker } from '@/data/workers';

export type RoomGenderType = 'male' | 'female' | 'mixed' | 'empty' | 'auto';

const LOCAL_STORAGE_KEY = 'ktx_room_gender_assignments';

export interface RoomGenderInfo {
  gender: 'male' | 'female' | 'mixed' | 'empty';
  label: string;
  isCustom: boolean; // True if manually designated by Admin
  maleCount: number;
  femaleCount: number;
  totalCount: number;
}

/**
 * Normalizes gender string to 'nam', 'nu', or 'other'
 */
export function normalizeGender(val?: string | null): 'nam' | 'nu' | 'other' {
  if (!val) return 'other';
  const clean = val.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (clean === 'nam' || clean === 'm' || clean === 'male') return 'nam';
  if (clean === 'nu' || clean === 'n' || clean === 'female' || (clean.startsWith('n') && clean.length <= 3)) return 'nu';
  return 'other';
}

/**
 * Determines the effective gender status of a room:
 * 1. Admin manual designation ('Nam' or 'Nữ') takes precedence.
 * 2. Auto-detect from workers in the room:
 *    - All female -> 'female' (Phòng Nữ)
 *    - All male -> 'male' (Phòng Nam)
 *    - Both -> 'mixed' (Hỗn hợp)
 *    - 0 workers -> 'empty' (Phòng trống)
 */
export function getRoomGenderInfo(
  roomWorkers: Worker[] = [],
  adminAssignedLabel?: string | null
): RoomGenderInfo {
  let maleCount = 0;
  let femaleCount = 0;

  roomWorkers.forEach(w => {
    const g = normalizeGender(w.gioiTinh);
    if (g === 'nam') maleCount++;
    else if (g === 'nu') femaleCount++;
  });

  const totalCount = roomWorkers.length;

  // Check manual admin assignment
  if (adminAssignedLabel) {
    const normLabel = adminAssignedLabel.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (normLabel === 'nam' || normLabel === 'phong nam') {
      return {
        gender: 'male',
        label: 'Phòng Nam',
        isCustom: true,
        maleCount,
        femaleCount,
        totalCount,
      };
    }
    if (normLabel === 'nu' || normLabel === 'phong nu') {
      return {
        gender: 'female',
        label: 'Phòng Nữ',
        isCustom: true,
        maleCount,
        femaleCount,
        totalCount,
      };
    }
  }

  // Auto-detect based on workers
  if (totalCount === 0) {
    return {
      gender: 'empty',
      label: 'Phòng Trống',
      isCustom: false,
      maleCount: 0,
      femaleCount: 0,
      totalCount: 0,
    };
  }

  if (femaleCount > 0 && maleCount === 0) {
    return {
      gender: 'female',
      label: 'Phòng Nữ',
      isCustom: false,
      maleCount,
      femaleCount,
      totalCount,
    };
  }

  if (maleCount > 0 && femaleCount === 0) {
    return {
      gender: 'male',
      label: 'Phòng Nam',
      isCustom: false,
      maleCount,
      femaleCount,
      totalCount,
    };
  }

  return {
    gender: 'mixed',
    label: 'Hỗn hợp',
    isCustom: false,
    maleCount,
    femaleCount,
    totalCount,
  };
}

/**
 * Loads room gender assignments from localStorage
 */
export function loadSavedRoomGenderMap(): Record<string, 'male' | 'female' | 'auto'> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load room gender map from localStorage:', err);
  }
  return {};
}

/**
 * Saves room gender assignments to localStorage
 */
export function saveRoomGenderMap(map: Record<string, 'male' | 'female' | 'auto'>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.error('Failed to save room gender map to localStorage:', err);
  }
}

/**
 * Syncs room gender designation with Supabase `room_units` table
 */
export async function syncRoomGenderToSupabase(
  ktx: string,
  building: string,
  room: string,
  gender: 'male' | 'female' | 'auto'
): Promise<boolean> {
  try {
    const supabase = createClient();
    const effectiveDay = building.trim();
    const effectiveRoom = room.trim();
    const labelToSave = gender === 'female' ? 'Nữ' : gender === 'male' ? 'Nam' : null;

    // Try updating existing row
    const { data: updateData, error: updateError } = await supabase
      .from('room_units')
      .update({
        room_label: labelToSave,
        updated_at: new Date().toISOString(),
      })
      .eq('ktx', ktx)
      .eq('day_nha', effectiveDay)
      .eq('phong_so', effectiveRoom)
      .select();

    if (updateError) {
      console.warn('Supabase update room_label error:', updateError.message);
    }

    if (!updateData || updateData.length === 0) {
      // Upsert new row
      await supabase
        .from('room_units')
        .upsert(
          {
            ktx,
            day_nha: effectiveDay,
            phong_so: effectiveRoom,
            room_label: labelToSave,
          },
          { onConflict: 'ktx,day_nha,phong_so' }
        );
    }

    return true;
  } catch (err) {
    console.error('syncRoomGenderToSupabase failed:', err);
    return false;
  }
}

/**
 * Loads all room_label values from Supabase `room_units`
 */
export async function fetchRoomLabelsFromSupabase(): Promise<Record<string, 'male' | 'female' | 'auto'>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('room_units')
      .select('ktx, day_nha, phong_so, room_label')
      .not('room_label', 'is', null);

    if (error || !data) return {};

    const map: Record<string, 'male' | 'female' | 'auto'> = {};
    data.forEach((row: any) => {
      if (!row.ktx || !row.day_nha || !row.phong_so || !row.room_label) return;
      const key = `${row.ktx.trim()}||${row.day_nha.trim()}||${row.phong_so.trim()}`;
      const norm = row.room_label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (norm === 'nam' || norm === 'phong nam') {
        map[key] = 'male';
      } else if (norm === 'nu' || norm === 'phong nu') {
        map[key] = 'female';
      }
    });

    return map;
  } catch (err) {
    console.error('fetchRoomLabelsFromSupabase error:', err);
    return {};
  }
}
