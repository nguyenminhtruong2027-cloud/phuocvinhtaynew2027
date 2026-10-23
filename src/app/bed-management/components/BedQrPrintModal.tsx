'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { X, Printer, Loader2, QrCode, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { compareKtxNames } from '@/data/workers';

interface PrintBedRow {
  id: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong: string;
  status: 'empty' | 'occupied' | 'maintenance';
  ma_nv: string | null;
  ho_va_ten: string | null;
}

const QR_BASE = 'https://phuocvinhtaynew2027.vercel.app/qr-portal?tab=bed_inspect&bed_qr=';
const QR_IMG = 'https://api.qrserver.com/v1/create-qr-code/';

function bedQrUrl(bed: PrintBedRow): string {
  const data = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bed?.id || '')
    ? bed.id
    : encodeURIComponent([bed?.ktx, bed?.day, bed?.phong_so, bed?.giuong].filter(Boolean).join('|'));
  return `${QR_BASE}${data}`;
}

function qrImageSrc(bed: PrintBedRow): string {
  return `${QR_IMG}?size=240x240&data=${encodeURIComponent(bedQrUrl(bed))}&margin=6&color=0B0F17&bgcolor=FFFFFF`;
}

/** Print-only CSS: chỉ hiển thị khu vực tem, khổ tem nhãn 5×8cm. */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 8mm; }
  body * { visibility: hidden !important; }
  .qr-print-area, .qr-print-area * { visibility: visible !important; }
  .qr-print-area {
    position: absolute !important;
    top: 0; left: 0; width: 100%;
    display: grid !important;
    grid-template-columns: repeat(2, 5cm);
    gap: 4mm;
  }
  .qr-label {
    width: 5cm !important; height: 8cm !important;
    break-inside: avoid; page-break-inside: avoid;
    box-shadow: none !important;
  }
  .no-print { display: none !important; }
}
`;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Khi đặt, modal chỉ in tem của đúng giường này (dùng cho /qr-portal). */
  lockedBed?: PrintBedRow | null;
}

export default function BedQrPrintModal({ open, onClose, lockedBed = null }: Props) {
  const [beds, setBeds] = useState<PrintBedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [scopeKtx, setScopeKtx] = useState('');
  const [scopeDay, setScopeDay] = useState('');
  const [scopeRoom, setScopeRoom] = useState('');
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const loadBeds = useCallback(async () => {
    setLoading(true);
    try {
      const rows: PrintBedRow[] = [];
      let from = 0;
      for (let page = 0; page < 30; page++) {
        try {
          const { data, error } = await supabase
            .from('beds')
            .select('id, ktx, day, phong_so, giuong, status, ma_nv, ho_va_ten')
            .range(from, from + 999);
          if (error) {
            console.warn('[qr-print] load beds error:', error.message);
            break;
          }
          const list = (data ?? []) as Record<string, unknown>[];
          rows.push(...list.map((r, i) => ({
            id: String(r?.id ?? `bed-${i}`),
            ktx: String(r?.ktx ?? ''),
            day: String(r?.day ?? ''),
            phong_so: String(r?.phong_so ?? ''),
            giuong: String(r?.giuong ?? ''),
            status: r?.status === 'occupied' ? 'occupied' as const : r?.status === 'maintenance' ? 'maintenance' as const : 'empty' as const,
            ma_nv: r?.ma_nv ? String(r.ma_nv) : null,
            ho_va_ten: r?.ho_va_ten ? String(r.ho_va_ten) : null,
          })));
          if (list.length < 1000) break;
          from += 1000;
        } catch (err) {
          console.warn('[qr-print] load beds failed:', err);
          break;
        }
      }
      // Only real rows (ktx/day/phong/giuong đầy đủ)
      setBeds(rows.filter(b =>
        b.ktx?.trim() && b.day?.trim() && b.phong_so?.trim() && b.giuong?.trim()
      ));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    if (lockedBed) {
      setBeds(lockedBed ? [lockedBed] : []);
      setLoading(false);
      return;
    }
    loadBeds();
  }, [open, lockedBed, loadBeds]);

  useEffect(() => {
    if (open) setScopeKtx(lockedBed ? (lockedBed.ktx || '') : '');
    setScopeDay(lockedBed ? (lockedBed.day || '') : '');
    setScopeRoom(lockedBed ? (lockedBed.phong_so || '') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lockedBed]);

  const ktxList = useMemo(
    () => [...new Set((beds || []).map(b => b?.ktx?.trim()).filter(Boolean) as string[])].sort(compareKtxNames),
    [beds]
  );
  const dayList = useMemo(
    () =>
      [...new Set(
        (beds || []).filter(b => !scopeKtx || b.ktx === scopeKtx).map(b => b?.day?.trim()).filter(Boolean) as string[]
      )].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true })),
    [beds, scopeKtx]
  );
  const roomList = useMemo(
    () =>
      [...new Set(
        (beds || [])
          .filter(b => (!scopeKtx || b.ktx === scopeKtx) && (!scopeDay || b.day === scopeDay))
          .map(b => b?.phong_so?.trim())
          .filter(Boolean) as string[]
      )].sort((a, b) => {
        const na = parseInt(a, 10);
        const nb = parseInt(b, 10);
        return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b, 'vi', { numeric: true });
      }),
    [beds, scopeKtx, scopeDay]
  );

  const labelBeds = useMemo(() => {
    if (lockedBed) return lockedBed ? [lockedBed] : [];
    return (beds || []).filter(b => {
      if (scopeKtx && b.ktx !== scopeKtx) return false;
      if (scopeDay && b.day !== scopeDay) return false;
      if (scopeRoom && b.phong_so !== scopeRoom) return false;
      return true;
    });
  }, [beds, scopeKtx, scopeDay, scopeRoom, lockedBed]);

  if (!open) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4" onClick={onClose}>
        <div
          className="bg-[#131B2E] border border-slate-800/80 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-4xl flex flex-col max-h-[92vh]"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/80 no-print">
            <div className="min-w-0">
              <h3 className="font-extrabold text-white flex items-center gap-2">
                <QrCode size={17} className="text-cyan-400" /> 🖨️ In Tem Mã QR Giường
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                {lockedBed ? 'Tem cho giường đang xem trong Kiểm Tra Giường' : `Căn tem nhãn 5×8 cm — ${labelBeds.length} tem`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-900/80 text-slate-400 hover:text-white shrink-0"><X size={16} /></button>
          </div>

          {/* Scope pickers */}
          {!lockedBed && (
            <div className="px-5 pt-4 flex flex-wrap gap-3 items-end no-print">
              <div>
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">KTX</label>
                <select
                  value={scopeKtx}
                  onChange={e => { setScopeKtx(e.target.value); setScopeDay(''); setScopeRoom(''); }}
                  className="mt-1 block bg-slate-900/80 border border-slate-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold min-w-[130px] cursor-pointer"
                >
                  <option value="">Toàn bộ KTX</option>
                  {ktxList.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Dãy</label>
                <select
                  value={scopeDay}
                  onChange={e => { setScopeDay(e.target.value); setScopeRoom(''); }}
                  disabled={!scopeKtx}
                  className="mt-1 block bg-slate-900/80 border border-slate-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold min-w-[120px] cursor-pointer disabled:opacity-40"
                >
                  <option value="">Tất cả dãy</option>
                  {dayList.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">In theo Phòng</label>
                <select
                  value={scopeRoom}
                  onChange={e => setScopeRoom(e.target.value)}
                  disabled={!scopeKtx || !scopeDay}
                  className="mt-1 block bg-slate-900/80 border border-slate-700 text-gray-100 rounded-xl px-3 py-2 text-sm font-semibold min-w-[120px] cursor-pointer disabled:opacity-40"
                >
                  <option value="">Tất cả phòng</option>
                  {roomList.map(r => <option key={r} value={r}>Phòng {r}</option>)}
                </select>
              </div>
              <button
                onClick={() => window.print()}
                className="ml-auto flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#0B0F17] text-sm font-extrabold transition-colors"
                title="In ngay (Ctrl+P)"
              >
                <Printer size={15} /> In ngay (Ctrl+P)
              </button>
            </div>
          )}

          {/* Print button cho lockedBed (qr-portal) */}
          {lockedBed && (
            <div className="px-5 pt-4 flex justify-end no-print">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-[#0B0F17] text-sm font-extrabold transition-colors"
              >
                <Printer size={15} /> In ngay (Ctrl+P)
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex-1 flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-cyan-400" />
            </div>
          ) : labelBeds.length === 0 ? (
            <div className="m-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-center gap-2 no-print">
              <AlertCircle size={15} className="text-amber-300 shrink-0" />
              <p className="text-xs text-amber-200">Không có giường nào khớp phạm vi in. Kiểm tra dữ liệu bảng <code>beds</code>.</p>
            </div>
          ) : (
            <>
              {/* Preview (màn hình) */}
              <div className="flex-1 overflow-y-auto px-5 py-4 no-print">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {labelBeds.map(bed => (
                    <label key={bed?.id} className="qr-label block rounded-xl border border-slate-700 bg-white p-2.5 text-[#0B0F17] shadow-lg aspect-[5/8] flex flex-col overflow-hidden">
                      <p className="text-[9px] font-bold text-center text-slate-600 uppercase tracking-wider">KTX Phước Vĩnh Tây</p>
                      <div className="flex-1 min-h-0 flex items-center justify-center">
                        <img src={qrImageSrc(bed)} alt={`QR giường ${bed?.ktx} ${bed?.day} P${bed?.phong_so} G${bed?.giuong}`} className="w-full h-full object-contain" />
                      </div>
                      <div className="space-y-0.5 text-center">
                        <p className="text-[10px] font-extrabold truncate">{[bed?.ktx, bed?.day].filter(Boolean).join(' · ')}</p>
                        <p className="text-[10px] font-extrabold truncate text-cyan-700">Phòng {bed?.phong_so || '—'} · Giường {bed?.giuong || '—'}</p>
                        <p className="text-[10px] font-bold truncate">
                          {bed?.status === 'occupied'
                            ? (bed?.ho_va_ten || bed?.ma_nv || 'Đã ở')
                            : (bed?.status === 'maintenance' ? 'Đang bảo trì' : '(Giường trống)')}
                        </p>
                        <p className="text-[7px] text-slate-500 font-mono truncate">Scan: Giường ID…</p>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-slate-400 text-center no-print">
                  💡 Mẹo: tem đã căn khổ 5×8 cm. Bấm <b>In ngay</b> hoặc <b>Ctrl+P</b> — chọn khổ giấy A4, tắt Header/Footer khi in.
                </p>
              </div>

              {/* Print area: chỉ tem được in với khổ thật 5×8 cm */}
              <div className="qr-print-area hidden">
                {labelBeds.map(bed => (
                  <div key={`print-${bed?.id}`} className="qr-label bg-white text-[#0B0F17] p-3 flex flex-col">
                    <p className="text-center text-xs font-extrabold uppercase tracking-wider">KTX Phước Vĩnh Tây</p>
                    <div className="flex-1 min-h-0 flex items-center justify-center py-1">
                      <img src={qrImageSrc(bed)} alt="QR" className="w-full h-full object-contain" />
                    </div>
                    <div className="space-y-0.5 text-center">
                      <p className="text-sm font-extrabold">{[bed?.ktx, bed?.day].filter(Boolean).join(' · ')}</p>
                      <p className="text-sm font-extrabold text-cyan-700">Phòng {bed?.phong_so || '—'} · Giường {bed?.giuong || '—'}</p>
                      <p className="text-base font-extrabold">
                        {bed?.status === 'occupied'
                          ? (bed?.ho_va_ten || bed?.ma_nv || '')
                          : (bed?.status === 'maintenance' ? 'Đang bảo trì' : '(Giường trống)')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
