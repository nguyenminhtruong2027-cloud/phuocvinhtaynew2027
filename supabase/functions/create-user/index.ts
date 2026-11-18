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

    const { data: callerProfile, error: profileCheckError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single();

    const callerRole = callerProfile?.role;
    if (profileCheckError || !callerRole || (callerRole !== 'super_admin' && callerRole !== 'admin')) {
      return new Response(JSON.stringify({ error: 'Chỉ Admin hoặc Super Admin mới có quyền tạo tài khoản.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email, password, full_name, role, assigned_blocks } = await req?.json();
    const targetRole = (role || 'staff') as string;

    if (!['admin', 'staff'].includes(targetRole)) {
      return new Response(JSON.stringify({ error: 'Vai trò tạo mới chỉ được phép là Admin hoặc Staff.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (targetRole === 'admin' && callerRole !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Chỉ Quản trị tối cao (Super Admin) mới có quyền tạo tài khoản Admin.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!email || !password || !full_name) {
      return new Response(JSON.stringify({ error: 'Vui lòng cung cấp đầy đủ email, mật khẩu và họ tên.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (password?.length < 6) {
      return new Response(JSON.stringify({ error: 'Mật khẩu phải có ít nhất 6 ký tự.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const effectiveBlocks = targetRole === 'admin' ? [] : (assigned_blocks ?? []);

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: targetRole },
    });

    if (createError) {
      let errorMsg = createError.message;
      if (errorMsg.includes('already registered') || errorMsg.includes('already been registered')) {
        errorMsg = 'Email này đã được đăng ký. Vui lòng dùng email khác.';
      } else if (errorMsg.includes('invalid')) {
        errorMsg = 'Email không hợp lệ.';
      }
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newUserId = newUser?.user?.id;
    if (!newUserId) {
      return new Response(JSON.stringify({ error: 'Tạo Auth thành công nhưng không lấy được user ID.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUserId,
        email,
        full_name,
        role: targetRole,
        assigned_blocks: effectiveBlocks,
      }, { onConflict: 'id' });

    if (profileError) {
      return new Response(JSON.stringify({
        error: `Tạo Auth thành công nhưng lỗi lưu profile: ${profileError.message}`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      user: {
        id: newUserId,
        email,
        full_name,
        role: targetRole,
        assigned_blocks: effectiveBlocks,
      }
    }), {
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
