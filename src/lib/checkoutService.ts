import { createClient } from '@/lib/supabase/client';
import { CheckoutRequest } from '@/types/checkout';

const CHECKOUT_TAG_PREFIX = '[CHECKOUT_PENDING]';

interface StoredCheckoutTag {
  id: string;
  worker_id?: string;
  ho_va_ten: string;
  ma_nv: string;
  so_cccd: string;
  so_dien_thoai: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong?: string;
  ly_do: string;
  ngay_don_ra: string;
  ghi_chu?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

function parseCheckoutTag(rawGhiChu: string): StoredCheckoutTag | null {
  if (!rawGhiChu || !rawGhiChu.includes(CHECKOUT_TAG_PREFIX)) return null;
  try {
    const afterTag = rawGhiChu.split(CHECKOUT_TAG_PREFIX)[1];
    if (!afterTag) return null;
    const jsonStr = afterTag.split('\n')[0].trim();
    if (jsonStr.startsWith('{') && jsonStr.endsWith('}')) {
      return JSON.parse(jsonStr) as StoredCheckoutTag;
    }
  } catch (e) {
    console.warn('[checkoutService] Failed to parse tag:', e);
  }
  return null;
}

function stripCheckoutTag(rawGhiChu: string): string {
  if (!rawGhiChu) return '';
  return rawGhiChu.replace(/\[CHECKOUT_PENDING\][^\n]*\n?/g, '').trim();
}

/**
 * Fetches all checkout requests from Supabase.
 * Checks `checkout_requests` table first, and merges with workers having pending checkout tags and audit logs.
 */
export async function getCheckoutRequests(): Promise<CheckoutRequest[]> {
  const supabase = createClient();
  const requestMap = new Map<string, CheckoutRequest>();

  // 1. Try fetching from `checkout_requests` table if it exists
  try {
    const { data, error } = await supabase
      .from('checkout_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      data.forEach((row: any) => {
        const item: CheckoutRequest = {
          id: String(row.id),
          worker_id: row.worker_id ? String(row.worker_id) : undefined,
          ho_va_ten: String(row.ho_va_ten || ''),
          ma_nv: String(row.ma_nv || ''),
          so_cccd: String(row.so_cccd || ''),
          so_dien_thoai: String(row.so_dien_thoai || ''),
          ktx: String(row.ktx || ''),
          day: String(row.day || ''),
          phong_so: String(row.phong_so || ''),
          giuong: row.giuong ? String(row.giuong) : undefined,
          ly_do: String(row.ly_do || 'Dọn ra KTX'),
          ngay_don_ra: String(row.ngay_don_ra || ''),
          ghi_chu: row.ghi_chu ? String(row.ghi_chu) : undefined,
          status: (row.status as any) || 'pending',
          reviewed_by: row.reviewed_by ? String(row.reviewed_by) : null,
          reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null,
          created_at: String(row.created_at || new Date().toISOString()),
        };
        requestMap.set(item.id, item);
      });
    }
  } catch (err) {
    // Table might not exist in Supabase yet, proceed to worker check
  }

  // 2. Fetch pending checkout requests embedded in `workers` table
  try {
    const { data: workerRows, error: workerErr } = await supabase
      .from('workers')
      .select('id, ho_va_ten, ma_nv, cccd, so_dien_thoai, ktx, day, phong_so, giuong, ghi_chu, ngay_ra_ktx')
      .like('ghi_chu', `%${CHECKOUT_TAG_PREFIX}%`);

    if (!workerErr && Array.isArray(workerRows)) {
      workerRows.forEach(w => {
        const parsed = parseCheckoutTag(w.ghi_chu || '');
        if (parsed) {
          const reqId = parsed.id || `co-${w.id}`;
          if (!requestMap.has(reqId)) {
            requestMap.set(reqId, {
              id: reqId,
              worker_id: w.id,
              ho_va_ten: parsed.ho_va_ten || w.ho_va_ten,
              ma_nv: parsed.ma_nv || w.ma_nv,
              so_cccd: parsed.so_cccd || w.cccd,
              so_dien_thoai: parsed.so_dien_thoai || w.so_dien_thoai,
              ktx: parsed.ktx || w.ktx,
              day: parsed.day || w.day,
              phong_so: parsed.phong_so || w.phong_so,
              giuong: parsed.giuong || w.giuong,
              ly_do: parsed.ly_do || 'Dọn ra KTX',
              ngay_don_ra: parsed.ngay_don_ra || w.ngay_ra_ktx || new Date().toISOString().split('T')[0],
              ghi_chu: parsed.ghi_chu || '',
              status: parsed.status || 'pending',
              created_at: parsed.created_at || new Date().toISOString(),
            });
          }
        }
      });
    }
  } catch (err) {
    console.warn('[checkoutService] Error fetching worker pending tags:', err);
  }

  // 3. Fetch past checkout events from `audit_logs` (for approved/completed history)
  try {
    const { data: auditRows, error: auditErr } = await supabase
      .from('audit_logs')
      .select('id, timestamp, account, action, detail')
      .in('action', ['CHECKOUT_REQUEST', 'CHECKOUT_APPROVED', 'CHECKOUT_REJECTED'])
      .order('timestamp', { ascending: false })
      .limit(100);

    if (!auditErr && Array.isArray(auditRows)) {
      auditRows.forEach(log => {
        try {
          if (!log.detail) return;
          const parsed = typeof log.detail === 'string' ? JSON.parse(log.detail) : log.detail;
          if (parsed && parsed.id && !requestMap.has(parsed.id)) {
            requestMap.set(parsed.id, {
              id: parsed.id,
              worker_id: parsed.worker_id,
              ho_va_ten: parsed.ho_va_ten || log.account || 'Công nhân',
              ma_nv: parsed.ma_nv || '',
              so_cccd: parsed.so_cccd || '',
              so_dien_thoai: parsed.so_dien_thoai || '',
              ktx: parsed.ktx || '',
              day: parsed.day || '',
              phong_so: parsed.phong_so || '',
              giuong: parsed.giuong || '',
              ly_do: parsed.ly_do || 'Dọn ra KTX',
              ngay_don_ra: parsed.ngay_don_ra || log.timestamp.split('T')[0],
              ghi_chu: parsed.ghi_chu || '',
              status: log.action === 'CHECKOUT_APPROVED' ? 'approved' : log.action === 'CHECKOUT_REJECTED' ? 'rejected' : 'pending',
              created_at: parsed.created_at || log.timestamp,
              reviewed_at: log.action === 'CHECKOUT_APPROVED' ? log.timestamp : undefined,
            });
          } else if (parsed && parsed.id && requestMap.has(parsed.id)) {
            // Update status if approved in audit log
            const existing = requestMap.get(parsed.id)!;
            if (log.action === 'CHECKOUT_APPROVED' && existing.status !== 'approved') {
              existing.status = 'approved';
              existing.reviewed_at = log.timestamp;
            } else if (log.action === 'CHECKOUT_REJECTED' && existing.status !== 'rejected') {
              existing.status = 'rejected';
              existing.reviewed_at = log.timestamp;
            }
          }
        } catch {
          // Ignore invalid JSON in detail
        }
      });
    }
  } catch (err) {
    console.warn('[checkoutService] Error reading checkout audit logs:', err);
  }

  const list = Array.from(requestMap.values());
  list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return list;
}

