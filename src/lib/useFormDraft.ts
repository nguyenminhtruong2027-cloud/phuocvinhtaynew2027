'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const DRAFT_PREFIX = 'ktx_form_draft_v1:';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StoredDraft<T> {
  savedAt: number;
  data: T;
}

function readDraft<T>(storageKey: string, ttlMs: number): StoredDraft<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.data) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    if (Date.now() - parsed.savedAt > ttlMs) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function formatDraftAgeVN(savedAt: number | null): string {
  if (!savedAt) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - savedAt) / 1000));
  if (diffSec < 60) return 'vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr} giờ trước`;
}

/**
 * Auto-save unsaved form inputs to localStorage so mobile staff never lose
 * typed data when signal drops or the browser tab refreshes accidentally.
 * Never pass passwords or tokens into this hook.
 */
export function useFormDraft<T extends Record<string, unknown>>(
  draftId: string,
  options?: {
    enabled?: boolean;
    ttlMs?: number;
    debounceMs?: number;
  }
) {
  const enabled = options?.enabled ?? true;
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const debounceMs = options?.debounceMs ?? 450;
  const storageKey = `${DRAFT_PREFIX}${draftId}`;

  const [pendingDraft, setPendingDraft] = useState<StoredDraft<T> | null>(() =>
    enabled ? readDraft<T>(storageKey, ttlMs) : null
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPendingDraft(null);
      return;
    }
    setPendingDraft(readDraft<T>(storageKey, ttlMs));
  }, [enabled, storageKey, ttlMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const saveDraft = useCallback(
    (data: T) => {
      if (!enabled || typeof window === 'undefined') return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        try {
          const payload: StoredDraft<T> = { savedAt: Date.now(), data };
          window.localStorage.setItem(storageKey, JSON.stringify(payload));
        } catch {
          // Ignore quota exceeded or private browsing errors
        }
      }, debounceMs);
    },
    [enabled, storageKey, debounceMs]
  );

  const clearDraft = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPendingDraft(null);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }, [storageKey]);

  const consumeDraft = useCallback((): T | null => {
    const current = pendingDraft?.data ?? readDraft<T>(storageKey, ttlMs)?.data ?? null;
    setPendingDraft(null);
    return current;
  }, [pendingDraft, storageKey, ttlMs]);

  return {
    hasDraft: Boolean(enabled && pendingDraft),
    draftSavedAt: pendingDraft?.savedAt ?? null,
    saveDraft,
    consumeDraft,
    clearDraft,
  };
}
