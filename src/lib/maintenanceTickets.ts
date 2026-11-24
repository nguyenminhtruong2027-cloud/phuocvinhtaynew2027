import { createClient } from '@/lib/supabase/client';
import { normalizeRoomLabel } from '@/lib/facilityCapacity';

export type TicketCategory =
  | 'ac'
  | 'fan'
  | 'electric'
  | 'plumbing'
  | 'bed_locker'
  | 'door_lock'
  | 'other';

export type TicketPriority = 'normal' | 'urgent';
export type TicketStatus = 'open' | 'in_progress' | 'resolved';

export interface MaintenanceTicket {
  id: string;
  ticket_code: string;
  ktx: string;
  day: string;
  phong_so: string;
  category: TicketCategory;
  priority: TicketPriority;
  description: string;
  reporter_name: string;
  reporter_phone: string;
  source: 'qr' | 'internal';
  status: TicketStatus;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  started_at: string | null;
  resolved_by_id: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export const TICKET_CATEGORY_META: Record<
  TicketCategory,
  { label: string; shortLabel: string; hint: string }
> = {
  ac: { label: 'Điều hòa / Remote', shortLabel: 'Điều hòa', hint: 'Không mát, chảy nước, hỏng remote' },
  fan: { label: 'Quạt trần / Quạt tường', shortLabel: 'Quạt', hint: 'Không quay, kêu to, lỏng ốc' },
  electric: { label: 'Đèn / Ổ cắm / Điện', shortLabel: 'Điện / Đèn', hint: 'Cháy bóng, hỏng ổ cắm, nhảy át' },
  plumbing: { label: 'Nước / Vệ sinh / Thoát nước', shortLabel: 'Nước / WC', hint: 'Rò nước, tắc cống, hỏng vòi' },
  bed_locker: { label: 'Giường tầng / Tủ cá nhân', shortLabel: 'Giường / Tủ', hint: 'Lỏng ốc giường, kẹt khóa tủ, gãy thang' },
  door_lock: { label: 'Cửa phòng / Khóa / Cửa sổ', shortLabel: 'Cửa / Khóa', hint: 'Hỏng chốt, kẹt cửa, vỡ kính' },
  other: { label: 'Sự cố khác', shortLabel: 'Khác', hint: 'Hạng mục cơ sở vật chất khác' },
};

export const TICKET_CATEGORIES: TicketCategory[] = [
  'ac',
  'fan',
  'electric',
  'plumbing',
  'bed_locker',
  'door_lock',
  'other',
];

export function getTicketCategoryLabel(cat: string): string {
  return TICKET_CATEGORY_META[cat as TicketCategory]?.label ?? 'Sự cố khác';
}

export function getTicketCategoryShortLabel(cat: string): string {
  return TICKET_CATEGORY_META[cat as TicketCategory]?.shortLabel ?? 'Khác';
}

export function buildRoomIssueQrUrl(
  origin: string,
  ktx: string,
  day: string,
  room: string
): string {
  const base = (origin || '').replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (ktx.trim()) params.set('ktx', ktx.trim());
  if (day.trim()) params.set('day', day.trim());
  if (room.trim()) params.set('phong', normalizeRoomLabel(room) || room.trim());
  return `${base}/report-issue?${params.toString()}`;
}

export function isMaintenanceTableMissingError(err: unknown): boolean {
  const msg =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message?: string }).message || '')
      : String(err || '');
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: string }).code || '')
      : '';
  const lower = msg.toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === '42883' ||
    code === 'PGRST202' ||
    lower.includes('maintenance_tickets') && (lower.includes('does not exist') || lower.includes('not found') || lower.includes('schema cache')) ||
    lower.includes('submit_public_maintenance_ticket') && (lower.includes('does not exist') || lower.includes('not found'))
  );
}

