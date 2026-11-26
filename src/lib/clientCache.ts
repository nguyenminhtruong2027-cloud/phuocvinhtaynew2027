'use client';

interface CacheEntry<T> {
  data: T;
  updatedAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Đọc dữ liệu từ bộ nhớ đệm trình duyệt (Stale-While-Revalidate).
 * Trả về undefined nếu chưa có hoặc quá hạn maxAgeMs (mặc định 15 phút).
 */
export function getCachedData<T>(key: string, maxAgeMs = 15 * 60 * 1000): T | undefined {
  if (typeof window === 'undefined') return undefined;
  const entry = store.get(key);
  if (!entry) return undefined;
  if (maxAgeMs > 0 && Date.now() - entry.updatedAt > maxAgeMs) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

/** Lưu dữ liệu vào bộ nhớ đệm trình duyệt */
export function setCachedData<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  store.set(key, { data, updatedAt: Date.now() });
}

/** Xóa 1 khóa hoặc toàn bộ khóa có tiền tố nhất định */
export function invalidateCachedData(keyOrPrefix?: string): void {
  if (!keyOrPrefix) {
    store.clear();
    return;
  }
  if (store.has(keyOrPrefix)) {
    store.delete(keyOrPrefix);
  }
  for (const k of Array.from(store.keys())) {
    if (k.startsWith(keyOrPrefix)) {
      store.delete(k);
    }
  }
}

export const CACHE_KEYS = {
  BEDS_LIST: 'ktx_beds_list_v1',
  BEDS_RESERVATIONS: 'ktx_beds_reservations_v1',
  BEDS_CAPACITIES: 'ktx_beds_capacities_v1',
  BEDS_FACILITIES: 'ktx_beds_facilities_v1',
  DASHBOARD_FACILITIES: 'ktx_dashboard_facilities_v1',
  DASHBOARD_SUPPORT: 'ktx_dashboard_support_v1',
  DASHBOARD_TODAY_STATS: 'ktx_dashboard_today_stats_v1',
  MAINTENANCE_BUNDLE: 'ktx_maintenance_bundle_v1',
  SECURITY_BUNDLE: 'ktx_security_bundle_v1',
  TEAMS_ABSENT_IDS: 'ktx_teams_absent_ids_v1',
} as const;
