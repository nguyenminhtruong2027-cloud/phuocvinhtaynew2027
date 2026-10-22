import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { normalizeSupabaseUrl, getSupabaseAnonKey } from './client';

export async function createClient() {
  const cookieStore = await cookies();

  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = getSupabaseAnonKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore?.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        try {
          cookiesToSet?.forEach(({ name, value, options }) =>
            cookieStore?.set(name, value, options)
          );
        } catch {
          // The `setAll` method was called from a Server Component.
        }
      },
    },
  });
}