export function formatTicketCodeClient(): string {
  const vnNow = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })
  );
  const dd = String(vnNow.getDate()).padStart(2, '0');
  const mm = String(vnNow.getMonth() + 1).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BT-${dd}${mm}-${rand}`;
}

export async function fetchMaintenanceTickets(opts?: {
  activeOnly?: boolean;
}): Promise<{ tickets: MaintenanceTicket[]; tableMissing: boolean }> {
  const supabase = createClient();
  let query = supabase
    .from('maintenance_tickets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (opts?.activeOnly) {
    query = query.in('status', ['open', 'in_progress']);
  }

  const { data, error } = await query;
  if (error) {
    if (isMaintenanceTableMissingError(error)) {
      return { tickets: [], tableMissing: true };
    }
    throw new Error(error.message || 'Không thể tải danh sách phiếu bảo trì.');
  }

  return {
    tickets: (data || []) as MaintenanceTicket[],
    tableMissing: false,
  };
}

export async function submitPublicMaintenanceTicket(input: {
  ktx: string;
  day: string;
  phong_so: string;
  category: TicketCategory;
  priority: TicketPriority;
  description: string;
  reporter_name?: string;
  reporter_phone?: string;
}): Promise<{ ticketCode: string; duplicate: boolean }> {
  const ktx = input.ktx.trim().slice(0, 120);
  const day = input.day.trim().slice(0, 80);
  const phong = (normalizeRoomLabel(input.phong_so) || input.phong_so).trim().slice(0, 60);
  const desc = input.description.trim().slice(0, 600);
  const reporterName = (input.reporter_name || '').trim().slice(0, 120);
  const reporterPhone = (input.reporter_phone || '').trim().slice(0, 30);

  if (!ktx || !day || !phong) {
    throw new Error('Vui lòng chọn đầy đủ KTX, Dãy và Phòng.');
  }
  if (desc.length < 3) {
    throw new Error('Vui lòng mô tả ngắn tình trạng hỏng (ít nhất 3 ký tự).');
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc('submit_public_maintenance_ticket', {
    p_ktx: ktx,
    p_day: day,
    p_phong_so: phong,
    p_category: input.category,
    p_priority: input.priority,
    p_description: desc,
    p_reporter_name: reporterName,
    p_reporter_phone: reporterPhone,
  });

  if (error) {
    if (isMaintenanceTableMissingError(error)) {
      throw new Error('Hệ thống bảo trì chưa được khởi tạo bảng dữ liệu trên Supabase. Vui lòng báo Quản trị viên chạy SQL cập nhật.');
    }
    throw new Error(error.message || 'Không thể gửi phiếu báo hỏng.');
  }

  const payload = (data || {}) as { ticket_code?: string; duplicate?: boolean };
  return {
    ticketCode: payload.ticket_code || formatTicketCodeClient(),
    duplicate: Boolean(payload.duplicate),
  };
}

export async function createInternalMaintenanceTicket(input: {
  ktx: string;
  day: string;
  phong_so: string;
  category: TicketCategory;
  priority: TicketPriority;
  description: string;
  reporter_name: string;
  reporter_phone?: string;
}): Promise<MaintenanceTicket> {
  const ktx = input.ktx.trim().slice(0, 120);
  const day = input.day.trim().slice(0, 80);
  const phong = (normalizeRoomLabel(input.phong_so) || input.phong_so).trim().slice(0, 60);
  const desc = input.description.trim().slice(0, 600);
  if (!ktx || !day || !phong) throw new Error('Vui lòng chọn đầy đủ KTX, Dãy và Phòng.');
  if (desc.length < 3) throw new Error('Mô tả sự cố cần ít nhất 3 ký tự.');

  const supabase = createClient();
  const { data, error } = await supabase
    .from('maintenance_tickets')
    .insert({
      ticket_code: formatTicketCodeClient(),
      ktx,
      day,
      phong_so: phong,
      category: input.category,
      priority: input.priority,
      description: desc,
      reporter_name: input.reporter_name.trim().slice(0, 120),
      reporter_phone: (input.reporter_phone || '').trim().slice(0, 30),
      source: 'internal',
      status: 'open',
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Không thể tạo phiếu báo hỏng.');
  }
  return data as MaintenanceTicket;
}

export async function acceptMaintenanceTicket(
  ticketId: string,
  techId: string,
  techName: string
): Promise<MaintenanceTicket> {
  const supabase = createClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('maintenance_tickets')
    .update({
      status: 'in_progress',
      assigned_to_id: techId,
      assigned_to_name: techName.trim().slice(0, 120),
      started_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', ticketId)
    .select('*')
    .single();

  if (error) throw new Error(error.message || 'Không thể tiếp nhận phiếu.');
  return data as MaintenanceTicket;
}

export async function resolveMaintenanceTicket(
  ticketId: string,
  techId: string,
  techName: string,
  resolutionNote: string
): Promise<MaintenanceTicket> {
  const supabase = createClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('maintenance_tickets')
    .update({
      status: 'resolved',
      resolved_by_id: techId,
      resolved_by_name: techName.trim().slice(0, 120),
      resolved_at: nowIso,
      resolution_note: resolutionNote.trim().slice(0, 600),
      updated_at: nowIso,
    })
    .eq('id', ticketId)
    .select('*')
    .single();

  if (error) throw new Error(error.message || 'Không thể hoàn thành phiếu.');
  return data as MaintenanceTicket;
}

export async function reopenMaintenanceTicket(ticketId: string): Promise<MaintenanceTicket> {
  const supabase = createClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('maintenance_tickets')
    .update({
      status: 'open',
      resolved_by_id: null,
      resolved_by_name: null,
      resolved_at: null,
      updated_at: nowIso,
    })
    .eq('id', ticketId)
    .select('*')
    .single();

  if (error) throw new Error(error.message || 'Không thể mở lại phiếu.');
  return data as MaintenanceTicket;
}

export async function deleteMaintenanceTicket(ticketId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('maintenance_tickets')
    .delete()
    .eq('id', ticketId);

  if (error) {
    throw new Error(error.message || 'Không thể xóa phiếu bảo trì (kiểm tra quyền và trạng thái đã xử lý).');
  }
}

export async function bulkDeleteResolvedTickets(ticketIds: string[]): Promise<number> {
  if (ticketIds.length === 0) return 0;
  const supabase = createClient();
  const { error, count } = await supabase
    .from('maintenance_tickets')
    .delete({ count: 'exact' })
    .in('id', ticketIds)
    .eq('status', 'resolved');

  if (error) {
    throw new Error(error.message || 'Không thể xóa hàng loạt phiếu đã xử lý.');
  }
  return count ?? ticketIds.length;
}

// ─── SLA & Maintenance Analytics Helpers ────────────────────────────────────
export type TicketSlaState = 'ok' | 'warning' | 'overdue' | 'resolved';

export interface TicketSlaResult {
  state: TicketSlaState;
  elapsedMinutes: number;
  limitMinutes: number;
  overdueMinutes: number;
  elapsedLabel: string;
  label: string;
}

export function formatDurationVi(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins < 60) return `${mins}p`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) {
    return remMins > 0 ? `${hours}g ${remMins}p` : `${hours}g`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} ngày ${remHours}g` : `${days} ngày`;
}

