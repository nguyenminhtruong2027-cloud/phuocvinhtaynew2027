'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Wrench,
  QrCode,
  Copy,
  Download,
  Printer,
  ExternalLink,
  Loader2,
  Building2,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useKtxStructure } from '@/lib/ktxStructure';
import {
  FacilityItem,
  fetchFacilitiesList,
  formatRoomDisplay,
  normalizeRoomLabel,
} from '@/lib/facilityCapacity';
import { buildRoomIssueQrUrl } from '@/lib/maintenanceTickets';
import { naturalSortCompare } from '@/data/workers';
import { QrCodeImage, downloadQrPng } from '@/components/QrCodeImage';
import { PosterPaperSize, printQrBulletinPoster } from '@/lib/qrPosterPrint';

export default function RoomIssueQrPortalTab() {
  const { ktxGroups } = useKtxStructure();
  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [selectedKtx, setSelectedKtx] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedRoom, setSelectedRoom] = useState('');
  const [paperSize, setPaperSize] = useState<PosterPaperSize>('A5');
  const [printing, setPrinting] = useState(false);

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
    return Array.from(set).sort(naturalSortCompare);
  }, [ktxGroups, facilities]);

  useEffect(() => {
    if (!selectedKtx && ktxOptions.length > 0) setSelectedKtx(ktxOptions[0]);
  }, [selectedKtx, ktxOptions]);

  const dayOptions = useMemo(() => {
    const set = new Set<string>();
    ktxGroups.find(g => g.ktx === selectedKtx)?.days.forEach(d => set.add(d));
    facilities
      .filter(f => !selectedKtx || f.ktx === selectedKtx)
      .forEach(f => {
        if (f.day) set.add(f.day);
      });
    return Array.from(set).sort(naturalSortCompare);
  }, [ktxGroups, facilities, selectedKtx]);

  useEffect(() => {
    if (!selectedDay && dayOptions.length > 0) setSelectedDay(dayOptions[0]);
  }, [selectedDay, dayOptions]);

  const roomOptions = useMemo(() => {
    const set = new Set<string>();
    facilities
      .filter(f => (!selectedKtx || f.ktx === selectedKtx) && (!selectedDay || f.day === selectedDay))
      .forEach(f => {
        const norm = normalizeRoomLabel(f.phong_khu_vuc);
        if (norm) set.add(norm);
      });
    return Array.from(set).sort(naturalSortCompare);
  }, [facilities, selectedKtx, selectedDay]);

  useEffect(() => {
    if (!selectedRoom && roomOptions.length > 0) setSelectedRoom(roomOptions[0]);
  }, [selectedRoom, roomOptions]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const qrUrl = useMemo(
    () => buildRoomIssueQrUrl(origin, selectedKtx, selectedDay, selectedRoom),
    [origin, selectedKtx, selectedDay, selectedRoom]
  );

  const handlePrintPoster = async () => {
    if (!selectedKtx || !selectedDay || !selectedRoom) {
      toast.error('Vui lòng chọn KTX, Dãy và Phòng cần in mã QR.');
      return;
    }
    setPrinting(true);
    try {
      const ok = await printQrBulletinPoster({
        url: qrUrl,
        paperSize,
        badgeText: 'KỸ THUẬT & BẢO TRÌ KTX',
        title: `QUÉT QR BÁO HỎNG — ${selectedDay.toUpperCase()} · ${formatRoomDisplay(selectedRoom).toUpperCase()}`,
        subtitle: 'Điều hòa · Quạt · Đèn điện · Nước · Giường tủ · Khóa cửa',
        accentHex: '#b45309',
        steps: [
          { title: 'Mở Zalo hoặc Camera điện thoại', detail: 'Quét mã QR dán trên cửa phòng này.' },
          { title: 'Chọn thiết bị gặp sự cố', detail: 'Phòng của bạn đã điền sẵn, không cần đăng nhập.' },
          { title: 'Nhấn Gửi báo hỏng', detail: 'Tổ Kỹ thuật nhận thông báo ngay và xử lý nhanh.' },
        ],
        footerNote: `${selectedKtx} — ${selectedDay} — ${formatRoomDisplay(selectedRoom)} · Tổ Kỹ thuật KTX`,
        metaLine: qrUrl,
      });
      if (!ok) toast.error('Không thể tạo bản in poster QR.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-bdr">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-500 flex items-center justify-center shrink-0">
            <Wrench size={20} />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold text-tx">Mã QR Báo Hỏng Cửa Phòng</h1>
            <p className="text-xs text-mu mt-0.5">
              Tạo và in tem QR dán cửa từng phòng để công nhân báo hỏng thiết bị trong 10 giây
            </p>
          </div>
        </div>
        <Link
          href="/maintenance"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-pri hover:bg-pri2 text-white text-xs font-bold shadow-sm transition-colors self-start sm:self-auto"
        >
          <Wrench size={14} />
          <span>Mở Trung Tâm Kỹ Thuật & Bảo Trì</span>
          <ExternalLink size={13} />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Controls */}
        <div className="lg:col-span-7 rounded-2xl bg-surf border border-bdr2 p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-mu">
            <Building2 size={14} className="text-lnk" />
            <span>Chọn phòng cần tạo mã QR dán cửa</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-mu block mb-1">Khu KTX</label>
              <select
                value={selectedKtx}
                onChange={e => {
                  setSelectedKtx(e.target.value);
                  setSelectedDay('');
                  setSelectedRoom('');
                }}
                className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-sm text-tx"
              >
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
                value={selectedDay}
                onChange={e => {
                  setSelectedDay(e.target.value);
                  setSelectedRoom('');
                }}
                className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-sm text-tx"
              >
                {dayOptions.map(d => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-mu block mb-1">Số phòng</label>
              <select
                value={selectedRoom}
                onChange={e => setSelectedRoom(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-page border border-bdr2 text-sm text-tx"
              >
                {roomOptions.map(r => (
                  <option key={r} value={r}>
                    {formatRoomDisplay(r)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl bg-page border border-bdr p-4 space-y-2 text-xs text-mu">
            <p className="font-bold text-tx flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-ok" />
              <span>Quy trình vận hành khép kín:</span>
            </p>
            <ul className="space-y-1 pl-5 list-disc">
              <li>Công nhân quét mã QR tại cửa phòng bằng Zalo/Camera — không cần đăng nhập.</li>
              <li>Hệ thống tự điền sẵn Khu KTX, Dãy và Số phòng, gửi thẳng phiếu đến tài khoản Kỹ thuật viên.</li>
              <li>Phòng có phiếu chưa xử lý sẽ tự động bật cảnh báo trên Bản đồ 3D KTX (chế độ Bảo trì).</li>
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(qrUrl);
                  toast.success('Đã sao chép đường dẫn báo hỏng!');
                } catch {
                  toast.error('Không thể sao chép.');
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-act hover:bg-bdg border border-bdr2 text-xs font-bold text-tx cursor-pointer"
            >
              <Copy size={14} />
              <span>Sao chép link</span>
            </button>

            <button
              type="button"
              onClick={() =>
                downloadQrPng(qrUrl, `QR_BaoHong_${selectedDay}_${selectedRoom}.png`.replace(/\s+/g, '_'))
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-act hover:bg-bdg border border-bdr2 text-xs font-bold text-tx cursor-pointer"
            >
              <Download size={14} />
              <span>Tải PNG</span>
            </button>

            <select
              value={paperSize}
              onChange={e => setPaperSize(e.target.value as PosterPaperSize)}
              className="px-2.5 py-2 rounded-xl bg-page border border-bdr2 text-xs font-semibold text-tx"
            >
              <option value="A5">Khổ A5 (Dán cửa)</option>
              <option value="A4">Khổ A4 (Bảng tin)</option>
            </select>

            <button
              type="button"
              disabled={printing}
              onClick={() => void handlePrintPoster()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-pri hover:bg-pri2 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
            >
              {printing ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
              <span>In Poster QR</span>
            </button>
          </div>
        </div>

        {/* Right QR Preview Card */}
        <div className="lg:col-span-5 rounded-2xl bg-surf border border-bdr2 p-5 flex flex-col items-center justify-center text-center gap-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-500 border border-amber-500/30 text-[11px] font-bold">
            <QrCode size={13} />
            <span>BÁO HỎNG THIẾT BỊ PHÒNG</span>
          </div>
          <div className="bg-white p-3.5 rounded-2xl shadow-md">
            <QrCodeImage value={qrUrl} size={200} className="w-48 h-48 object-contain" />
          </div>
          <div>
            <p className="text-base font-extrabold text-tx">
              {selectedDay || '—'} · {selectedRoom ? formatRoomDisplay(selectedRoom) : '—'}
            </p>
            <p className="text-xs text-mu">{selectedKtx}</p>
            <p className="text-[11px] text-mu break-all mt-1.5 max-w-xs">{qrUrl}</p>
          </div>
          <Link
            href={qrUrl.replace(origin, '') || '/report-issue'}
            target="_blank"
            className="inline-flex items-center gap-1 text-xs font-semibold text-lnk hover:underline"
          >
            <span>Mở thử trang báo hỏng</span>
            <ExternalLink size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}
