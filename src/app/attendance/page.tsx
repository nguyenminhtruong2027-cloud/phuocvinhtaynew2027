'use client';
import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle2, AlertCircle, Loader2, QrCode, User, Hash, MapPin } from 'lucide-react';

interface SessionInfo {
  id: string;
  session_date: string;
  is_active: boolean;
  zone_ktx: string;
  zone_day: string;
  zone_phong: string;
}

interface WorkerInfo {
  ho_va_ten: string;
  ktx: string;
  day: string;
  phong_so: string;
}

type PageState = 'form' | 'submitting' | 'success' | 'error' | 'session_closed' | 'already_checked_in';

export default function AttendancePage() {
  const [sessionDate, setSessionDate] = useState<string>('');
  const [zoneKtx, setZoneKtx] = useState<string>('');
  const [zoneDay, setZoneDay] = useState<string>('');
  const [zonePhong, setZonePhong] = useState<string>('');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [hoVaTen, setHoVaTen] = useState('');
  const [maNv, setMaNv] = useState('');
  const [pageState, setPageState] = useState<PageState>('form');
  const [errorMsg, setErrorMsg] = useState('');
  const [workerInfo, setWorkerInfo] = useState<WorkerInfo | null>(null);
  const [checkedInTime, setCheckedInTime] = useState('');
  const [alreadyCheckedInTime, setAlreadyCheckedInTime] = useState('');

  const supabase = createClient();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const dateParam = params.get('date') || new Date().toISOString().slice(0, 10);
      setSessionDate(dateParam);
      setZoneKtx(params.get('ktx') || '');
      setZoneDay(params.get('day') || '');
      setZonePhong(params.get('phong') || '');
    }
  }, []);

  useEffect(() => {
    if (!sessionDate) return;
    const load = async () => {
      setSessionLoading(true);
      try {
        const { data, error } = await supabase
          .from('attendance_sessions')
          .select('id, session_date, is_active, zone_ktx, zone_day, zone_phong')
          .eq('session_date', sessionDate)
          .eq('zone_ktx', zoneKtx)
          .eq('zone_day', zoneDay)
          .eq('zone_phong', zonePhong)
          .maybeSingle();
        if (!error && data) setSession(data as SessionInfo);
        else setSession(null);
      } catch {
        setSession(null);
      } finally {
        setSessionLoading(false);
      }
    };
    load();
  }, [sessionDate, zoneKtx, zoneDay, zonePhong]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hoVaTen.trim() || !maNv.trim()) return;
    if (!session?.is_active) { setPageState('session_closed'); return; }
    setPageState('submitting');
    try {
      let wInfo: WorkerInfo = { ho_va_ten: hoVaTen.trim(), ktx: '', day: '', phong_so: '' };
      const { data: worker } = await supabase
        .from('workers')
        .select('ho_va_ten, ktx, day, phong_so')
        .eq('ma_nv', maNv.trim())
        .maybeSingle();
      if (worker) {
        wInfo = {
          ho_va_ten: worker.ho_va_ten || hoVaTen.trim(),
          ktx: worker.ktx || '',
          day: worker.day || '',
          phong_so: worker.phong_so || '',
        };
      }

      // Feature 5: Check for duplicate check-in
      const { data: existingRecord } = await supabase
        .from('attendance_records')
        .select('id, checked_in_at, status')
        .eq('session_id', session.id)
        .eq('ma_nv', maNv.trim())
        .in('status', ['present', 'excused'])
        .maybeSingle();

      if (existingRecord) {
        setAlreadyCheckedInTime(new Date(existingRecord.checked_in_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
        setWorkerInfo(wInfo);
        setPageState('already_checked_in');
        return;
      }

      const now = new Date().toISOString();
      const { error: upsertErr } = await supabase
        .from('attendance_records')
        .upsert(
          {
            session_id: session.id,
            session_date: session.session_date,
            ma_nv: maNv.trim(),
            ho_va_ten: wInfo.ho_va_ten,
            ktx: wInfo.ktx,
            day: wInfo.day,
            phong_so: wInfo.phong_so,
            status: 'present',
            checked_in_at: now,
          },
          { onConflict: 'session_id,ma_nv' }
        );
      if (upsertErr) { setErrorMsg(upsertErr.message); setPageState('error'); return; }
      setWorkerInfo(wInfo);
      setCheckedInTime(new Date(now).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
      setPageState('success');
    } catch (err: any) {
      setErrorMsg(err.message || 'Có lỗi xảy ra');
      setPageState('error');
    }
  };

  const zoneLabel = [
    zoneKtx,
    zoneDay ? `Dãy ${zoneDay}` : '',
    zonePhong ? `Phòng ${zonePhong}` : '',
  ].filter(Boolean).join(' — ') || 'Toàn KTX';

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="animate-spin text-ok" />
          <p className="text-base text-mu font-medium">Đang tải...</p>
        </div>
      </div>
    );
  }

  // ─── No session ───────────────────────────────────────────────────────────
  if (!sessionDate || !session) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-5">
        <div className="bg-surf rounded-3xl shadow-xl p-8 w-full max-w-sm text-center space-y-5">
          <div className="w-20 h-20 tint-wn rounded-full flex items-center justify-center mx-auto">
            <AlertCircle size={40} className="text-wn" />
          </div>
          <h2 className="text-xl font-bold text-tx">Chưa có phiên điểm danh</h2>
          <p className="text-base text-ic leading-relaxed">
            Phiên điểm danh ngày <strong>{sessionDate}</strong>
            {zoneLabel !== 'Toàn KTX' && <> ({zoneLabel})</>} chưa được mở.
          </p>
          <p className="text-sm text-mu">Vui lòng liên hệ ban quản lý.</p>
        </div>
      </div>
    );
  }

  // ─── Session closed ───────────────────────────────────────────────────────
  if (!session.is_active || pageState === 'session_closed') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-5">
        <div className="bg-surf rounded-3xl shadow-xl p-8 w-full max-w-sm text-center space-y-5">
          <div className="w-20 h-20 bg-act rounded-full flex items-center justify-center mx-auto">
            <QrCode size={40} className="text-mu" />
          </div>
          <h2 className="text-xl font-bold text-tx">Phiên điểm danh đã đóng</h2>
          <p className="text-base text-ic leading-relaxed">
            Phiên ngày <strong>{session.session_date}</strong> ({zoneLabel}) đã kết thúc.
          </p>
          <p className="text-sm text-mu">Liên hệ ban quản lý nếu cần hỗ trợ.</p>
        </div>
      </div>
    );
  }

  // ─── Error ────────────────────────────────────────────────────────────────
  if (pageState === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-rose-50 flex items-center justify-center p-5">
        <div className="bg-surf rounded-3xl shadow-xl p-8 w-full max-w-sm text-center space-y-5">
          <div className="w-20 h-20 bg-dgrbg rounded-full flex items-center justify-center mx-auto">
            <AlertCircle size={40} className="text-dgr" />
          </div>
          <h2 className="text-2xl font-bold text-tx">Có lỗi xảy ra</h2>
          <p className="text-base text-mu">{errorMsg || 'Vui lòng thử lại.'}</p>
          <button
            onClick={() => setPageState('form')}
            className="w-full py-4 bg-dgr text-tx rounded-2xl text-lg font-semibold hover:bg-red-700 active:scale-95 transition-all"
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  // ─── Success ──────────────────────────────────────────────────────────────
  if (pageState === 'success' && workerInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center p-5">
        <div className="bg-surf rounded-3xl shadow-2xl p-8 w-full max-w-sm text-center space-y-6">
          <div className="w-24 h-24 bg-okbg rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={52} className="text-ok" />
          </div>
          <div>
            <h2 className="text-3xl font-bold text-tx">Điểm danh thành công!</h2>
            <p className="text-base text-ic mt-1">Ngày {session.session_date}</p>
          </div>
          <div className="bg-okbg border border-bdr2 rounded-2xl p-5 text-left space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-okbg rounded-full flex items-center justify-center flex-shrink-0">
                <User size={18} className="text-ok" />
              </div>
              <div>
                <p className="text-xs text-ic font-medium uppercase tracking-wide">Họ và tên</p>
                <p className="text-lg font-bold text-tx mt-0.5">{workerInfo.ho_va_ten}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-okbg rounded-full flex items-center justify-center flex-shrink-0">
                <Hash size={18} className="text-ok" />
              </div>
              <div>
                <p className="text-xs text-ic font-medium uppercase tracking-wide">Mã nhân viên</p>
                <p className="text-lg font-bold text-tx font-mono mt-0.5">{maNv}</p>
              </div>
            </div>
            {(workerInfo.ktx || workerInfo.day || workerInfo.phong_so) && (
              <div className="flex items-start gap-3 pt-3 border-t border-bdr2">
                <div className="w-10 h-10 bg-okbg rounded-full flex items-center justify-center flex-shrink-0">
                  <MapPin size={18} className="text-ok" />
                </div>
                <div>
                  <p className="text-xs text-ic font-medium uppercase tracking-wide">Thông tin phòng</p>
                  <p className="text-base font-semibold text-tx mt-0.5">
                    {[workerInfo.ktx, workerInfo.day ? `Dãy ${workerInfo.day}` : '', workerInfo.phong_so ? `Phòng ${workerInfo.phong_so}` : ''].filter(Boolean).join(' — ')}
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="bg-ok2 text-tx rounded-2xl px-5 py-4">
            <p className="text-lg font-bold">✓ Đã ghi nhận lúc {checkedInTime}</p>
          </div>
          <button
            onClick={() => { setPageState('form'); setMaNv(''); setHoVaTen(''); }}
            className="w-full py-4 border-2 border-ok2 text-ok rounded-2xl text-base font-semibold hover:bg-okbg active:scale-95 transition-all"
          >
            Điểm danh người khác
          </button>
        </div>
      </div>
    );
  }

  // ─── Already checked in ───────────────────────────────────────────────────
  if (pageState === 'already_checked_in' && workerInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center p-5">
        <div className="bg-surf rounded-3xl shadow-xl p-8 w-full max-w-sm text-center space-y-5">
          <div className="w-20 h-20 tint-wn rounded-full flex items-center justify-center mx-auto">
            <AlertCircle size={40} className="text-wn" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-tx">Đã điểm danh rồi!</h2>
            <p className="text-base text-ic mt-1">Ngày {session?.session_date}</p>
          </div>
          <div className="tint-wn border border-wn rounded-2xl p-5 text-left space-y-3">
            <div>
              <p className="text-xs text-ic font-medium uppercase tracking-wide">Họ và tên</p>
              <p className="text-lg font-bold text-tx mt-0.5">{workerInfo.ho_va_ten}</p>
            </div>
            <div>
              <p className="text-xs text-ic font-medium uppercase tracking-wide">Mã nhân viên</p>
              <p className="text-base font-bold text-tx font-mono mt-0.5">{maNv}</p>
            </div>
            <div className="pt-3 border-t border-wn">
              <p className="text-sm text-wn font-semibold">
                ⚠ Bạn đã được ghi nhận điểm danh lúc <strong>{alreadyCheckedInTime}</strong> hôm nay.
              </p>
              <p className="text-xs text-ic mt-1">Không thể điểm danh lại trong cùng một phiên.</p>
            </div>
          </div>
          <button
            onClick={() => { setPageState('form'); setMaNv(''); setHoVaTen(''); }}
            className="w-full py-4 border-2 border-wn text-wn rounded-2xl text-base font-semibold hover:tint-wn active:scale-95 transition-all"
          >
            Điểm danh người khác
          </button>
        </div>
      </div>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-100 flex items-center justify-center p-4">
      <div className="bg-surf rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-8 text-center text-tx">
          <div className="w-20 h-20 bg-surf/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <QrCode size={40} className="text-tx" />
          </div>
          <h1 className="text-2xl font-bold">Điểm Danh</h1>
          <p className="text-emerald-100 mt-1 text-base">Ngày {sessionDate}</p>
          {(zoneKtx || zoneDay || zonePhong) && (
            <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-surf/20 rounded-full text-sm font-medium">
              <MapPin size={13} />
              {zoneLabel}
            </div>
          )}
          <div className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-surf/20 rounded-full text-sm font-semibold">
            <div className="w-2.5 h-2.5 bg-surf rounded-full animate-pulse" />
            Phiên đang mở
          </div>
        </div>

        {/* Form body */}
        <div className="px-6 py-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-base font-semibold text-mu mb-2">
                Họ và tên <span className="text-dgr">*</span>
              </label>
              <input
                type="text"
                value={hoVaTen}
                onChange={e => setHoVaTen(e.target.value)}
                placeholder="Nhập họ và tên đầy đủ"
                required
                autoComplete="name"
                className="w-full px-4 py-4 border-2 border-bdr rounded-2xl text-base focus:outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 transition-all placeholder:text-mu"
              />
            </div>
            <div>
              <label className="block text-base font-semibold text-mu mb-2">
                Mã nhân viên <span className="text-dgr">*</span>
              </label>
              <input
                type="text"
                value={maNv}
                onChange={e => setMaNv(e.target.value)}
                placeholder="Nhập mã nhân viên"
                required
                autoComplete="off"
                inputMode="text"
                className="w-full px-4 py-4 border-2 border-bdr rounded-2xl text-base font-mono focus:outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 transition-all placeholder:text-mu"
              />
            </div>
            <button
              type="submit"
              disabled={pageState === 'submitting' || !hoVaTen.trim() || !maNv.trim()}
              className="w-full py-5 bg-ok2 text-tx rounded-2xl text-lg font-bold hover:bg-emerald-700 disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-200 mt-2"
            >
              {pageState === 'submitting' ? (
                <><Loader2 size={22} className="animate-spin" /> Đang xử lý...</>
              ) : (
                <><CheckCircle2 size={22} /> Xác nhận điểm danh</>
              )}
            </button>
          </form>
          <p className="text-center text-xs text-mu mt-5">
            Hệ thống KTX Manager — Điểm danh tự động
          </p>
        </div>
      </div>
    </div>
  );
}