/**
 * SLA chuẩn vận hành KTX:
 * - Khẩn cấp (urgent): tối đa 2 giờ (120p), cảnh báo từ 90p
 * - Bình thường (normal): tối đa 24 giờ (1440p), cảnh báo từ 18 giờ (1080p)
 */
export function getTicketSlaStatus(
  ticket: MaintenanceTicket,
  nowMs: number = Date.now()
): TicketSlaResult {
  const createdMs = new Date(ticket.created_at).getTime();
  const limitMinutes = ticket.priority === 'urgent' ? 120 : 1440;
  const warningMinutes = ticket.priority === 'urgent' ? 90 : 1080;

  if (!Number.isFinite(createdMs)) {
    return {
      state: ticket.status === 'resolved' ? 'resolved' : 'ok',
      elapsedMinutes: 0,
      limitMinutes,
      overdueMinutes: 0,
      elapsedLabel: '0p',
      label: ticket.status === 'resolved' ? 'Đã xong' : 'Trong hạn',
    };
  }

  if (ticket.status === 'resolved') {
    const resolvedMs = ticket.resolved_at ? new Date(ticket.resolved_at).getTime() : nowMs;
    const elapsedMinutes = Math.max(0, Math.round((resolvedMs - createdMs) / 60000));
    const overdueMinutes = Math.max(0, elapsedMinutes - limitMinutes);
    return {
      state: 'resolved',
      elapsedMinutes,
      limitMinutes,
      overdueMinutes,
      elapsedLabel: formatDurationVi(elapsedMinutes),
      label: `Xử lý trong ${formatDurationVi(elapsedMinutes)}`,
    };
  }

  const elapsedMinutes = Math.max(0, Math.round((nowMs - createdMs) / 60000));
  if (elapsedMinutes > limitMinutes) {
    const overdueMinutes = elapsedMinutes - limitMinutes;
    return {
      state: 'overdue',
      elapsedMinutes,
      limitMinutes,
      overdueMinutes,
      elapsedLabel: formatDurationVi(elapsedMinutes),
      label: `Quá hạn SLA +${formatDurationVi(overdueMinutes)}`,
    };
  }

  if (elapsedMinutes >= warningMinutes) {
    const left = Math.max(1, limitMinutes - elapsedMinutes);
    return {
      state: 'warning',
      elapsedMinutes,
      limitMinutes,
      overdueMinutes: 0,
      elapsedLabel: formatDurationVi(elapsedMinutes),
      label: `Sắp quá hạn (còn ${formatDurationVi(left)})`,
    };
  }

  return {
    state: 'ok',
    elapsedMinutes,
    limitMinutes,
    overdueMinutes: 0,
    elapsedLabel: formatDurationVi(elapsedMinutes),
    label: `Đã chờ ${formatDurationVi(elapsedMinutes)}`,
  };
}