/**
 * Creates and submits a new checkout declaration request
 */
export async function submitCheckoutRequest(params: {
  ho_va_ten: string;
  ma_nv: string;
  so_cccd: string;
  so_dien_thoai: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong?: string;
  ly_do: string;
  ngay_don_ra: string;
  ghi_chu?: string;
}): Promise<CheckoutRequest> {
  const supabase = createClient();
  const id = `co-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const newRequest: CheckoutRequest = {
    id,
    ho_va_ten: params.ho_va_ten.trim(),
    ma_nv: params.ma_nv.trim(),
    so_cccd: params.so_cccd.trim(),
    so_dien_thoai: params.so_dien_thoai.trim(),
    ktx: params.ktx.trim(),
    day: params.day.trim(),
    phong_so: params.phong_so.trim(),
    giuong: params.giuong ? params.giuong.trim() : undefined,
    ly_do: params.ly_do.trim() || 'Dọn ra KTX',
    ngay_don_ra: params.ngay_don_ra || now.split('T')[0],
    ghi_chu: params.ghi_chu ? params.ghi_chu.trim() : '',
    status: 'pending',
    created_at: now,
  };

  // 1. Try to find the worker in the database
  let matchedWorkerId: string | undefined = undefined;
  try {
    let query = supabase.from('workers').select('id, ho_va_ten, ghi_chu, day, phong_so, giuong');
    if (newRequest.ma_nv) {
      query = query.eq('ma_nv', newRequest.ma_nv);
    } else if (newRequest.so_cccd) {
      query = query.eq('cccd', newRequest.so_cccd);
    } else {
      query = query.eq('ho_va_ten', newRequest.ho_va_ten);
    }

    const { data: matchedWorkers } = await query.limit(1);
    if (matchedWorkers && matchedWorkers[0]) {
      const w = matchedWorkers[0];
      matchedWorkerId = w.id;
      newRequest.worker_id = w.id;

      // Update worker's ghi_chu with [CHECKOUT_PENDING] tag
      const existingClean = stripCheckoutTag(w.ghi_chu || '');
      const tagContent: StoredCheckoutTag = {
        ...newRequest,
        worker_id: w.id,
      };
      const updatedGhiChu = `${CHECKOUT_TAG_PREFIX}${JSON.stringify(tagContent)}${existingClean ? `\n${existingClean}` : ''}`;

      await supabase
        .from('workers')
        .update({ ghi_chu: updatedGhiChu })
        .eq('id', w.id);
    }
  } catch (err) {
    console.warn('[checkoutService] Could not tag worker directly:', err);
  }

  // 2. Try inserting into `checkout_requests` table
  try {
    await supabase.from('checkout_requests').insert({
      id: newRequest.id,
      worker_id: matchedWorkerId || null,
      ho_va_ten: newRequest.ho_va_ten,
      ma_nv: newRequest.ma_nv,
      so_cccd: newRequest.so_cccd,
      so_dien_thoai: newRequest.so_dien_thoai,
      ktx: newRequest.ktx,
      day: newRequest.day,
      phong_so: newRequest.phong_so,
      giuong: newRequest.giuong || null,
      ly_do: newRequest.ly_do,
      ngay_don_ra: newRequest.ngay_don_ra,
      ghi_chu: newRequest.ghi_chu || null,
      status: 'pending',
      created_at: now,
    });
  } catch {
    // Ignore if table does not exist
  }

  // 3. Log to audit_logs for permanent record
  try {
    const { randomUUID } = await import('crypto').catch(() => ({ randomUUID: () => `log-${Date.now()}` }));
    await supabase.from('audit_logs').insert({
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-0000-0000-${Date.now().toString(16).padStart(12, '0')}`,
      timestamp: now,
      account: newRequest.ho_va_ten,
      action: 'CHECKOUT_REQUEST',
      detail: JSON.stringify(newRequest),
    });
  } catch (err) {
    console.warn('[checkoutService] Audit log insert warning:', err);
  }

  return newRequest;
}

