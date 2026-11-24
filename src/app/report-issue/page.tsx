'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Wrench,
  Snowflake,
  Fan,
  Zap,
  Droplets,
  BedDouble,
  DoorClosed,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Loader2,
  Send,
  RotateCcw,
  Building2,
  Phone,
  User,
  Edit3,
} from 'lucide-react';
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_META,
  TicketCategory,
  TicketPriority,
  submitPublicMaintenanceTicket,
} from '@/lib/maintenanceTickets';
import { useKtxStructure } from '@/lib/ktxStructure';
import {
  FacilityItem,
  fetchFacilitiesList,
  formatRoomDisplay,
  normalizeRoomLabel,
} from '@/lib/facilityCapacity';
import { naturalSortCompare } from '@/data/workers';

const CATEGORY_ICONS: Record<TicketCategory, React.ComponentType<{ size?: number; className?: string }>> = {
  ac: Snowflake,
  fan: Fan,
  electric: Zap,
  plumbing: Droplets,
  bed_locker: BedDouble,
  door_lock: DoorClosed,
  other: HelpCircle,
};

const QUICK_SUGGESTIONS: Record<TicketCategory, string[]> = {
  ac: ['Điều hòa không mát', 'Điều hòa chảy nước', 'Hỏng điều khiển (remote)', 'Điều hòa không lên nguồn'],
  fan: ['Quạt không quay', 'Quạt kêu to / rung lắc', 'Hỏng công tắc quạt'],
  electric: ['Cháy bóng đèn phòng', 'Hỏng ổ cắm điện', 'Nhảy aptomat / mất điện phòng'],
  plumbing: ['Rò rỉ vòi nước', 'Tắc cống thoát nước', 'Hỏng vòi sen / bồn cầu'],
  bed_locker: ['Giường lỏng ốc / kêu cót két', 'Hỏng khóa tủ cá nhân', 'Gãy thang leo giường tầng'],
  door_lock: ['Hỏng ổ khóa cửa phòng', 'Cửa bị kẹt không đóng được', 'Hỏng chốt cửa sổ'],
  other: ['Cần kiểm tra thiết bị phòng'],
};