export interface MaintenanceAnalytics {
  totalTickets: number;
  activeCount: number;
  resolvedCount: number;
  slaOverdueCount: number;
  slaWarningCount: number;
  slaCompliancePct: number | null;
  avgResolveMinutes: number | null;
  topCategories: Array<{
    category: TicketCategory;
    label: string;
    count: number;
    pct: number;
  }>;
  topRooms: Array<{
    ktx: string;
    day: string;
    phong_so: string;
    count: number;
  }>;
  topDays: Array<{
    day: string;
    count: number;
  }>;
}

export function computeMaintenanceAnalytics(
  tickets: MaintenanceTicket[],
  nowMs: number = Date.now()
): MaintenanceAnalytics {
  let activeCount = 0;
  let resolvedCount = 0;
  let slaOverdueCount = 0;
  let slaWarningCount = 0;
  let resolveMinutesSum = 0;
  let resolveDurationCount = 0;
  let resolvedWithinSla = 0;

  const categoryCounts = new Map<TicketCategory, number>();
  const roomCounts = new Map<string, { ktx: string; day: string; phong_so: string; count: number }>();
  const dayCounts = new Map<string, number>();

  for (const t of tickets) {
    const sla = getTicketSlaStatus(t, nowMs);
    if (t.status === 'resolved') {
      resolvedCount += 1;
      if (t.resolved_at) {
        resolveMinutesSum += sla.elapsedMinutes;
        resolveDurationCount += 1;
        if (sla.overdueMinutes === 0) resolvedWithinSla += 1;
      }
    } else {
      activeCount += 1;
      if (sla.state === 'overdue') slaOverdueCount += 1;
      else if (sla.state === 'warning') slaWarningCount += 1;
    }

    categoryCounts.set(t.category, (categoryCounts.get(t.category) || 0) + 1);

    const roomNorm = normalizeRoomLabel(t.phong_so) || t.phong_so;
    const roomKey = `${t.ktx}||${t.day}||${roomNorm}`;
    const existingRoom = roomCounts.get(roomKey);
    if (existingRoom) {
      existingRoom.count += 1;
    } else {
      roomCounts.set(roomKey, { ktx: t.ktx, day: t.day, phong_so: roomNorm, count: 1 });
    }

    if (t.day) {
      dayCounts.set(t.day, (dayCounts.get(t.day) || 0) + 1);
    }
  }

  const total = tickets.length;
  const topCategories = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({
      category,
      label: getTicketCategoryShortLabel(category),
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const topRooms = Array.from(roomCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const topDays = Array.from(dayCounts.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalTickets: total,
    activeCount,
    resolvedCount,
    slaOverdueCount,
    slaWarningCount,
    slaCompliancePct:
      resolveDurationCount > 0 ? Math.round((resolvedWithinSla / resolveDurationCount) * 100) : null,
    avgResolveMinutes:
      resolveDurationCount > 0 ? Math.round(resolveMinutesSum / resolveDurationCount) : null,
    topCategories,
    topRooms,
    topDays,
  };
}

/**
 * Chuông báo tinh tế bằng Web Audio API khi có phiếu KHẨN CẤP mới (không phụ thuộc file âm thanh ngoài).
 */
export function playUrgentAlertChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const tones = [
      { freq: 880, start: 0, dur: 0.14 },
      { freq: 1174.66, start: 0.16, dur: 0.22 },
    ];

    tones.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.14, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    });

    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 600);
  } catch {
    // Browser autoplay policy may block until first user gesture; fail silently
  }
}

