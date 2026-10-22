import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';

export function normalizeSupabaseUrl(rawUrl?: string): string {
  let url = (rawUrl || '').trim().replace(/^["']|["']$/g, '');
  if (!url || url.includes('placeholder')) {
    url = 'https://dyxcrglybrawussscoxw.supabase.co';
  }
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/(rest|auth|storage|functions)(\/v\d+.*|\/.*)?$/i, '');
  url = url.replace(/\/+$/, '');
  return url;
}

export function getSupabaseAnonKey(rawKey?: string): string {
  const key = (rawKey || '').trim().replace(/^["']|["']$/g, '');
  return key || 'sb_publishable_80bsv6tafkSchBHENJITSRQ_1E0A7_placeholder';
}

let _client: SupabaseClient | null = null;
let _clientUrl: string | null = null;
let _clientKey: string | null = null;

export function createClient(): SupabaseClient {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const url = normalizeSupabaseUrl(rawUrl);
  const key = getSupabaseAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (_client && _clientUrl === url && _clientKey === key) {
    return _client;
  }

  _client = createSupabaseClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  _clientUrl = url;
  _clientKey = key;
  return _client;
}

export const supabase = createClient();
