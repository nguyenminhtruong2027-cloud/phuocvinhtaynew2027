'use client';

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { X, Printer, Loader2, QrCode, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { compareKtxNames } from '@/data/workers';
import { QrCodeImage, generateQrDataUrl } from '@/components/QrCodeImage';
import { printHtmlViaIframe, escapeHtml } from '@/lib/printHtml';
import { deduplicateBedRows, normalizeBedLabel } from '@/lib/bedSync';
import { extractRoomNumber } from '@/lib/facilityCapacity';

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

function bedQrUrl(bed: PrintBedRow): string {
  const data = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bed?.id || '')
    ? bed.id
    : encodeURIComponent([bed?.ktx, bed?.day, bed?.phong_so, bed?.giuong].filter(Boolean).join('|'));
  return `${QR_BASE}${data}`;
}

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
      const byId = new Map<string, PrintBedRow>();
      let from = 0;
      for (let page = 0; page < 30; page++) {
        try {
          const { data, error } = await supabase
            .from('beds')
            .select('id, ktx, day, phong_so, giuong, status, ma_nv, ho_va_ten')
            .order('id', { ascending: true })
            .range(from, from + 999);
          if (error) {
            console.warn('[qr-print] load beds error:', error.message);
            break;
          }
          const list = (data ?? []) as Record<string, unknown>[];
          list.forEach((r, i) => {
            const id = String(r?.id ?? `bed-${from}-${i}`);
            const rawRoom = String(r?.phong_so ?? '').trim();
            const rawBed = String(r?.giuong ?? '').trim();
            byId.set(id, {
              id,
              ktx: String(r?.ktx ?? '').trim(),
              day: String(r?.day ?? '').trim(),
              phong_so: extractRoomNumber(rawRoom) || rawRoom,
              giuong: normalizeBedLabel(rawBed) || rawBed,
              status: r?.status === 'occupied' ? 'occupied' as const : r?.status === 'maintenance' ? 'maintenance' as const : 'empty' as const,
              ma_nv: r?.ma_nv ? String(r.ma_nv) : null,
              ho_va_ten: r?.ho_va_ten ? String(r.ho_va_ten) : null,
            });
          });
          if (list.length < 1000) break;
          from += 1000;
        } catch (err) {
          console.warn('[qr-print] load beds failed:', err);
          break;
        }
      }
      // Only real rows (ktx/day/phong/giuong đầy đủ), deduplicated by canonical bed slot
      const validBeds = Array.from(byId.values()).filter(b =>
        b.ktx?.trim() && b.day?.trim() && b.phong_so?.trim() && b.giuong?.trim()
      );
      setBeds(deduplicateBedRows(validBeds).kept);
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

  const [printing, setPrinting] = useState(false);

  const handlePrintLabels = useCallback(async () => {
    if (labelBeds.length === 0) return;
    setPrinting(true);
    try {
      const items = await Promise.all(
        labelBeds.map(async bed => {
          const qrSrc = await generateQrDataUrl(bedQrUrl(bed), {
            width: 260,
            margin: 2,
            darkColor: '#0B0F17',
          });
          const occupant =
            bed?.status === 'occupied'
              ? bed?.ho_va_ten || bed?.ma_nv || ''
              : bed?.status === 'maintenance'
              ? 'Đang bảo trì'
              : '(Giường trống)';
          return `
            <div class="label">
              <div class="hd">KTX Phước Vĩnh Tây</div>
              <div class="qr"><img src="${qrSrc}" alt="QR" /></div>
              <div class="meta">
                <div class="loc">${escapeHtml([bed?.ktx, bed?.day].filter(Boolean).join(' · '))}</div>
                <div class="room">Phòng ${escapeHtml(bed?.phong_so || '—')} · Giường ${escapeHtml(bed?.giuong || '—')}</div>
                <div class="occ">${escapeHtml(occupant)}</div>
              </div>
            </div>`;
        })
      );
      printHtmlViaIframe(`<!doctype html>
<html><head><meta charset="utf-8"><title>In Tem Mã QR Giường</title>
<style>
  @page { size: A4; margin: 8mm; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; color: #0B0F17; }
  .grid { display: grid; grid-template-columns: repeat(3, 5cm); gap: 4mm; }
  .label { width: 5cm; height: 8cm; border: 1px solid #cbd5e1; border-radius: 6px; padding: 3mm; box-sizing: border-box; display: flex; flex-direction: column; break-inside: avoid; page-break-inside: avoid; }
  .hd { text-align: center; font-size: 9pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; }
  .qr { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
  .qr img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .meta { text-align: center; line-height: 1.25; }
  .loc { font-size: 9pt; font-weight: 800; }
  .room { font-size: 9.5pt; font-weight: 800; color: #1d4ed8; }
  .occ { font-size: 10pt; font-weight: 700; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head>
<body><div class="grid">${items.join('')}</div></body></html>`);
    } finally {
      setPrinting(false);
    }
  }, [labelBeds]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-0 sm:p-4" onClick={onClose}>
        <div
          className="bg-surf border border-bdr rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-4xl flex flex-col max-h-[92vh]"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-bdr no-print">
            <div className="min-w-0">
              <h3 className="font-extrabold text-tx flex items-center gap-2">
                <QrCode size={17} className="text-pri2" /> 🖨️ In Tem Mã QR Giường
              </h3>
              <p className="text-xs text-mu mt-0.5">
                {lockedBed ? 'Tem cho giường đang xem trong Kiểm Tra Giường' : `Căn tem nhãn 5×8 cm — ${labelBeds.length} tem`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-act text-mu hover:text-tx shrink-0"><X size={16} /></button>
          </div>

          {/* Scope pickers */}
          {!lockedBed && (
            <div className="px-5 pt-4 flex flex-wrap gap-3 items-end no-print">
              <div>
                <label className="text-[11px] font-bold text-mu uppercase tracking-wider">KTX</label>
                <select
                  value={scopeKtx}
                  onChange={e => { setScopeKtx(e.target.value); setScopeDay(''); setScopeRoom(''); }}
                  className="mt-1 block bg-surf border border-bdr text-tx rounded-xl px-3 py-2 text-sm font-semibold min-w-[130px] cursor-pointer"
                >
                  <option value="">Toàn bộ KTX</option>
                  {ktxList.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-mu uppercase tracking-wider">Dãy</label>
                <select
                  value={scopeDay}
                  onChange={e => { setScopeDay(e.target.value); setScopeRoom(''); }}
                  disabled={!scopeKtx}
                  className="mt-1 block bg-surf border border-bdr text-tx rounded-xl px-3 py-2 text-sm font-semibold min-w-[120px] cursor-pointer disabled:opacity-40"
                >
                  <option value="">Tất cả dãy</option>
                  {dayList.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-mu uppercase tracking-wider">In theo Phòng</label>
                <select
                  value={scopeRoom}
                  onChange={e => setScopeRoom(e.target.value)}
                  disabled={!scopeKtx || !scopeDay}
                  className="mt-1 block bg-surf border border-bdr text-tx rounded-xl px-3 py-2 text-sm font-semibold min-w-[120px] cursor-pointer disabled:opacity-40"
                >
                  <option value="">Tất cả phòng</option>
                  {roomList.map(r => <option key={r} value={r}>Phòng {r}</option>)}
                </select>
              </div>
              <button
                onClick={handlePrintLabels}
                disabled={printing || labelBeds.length === 0}
                className="ml-auto flex items-center gap-2 px-4 py-2.5 rounded-xl bg-pri hover:bg-pri2 text-white text-sm font-extrabold transition-colors disabled:opacity-50"
                title="In tem QR 5×8 cm"
              >
                {printing ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                {printing ? 'Đang tạo tem...' : 'In ngay (5×8 cm)'}
              </button>
            </div>
          )}

          {/* Print button cho lockedBed (qr-portal) */}
          {lockedBed && (
            <div className="px-5 pt-4 flex justify-end no-print">
              <button
                onClick={handlePrintLabels}
                disabled={printing}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-pri hover:bg-pri2 text-white text-sm font-extrabold transition-colors disabled:opacity-50"
              >
                {printing ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                {printing ? 'Đang tạo tem...' : 'In ngay (5×8 cm)'}
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex-1 flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-pri2" />
            </div>
          ) : labelBeds.length === 0 ? (
            <div className="m-5 rounded-xl border border-wn tint-wn p-4 flex items-center gap-2 no-print">
              <AlertCircle size={15} className="text-wn shrink-0" />
              <p className="text-xs text-wn">Không có giường nào khớp phạm vi in. Kiểm tra dữ liệu bảng <code>beds</code>.</p>
            </div>
          ) : (
            <>
              {/* Preview (màn hình) */}
              <div className="flex-1 overflow-y-auto px-5 py-4 no-print">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {labelBeds.map(bed => (
                    <label key={bed?.id} className="qr-label block rounded-xl border border-bdr bg-white p-2.5 text-[#0B0F17] shadow-lg aspect-[5/8] flex flex-col overflow-hidden">
                      <p className="text-[9px] font-bold text-center text-mu uppercase tracking-wider">KTX Phước Vĩnh Tây</p>
                      <div className="flex-1 min-h-0 flex items-center justify-center">
                        <QrCodeImage
                          value={bedQrUrl(bed)}
                          size={180}
                          margin={2}
                          darkColor="#0B0F17"
                          alt={`QR giường ${bed?.ktx} ${bed?.day} P${bed?.phong_so} G${bed?.giuong}`}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="space-y-0.5 text-center">
                        <p className="text-[10px] font-extrabold truncate">{[bed?.ktx, bed?.day].filter(Boolean).join(' · ')}</p>
                        <p className="text-[10px] font-extrabold truncate text-pri">Phòng {bed?.phong_so || '—'} · Giường {bed?.giuong || '—'}</p>
                        <p className="text-[10px] font-bold truncate">
                          {bed?.status === 'occupied'
                            ? (bed?.ho_va_ten || bed?.ma_nv || 'Đã ở')
                            : (bed?.status === 'maintenance' ? 'Đang bảo trì' : '(Giường trống)')}
                        </p>
                        <p className="text-[7px] text-ic font-mono truncate">Scan: Giường ID…</p>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-mu text-center no-print">
                  💡 Mẹo: tem đã căn khổ 5×8 cm. Bấm <b>In ngay</b> — chọn khổ giấy A4, tắt Header/Footer khi in.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
