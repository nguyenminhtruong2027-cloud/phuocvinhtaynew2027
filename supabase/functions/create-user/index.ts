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

    // Admin client with service role key - bypasses RLS entirely
    const supabaseAdmin = createClient(
      Deno?.env?.get('SUPABASE_URL') ?? '',
      Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Caller client to verify the requesting user
    const supabaseClient = createClient(
      Deno?.env?.get('SUPABASE_URL') ?? '',
      Deno?.env?.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify caller identity
    const { data: { user: callerUser }, error: callerError } = await supabaseClient?.auth?.getUser();
    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Không thể xác thực người dùng.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check caller is admin using service role (bypasses RLS)
    const { data: callerProfile, error: profileCheckError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single();

    if (profileCheckError || !callerProfile || callerProfile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Chỉ Admin mới có quyền tạo tài khoản.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email, password, full_name, role, assigned_blocks } = await req?.json();

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

    // Create user in Supabase Auth using admin client
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: role || 'staff' },
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

    // Upsert profile using service role (bypasses RLS) - ensures profile exists even if trigger failed
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUserId,
        email,
        full_name,
        role: role || 'staff',
        assigned_blocks: assigned_blocks ?? [],
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
        role: role || 'staff',
        assigned_blocks: assigned_blocks ?? [],
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
