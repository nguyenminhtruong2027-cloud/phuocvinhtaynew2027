'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useKtxStructure } from '@/lib/ktxStructure';
import {
  LogOut,
  Building2,
  CheckCircle2,
  KeyRound,
  ArrowLeft,
  Send,
  Calendar,
  AlertCircle,
  Loader2,
  Check,
  ShieldCheck,
  Home,
} from 'lucide-react';

export default function CheckoutPage() {
  const { ktxNames } = useKtxStructure();
  const [isMounted, setIsMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    setIsMounted(true);
    setForm(prev => ({
      ...prev,
      ngay_ra: new Date().toISOString().split('T')[0],
    }));
  }, []);

  useEffect(() => {
    if (ktxNames.length > 0 && !form.ktx) {
      setForm(f => ({ ...f, ktx: ktxNames[0] }));
    }
  }, [ktxNames, form.ktx]);

  // Hydration safety: render matching skeleton on initial server/client pass
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
    if (!form.ho_va_ten.trim()) missing.push('Họ và tên');
    if (!form.ma_nv_or_cccd.trim()) missing.push('Mã công nhân hoặc CCCD');
    if (!form.ktx.trim()) missing.push('Khu KTX');
    if (!form.day.trim()) missing.push('Dãy nhà');
    if (!form.phong_so.trim()) missing.push('Phòng số');
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
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-full text-xs font-bold">
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
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-6 sm:p-8 text-center space-y-4 shadow-sm">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={36} />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-emerald-800 dark:text-emerald-300">
                Gửi yêu cầu Check-out thành công!
              </h2>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Ban Quản lý KTX đã nhận được thông tin khai báo dọn ra của{' '}
                <strong>{form.ho_va_ten}</strong> ({form.ma_nv_or_cccd}).
              </p>
            </div>
            <div className="bg-white/90 dark:bg-card border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-4 text-xs text-left space-y-2 text-foreground">
              <p className="font-semibold text-emerald-800 dark:text-emerald-300 border-b border-border pb-1">
                Chi tiết xác nhận:
              </p>
              <p>• <strong>Khu vực phòng:</strong> {form.ktx} - {form.day} - Phòng {form.phong_so} {form.giuong ? `(Giường ${form.giuong})` : ''}</p>
              <p>• <strong>Lý do dọn ra:</strong> {form.ly_do === 'Khác' ? form.ly_do_chi_tiet : form.ly_do}</p>
              <p>• <strong>Ngày dự kiến trả phòng:</strong> {form.ngay_ra}</p>
              <div className="mt-2 pt-2 border-t border-border text-muted-foreground space-y-1">
                <p>📍 <strong>Bước tiếp theo:</strong></p>
                <p>1. Dọn sạch vị trí giường và bàn giao chìa khóa cho Quản lý / Bảo vệ trực.</p>
                <p>2. Quản lý sẽ bấm <strong>Phê duyệt dọn ra</strong> trên hệ thống để hoàn tất giải phóng giường phòng.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSubmitted(false);
                setForm(prev => ({
                  ...prev,
                  ho_va_ten: '',
                  ma_nv_or_cccd: '',
                  so_dien_thoai: '',
                  phong_so: '',
                  giuong: '',
                  ghi_chu: '',
                }));
              }}
              className="text-xs text-primary hover:underline font-semibold cursor-pointer pt-2"
            >
              Gửi một yêu cầu khai báo khác
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4" suppressHydrationWarning>
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-400 flex items-start gap-2" suppressHydrationWarning>
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Worker Identification */}
            <div className="space-y-3" suppressHydrationWarning>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <span>1. Thông tin công nhân</span>
              </h3>

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
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
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

                <div className="sm:col-span-2">
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
              </div>
            </div>

            {/* Room Location */}
            <div className="space-y-3 pt-3 border-t border-border" suppressHydrationWarning>
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Home size={14} className="text-rose-500" />
                <span>2. Vị trí phòng ở cần trả</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" suppressHydrationWarning>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Khu KTX *
                  </label>
                  <select
                    value={form.ktx}
                    onChange={e => setForm({ ...form, ktx: e.target.value })}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer font-semibold"
                    suppressHydrationWarning
                  >
                    {ktxNames.length === 0 ? (
                      <option value="">-- Đang tải KTX --</option>
                    ) : (
                      ktxNames.map(ktx => (
                        <option key={ktx} value={ktx}>
                          {ktx}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Dãy nhà *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Dãy 1"
                    value={form.day}
                    onChange={e => setForm({ ...form, day: e.target.value })}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    suppressHydrationWarning
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1">
                    Phòng số *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="VD: 101"
                    value={form.phong_so}
                    onChange={e => setForm({ ...form, phong_so: e.target.value })}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                    suppressHydrationWarning
                  />
                </div>

                <div className="sm:col-span-3">
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

            {/* Reason & Handover Confirmation */}
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
                    className="rounded text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                    suppressHydrationWarning
                  />
                  <span>Đã nộp lại chìa khóa phòng cho Quản lý / Bảo vệ trực KTX</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.ban_giao_tai_san}
                    onChange={e => setForm({ ...form, ban_giao_tai_san: e.target.checked })}
                    className="rounded text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
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