function ReportIssueContent() {
  const searchParams = useSearchParams();
  const { ktxGroups } = useKtxStructure();

  const paramKtx = (searchParams.get('ktx') || '').trim();
  const paramDay = (searchParams.get('day') || '').trim();
  const paramPhong = normalizeRoomLabel(searchParams.get('phong') || searchParams.get('room') || '');

  const hasPrefilledRoom = Boolean(paramKtx && paramDay && paramPhong);

  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [editingLocation, setEditingLocation] = useState(!hasPrefilledRoom);

  const [ktx, setKtx] = useState(paramKtx || 'KTX Phước Vĩnh Tây');
  const [day, setDay] = useState(paramDay || '');
  const [phongSo, setPhongSo] = useState(paramPhong || '');

  const [category, setCategory] = useState<TicketCategory>('electric');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [description, setDescription] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [reporterPhone, setReporterPhone] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedResult, setSubmittedResult] = useState<{
    ticketCode: string;
    duplicate: boolean;
    ktx: string;
    day: string;
    phongSo: string;
    category: TicketCategory;
  } | null>(null);

  useEffect(() => {
    let active = true;
    fetchFacilitiesList(false)
      .then(list => {
        if (active && Array.isArray(list)) {
          setFacilities(list.filter(f => f.is_visible !== false));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const ktxOptions = useMemo(() => {
    const set = new Set<string>();
    ktxGroups.forEach(g => {
      if (g.ktx) set.add(g.ktx);
    });
    facilities.forEach(f => {
      if (f.ktx) set.add(f.ktx);
    });
    if (ktx) set.add(ktx);
    return Array.from(set).sort(naturalSortCompare);
  }, [ktxGroups, facilities, ktx]);

  const dayOptions = useMemo(() => {
    const set = new Set<string>();
    const group = ktxGroups.find(g => g.ktx === ktx);
    group?.days.forEach(d => set.add(d));
    facilities
      .filter(f => !ktx || f.ktx === ktx)
      .forEach(f => {
        if (f.day) set.add(f.day);
      });
    if (day) set.add(day);
    return Array.from(set).sort(naturalSortCompare);
  }, [ktxGroups, facilities, ktx, day]);

  const roomOptions = useMemo(() => {
    const set = new Set<string>();
    facilities
      .filter(f => (!ktx || f.ktx === ktx) && (!day || f.day === day))
      .forEach(f => {
        const norm = normalizeRoomLabel(f.phong_khu_vuc);
        if (norm) set.add(norm);
      });
    if (phongSo) set.add(phongSo);
    return Array.from(set).sort(naturalSortCompare);
  }, [facilities, ktx, day, phongSo]);

  useEffect(() => {
    if (!ktx && ktxOptions.length > 0) {
      setKtx(ktxOptions[0]);
    }
  }, [ktx, ktxOptions]);

  useEffect(() => {
    if (!day && dayOptions.length > 0) {
      setDay(dayOptions[0]);
    }
  }, [day, dayOptions]);

  useEffect(() => {
    if (!phongSo && roomOptions.length > 0) {
      setPhongSo(roomOptions[0]);
    }
  }, [phongSo, roomOptions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!ktx.trim() || !day.trim() || !phongSo.trim()) {
      setErrorMsg('Vui lòng chọn đầy đủ khu KTX, Dãy và Số phòng.');
      return;
    }
    if (description.trim().length < 3) {
      setErrorMsg('Vui lòng chọn gợi ý nhanh hoặc mô tả ngắn sự cố (tối thiểu 3 ký tự).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitPublicMaintenanceTicket({
        ktx,
        day,
        phong_so: phongSo,
        category,
        priority,
        description,
        reporter_name: reporterName,
        reporter_phone: reporterPhone,
      });
      setSubmittedResult({
        ticketCode: res.ticketCode,
        duplicate: res.duplicate,
        ktx,
        day,
        phongSo,
        category,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể gửi phiếu báo hỏng. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetForm = () => {
    setSubmittedResult(null);
    setDescription('');
    setPriority('normal');
    setErrorMsg(null);
  };

  if (submittedResult) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-page">
        <div className="w-full max-w-md rounded-2xl bg-surf border border-bdr2 shadow-xl p-6 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-okbg border border-ok2/35 text-ok flex items-center justify-center mx-auto">
            <CheckCircle2 size={34} />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-extrabold text-tx">
              {submittedResult.duplicate ? 'Sự cố đã được ghi nhận trước đó' : 'Đã gửi báo hỏng thành công!'}
            </h1>
            <p className="text-xs sm:text-sm text-mu leading-relaxed">
              {submittedResult.duplicate
                ? 'Phòng của bạn đã có phiếu báo hỏng cùng hạng mục vừa được gửi trong ít phút trước. Tổ kỹ thuật đã nhận được thông báo.'
                : 'Thông tin đã chuyển thẳng đến Tổ Kỹ thuật & Bảo trì KTX để kiểm tra và khắc phục.'}
            </p>
          </div>

          <div className="rounded-xl bg-act border border-bdr2 p-4 space-y-2 text-left text-xs sm:text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-mu">Mã phiếu theo dõi</span>
              <span className="font-mono font-extrabold text-lnk text-sm tracking-wide">
                {submittedResult.ticketCode}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-mu">Vị trí phòng</span>
              <span className="font-bold text-tx">
                {submittedResult.day} · {formatRoomDisplay(submittedResult.phongSo)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-mu">Hạng mục</span>
              <span className="font-semibold text-tx">
                {TICKET_CATEGORY_META[submittedResult.category].label}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleResetForm}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-pri hover:bg-pri2 text-white font-bold text-sm transition-colors cursor-pointer"
          >
            <RotateCcw size={16} />
            <span>Báo thêm sự cố khác</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page py-5 px-3 sm:px-4">
      <div className="w-full max-w-lg mx-auto space-y-4">
        {/* Top Brand Card */}
        <div className="rounded-2xl bg-surf border border-bdr2 shadow-sm p-4 sm:p-5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-500 flex items-center justify-center shrink-0">
            <Wrench size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-lnk">
              KTX Phước Vĩnh Tây · Kỹ thuật & Bảo trì
            </p>
            <h1 className="text-lg sm:text-xl font-extrabold text-tx leading-tight mt-0.5">
              Báo Hỏng Thiết Bị Phòng Ở
            </h1>
            <p className="text-xs text-mu mt-0.5">
              Không cần đăng nhập · Gửi trực tiếp đến Tổ kỹ thuật trong 10 giây
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Room Location Section */}
          <div className="rounded-2xl bg-surf border border-bdr2 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-mu">
                <MapPin size={14} className="text-lnk" />
                <span>Vị trí phòng gặp sự cố</span>
              </div>
              {hasPrefilledRoom && !editingLocation && (
                <button
                  type="button"
                  onClick={() => setEditingLocation(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-lnk hover:underline cursor-pointer"
                >
                  <Edit3 size={12} />
                  <span>Đổi phòng</span>
                </button>
              )}
            </div>

            {!editingLocation && ktx && day && phongSo ? (
              <div className="rounded-xl bg-act border border-bdr2 px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-pri/15 text-lnk flex items-center justify-center shrink-0">
                    <Building2 size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-tx truncate">
                      {day} · {formatRoomDisplay(phongSo)}
                    </p>
                    <p className="text-xs text-mu truncate">{ktx}</p>
                  </div>
                </div>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-okbg text-ok border border-ok2/30 shrink-0">
                  Từ mã QR
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Khu KTX</label>
                  <select
                    value={ktx}
                    onChange={e => {
                      setKtx(e.target.value);
                      setDay('');
                      setPhongSo('');
                    }}
                    className="w-full px-3 py-2.5 rounded-xl bg-page border border-bdr2 text-sm text-tx focus:outline-none focus:border-pri2"
                    required
                  >
                    {ktxOptions.length === 0 && <option value="KTX Phước Vĩnh Tây">KTX Phước Vĩnh Tây</option>}
                    {ktxOptions.map(k => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Dãy nhà</label>
                  <select
                    value={day}
                    onChange={e => {
                      setDay(e.target.value);
                      setPhongSo('');
                    }}
                    className="w-full px-3 py-2.5 rounded-xl bg-page border border-bdr2 text-sm text-tx focus:outline-none focus:border-pri2"
                    required
                  >
                    <option value="">-- Chọn Dãy --</option>
                    {dayOptions.map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-mu block mb-1">Phòng số</label>
                  {roomOptions.length > 0 ? (
                    <select
                      value={phongSo}
                      onChange={e => setPhongSo(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-page border border-bdr2 text-sm text-tx focus:outline-none focus:border-pri2"
                      required
                    >
                      <option value="">-- Chọn Phòng --</option>
                      {roomOptions.map(r => (
                        <option key={r} value={r}>
                          {formatRoomDisplay(r)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={phongSo}
                      onChange={e => setPhongSo(e.target.value)}
                      placeholder="VD: 01, 02..."
                      className="w-full px-3 py-2.5 rounded-xl bg-page border border-bdr2 text-sm text-tx focus:outline-none focus:border-pri2"
                      required
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Category Picker */}
          <div className="rounded-2xl bg-surf border border-bdr2 p-4 space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-mu block">
              1. Chọn thiết bị gặp sự cố
            </label>
            <div className="grid grid-cols-2 gap-2">
              {TICKET_CATEGORIES.map(cat => {
                const Icon = CATEGORY_ICONS[cat];
                const meta = TICKET_CATEGORY_META[cat];
                const active = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'bg-pri/12 border-pri2 text-tx shadow-sm'
                        : 'bg-page/70 border-bdr text-nav hover:bg-act hover:text-tx'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        active ? 'bg-pri text-white' : 'bg-surf border border-bdr text-ic'
                      }`}
                    >
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold leading-snug">{meta.shortLabel}</p>
                      <p className="text-[11px] text-mu leading-tight mt-0.5 line-clamp-2">{meta.hint}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority + Description */}
          <div className="rounded-2xl bg-surf border border-bdr2 p-4 space-y-3.5">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-mu block mb-2">
                2. Mức độ ưu tiên
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPriority('normal')}
                  className={`py-2.5 px-3 rounded-xl border text-xs sm:text-sm font-bold transition-colors cursor-pointer ${
                    priority === 'normal'
                      ? 'bg-act border-pri2 text-tx'
                      : 'bg-page border-bdr text-mu hover:text-tx'
                  }`}
                >
                  Bình thường
                </button>
                <button
                  type="button"
                  onClick={() => setPriority('urgent')}
                  className={`py-2.5 px-3 rounded-xl border text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    priority === 'urgent'
                      ? 'bg-dgrbg border-dgr text-dgr'
                      : 'bg-page border-bdr text-mu hover:text-dgr'
                  }`}
                >
                  <AlertTriangle size={15} />
                  <span>Khẩn cấp</span>
                </button>
              </div>
              {priority === 'urgent' && (
                <p className="text-[11px] text-dgr mt-1.5">
                  Dùng cho sự cố mất điện toàn phòng, chập điện, vỡ ống nước hoặc hỏng khóa cửa không vào được.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-mu block mb-1.5">
                3. Mô tả ngắn tình trạng hỏng <span className="text-dgr">*</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_SUGGESTIONS[category].map(sugg => (
                  <button
                    key={sugg}
                    type="button"
                    onClick={() =>
                      setDescription(prev => {
                        const clean = prev.trim();
                        if (!clean) return sugg;
                        if (clean.toLowerCase().includes(sugg.toLowerCase())) return prev;
                        return `${clean}; ${sugg}`;
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-act hover:bg-bdg border border-bdr text-[11px] font-medium text-tx transition-colors cursor-pointer"
                  >
                    + {sugg}
                  </button>
                ))}
              </div>
              <textarea
                rows={3}
                maxLength={600}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="VD: Quạt trần số 2 không quay, đã bật công tắc nhưng không lên..."
                className="w-full px-3 py-2.5 rounded-xl bg-page border border-bdr2 text-sm text-tx placeholder:text-mu focus:outline-none focus:border-pri2 resize-none"
                required
              />
              <div className="flex justify-end text-[11px] text-mu mt-1 tabular-nums">
                {description.length}/600
              </div>
            </div>

            {/* Optional Reporter Contact */}
            <div className="pt-2 border-t border-bdr grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="text-xs font-medium text-mu flex items-center gap-1 mb-1">
                  <User size={12} />
                  <span>Tên người báo (không bắt buộc)</span>
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={reporterName}
                  onChange={e => setReporterName(e.target.value)}
                  placeholder="VD: Nguyễn Văn A"
                  className="w-full px-3 py-2 rounded-xl bg-page border border-bdr text-sm text-tx placeholder:text-mu focus:outline-none focus:border-pri2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-mu flex items-center gap-1 mb-1">
                  <Phone size={12} />
                  <span>SĐT liên hệ (không bắt buộc)</span>
                </label>
                <input
                  type="tel"
                  maxLength={30}
                  value={reporterPhone}
                  onChange={e => setReporterPhone(e.target.value)}
                  placeholder="Để kỹ thuật gọi khi đến phòng"
                  className="w-full px-3 py-2 rounded-xl bg-page border border-bdr text-sm text-tx placeholder:text-mu focus:outline-none focus:border-pri2"
                />
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-dgrbg border border-dgr/35 px-4 py-3 text-xs sm:text-sm text-dgr font-medium flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 px-5 rounded-xl bg-pri hover:bg-pri2 text-white font-bold text-sm sm:text-base shadow-lg transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            <span>{submitting ? 'Đang gửi báo hỏng...' : 'Gửi phiếu báo hỏng ngay'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ReportIssuePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-page">
          <Loader2 size={28} className="animate-spin text-lnk" />
        </div>
      }
    >
      <ReportIssueContent />
    </Suspense>
  );
}
