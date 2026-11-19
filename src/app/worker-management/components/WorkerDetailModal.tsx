'use client';
import React, { useState, useEffect } from 'react';
import { Worker, calcSoNgay } from '@/data/workers';
import {
  X,
  Pencil,
  Trash2,
  Phone,
  MapPin,
  Calendar,
  Building2,
  Shield,
  User,
  CreditCard,
  Users,
  History,
  Loader2,
  ArrowRightLeft,
  LogIn,
  LogOut,
  Printer,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { escapeHtml, printHtmlViaIframe } from '@/lib/printHtml';
import { SlidingTabs } from '@/components/ui/MotionPrimitives';
import { StatusTag, MonoChip } from '@/components/ui/StatusTag';

interface Props {
  worker: Worker;
  onClose: () => void;
  onEdit: (w: Worker) => void;
  onDelete?: (w: Worker) => void;
  /** If false, Edit buttons are hidden/disabled (read-only mode for staff without write access) */
  canEdit?: boolean;
}

interface TimelineEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  actor?: string;
  kind: 'checkin' | 'transfer' | 'checkout' | 'update';
}

function DetailRow({
  label,
  value,
  icon: Icon,
  mono,
}: {
  label: string;
  value: string | undefined;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-bdr last:border-0">
      {Icon && <Icon size={14} className="text-ic mt-0.5 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-mu font-medium">{label}</p>
        <p className={`text-sm text-tx mt-0.5 ${mono ? 'font-mono font-tabular' : 'font-semibold'} break-words`}>
          {value || <span className="text-mu italic text-xs font-normal">Chưa có thông tin</span>}
        </p>
      </div>
    </div>
  );
}

function formatHistoryTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function WorkerDetailModal({ worker: w, onClose, onEdit, onDelete, canEdit = true }: Props) {
  const [activeTab, setActiveTab] = useState<'info' | 'history'>('info');
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const workerId = w.id;
  const workerMaNV = w.maNV || '';
  const workerName = w.hoVaTen || '';
  const workerNgayVao = w.ngayVaoKTX || '';
  const workerNgayRa = w.ngayRaKTX || '';
  const workerKtx = w.ktx || '';
  const workerDay = w.day || '';
  const workerPhong = w.phongSo || '';
  const workerGiuong = w.giuong || '';

  const isFemale =
    (w.gioiTinh || '').toLowerCase().includes('nữ') || (w.gioiTinh || '').toLowerCase() === 'nu';
  const platoonTone = w.tieuDoan === '113' ? 'teal' : w.tieuDoan === '111' ? 'pink' : w.tieuDoan ? 'blue' : 'amber';

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    let cancelled = false;

    const loadHistory = async () => {
      setLoadingHistory(true);
      const list: TimelineEvent[] = [];

      if (workerNgayVao) {
        list.push({
          id: `checkin-${workerId}`,
          time: workerNgayVao,
          title: 'Tiếp nhận vào KTX',
          detail: `${workerKtx || 'KTX'} · ${workerDay || '—'} · Phòng ${workerPhong || '—'}${
            workerGiuong ? ` · Giường ${workerGiuong}` : ''
          }`,
          kind: 'checkin',
        });
      }

      if (workerNgayRa) {
        list.push({
          id: `checkout-date-${workerId}`,
          time: workerNgayRa,
          title: 'Ngày rời KTX đã ghi nhận',
          detail: `${workerKtx || 'KTX'} · ${workerDay || '—'} · Phòng ${workerPhong || '—'}`,
          kind: 'checkout',
        });
      }

      try {
        const supabase = createClient();
        const searchTerms = [workerMaNV.trim(), workerName.trim()].filter(Boolean);
        const auditRows: Array<{ id: string; timestamp: string; account: string; action: string; detail: string }> = [];

        if (searchTerms.length > 0) {
          const orFilter = searchTerms
            .map(t => `detail.ilike.%${t.replace(/[%_(),]/g, '')}%`)
            .join(',');
          const { data: logs, error } = await supabase
            .from('audit_logs')
            .select('id, timestamp, account, action, detail')
            .or(orFilter)
            .order('timestamp', { ascending: false })
            .limit(40);
          if (!error && logs) {
            auditRows.push(...logs);
          }
        }

        const [delRes, entryRes] = await Promise.all([
          supabase
            .from('worker_deletion_log')
            .select('id, deleted_at, ktx, day')
            .or(
              workerMaNV.trim()
                ? `worker_id.eq.${workerId},ma_nv.eq.${workerMaNV.trim()}`
                : `worker_id.eq.${workerId}`
            )
            .order('deleted_at', { ascending: false })
            .limit(20),
          supabase
            .from('worker_entry_log')
            .select('id, entered_at, ktx, day')
            .or(
              workerMaNV.trim()
                ? `worker_id.eq.${workerId},ma_nv.eq.${workerMaNV.trim()}`
                : `worker_id.eq.${workerId}`
            )
            .order('entered_at', { ascending: false })
            .limit(10),
        ]);

        const formatAuditDetail = (
          action: string,
          rawDetail: string
        ): { title: string; detail: string; kind: TimelineEvent['kind'] } => {
          const act = String(action || '');
          let prettyDetail = rawDetail || '';
          try {
            if (rawDetail.trim().startsWith('{')) {
              const parsed = JSON.parse(rawDetail);
              if (act === 'BED_REASSIGN' && parsed.from && parsed.to) {
                prettyDetail = `Từ ${parsed.from.ktx || ''} · ${parsed.from.day || ''} · P${parsed.from.phong_so || ''} · G${
                  parsed.from.giuong || ''
                } → Sang ${parsed.to.ktx || ''} · ${parsed.to.day || ''} · P${parsed.to.phong_so || ''} · G${
                  parsed.to.giuong || ''
                }`;
                return { title: 'Chuyển / Đổi giường', detail: prettyDetail, kind: 'transfer' };
              }
              if (act === 'BED_INSPECT_CONFIRM') {
                prettyDetail = `Xác nhận có mặt tại ${parsed.ktx || ''} · ${parsed.day || ''} · P${parsed.phong_so || ''} · G${
                  parsed.giuong || ''
                }`;
                return { title: 'Xác nhận kiểm tra giường QR', detail: prettyDetail, kind: 'checkin' };
              }
              if (act === 'CHECKOUT_APPROVED' || act === 'CHECKOUT_REQUEST') {
                prettyDetail = `${parsed.ho_va_ten || ''} (${parsed.ma_nv || '—'}) — ${parsed.ktx || ''} · ${
                  parsed.day || ''
                } · P${parsed.phong_so || ''}${parsed.ly_do ? ` | Lý do: ${parsed.ly_do}` : ''}`;
                return {
                  title: act === 'CHECKOUT_APPROVED' ? 'Duyệt trả phòng KTX' : 'Gửi yêu cầu trả phòng',
                  detail: prettyDetail,
                  kind: 'checkout',
                };
              }
            }
          } catch {
            // Keep raw detail text
          }

          const kind: TimelineEvent['kind'] =
            act.includes('Chuyển') || act.includes('giường') || act === 'BED_REASSIGN'
              ? 'transfer'
              : act.includes('Trả') || act.includes('Xóa') || act.includes('CHECKOUT') || act === 'DELETE'
              ? 'checkout'
              : act.includes('Thêm') || act.includes('Duyệt') || act === 'CREATE' || act === 'APPROVE_REGISTRATION'
              ? 'checkin'
              : 'update';
          return { title: act || 'Cập nhật hồ sơ', detail: prettyDetail, kind };
        };

        for (const log of auditRows) {
          const parsed = formatAuditDetail(log.action, log.detail);
          list.push({
            id: `audit-${log.id}`,
            time: log.timestamp,
            title: parsed.title,
            detail: parsed.detail,
            actor: log.account || undefined,
            kind: parsed.kind,
          });
        }

        if (!entryRes.error && entryRes.data) {
          for (const e of entryRes.data) {
            list.push({
              id: `entry-${e.id}`,
              time: e.entered_at,
              title: 'Ghi nhận nhập KTX (Hệ thống)',
              detail: `${e.ktx || 'KTX'} · ${e.day || '—'}`,
              kind: 'checkin',
            });
          }
        }

        if (!delRes.error && delRes.data) {
          for (const d of delRes.data) {
            list.push({
              id: `del-${d.id}`,
              time: d.deleted_at,
              title: 'Ghi nhận rời KTX / Trả phòng',
              detail: `${d.ktx || 'KTX'} · ${d.day || '—'}`,
              kind: 'checkout',
            });
          }
        }
      } catch {
        // Bỏ qua lỗi mạng khi tra cứu log bổ sung
      }

      list.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      if (!cancelled) {
        setEvents(list);
        setLoadingHistory(false);
      }
    };

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [activeTab, workerId, workerMaNV, workerName, workerNgayVao, workerNgayRa, workerKtx, workerDay, workerPhong, workerGiuong]);

  const locLabel = [w.ktx, w.day, w.phongSo ? `P.${w.phongSo}` : '', w.giuong ? `G${w.giuong}` : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop-scrim fade-in" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="surface-elevated rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden border border-bdr2 modal-enter"
      >
        {/* Header */}
        <div className="flex items-center gap-3.5 px-5 py-4 border-b border-bdr bg-act/50">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-extrabold flex-shrink-0 ${
              isFemale ? 'craft-icon-pink' : 'craft-icon-blue'
            }`}
          >
            {w.hoVaTen.split(' ').pop()?.charAt(0) ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-extrabold text-tx truncate">{w.hoVaTen}</h2>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <StatusTag tone={platoonTone} icon={Shield}>
                {w.tieuDoan ? `TD ${w.tieuDoan}` : 'Chưa phân bổ'}
              </StatusTag>
              {locLabel && <MonoChip tone="blue">{locLabel}</MonoChip>}
              <StatusTag
                tone={w.tamTruStatus === 'registered' ? 'teal' : 'amber'}
                icon={w.tamTruStatus === 'registered' ? CheckCircle2 : Clock}
              >
                {w.tamTruStatus === 'registered' ? 'Đã ĐK tạm trú' : 'Chưa ĐK'}
              </StatusTag>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                const days = calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX);
                const tamTruText = w.tamTruStatus === 'registered' ? 'Đã đăng ký tạm trú' : 'Chưa đăng ký tạm trú';
                const printedAt = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8" /><title>Phiếu Cư Trú - ${escapeHtml(w.hoVaTen)}</title>
<style>
  @page { size: A5 landscape; margin: 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; padding: 12px; font-size: 12px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 12px; }
  .title { font-size: 16px; font-weight: 800; color: #1e3a8a; margin: 0; }
  .sub { font-size: 11px; color: #4b5563; margin-top: 2px; }
  .badge { padding: 4px 10px; border: 1px solid #2563eb; border-radius: 6px; font-weight: 700; font-size: 11px; color: #1d4ed8; background: #eff6ff; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
  .box { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; }
  .box h4 { margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .row { display: flex; justify-content: space-between; margin-bottom: 5px; gap: 8px; }
  .lbl { color: #6b7280; }
  .val { font-weight: 700; text-align: right; }
  .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 16px; text-align: center; }
  .sign-box { padding-top: 4px; }
  .sign-line { margin-top: 38px; font-size: 11px; color: #4b5563; }
</style></head><body>
  <div class="header">
    <div>
      <p class="title">PHIẾU THÔNG TIN CƯ TRÚ KTX PHƯỚC VĨNH TÂY</p>
      <p class="sub">Ngày in: ${escapeHtml(printedAt)}</p>
    </div>
    <div class="badge">${escapeHtml(w.ktx || 'KTX')} · ${escapeHtml(w.day || '—')} · P${escapeHtml(w.phongSo || '—')} · G${escapeHtml(w.giuong || '—')}</div>
  </div>
  <div class="grid">
    <div class="box">
      <h4>Thông tin cá nhân</h4>
      <div class="row"><span class="lbl">Họ và tên:</span><span class="val">${escapeHtml(w.hoVaTen)}</span></div>
      <div class="row"><span class="lbl">Mã nhân viên:</span><span class="val">${escapeHtml(w.maNV || '—')}</span></div>
      <div class="row"><span class="lbl">Giới tính / Ngày sinh:</span><span class="val">${escapeHtml(w.gioiTinh || '—')} · ${escapeHtml(w.ngaySinh || '—')}</span></div>
      <div class="row"><span class="lbl">Số CCCD:</span><span class="val">${escapeHtml(w.cccd || '—')}</span></div>
      <div class="row"><span class="lbl">Số điện thoại:</span><span class="val">${escapeHtml(w.soDienThoai || '—')}</span></div>
      <div class="row"><span class="lbl">Quê quán:</span><span class="val">${escapeHtml(w.hoKhauTinh || '—')}</span></div>
    </div>
    <div class="box">
      <h4>Thông tin lưu trú &amp; đơn vị</h4>
      <div class="row"><span class="lbl">Đơn vị / Tiểu đoàn:</span><span class="val">${escapeHtml(w.donVi || '—')}${w.tieuDoan ? ` (TD ${escapeHtml(w.tieuDoan)})` : ''}</span></div>
      <div class="row"><span class="lbl">Vị trí phòng giường:</span><span class="val">${escapeHtml([w.ktx, w.day, w.phongSo ? `Phòng ${w.phongSo}` : '', w.giuong ? `Giường ${w.giuong}` : ''].filter(Boolean).join(' · '))}</span></div>
      <div class="row"><span class="lbl">Ngày vào / ra KTX:</span><span class="val">${escapeHtml(w.ngayVaoKTX || '—')} → ${escapeHtml(w.ngayRaKTX || 'Đang ở')}</span></div>
      <div class="row"><span class="lbl">Số ngày lưu trú:</span><span class="val">${days !== null ? `${days} ngày` : '—'}</span></div>
      <div class="row"><span class="lbl">Trạng thái tạm trú:</span><span class="val">${escapeHtml(tamTruText)}</span></div>
      <div class="row"><span class="lbl">Tổ trưởng:</span><span class="val">${escapeHtml(w.toTruong || '—')} (${escapeHtml(w.sdtToTruong || '—')})</span></div>
    </div>
  </div>
  <div class="signs">
    <div class="sign-box"><strong>Người lưu trú ký xác nhận</strong><div class="sign-line">(Ký và ghi rõ họ tên)</div></div>
    <div class="sign-box"><strong>Đại diện Ban Quản Lý KTX</strong><div class="sign-line">(Ký và ghi rõ họ tên)</div></div>
  </div>
</body></html>`;
                printHtmlViaIframe(html);
              }}
              className="p-2 rounded-lg hover:bg-act text-mu hover:text-lnk transition-colors cursor-pointer"
              title="In phiếu cư trú"
            >
              <Printer size={15} />
            </button>
            {canEdit ? (
              <button
                onClick={() => onEdit(w)}
                className="p-2 rounded-lg hover:bg-act text-mu hover:text-lnk transition-colors cursor-pointer"
                title="Chỉnh sửa"
              >
                <Pencil size={15} />
              </button>
            ) : (
              <button
                disabled
                title="Bạn không có quyền sửa công nhân thuộc KTX/Dãy này"
                className="p-2 rounded-lg text-ic cursor-not-allowed"
              >
                <Pencil size={15} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(w)}
                className="p-2 rounded-lg hover:bg-dgrbg text-mu hover:text-dgr transition-colors cursor-pointer"
                title="Xóa"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-act text-mu hover:text-tx transition-colors ml-0.5 cursor-pointer">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Sliding Tabs */}
        <div className="px-5 py-2.5 border-b border-bdr bg-surf/80">
          <SlidingTabs<'info' | 'history'>
            layoutId="worker-detail-tabs"
            compact
            value={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'info', label: 'Thông tin chi tiết', icon: User },
              { id: 'history', label: 'Lịch sử lưu trú', icon: History, count: events.length > 0 ? events.length : undefined },
            ]}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-3.5">
          {activeTab === 'info' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              <div>
                <p className="text-[11px] font-bold text-ic uppercase tracking-wider mb-1 mt-1">Thông tin cá nhân</p>
                <DetailRow label="Họ và Tên" value={w.hoVaTen} icon={User} />
                <DetailRow label="Mã nhân viên" value={w.maNV} icon={CreditCard} mono />
                <DetailRow label="Giới tính" value={w.gioiTinh} />
                <DetailRow label="Ngày sinh" value={w.ngaySinh} icon={Calendar} mono />
                <DetailRow label="Số điện thoại" value={w.soDienThoai} icon={Phone} mono />
                <DetailRow label="CCCD" value={w.cccd} icon={CreditCard} mono />
                <DetailRow label="Hộ khẩu Tỉnh/TP" value={w.hoKhauTinh} icon={MapPin} />
                {w.avatar && (
                  <div className="py-2.5 border-b border-bdr">
                    <p className="text-xs text-mu font-medium mb-1.5">Ảnh CCCD</p>
                    <a href={w.avatar} target="_blank" rel="noopener noreferrer">
                      <img
                        src={w.avatar}
                        alt={`Ảnh CCCD của ${w.hoVaTen}`}
                        className="w-full max-w-[180px] rounded-xl border border-bdr2 object-cover hover:opacity-90 transition-opacity cursor-pointer"
                      />
                    </a>
                  </div>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold text-ic uppercase tracking-wider mb-1 mt-1">Thông tin KTX</p>
                <DetailRow label="KTX" value={w.ktx} icon={Building2} />
                <DetailRow label="Đơn vị" value={w.donVi} />
                <DetailRow label="Tiểu đoàn" value={w.tieuDoan || 'Chưa phân'} icon={Shield} />
                <DetailRow label="Dãy nhà" value={w.day} icon={Building2} />
                <DetailRow label="Phòng số" value={w.phongSo} mono />
                <DetailRow label="Số giường" value={w.giuong || '—'} mono />
                <DetailRow label="Ngày vào KTX" value={w.ngayVaoKTX} icon={Calendar} mono />
                <DetailRow label="Ngày ra KTX" value={w.ngayRaKTX || 'Đang ở'} mono />
                <DetailRow
                  label="Số ngày lưu trú"
                  value={calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX) !== null ? `${calcSoNgay(w.ngayVaoKTX, w.ngayRaKTX)} ngày` : '—'}
                  mono
                />
                <p className="text-[11px] font-bold text-ic uppercase tracking-wider mb-1 mt-3">Tổ trưởng</p>
                <DetailRow label="Họ tên tổ trưởng" value={w.toTruong} icon={Users} />
                <DetailRow label="SĐT tổ trưởng" value={w.sdtToTruong} icon={Phone} mono />
                {w.ghiChu && (
                  <>
                    <p className="text-[11px] font-bold text-ic uppercase tracking-wider mb-1 mt-3">Ghi chú</p>
                    <p className="text-sm text-tx bg-act/50 border border-bdr rounded-lg p-2.5">{w.ghiChu}</p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="py-2">
              {loadingHistory ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-mu">
                  <Loader2 size={20} className="animate-spin text-pri2" />
                  <p className="text-xs">Đang tải lịch sử lưu trú &amp; chuyển giường...</p>
                </div>
              ) : events.length === 0 ? (
                <div className="py-12 text-center text-mu">
                  <History size={28} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-semibold text-tx">Chưa có mốc lịch sử nào</p>
                  <p className="text-xs mt-1">
                    Các thao tác chuyển phòng, đổi giường, hoặc duyệt trả phòng sẽ tự động ghi nhận tại đây.
                  </p>
                </div>
              ) : (
                <div className="relative pl-5 space-y-3 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-bdr2">
                  {events.map(ev => {
                    const dotBg =
                      ev.kind === 'checkin'
                        ? 'bg-ok2'
                        : ev.kind === 'transfer'
                        ? 'bg-pri2'
                        : ev.kind === 'checkout'
                        ? 'bg-dgr'
                        : 'bg-wn';
                    const tagTone =
                      ev.kind === 'checkin'
                        ? 'teal'
                        : ev.kind === 'transfer'
                        ? 'blue'
                        : ev.kind === 'checkout'
                        ? 'rose'
                        : 'amber';
                    const EvIcon =
                      ev.kind === 'checkin'
                        ? LogIn
                        : ev.kind === 'transfer'
                        ? ArrowRightLeft
                        : ev.kind === 'checkout'
                        ? LogOut
                        : History;
                    return (
                      <div key={ev.id} className="relative bg-act/50 border border-bdr rounded-xl p-3">
                        <span className={`absolute -left-[17px] top-4 w-2.5 h-2.5 rounded-full ${dotBg} ring-2 ring-surf`} />
                        <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                          <StatusTag tone={tagTone} icon={EvIcon}>
                            {ev.title}
                          </StatusTag>
                          <span className="text-[11px] font-mono font-tabular text-mu">{formatHistoryTime(ev.time)}</span>
                        </div>
                        <p className="text-xs text-tx/90 break-words leading-relaxed">{ev.detail}</p>
                        {ev.actor && (
                          <p className="text-[11px] text-mu mt-1.5">
                            Thực hiện: <span className="font-semibold text-tx">{ev.actor}</span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-bdr bg-act/30 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-xs">
            Đóng
          </button>
          {canEdit ? (
            <button onClick={() => onEdit(w)} className="btn-glow-primary px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <Pencil size={13} />
              <span>Chỉnh sửa</span>
            </button>
          ) : (
            <button disabled className="btn-primary text-xs opacity-40 cursor-not-allowed">
              <Pencil size={13} />
              <span>Chỉ xem</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}