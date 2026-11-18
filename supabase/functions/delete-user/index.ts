import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno?.serve(async (req) => {
  if (req?.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req?.headers?.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Thiếu thông tin xác thực.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Token xác thực không hợp lệ.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno?.env?.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno?.env?.get('SUPABASE_ANON_KEY') ?? '';

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let callerUser = null;
    let callerError: { message?: string } | null = null;

    if (serviceRoleKey) {
      const res = await supabaseAdmin.auth.getUser(jwt);
      callerUser = res?.data?.user ?? null;
      callerError = res?.error ?? null;
    }

    if (!callerUser && anonKey) {
      const supabaseClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const res = await supabaseClient.auth.getUser(jwt);
      callerUser = res?.data?.user ?? null;
      callerError = res?.error ?? callerError;
    }

    if (!callerUser) {
      return new Response(
        JSON.stringify({
          error: `Không thể xác thực người dùng${callerError?.message ? ` (${callerError.message})` : '.'}`,
        }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single();

    const callerRole = callerProfile?.role;
    if (callerRole !== 'super_admin' && callerRole !== 'admin') {
      return new Response(JSON.stringify({ error: 'Bạn không có quyền xóa tài khoản.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { user_id } = await req?.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: 'Thiếu user_id cần xóa.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (user_id === callerUser.id) {
      return new Response(JSON.stringify({ error: 'Không thể tự xóa tài khoản đang đăng nhập.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', user_id)
      .maybeSingle();

    if (targetProfile?.role === 'super_admin') {
      return new Response(JSON.stringify({ error: 'Tài khoản Quản trị tối cao (Super Admin) được bảo vệ tuyệt đối, không thể xóa.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (targetProfile?.role === 'admin' && callerRole !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Chỉ Quản trị tối cao (Super Admin) mới có quyền xóa tài khoản Admin.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabaseAdmin.from('profiles').delete().eq('id', user_id);
    const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(user_id);

    if (authDeleteErr && !authDeleteErr.message.toLowerCase().includes('not found')) {
      return new Response(JSON.stringify({ error: `Không thể xóa Auth user: ${authDeleteErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: `Lỗi server: ${err instanceof Error ? err.message : String(err)}`
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
