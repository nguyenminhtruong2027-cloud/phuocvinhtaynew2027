import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';

// Real production Supabase configuration for KTX Phước Vĩnh Tây
export const FALLBACK_SUPABASE_URL = 'https://prswnzyuraipyyivtbkr.supabase.co';
export const FALLBACK_SUPABASE_KEY = 'sb_publishable_CYcMq2RZjFay7bVhQkbtbg_ieGUhd4v';

export function normalizeSupabaseUrl(rawUrl?: string): string {
  let url = (rawUrl || '').trim().replace(/^["']|["']$/g, '');
  if (!url || url.includes('placeholder') || url.includes('dyxcrglybrawussscoxw')) {
    return FALLBACK_SUPABASE_URL;
  }
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/(rest|auth|storage|functions)(\/v\d+.*|\/.*)?$/i, '');
  url = url.replace(/\/+$/, '');
  return url;
}

export function getSupabaseAnonKey(rawKey?: string): string {
  const key = (rawKey || '').trim().replace(/^["']|["']$/g, '');
  if (!key || key.includes('placeholder')) {
    return FALLBACK_SUPABASE_KEY;
  }
  return key;
}

export function getSupabaseConfig(): { url: string; key: string } {
  const envUrl =
    (typeof process !== 'undefined' && (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)) ||
    '';

  const envKey =
    (typeof process !== 'undefined' &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
       process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
       process.env.SUPABASE_ANON_KEY ||
       process.env.SUPABASE_PUBLISHABLE_KEY ||
       process.env.SUPABASE_KEY)) ||
    '';

  const url = normalizeSupabaseUrl(envUrl);
  const key = getSupabaseAnonKey(envKey);

  return { url, key };
}

/**
 * Safe fetch wrapper to intercept and gracefully handle network exceptions (Failed to fetch, CORS, timeout)
 * so that transient connection drops do not throw uncaught promise rejections or trigger React dev overlays.
 */
async function safeSupabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err: any) {
    console.warn('[Supabase Network] fetch caught exception:', err?.message || err);
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

    // Gracefully handle auth user check if offline/unreachable:
    // NEVER return 200 { user: null } because that falsely triggers logout on brief network blips.
    if (urlStr.includes('/auth/v1/user')) {
      return new Response(
        JSON.stringify({
          error: 'network_error',
          message: 'Không thể kết nối đến máy chủ xác thực. Đang giữ nguyên phiên hiện tại.',
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Gracefully handle auth token login/refresh if offline/unreachable
    if (urlStr.includes('/auth/v1/token')) {
      return new Response(
        JSON.stringify({
          error: 'network_error',
          error_description: 'Không thể kết nối đến máy chủ Supabase. Vui lòng kiểm tra kết nối mạng.',
          message: 'Không thể kết nối đến máy chủ Supabase. Vui lòng kiểm tra kết nối mạng.',
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Read requests: return empty list with 200 instead of failing with unhandled rejection
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Range': '0-0/0',
        },
      });
    }

    // Write requests: return structured 503 error for Supabase SDK to parse into { error }
    return new Response(
      JSON.stringify({
        message: 'Lỗi kết nối máy chủ Supabase. Vui lòng thử lại sau.',
        code: 'NETWORK_ERROR',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export const REMEMBER_ME_STORAGE_KEY = 'ktx_remember_me';

export function getRememberMePreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(REMEMBER_ME_STORAGE_KEY);
    return raw !== '0';
  } catch {
    return true;
  }
}

export function setRememberMePreference(remember: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMEMBER_ME_STORAGE_KEY, remember ? '1' : '0');
  } catch {
    // Ignore storage quota/privacy restrictions
  }
}

/**
 * Adaptive Supabase Auth storage:
 * - When "Duy trì đăng nhập" is enabled (default): persists tokens in localStorage across browser restarts & PWA launches.
 * - When disabled: stores tokens in sessionStorage so the session ends automatically when the browser closes.
 * - Reads from both stores seamlessly so active sessions are never accidentally dropped.
 */
const adaptiveAuthStorage = {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const fromLocal = window.localStorage.getItem(key);
      if (fromLocal !== null) return fromLocal;
    } catch {}
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    const remember = getRememberMePreference();
    try {
      if (remember) {
        window.localStorage.setItem(key, value);
        window.sessionStorage.removeItem(key);
      } else {
        window.sessionStorage.setItem(key, value);
        window.localStorage.removeItem(key);
      }
    } catch {
      // Fallback if localStorage is restricted
      try {
        window.sessionStorage.setItem(key, value);
      } catch {}
    }
  },
  removeItem(key: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch {}
    try {
      window.sessionStorage.removeItem(key);
    } catch {}
  },
};

let _client: SupabaseClient | null = null;
let _clientUrl: string | null = null;
let _clientKey: string | null = null;

export function createClient(): SupabaseClient {
  const { url, key } = getSupabaseConfig();

  if (_client && _clientUrl === url && _clientKey === key) {
    return _client;
  }

  _client = createSupabaseClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: adaptiveAuthStorage,
    },
    global: {
      fetch: safeSupabaseFetch,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  _clientUrl = url;
  _clientKey = key;
  return _client;
}

export const supabase = createClient();
