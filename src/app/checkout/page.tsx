'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useKtxStructure } from '@/lib/ktxStructure';
import { fetchWorkerHierarchy, naturalCompare } from '@/lib/workerHierarchy';
import {
  LogOut,
  Building2,
  CheckCircle2,
  KeyRound,
  ArrowLeft,
  Send,
  AlertCircle,
  Loader2,
  Check,
  ShieldCheck,
  Home,
  User,
  Users,
  UserCheck,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

interface RoomResident {
  id: string;
  ho_va_ten: string;
  ma_nv?: string;
  cccd?: string;
  so_dien_thoai?: string;
  ktx?: string;
  day?: string;
  phong_so?: string;
  giuong?: string;
  don_vi?: string;
  ngay_ra_ktx?: string;
}

export default function CheckoutPage() {
  const { ktxNames } = useKtxStructure();
  const [isMounted, setIsMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hierarchy for cascading KTX -> Day -> Room
  const [hierarchy, setHierarchy] = useState<{
    ktxList: string[];
    daysByKtx: Record<string, string[]>;
    roomsByKtxDay: Record<string, string[]>;
  }>({
    ktxList: [],
    daysByKtx: {},
    roomsByKtxDay: {},
  });

  // Custom manual inputs fallback
  const [isCustomKtx, setIsCustomKtx] = useState(false);
  const [customKtx, setCustomKtx] = useState('');
  const [isCustomDay, setIsCustomDay] = useState(false);
  const [customDay, setCustomDay] = useState('');
  const [isCustomPhong, setIsCustomPhong] = useState(false);
  const [customPhong, setCustomPhong] = useState('');

  // Residents in selected room
  const [residents, setResidents] = useState<RoomResident[]>([]);
  const [loadingResidents, setLoadingResidents] = useState(false);
  const [selectedResidentId, setSelectedResidentId] = useState('');

  const [form, setForm] = useState({
    ho_va_ten: '',
    ma_nv_or_cccd: '',
    so_dien_thoai: '',
    ktx: '',
    day: '',
    phong_so: '',
    giuong: '',
    ngay_ra: '',
    ly_do: 'Hết hạn hợp đồng lao động',
    ly_do_chi_tiet: '',
    ban_giao_chia_khoa: true,
    ban_giao_tai_san: true,
    ghi_chu: '',
  });

  const supabase = createClient();

  // Load hierarchy and initialize today's date
  useEffect(() => {
    setIsMounted(true);
    setForm(prev => ({
      ...prev,
      ngay_ra: new Date().toISOString().split('T')[0],
    }));

    let active = true;
    fetchWorkerHierarchy(true).then(data => {
      if (!active) return;
      if (data) {
        setHierarchy({
          ktxList: data.ktxList || [],
          daysByKtx: data.daysByKtx || {},
          roomsByKtxDay: data.roomsByKtxDay || {},
        });
      }
    }).catch(err => {
      console.warn('Failed to load worker hierarchy for checkout:', err);
    });
    return () => { active = false; };
  }, []);

  // Cascading options
  const availableKtxList = useMemo(() => {
    const set = new Set<string>();
    (hierarchy.ktxList || []).forEach(k => { if (k?.trim()) set.add(k.trim()); });
    (ktxNames || []).forEach(k => { if (k?.trim()) set.add(k.trim()); });
    return Array.from(set).sort(naturalCompare);
  }, [hierarchy.ktxList, ktxNames]);

  const availableDayList = useMemo(() => {
    const currentKtx = (form.ktx || '').trim();
    if (!currentKtx) return [];

    const set = new Set<string>();
    const daysFromHierarchy = hierarchy.daysByKtx[currentKtx];
    if (daysFromHierarchy && daysFromHierarchy.length > 0) {
      daysFromHierarchy.forEach(d => { if (d?.trim()) set.add(d.trim()); });
    }
    return Array.from(set).sort(naturalCompare);
  }, [form.ktx, hierarchy.daysByKtx]);

  const availableRoomList = useMemo(() => {
    const currentKtx = (form.ktx || '').trim();
    const currentDay = (form.day || '').trim();
    if (!currentKtx || !currentDay) return [];

    const kdKey = `${currentKtx}__${currentDay}`;
    const rooms = hierarchy.roomsByKtxDay[kdKey] || [];
    return Array.from(new Set(rooms.filter(Boolean))).sort(naturalCompare);
  }, [form.ktx, form.day, hierarchy.roomsByKtxDay]);

  // Load residents whenever (ktx, day, phong_so) changes
  useEffect(() => {
    const ktx = form.ktx?.trim();
    const day = form.day?.trim();
    const phong = form.phong_so?.trim();

    if (!ktx || !day || !phong) {
      setResidents([]);
      setSelectedResidentId('');
      return;
    }

    let active = true;
    setLoadingResidents(true);

    async function loadRoomResidents() {
      try {
        const { data, error: fetchErr } = await supabase
          .from('workers')
          .select('id, ho_va_ten, ma_nv, cccd, so_dien_thoai, ktx, day, phong_so, giuong, don_vi, ngay_ra_ktx')
          .eq('ktx', ktx)
          .eq('day', day)
          .eq('phong_so', phong);

        if (!active) return;
        if (fetchErr) {
          console.warn('Error loading residents:', fetchErr.message);
          setResidents([]);
          return;
        }

        // Prioritize active residents who have not checked out
        const activeList = (data || []).filter((r: any) => !r.ngay_ra_ktx);
        const listToUse = activeList.length > 0 ? activeList : (data || []);

        // Sort by bed number first (1, 2, 3...), then by name
        const sorted = (listToUse as RoomResident[]).sort((a, b) => {
          const gA = parseInt((a.giuong || '').replace(/\D/g, ''), 10);
          const gB = parseInt((b.giuong || '').replace(/\D/g, ''), 10);
          if (!isNaN(gA) && !isNaN(gB) && gA !== gB) return gA - gB;
          return (a.ho_va_ten || '').localeCompare(b.ho_va_ten || '', 'vi');
        });

        setResidents(sorted);
      } catch (err) {
        console.warn('Load residents failed:', err);
        if (active) setResidents([]);
      } finally {
        if (active) setLoadingResidents(false);
      }
    }

    loadRoomResidents();
    return () => { active = false; };
  }, [form.ktx, form.day, form.phong_so, supabase]);

  // Handlers for location changes
  const handleKtxSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__other__') {
      setIsCustomKtx(true);
      setForm(f => ({ ...f, ktx: customKtx, day: '', phong_so: '', ho_va_ten: '', ma_nv_or_cccd: '', so_dien_thoai: '', giuong: '' }));
      setIsCustomDay(false);
      setCustomDay('');
      setIsCustomPhong(false);
      setCustomPhong('');
      setSelectedResidentId('');
      setResidents([]);
    } else {
      setIsCustomKtx(false);
      setCustomKtx('');
      setForm(f => ({ ...f, ktx: val, day: '', phong_so: '', ho_va_ten: '', ma_nv_or_cccd: '', so_dien_thoai: '', giuong: '' }));
      setIsCustomDay(false);
      setCustomDay('');
      setIsCustomPhong(false);
      setCustomPhong('');
      setSelectedResidentId('');
      setResidents([]);
    }
  };

  const handleCustomKtxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomKtx(val);
    setForm(f => ({ ...f, ktx: val }));
  };

  const handleDaySelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__other__') {
      setIsCustomDay(true);
      setForm(f => ({ ...f, day: customDay, phong_so: '', ho_va_ten: '', ma_nv_or_cccd: '', so_dien_thoai: '', giuong: '' }));
      setIsCustomPhong(false);
      setCustomPhong('');
      setSelectedResidentId('');
      setResidents([]);
    } else {
      setIsCustomDay(false);
      setCustomDay('');
      setForm(f => ({ ...f, day: val, phong_so: '', ho_va_ten: '', ma_nv_or_cccd: '', so_dien_thoai: '', giuong: '' }));
      setIsCustomPhong(false);
      setCustomPhong('');
      setSelectedResidentId('');
      setResidents([]);
    }
  };

  const handleCustomDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomDay(val);
    setForm(f => ({ ...f, day: val }));
  };

  const handlePhongSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__other__') {
      setIsCustomPhong(true);
      setForm(f => ({ ...f, phong_so: customPhong, ho_va_ten: '', ma_nv_or_cccd: '', so_dien_thoai: '', giuong: '' }));
      setSelectedResidentId('');
      setResidents([]);
    } else {
      setIsCustomPhong(false);
      setCustomPhong('');
      setForm(f => ({ ...f, phong_so: val, ho_va_ten: '', ma_nv_or_cccd: '', so_dien_thoai: '', giuong: '' }));
      setSelectedResidentId('');
    }
  };

  const handleCustomPhongChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomPhong(val);
    setForm(f => ({ ...f, phong_so: val }));
  };

  // When a resident from the room is picked, automatically fill all worker fields
  const handleSelectResident = (workerId: string) => {
    setSelectedResidentId(workerId);
    if (!workerId || workerId === '__manual__') {
      return;
    }
    const resident = residents.find(r => r.id === workerId);
    if (resident) {
      const cleanMa = (resident.ma_nv || '').trim();
      const cleanCccd = (resident.cccd || '').trim();
      const codeValue = (cleanMa && cleanMa !== 'Chờ mã' && cleanMa !== '-') ? cleanMa : cleanCccd;
      const phoneValue = (resident.so_dien_thoai && resident.so_dien_thoai !== '-') ? resident.so_dien_thoai : '';
      const bedValue = resident.giuong
        ? (resident.giuong.startsWith('Giường') ? resident.giuong : `Giường ${resident.giuong}`)
        : '';

      setForm(prev => ({
        ...prev,
        ho_va_ten: resident.ho_va_ten || prev.ho_va_ten,
        ma_nv_or_cccd: codeValue || prev.ma_nv_or_cccd,
        so_dien_thoai: phoneValue || prev.so_dien_thoai,
        giuong: bedValue || prev.giuong,
      }));
    }
  };

  // Find currently selected resident object for highlight
  const selectedResident = useMemo(() => {
    if (!selectedResidentId || selectedResidentId === '__manual__') return null;
    return residents.find(r => r.id === selectedResidentId) || null;
  }, [selectedResidentId, residents]);

  // Hydration safety
  if (!isMounted) {
    return (
      <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 flex items-center justify-center" suppressHydrationWarning>
        <div className="max-w-xl w-full mx-auto space-y-6 animate-pulse">
          <div className="h-4 w-28 bg-muted rounded" />
          <div className="h-28 bg-card border border-border rounded-2xl p-6 space-y-2">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-6 w-48 bg-muted rounded" />
            <div className="h-3 w-64 bg-muted rounded" />
          </div>
          <div className="h-96 bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="h-8 bg-muted rounded" />
            <div className="h-8 bg-muted rounded" />
            <div className="h-8 bg-muted rounded" />
            <div className="h-10 bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    const missing: string[] = [];
    if (!form.ktx.trim()) missing.push('Khu KTX');
    if (!form.day.trim()) missing.push('Dãy nhà');
    if (!form.phong_so.trim()) missing.push('Phòng số');
    if (!form.ho_va_ten.trim()) missing.push('Họ và tên');
    if (!form.ma_nv_or_cccd.trim()) missing.push('Mã công nhân hoặc CCCD');
    if (!form.ly_do.trim()) missing.push('Lý do dọn ra');

    if (missing.length > 0) {
      setError(`Vui lòng điền đầy đủ: ${missing.join(', ')}.`);
      return;
    }

    setSubmitting(true);
    try {
      const codeOrCccd = form.ma_nv_or_cccd.trim();
      const isDigitsOnly = /^\d{9,12}$/.test(codeOrCccd);
      const maNvValue = isDigitsOnly ? '' : codeOrCccd;
      const cccdValue = isDigitsOnly ? codeOrCccd : codeOrCccd;

      const reasonSummary = form.ly_do === 'Khác' && form.ly_do_chi_tiet.trim()
        ? form.ly_do_chi_tiet.trim()
        : form.ly_do;

      const fullNote = `[CHECKOUT] Lý do: ${reasonSummary}${
        form.ghi_chu.trim() ? ` | Ghi chú: ${form.ghi_chu.trim()}` : ''
      }${form.ngay_ra ? ` | Ngày dự kiến dọn ra: ${form.ngay_ra}` : ''}${
        form.ban_giao_chia_khoa ? ' | Đã nộp chìa khóa' : ' | Chưa nộp chìa khóa'
      }${form.ban_giao_tai_san ? ' | Đã vệ sinh & bàn giao tài sản' : ''}`;

      const { error: insertErr } = await supabase.from('worker_registrations').insert({
        ho_va_ten: form.ho_va_ten.trim(),
        ma_nv: maNvValue,
        so_cccd: cccdValue,
        so_dien_thoai: form.so_dien_thoai.trim(),
        ktx: form.ktx.trim(),
        day: form.day.trim(),
        phong_so: form.phong_so.trim(),
        giuong: form.giuong.trim(),
        status: 'pending',
        ghi_chu: fullNote,
      });

      if (insertErr) {
        throw new Error(insertErr.message);
      }

      setSubmitted(true);
    } catch (err: any) {
      setError(`Lỗi khi gửi yêu cầu: ${err?.message || 'Không thể kết nối đến máy chủ'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6" suppressHydrationWarning>
      <div className="max-w-xl mx-auto space-y-6">
        {/* Navigation link */}
        <div>
          <Link
            href="/qr-portal"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
          >
            <ArrowLeft size={14} /> Về Cổng QR Quản Lý
          </Link>
        </div>

        {/* Header Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-2 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 tint-dgr text-dgr border border-dgr rounded-full text-xs font-bold">
            <LogOut size={13} /> Khai báo dọn ra KTX
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Biểu Mẫu Khai Báo Check-Out KTX
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Dành cho công nhân thực hiện thủ tục trả phòng, bàn giao cơ sở vật chất và chìa khóa để hệ thống ghi nhận và giải phóng chỗ trống.
          </p>
        </div>

        {submitted ? (
          <div className="bg-okbg border border-bdr22 rounded-2xl p-6 sm:p-8 text-center space-y-4 shadow-sm">
            <div className="w-16 h-16 mx-auto rounded-full bg-okbg flex items-center justify-center text-ok">
              <CheckCircle2 size={36} />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-ok">
                Gửi yêu cầu Check-out thành công!
              </h2>
              <p className="text-xs text-ok">
                Ban Quản lý KTX đã nhận được thông tin khai báo dọn ra của{' '}
                <strong>{form.ho_va_ten}</strong> ({form.ma_nv_or_cccd}).
              </p>
            </div>
            <div className="bg-surf/90 border border-bdr22/60 rounded-xl p-4 text-xs text-left space-y-2 text-foreground">
              <p className="font-semibold text-ok border-b border-border pb-1">
                Chi tiết xác nhận:
              </p>
              <p>• <strong>Khu vực phòng:</strong> {form.ktx} - {form.day} - Phòng {form.phong_so} {form.giuong ? `(${form.giuong})` : ''}</p>
              <p>• <strong>Lý do dọn ra:</strong> {form.ly_do === 'Khác' ? form.ly_do_chi_tiet : form.ly_do}</p>
              <p>• <strong>Ngày dự kiến trả phòng:</strong> {form.ngay_ra}</p>
              <div className="mt-2 pt-2 border-t border-border text-muted-foreground space-y-1">
                <p>📍 <strong>Bước tiếp theo:</strong></p>
                <p>1. Dọn sạch vị trí giường và bàn giao chìa khóa cho Quản lý / Bảo vệ trực KTX.</p>
                <p>2. Quản lý sẽ bấm <strong>Phê duyệt dọn ra</strong> trên hệ thống để hoàn tất giải phóng giường phòng.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSubmitted(false);
                setSelectedResidentId('');
                setResidents([]);
                setIsCustomKtx(false);
                setCustomKtx('');
                setIsCustomDay(false);
                setCustomDay('');
                setIsCustomPhong(false);
                setCustomPhong('');
                setForm({
                  ho_va_ten: '',
                  ma_nv_or_cccd: '',
                  so_dien_thoai: '',
                  ktx: '',
                  day: '',
                  phong_so: '',
                  giuong: '',
                  ngay_ra: new Date().toISOString().split('T')[0],
                  ly_do: 'Hết hạn hợp đồng lao động',
                  ly_do_chi_tiet: '',
                  ban_giao_chia_khoa: true,
                  ban_giao_tai_san: true,
                  ghi_chu: '',
                });
              }}
              className="text-xs text-primary hover:underline font-semibold cursor-pointer pt-2"
            >
              Gửi một yêu cầu khai báo khác
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5" suppressHydrationWarning>
            {error && (
              <div className="p-3 bg-dgrbg border border-dgr rounded-xl text-xs text-dgr dark:text-red-400 flex items-start gap-2" suppressHydrationWarning>
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* ── BƯỚC 1: VỊ TRÍ PHÒNG Ở CẦN TRẢ (CASCADING KTX -> DÃY -> PHÒNG) ── */}
            <div className="space-y-3" suppressHydrationWarning>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Home size={14} className="text-rose-500" />
                  <span>1. Vị trí phòng ở cần trả</span>
                </h3>
                <span className="text-[11px] text-muted-foreground">Chọn phòng để hiện tên công nhân</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" suppressHydrationWarning>
                {/* Khu KTX */}
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Khu KTX *
                  </label>
                  <select
                    value={isCustomKtx ? '__other__' : form.ktx}
                    onChange={handleKtxSelect}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer font-medium"
                    suppressHydrationWarning
                  >
                    <option value="">-- Chọn Khu KTX --</option>
                    {availableKtxList.map(ktx => (
                      <option key={ktx} value={ktx}>{ktx}</option>
                    ))}
                    <option value="__other__">➕ Khác (Nhập thủ công)</option>
                  </select>
                  {isCustomKtx && (
                    <input
                      type="text"
                      value={customKtx}
                      onChange={handleCustomKtxChange}
                      placeholder="Nhập tên Khu KTX mới..."
                      className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mt-1.5 animate-in fade-in"
                      autoFocus
                      suppressHydrationWarning
                    />
                  )}
                </div>

                {/* Dãy nhà */}
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Dãy nhà *
                  </label>
                  <select
                    value={isCustomDay ? '__other__' : form.day}
                    onChange={handleDaySelect}
                    disabled={!form.ktx && !isCustomKtx}
                    className={`w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer font-medium ${
                      !form.ktx && !isCustomKtx ? 'opacity-60 cursor-not-allowed bg-muted/40' : ''
                    }`}
                    suppressHydrationWarning
                  >
                    <option value="">
                      {!form.ktx && !isCustomKtx ? '-- Chọn Khu KTX trước --' : '-- Chọn Dãy nhà --'}
                    </option>
                    {availableDayList.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                    <option value="__other__">➕ Khác (Nhập thủ công)</option>
                  </select>
                  {isCustomDay && (
                    <input
                      type="text"
                      value={customDay}
                      onChange={handleCustomDayChange}
                      placeholder="Nhập tên Dãy nhà mới..."
                      className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mt-1.5 animate-in fade-in"
                      autoFocus
                      suppressHydrationWarning
                    />
                  )}
                </div>

                {/* Phòng số */}
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Phòng số *
                  </label>
                  <select
                    value={isCustomPhong ? '__other__' : form.phong_so}
                    onChange={handlePhongSelect}
                    disabled={(!form.day && !isCustomDay) || (!form.ktx && !isCustomKtx)}
                    className={`w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer font-medium ${
                      (!form.day && !isCustomDay) || (!form.ktx && !isCustomKtx)
                        ? 'opacity-60 cursor-not-allowed bg-muted/40'
                        : ''
                    }`}
                    suppressHydrationWarning
                  >
                    <option value="">
                      {!form.ktx && !isCustomKtx
                        ? '-- Chọn Khu KTX trước --'
                        : !form.day && !isCustomDay
                        ? '-- Chọn Dãy nhà trước --'
                        : availableRoomList.length === 0
                        ? '-- Chọn phòng --'
                        : '-- Chọn Phòng --'}
                    </option>
                    {availableRoomList.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                    <option value="__other__">➕ Khác (Nhập thủ công)</option>
                  </select>
                  {isCustomPhong && (
                    <input
                      type="text"
                      value={customPhong}
                      onChange={handleCustomPhongChange}
                      placeholder="Nhập số phòng mới..."
                      className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mt-1.5 animate-in fade-in"
                      autoFocus
                      suppressHydrationWarning
                    />
                  )}
                </div>
              </div>
            </div>

            {/* ── BƯỚC 2: CHỌN CÔNG NHÂN TRONG PHÒNG (DANH SÁCH TỰ ĐỘNG) ── */}
            {form.phong_so && (
              <div className="p-3.5 bg-primary/5 border border-primary/20 rounded-xl space-y-3 animate-in fade-in" suppressHydrationWarning>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                    <Users size={14} />
                    <span>Danh sách công nhân phòng {form.phong_so} ({form.ktx} - {form.day})</span>
                  </span>
                  {loadingResidents && (
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin text-primary" /> Đang tải danh sách...
                    </span>
                  )}
                </div>

                {loadingResidents ? (
                  <div className="py-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 size={14} className="animate-spin text-primary" />
                    <span>Đang tìm kiếm danh sách người ở trong phòng {form.phong_so}...</span>
                  </div>
                ) : residents.length > 0 ? (
                  <div className="space-y-2.5">
                    {/* Select Dropdown */}
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Bấm để chọn tên bạn trong phòng:
                      </label>
                      <select
                        value={selectedResidentId}
                        onChange={e => handleSelectResident(e.target.value)}
                        className="w-full bg-background border border-primary/30 rounded-xl px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer shadow-sm"
                        suppressHydrationWarning
                      >
                        <option value="">-- Bấm vào đây để chọn tên ({residents.length} người trong phòng) --</option>
                        {residents.map(r => {
                          const bedInfo = r.giuong ? `(Giường ${r.giuong})` : '';
                          const codeInfo = r.ma_nv && r.ma_nv !== 'Chờ mã' && r.ma_nv !== '-'
                            ? `Mã: ${r.ma_nv}`
                            : r.cccd ? `CCCD: ${r.cccd}` : '';
                          const unitInfo = r.don_vi ? `· ${r.don_vi}` : '';
                          return (
                            <option key={r.id} value={r.id}>
                              {r.ho_va_ten} {bedInfo} - {codeInfo} {unitInfo}
                            </option>
                          );
                        })}
                        <option value="__manual__">➕ Không có tên tôi trong danh sách (Tự gõ thông tin)</option>
                      </select>
                    </div>

                    {/* Quick selection chips for mobile / fast clicking */}
                    <div>
                      <span className="block text-[11px] text-muted-foreground mb-1.5 font-medium">
                        Hoặc bấm chạm trực tiếp vào tên của bạn:
                      </span>
                      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                        {residents.map(r => {
                          const isSelected = selectedResidentId === r.id;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => handleSelectResident(r.id)}
                              className={`text-xs px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex items-center gap-1.5 ${
                                isSelected
                                  ? 'bg-primary text-primary-foreground border-primary font-bold shadow-sm'
                                  : 'bg-background hover:bg-muted/70 text-foreground border-border hover:border-primary/40'
                              }`}
                            >
                              <User size={12} className={isSelected ? 'text-primary-foreground' : 'text-primary'} />
                              <span>{r.ho_va_ten}</span>
                              {r.giuong && (
                                <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                                  isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                                }`}>
                                  G.{r.giuong}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Selection Confirmation Banner */}
                    {selectedResident && (
                      <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                          <span>
                            Đã chọn: <strong>{selectedResident.ho_va_ten}</strong>
                            {selectedResident.giuong ? ` (Giường ${selectedResident.giuong})` : ''} · Đã tự động điền thông tin bên dưới!
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedResidentId('');
                            setForm(prev => ({
                              ...prev,
                              ho_va_ten: '',
                              ma_nv_or_cccd: '',
                              so_dien_thoai: '',
                              giuong: '',
                            }));
                          }}
                          className="text-[11px] underline font-semibold text-emerald-800 dark:text-emerald-200 hover:opacity-80 ml-2 shrink-0 cursor-pointer"
                        >
                          Đổi người
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-muted/40 border border-border/80 rounded-xl text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">ℹ️ Chưa có dữ liệu công nhân gán trong phòng {form.phong_so}</p>
                    <p>Bạn vẫn có thể tự điền thông tin họ tên và số CCCD/Mã nhân viên ở các ô bên dưới để hoàn tất check-out.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── BƯỚC 3: THÔNG TIN CÔNG NHÂN (TỰ ĐỘNG ĐIỀN HOẶC NHẬP TAY) ── */}
            <div className="space-y-3 pt-2 border-t border-border" suppressHydrationWarning>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <User size={14} className="text-primary" />
                  <span>2. Thông tin công nhân check-out</span>
                </h3>
                {form.ho_va_ten && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <Check size={12} /> Đã có thông tin
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5" suppressHydrationWarning>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Họ và tên *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Nguyễn Văn A"
                    value={form.ho_va_ten}
                    onChange={e => setForm({ ...form, ho_va_ten: e.target.value })}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
                    suppressHydrationWarning
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Mã công nhân hoặc Số CCCD *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Mã NV (NV001) hoặc CCCD"
                    value={form.ma_nv_or_cccd}
                    onChange={e => setForm({ ...form, ma_nv_or_cccd: e.target.value })}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                    suppressHydrationWarning
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Số điện thoại liên hệ
                  </label>
                  <input
                    type="tel"
                    placeholder="VD: 0912345678"
                    value={form.so_dien_thoai}
                    onChange={e => setForm({ ...form, so_dien_thoai: e.target.value })}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                    suppressHydrationWarning
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Số giường (tùy chọn)
                  </label>
                  <input
                    type="text"
                    placeholder="VD: Giường 02"
                    value={form.giuong}
                    onChange={e => setForm({ ...form, giuong: e.target.value })}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    suppressHydrationWarning
                  />
                </div>
              </div>
            </div>

            {/* ── BƯỚC 4: LÝ DO DỌN RA & BÀN GIAO ── */}
            <div className="space-y-3 pt-3 border-t border-border" suppressHydrationWarning>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <KeyRound size={14} className="text-amber-500" />
                <span>3. Lý do dọn ra & Bàn giao</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5" suppressHydrationWarning>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Lý do dọn ra *
                  </label>
                  <select
                    value={form.ly_do}
                    onChange={e => setForm({ ...form, ly_do: e.target.value })}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                    suppressHydrationWarning
                  >
                    <option value="Hết hạn hợp đồng lao động">Hết hạn hợp đồng lao động</option>
                    <option value="Chuyển sang thuê nhà trọ ngoài">Chuyển sang thuê nhà trọ ngoài</option>
                    <option value="Điều chuyển đơn vị / công trình">Điều chuyển đơn vị / công trình</option>
                    <option value="Nghỉ phép dài hạn">Nghỉ phép dài hạn</option>
                    <option value="Chấm dứt hợp đồng">Chấm dứt hợp đồng</option>
                    <option value="Khác">Lý do khác...</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Ngày dự kiến trả phòng *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.ngay_ra}
                    onChange={e => setForm({ ...form, ngay_ra: e.target.value })}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    suppressHydrationWarning
                  />
                </div>

                {form.ly_do === 'Khác' && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">
                      Nêu rõ lý do dọn ra *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Nhập lý do cụ thể..."
                      value={form.ly_do_chi_tiet}
                      onChange={e => setForm({ ...form, ly_do_chi_tiet: e.target.value })}
                      className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      suppressHydrationWarning
                    />
                  </div>
                )}
              </div>

              {/* Handover checkboxes */}
              <div className="pt-2 space-y-2 bg-muted/30 p-3 rounded-xl border border-border/80" suppressHydrationWarning>
                <span className="block text-xs font-bold text-foreground">
                  Cam kết bàn giao cơ sở vật chất:
                </span>
                <label className="flex items-center gap-2.5 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.ban_giao_chia_khoa}
                    onChange={e => setForm({ ...form, ban_giao_chia_khoa: e.target.checked })}
                    className="rounded text-dgr focus:ring-rose-500 w-4 h-4 cursor-pointer"
                    suppressHydrationWarning
                  />
                  <span>Đã nộp lại chìa khóa phòng cho Quản lý / Bảo vệ trực KTX</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.ban_giao_tai_san}
                    onChange={e => setForm({ ...form, ban_giao_tai_san: e.target.checked })}
                    className="rounded text-dgr focus:ring-rose-500 w-4 h-4 cursor-pointer"
                    suppressHydrationWarning
                  />
                  <span>Đã thu dọn đồ đạc cá nhân, dọn sạch giường và không làm hư hỏng trang thiết bị</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Ghi chú thêm (nếu có)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ghi chú về tình trạng phòng, tài sản hoặc liên hệ..."
                  value={form.ghi_chu}
                  onChange={e => setForm({ ...form, ghi_chu: e.target.value })}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  suppressHydrationWarning
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-3 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold shadow-md transition-all cursor-pointer"
              suppressHydrationWarning
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Đang gửi yêu cầu...</span>
                </>
              ) : (
                <>
                  <Send size={15} />
                  <span>Gửi yêu cầu Check-out</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
