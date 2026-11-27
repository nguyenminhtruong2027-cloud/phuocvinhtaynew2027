'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  RotateCcw,
  Search,
  ShieldAlert,
  Loader2,
  UserPlus,
  Calendar,
  Building2,
  CreditCard,
  Phone,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Worker, removeAccents } from '@/data/workers';
import { createClient } from '@/lib/supabase/client';
import { fetchBlacklist, matchBlacklistInMemory, type BlacklistRecord } from '@/lib/disciplineService';
import { getVNDateString } from '@/lib/vnDate';
import { MonoChip, StatusTag } from '@/components/ui/StatusTag';

interface FormerWorkerEntry {
  key: string;
  hoVaTen: string;
  maNV: string;
  cccd: string;
  soDienThoai: string;
  donVi: string;
  tieuDoan: string;
  gioiTinh: string;
  ngaySinh: string;
  hoKhauTinh: string;
  toTruong: string;
  sdtToTruong: string;
  lastLocation: string;
  leftAt: string;
}

interface Props {
  activeWorkers: Worker[];
  onSelectReentry: (prefill: Partial<Worker>) => void;
  onClose: () => void;
}

export default function QuickReentryModal({ activeWorkers, onSelectReentry, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<FormerWorkerEntry[]>([]);
  const [blacklist, setBlacklist] = useState<BlacklistRecord[]>([]);
  const [query, setQuery] = useState('');
  const [blockedAlert, setBlockedAlert] = useState<{ entry: FormerWorkerEntry; reason: string } | null>(null);

  const activeCccdSet = useMemo(() => {
    const s = new Set<string>();
    activeWorkers.forEach(w => {
      if (!w.ngayRaKTX) {
        const digits = (w.cccd || '').replace(/\D/g, '');
        if (digits.length >= 9) s.add(digits);
      }
    });
    return s;
  }, [activeWorkers]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const supabase = createClient();
        const [delRes, blRes] = await Promise.all([
          supabase
            .from('worker_deletion_log')
            .select('*')
            .order('deleted_at', { ascending: false })
            .limit(300),
          fetchBlacklist().catch(() => ({ data: [] as BlacklistRecord[], tableMissing: true })),
        ]);

        if (!active) return;
        setBlacklist(blRes.data || []);

        const seen = new Map<string, FormerWorkerEntry>();

        // 1. From worker_deletion_log
        if (!delRes.error && Array.isArray(delRes.data)) {
          for (const row of delRes.data as Record<string, unknown>[]) {
            const name = String(row.ho_va_ten || row.full_name || '').trim();
            if (!name) continue;
            const cccd = String(row.cccd || row.id_card || '').trim();
            const maNV = String(row.ma_nv || row.worker_code || '').trim();
            const key = cccd.replace(/\D/g, '') || `${removeAccents(name).toLowerCase()}|${maNV.toLowerCase()}`;
            if (seen.has(key)) continue;

            const ktx = String(row.ktx || '').trim();
            const day = String(row.day || '').trim();
            const phong = String(row.phong_so || '').trim();
            const lastLocation = [ktx, day, phong ? `P.${phong}` : ''].filter(Boolean).join(' · ');

            seen.set(key, {
              key,
              hoVaTen: name,
              maNV,
              cccd,
              soDienThoai: String(row.so_dien_thoai || row.phone || '').trim(),
              donVi: String(row.don_vi || row.company || '').trim(),
              tieuDoan: String(row.tieu_doan || row.battalion || '').trim(),
              gioiTinh: String(row.gioi_tinh || row.gender || 'Nam').trim(),
              ngaySinh: String(row.ngay_sinh || row.birth_date || '').trim(),
              hoKhauTinh: String(row.ho_khau_tinh || row.hometown || '').trim(),
              toTruong: String(row.to_truong || row.team_leader || '').trim(),
              sdtToTruong: String(row.sdt_to_truong || row.team_leader_phone || '').trim(),
              lastLocation,
              leftAt: String(row.deleted_at || row.ngay_ra_ktx || '').slice(0, 10),
            });
          }
        }

        // 2. Also include soft-checked-out workers from workers list if any
        for (const w of activeWorkers) {
          if (!w.ngayRaKTX && !w.ghiChu?.includes('[Đã Check-out') && !w.ghiChu?.includes('[CHECKOUT]')) continue;
          const key =
            (w.cccd || '').replace(/\D/g, '') ||
            `${removeAccents(w.hoVaTen || '').toLowerCase()}|${(w.maNV || '').toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.set(key, {
            key,
            hoVaTen: w.hoVaTen,
            maNV: w.maNV || '',
            cccd: w.cccd || '',
            soDienThoai: w.soDienThoai || '',
            donVi: w.donVi || '',
            tieuDoan: w.tieuDoan || '',
            gioiTinh: w.gioiTinh || 'Nam',
            ngaySinh: w.ngaySinh || '',
            hoKhauTinh: w.hoKhauTinh || '',
            toTruong: w.toTruong || '',
            sdtToTruong: w.sdtToTruong || '',
            lastLocation: [w.ktx, w.day, w.phongSo ? `P.${w.phongSo}` : ''].filter(Boolean).join(' · '),
            leftAt: w.ngayRaKTX || '',
          });
        }

        setEntries(Array.from(seen.values()));
      } catch {
        toast.error('Không thể tải danh sách lịch sử công nhân đã rời KTX.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [activeWorkers]);

  const filtered = useMemo(() => {
    const q = removeAccents(query.trim()).toLowerCase();
    return entries.filter(e => {
      if (!q) return true;
      const hay = removeAccents(
        `${e.hoVaTen} ${e.cccd} ${e.maNV} ${e.soDienThoai} ${e.donVi} ${e.lastLocation}`
      ).toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query]);

  const handlePickEntry = (entry: FormerWorkerEntry) => {
    setBlockedAlert(null);
    const digits = entry.cccd.replace(/\D/g, '');
    if (digits.length >= 9 && activeCccdSet.has(digits)) {
      toast.warning(`${entry.hoVaTen} (CCCD ${entry.cccd}) hiện vẫn đang có tên trong danh sách đang ở KTX!`);
      return;
    }

    const blHit = matchBlacklistInMemory(blacklist, entry.cccd, entry.maNV);
    if (blHit.isBanned) {
      setBlockedAlert({
        entry,
        reason: `${blHit.reason || 'Thuộc danh sách cấm tái nhập'}${
          blHit.severity === 'permanent' ? ' (Cấm vĩnh viễn)' : blHit.bannedUntil ? ` (Đến ${blHit.bannedUntil})` : ''
        }`,
      });
      toast.error(`Chốt chặn an ninh: ${entry.hoVaTen} thuộc Danh sách Đen!`);
      return;
    }

    onSelectReentry({
      hoVaTen: entry.hoVaTen,
      maNV: entry.maNV,
      cccd: entry.cccd,
      soDienThoai: entry.soDienThoai,
      donVi: entry.donVi,
      tieuDoan: entry.tieuDoan,
      gioiTinh: entry.gioiTinh || 'Nam',
      ngaySinh: entry.ngaySinh,
      hoKhauTinh: entry.hoKhauTinh,
      toTruong: entry.toTruong,
      sdtToTruong: entry.sdtToTruong,
      ngayVaoKTX: getVNDateString(),
      ktx: '',
      day: '',
      phongSo: '',
      giuong: '',
      ghiChu: entry.leftAt ? `Tái nhập KTX (rời trước đó: ${entry.leftAt})` : 'Tái nhập KTX',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="surface-elevated rounded-t-3xl sm:rounded-2xl shadow-2xl border border-bdr3 w-full max-w-2xl max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden sheet-enter-bottom"
        onClick={e => e.stopPropagation()}
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-bdr2" />
        </div>

        <div className="px-5 py-3.5 border-b border-bdr flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-okbg text-ok border border-ok2/40 flex items-center justify-center shrink-0">
              <RotateCcw size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-tx truncate">Tái Nhập KTX 1 Chạm / Khôi Phục Check-out</h2>
              <p className="text-xs text-mu">
                Tự động điền sẵn hồ sơ cũ &amp; kiểm tra Danh sách Đen trước khi xếp phòng mới
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-mu hover:text-tx hover:bg-act cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-bdr bg-act/30 shrink-0 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Tìm công nhân đã rời KTX theo Họ tên, CCCD, Mã NV, Đơn vị..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-surf border border-bdr2 text-xs sm:text-sm text-tx focus:outline-none focus:border-pri2"
            />
          </div>

          {blockedAlert && (
            <div className="rounded-xl tint-dgr border border-dgr/45 px-3.5 py-2.5 flex items-start gap-2 text-xs">
              <ShieldAlert size={16} className="text-dgr shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-dgr">
                  CHẶN TÁI NHẬP: {blockedAlert.entry.hoVaTen} ({blockedAlert.entry.cccd || '—'})
                </div>
                <div className="text-tx/90 mt-0.5">Lý do Blacklist: {blockedAlert.reason}</div>
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto divide-y divide-bdr">
          {loading ? (
            <div className="py-14 flex flex-col items-center gap-2 text-mu text-xs">
              <Loader2 size={20} className="animate-spin text-pri2" />
              <span>Đang tải lịch sử công nhân đã rời KTX...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-14 text-center space-y-1.5 px-4">
              <CheckCircle2 size={28} className="mx-auto text-mu opacity-50" />
              <p className="text-sm font-bold text-tx">Không tìm thấy hồ sơ công nhân đã rời KTX</p>
              <p className="text-xs text-mu">
                Thử từ khóa khác hoặc bấm &ldquo;+ Thêm Công Nhân&rdquo; để tạo hồ sơ mới.
              </p>
            </div>
          ) : (
            filtered.slice(0, 60).map(entry => {
              const isAlreadyActive =
                entry.cccd.replace(/\D/g, '').length >= 9 && activeCccdSet.has(entry.cccd.replace(/\D/g, ''));
              const isBl = matchBlacklistInMemory(blacklist, entry.cccd, entry.maNV).isBanned;

              return (
                <div
                  key={entry.key}
                  className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-act/40 transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-tx">{entry.hoVaTen}</span>
                      {entry.maNV && <MonoChip>#{entry.maNV}</MonoChip>}
                      {isBl && <StatusTag tone="rose">Danh sách Đen</StatusTag>}
                      {isAlreadyActive && <StatusTag tone="teal">Đang ở KTX</StatusTag>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-mu font-tabular">
                      {entry.cccd && (
                        <span className="inline-flex items-center gap-1">
                          <CreditCard size={11} />
                          {entry.cccd}
                        </span>
                      )}
                      {entry.soDienThoai && (
                        <span className="inline-flex items-center gap-1">
                          <Phone size={11} />
                          {entry.soDienThoai}
                        </span>
                      )}
                      {entry.donVi && (
                        <span className="inline-flex items-center gap-1">
                          <Building2 size={11} />
                          {entry.donVi}
                        </span>
                      )}
                      {entry.leftAt && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar size={11} />
                          Rời: {entry.leftAt}
                        </span>
                      )}
                    </div>
                    {entry.lastLocation && (
                      <div className="text-[11px] text-mu">Phòng trước đây: {entry.lastLocation}</div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={isAlreadyActive}
                    onClick={() => handlePickEntry(entry)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      isBl
                        ? 'tint-dgr border border-dgr/40 text-dgr'
                        : 'btn-glow-primary'
                    }`}
                  >
                    <UserPlus size={13} />
                    <span>{isBl ? 'Kiểm tra' : 'Tái nhập'}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-bdr bg-surf flex items-center justify-between text-xs text-mu shrink-0">
          <span>Hiển thị tối đa 60 hồ sơ rời KTX gần nhất</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-bdr2 bg-surf hover:bg-act text-tx font-semibold cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