/**
 * Approves a checkout request:
 * 1. Frees up the room and bed in `workers` table (clears day, phong_so, giuong, sets ngay_ra_ktx, tam_tru_status: unregistered)
 * 2. Updates request status to 'approved'
 * 3. Logs completion in `audit_logs`
 */
export async function approveCheckoutRequest(
  request: CheckoutRequest,
  reviewerName = 'Quản trị viên'
): Promise<void> {
  const supabase = createClient();
  const now = new Date().toISOString();
  const checkoutDate = request.ngay_don_ra || now.split('T')[0];

  // 1. Locate and free up worker from room/bed in `workers`
  try {
    let workerRow: any = null;
    if (request.worker_id) {
      const { data } = await supabase.from('workers').select('*').eq('id', request.worker_id).maybeSingle();
      workerRow = data;
    }
    if (!workerRow && request.ma_nv) {
      const { data } = await supabase.from('workers').select('*').eq('ma_nv', request.ma_nv).maybeSingle();
      workerRow = data;
    }
    if (!workerRow && request.so_cccd) {
      const { data } = await supabase.from('workers').select('*').eq('cccd', request.so_cccd).maybeSingle();
      workerRow = data;
    }
    if (!workerRow && request.ho_va_ten && request.phong_so) {
      const { data } = await supabase.from('workers').select('*')
        .eq('ho_va_ten', request.ho_va_ten)
        .eq('phong_so', request.phong_so)
        .maybeSingle();
      workerRow = data;
    }

    if (workerRow) {
      const cleanGhiChu = stripCheckoutTag(workerRow.ghi_chu || '');
      const noteAppended = `[Đã Check-out ngày ${checkoutDate} - Lý do: ${request.ly_do}]${cleanGhiChu ? `\n${cleanGhiChu}` : ''}`;

      // CLEAR day, phong_so, giuong to return bed to vacant status!
      const { error: updateErr } = await supabase
        .from('workers')
        .update({
          day: '',
          phong_so: '',
          giuong: '',
          ngay_ra_ktx: checkoutDate,
          tam_tru_status: 'unregistered',
          ghi_chu: noteAppended,
        })
        .eq('id', workerRow.id);

      if (updateErr) {
        console.error('[checkoutService] Failed to clear worker room in database:', updateErr);
      }
    }
  } catch (err) {
    console.error('[checkoutService] Error updating worker room:', err);
  }

  // 2. Update `checkout_requests` table if exists
  try {
    await supabase
      .from('checkout_requests')
      .update({
        status: 'approved',
        reviewed_by: reviewerName,
        reviewed_at: now,
      })
      .eq('id', request.id);
  } catch {
    // Ignore if table does not exist
  }

  // 3. Log to `audit_logs`
  try {
    const logId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-0000-0000-${Date.now().toString(16).padStart(12, '0')}`;
    await supabase.from('audit_logs').insert({
      id: logId,
      timestamp: now,
      account: reviewerName,
      action: 'CHECKOUT_APPROVED',
      detail: JSON.stringify({
        ...request,
        status: 'approved',
        reviewed_by: reviewerName,
        reviewed_at: now,
      }),
    });
  } catch (err) {
    console.warn('[checkoutService] Failed to log approval audit:', err);
  }
}

/**
 * Rejects a checkout request
 */
export async function rejectCheckoutRequest(
  request: CheckoutRequest,
  reason = 'Thông tin không chính xác',
  reviewerName = 'Quản trị viên'
): Promise<void> {
  const supabase = createClient();
  const now = new Date().toISOString();

  // 1. Clean tag from worker if found
  try {
    if (request.worker_id) {
      const { data: w } = await supabase.from('workers').select('id, ghi_chu').eq('id', request.worker_id).maybeSingle();
      if (w) {
        const clean = stripCheckoutTag(w.ghi_chu || '');
        await supabase.from('workers').update({ ghi_chu: clean }).eq('id', w.id);
      }
    }
  } catch (err) {
    console.warn('[checkoutService] Worker tag cleanup warning:', err);
  }

  // 2. Update `checkout_requests` table
  try {
    await supabase
      .from('checkout_requests')
      .update({
        status: 'rejected',
        reviewed_by: reviewerName,
        reviewed_at: now,
        ghi_chu: request.ghi_chu ? `${request.ghi_chu} (Từ chối: ${reason})` : `Từ chối: ${reason}`,
      })
      .eq('id', request.id);
  } catch {
    // Ignore if table does not exist
  }

  // 3. Log to `audit_logs`
  try {
    const logId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-0000-0000-${Date.now().toString(16).padStart(12, '0')}`;
    await supabase.from('audit_logs').insert({
      id: logId,
      timestamp: now,
      account: reviewerName,
      action: 'CHECKOUT_REJECTED',
      detail: JSON.stringify({
        ...request,
        status: 'rejected',
        reject_reason: reason,
        reviewed_by: reviewerName,
        reviewed_at: now,
      }),
    });
  } catch (err) {
    console.warn('[checkoutService] Audit log reject warning:', err);
  }
}

/**
 * Deletes a checkout request record
 */
export async function deleteCheckoutRequest(request: CheckoutRequest): Promise<void> {
  const supabase = createClient();

  // 1. Clean worker tag
  try {
    if (request.worker_id) {
      const { data: w } = await supabase.from('workers').select('id, ghi_chu').eq('id', request.worker_id).maybeSingle();
      if (w) {
        const clean = stripCheckoutTag(w.ghi_chu || '');
        await supabase.from('workers').update({ ghi_chu: clean }).eq('id', w.id);
      }
    }
  } catch {}

  // 2. Delete from `checkout_requests`
  try {
    await supabase.from('checkout_requests').delete().eq('id', request.id);
  } catch {}
}