export const MAINTENANCE_SETUP_SQL = `-- Chạy 1 lần trong Supabase SQL Editor để kích hoạt phân quyền Kỹ thuật viên & Phiếu báo hỏng QR
-- Chi tiết đầy đủ nằm tại supabase/migrations/20261129000000_technician_rbac_and_maintenance_tickets.sql

DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%role%' LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', c);
  END LOOP;
END $$;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('super_admin', 'admin', 'staff', 'technician'));

CREATE OR REPLACE FUNCTION public.is_technician_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'technician');
$$;

CREATE OR REPLACE FUNCTION public.can_access_maintenance_block(p_ktx text, p_day text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text; v_blocks text[]; v_b text; v_ktx text := lower(trim(coalesce(p_ktx,''))); v_day text := lower(trim(coalesce(p_day,'')));
BEGIN
  SELECT role, coalesce(assigned_blocks,'{}'::text[]) INTO v_role, v_blocks FROM public.profiles WHERE id = auth.uid();
  IF v_role IN ('super_admin','admin') THEN RETURN true; END IF;
  IF v_role = 'technician' AND (array_length(v_blocks,1) IS NULL OR array_length(v_blocks,1) = 0) THEN RETURN true; END IF;
  IF v_role NOT IN ('technician','staff') OR array_length(v_blocks,1) IS NULL THEN RETURN false; END IF;
  FOREACH v_b IN ARRAY v_blocks LOOP
    IF lower(trim(v_b)) = (v_ktx || ' - ' || v_day) OR lower(trim(v_b)) = v_day OR (position(' - ' in v_b) > 0 AND lower(trim(split_part(v_b,' - ',2))) = v_day) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END; $$;

CREATE TABLE IF NOT EXISTS public.maintenance_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code text NOT NULL,
  ktx text NOT NULL CHECK (char_length(trim(ktx)) BETWEEN 1 AND 120),
  day text NOT NULL CHECK (char_length(trim(day)) BETWEEN 1 AND 80),
  phong_so text NOT NULL CHECK (char_length(trim(phong_so)) BETWEEN 1 AND 60),
  category text NOT NULL CHECK (category IN ('ac','fan','electric','plumbing','bed_locker','door_lock','other')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  description text NOT NULL CHECK (char_length(trim(description)) BETWEEN 3 AND 600),
  reporter_name text DEFAULT '' CHECK (char_length(coalesce(reporter_name,'')) <= 120),
  reporter_phone text DEFAULT '' CHECK (char_length(coalesce(reporter_phone,'')) <= 30),
  source text NOT NULL DEFAULT 'qr' CHECK (source IN ('qr','internal')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  assigned_to_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to_name text NULL,
  started_at timestamptz NULL,
  resolved_by_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by_name text NULL,
  resolved_at timestamptz NULL,
  resolution_note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.maintenance_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "maintenance_tickets_select_policy" ON public.maintenance_tickets;
CREATE POLICY "maintenance_tickets_select_policy" ON public.maintenance_tickets FOR SELECT TO authenticated
  USING (public.is_admin_user() OR (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day)) OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'staff'));
DROP POLICY IF EXISTS "maintenance_tickets_insert_policy" ON public.maintenance_tickets;
CREATE POLICY "maintenance_tickets_insert_policy" ON public.maintenance_tickets FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_user() OR public.can_access_maintenance_block(ktx, day));
DROP POLICY IF EXISTS "maintenance_tickets_update_policy" ON public.maintenance_tickets;
CREATE POLICY "maintenance_tickets_update_policy" ON public.maintenance_tickets FOR UPDATE TO authenticated
  USING (public.is_admin_user() OR (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day)))
  WITH CHECK (public.is_admin_user() OR (public.is_technician_user() AND public.can_access_maintenance_block(ktx, day)));
DROP POLICY IF EXISTS "maintenance_tickets_delete_policy" ON public.maintenance_tickets;
CREATE POLICY "maintenance_tickets_delete_policy" ON public.maintenance_tickets FOR DELETE TO authenticated
  USING (public.is_admin_user() OR (public.is_technician_user() AND status = 'resolved' AND public.can_access_maintenance_block(ktx, day)));

CREATE OR REPLACE FUNCTION public.submit_public_maintenance_ticket(
  p_ktx text, p_day text, p_phong_so text, p_category text,
  p_priority text DEFAULT 'normal', p_description text DEFAULT '',
  p_reporter_name text DEFAULT '', p_reporter_phone text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ktx text := trim(coalesce(p_ktx,'')); v_day text := trim(coalesce(p_day,'')); v_phong text := trim(coalesce(p_phong_so,''));
  v_cat text := lower(trim(coalesce(p_category,'other'))); v_prio text := CASE WHEN lower(trim(coalesce(p_priority,'')))='urgent' THEN 'urgent' ELSE 'normal' END;
  v_desc text := trim(coalesce(p_description,'')); v_dup text; v_code text; v_id uuid;
BEGIN
  IF char_length(v_ktx) < 1 OR char_length(v_day) < 1 OR char_length(v_phong) < 1 OR char_length(v_desc) < 3 THEN RAISE EXCEPTION 'Thông tin báo hỏng chưa hợp lệ.'; END IF;
  IF v_cat NOT IN ('ac','fan','electric','plumbing','bed_locker','door_lock','other') THEN RAISE EXCEPTION 'Hạng mục không hợp lệ.'; END IF;
  SELECT ticket_code INTO v_dup FROM public.maintenance_tickets
    WHERE lower(ktx)=lower(v_ktx) AND lower(day)=lower(v_day) AND lower(phong_so)=lower(v_phong) AND category=v_cat AND status IN ('open','in_progress') AND created_at > now() - interval '2 minutes' LIMIT 1;
  IF v_dup IS NOT NULL THEN RETURN jsonb_build_object('ticket_code', v_dup, 'duplicate', true); END IF;
  v_code := 'BT-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DDMM') || '-' || upper(substring(replace(gen_random_uuid()::text,'-','') from 1 for 4));
  INSERT INTO public.maintenance_tickets(ticket_code,ktx,day,phong_so,category,priority,description,reporter_name,reporter_phone,source,status)
    VALUES (v_code, left(v_ktx,120), left(v_day,80), left(v_phong,60), v_cat, v_prio, left(v_desc,600), left(trim(coalesce(p_reporter_name,'')),120), left(trim(coalesce(p_reporter_phone,'')),30), 'qr', 'open')
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'ticket_code', v_code, 'duplicate', false);
END; $$;
REVOKE ALL ON FUNCTION public.submit_public_maintenance_ticket(text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_public_maintenance_ticket(text,text,text,text,text,text,text,text) TO anon, authenticated;`;
