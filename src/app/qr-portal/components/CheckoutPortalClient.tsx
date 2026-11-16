'use client';

import React, { useState, useEffect } from 'react';
import {
  Download,
  Printer,
  ExternalLink,
  Copy,
  Check,
  LogOut,
  Building2,
  CheckCircle2,
  Clock,
  KeyRound,
  ShieldCheck,
  FileCheck2,
  ClipboardList,
} from 'lucide-react';
import { toast } from 'sonner';
import { QrCodeImage, downloadQrPng, generateQrDataUrl } from '@/components/QrCodeImage';
import { printHtmlViaIframe, escapeHtml } from '@/lib/printHtml';

export default function CheckoutPortalClient() {
  const [isMounted, setIsMounted] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState('/checkout');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (typeof window !== 'undefined') {
      setCheckoutUrl(`${window.location.origin}/checkout`);
    }
  }, []);

  if (!isMounted) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto animate-pulse" suppressHydrationWarning>
        <div className="h-10 w-64 bg-surf border border-bdr rounded" />
        <div className="h-64 bg-surf border border-bdr rounded-md" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="h-24 bg-surf border border-bdr rounded" />
          <div className="h-24 bg-surf border border-bdr rounded" />
          <div className="h-24 bg-surf border border-bdr rounded" />
          <div className="h-24 bg-surf border border-bdr rounded" />
        </div>
      </div>
    );
  }

  const handleDownload = async () => {
    const ok = await downloadQrPng(checkoutUrl, 'qr-check-out-ktx.png', 640);
    if (!ok) toast.error('Không thể tạo file ảnh QR.');
  };

  const handlePrint = async () => {
    const qrDataUrl = await generateQrDataUrl(checkoutUrl, { width: 520, margin: 3 });
    if (!qrDataUrl) return;
    printHtmlViaIframe(`<!doctype html>
<html><head><meta charset="utf-8"><title>In QR Check-out KTX</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 95vh; margin: 0; color: #111; }
  .card { text-align: center; max-width: 420px; padding: 28px; border: 2px solid #1b2430; border-radius: 14px; }
  h2 { margin: 0 0 8px; font-size: 18px; text-transform: uppercase; letter-spacing: 0.5px; }
  p { margin: 6px 0; font-size: 13px; color: #444; }
  img { width: 250px; height: 250px; margin: 14px auto; display: block; border: 2px solid #111; padding: 8px; }
  .url { font-family: monospace; font-size: 11px; word-break: break-all; color: #333; margin-top: 8px; }
  .foot { font-size: 11px; color: #555; border-top: 1px solid #ddd; padding-top: 10px; margin-top: 12px; }
</style></head>
<body>
  <div class="card">
    <h2>Thủ Tục Trả Phòng KTX Phước Vĩnh Tây</h2>
    <p>Quét mã QR bằng Camera điện thoại hoặc Zalo để khai báo dọn ra và bàn giao phòng</p>
    <img src="${qrDataUrl}" alt="QR Code Check-out KTX" />
    <div class="url">${escapeHtml(checkoutUrl)}</div>
    <div class="foot">Ban Quản Lý KTX • Vui lòng bàn giao chìa khóa cho ban quản lý / bảo vệ</div>
  </div>
</body></html>`);
  };

  const handleCopyLink = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(checkoutUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto font-sans">

      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-bdr">
        <div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight text-tx uppercase">
            MÃ QR CHECK-OUT (DỌN RA & BÀN GIAO PHÒNG)
          </h1>
          <p className="text-xs text-mu mt-0.5">
            Mã tiếp nhận khai báo dọn ra khỏi KTX để bảo vệ và ban quản trị giải phóng chỗ ở
          </p>
        </div>
      </div>

      {/* Main QR Card (Operations Console Flat Style) */}
      <div className="bg-surf border border-bdr rounded-md p-5">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="shrink-0 flex flex-col items-center gap-2.5">
            <div className="p-2 border border-bdr bg-white rounded">
              <QrCodeImage
                value={checkoutUrl}
                size={160}
                alt="Mã QR Check-out KTX"
                className="w-40 h-40 object-contain"
              />
            </div>
            <div className="flex items-center gap-1.5 w-full">
              <button
                type="button"
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-side hover:bg-act text-tx rounded text-[11px] font-semibold cursor-pointer"
              >
                <Download size={12} />
                <span>Tải mã</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 border border-bdr hover:bg-act text-tx rounded text-[11px] font-semibold cursor-pointer"
              >
                <Printer size={12} />
                <span>In ấn</span>
              </button>
            </div>
          </div>

          <div className="flex-1 text-center sm:text-left space-y-3 w-full">
            <div>
              <span className="text-[11px] font-bold uppercase text-wn tracking-wider">
                Cổng Dọn Ra Trực Tuyến
              </span>
              <h2 className="font-bold text-sm md:text-base text-tx mt-0.5">
                Khai Báo Check-out & Bàn Giao Cơ Sở Vật Chất
              </h2>
              <p className="text-xs text-mu mt-1 leading-relaxed">
                In và dán mã QR này tại văn phòng quản lý, cổng kiểm soát hoặc bảng tin các dãy. Công nhân quét mã để điền thông tin trả phòng và xác nhận lý do rời KTX.
              </p>
            </div>

            {/* URL Box */}
            <div className="bg-page rounded border border-bdr p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-ic">Đường dẫn trả phòng:</span>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1 text-wn hover:underline font-bold cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-ok" />
                      <span className="text-ok">Đã sao chép</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Sao chép link</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <code className="text-xs bg-surf px-2.5 py-1 rounded font-mono text-tx break-all flex-1 border border-bdr">
                  {checkoutUrl}
                </code>
              </div>

              <div className="pt-0.5">
                <a
                  href="/checkout"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-tx hover:underline font-semibold"
                >
                  <ExternalLink size={12} className="text-wn" /> Mở trang check-out để kiểm tra giao diện
                </a>
              </div>
            </div>

            {/* Tags */}
            <div className="flex flex-wrap gap-2 pt-1 text-xs font-medium">
              <span className="inline-flex items-center gap-1 bg-okbg text-ok px-2.5 py-0.5 rounded border border-bdr2">
                <CheckCircle2 size={12} /> Tiếp nhận 24/7 trực tuyến
              </span>
              <span className="inline-flex items-center gap-1 tint-wn text-wn px-2.5 py-0.5 rounded border border-wn/30">
                <KeyRound size={12} /> Bàn giao chìa khóa & thiết bị
              </span>
              <span className="inline-flex items-center gap-1 bg-act text-mu px-2.5 py-0.5 rounded border border-bdr">
                <Building2 size={12} /> Hoàn trả giường phòng ngay khi duyệt
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Step Guide Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            step: 'Bước 1',
            title: 'Quét mã QR',
            desc: 'Công nhân quét mã QR bằng Camera điện thoại hoặc Zalo tại KTX.',
            icon: <ClipboardList className="text-wn" size={16} />,
          },
          {
            step: 'Bước 2',
            title: 'Điền thông tin',
            desc: 'Nhập Mã NV / Họ tên, xác nhận số phòng và dãy nhà đang cư trú.',
            icon: <FileCheck2 className="text-wn" size={16} />,
          },
          {
            step: 'Bước 3',
            title: 'Bàn giao tài sản',
            desc: 'Bàn giao nệm, chìa khóa và kiểm tra cơ sở vật chất phòng ở.',
            icon: <KeyRound className="text-wn" size={16} />,
          },
          {
            step: 'Bước 4',
            title: 'Quản lý phê duyệt',
            desc: 'Quản lý duyệt đơn trên tab &quot;Duyệt Check-out&quot;, hoàn trả chỗ trống.',
            icon: <CheckCircle2 className="text-ok" size={16} />,
          },
        ].map((item, idx) => (
          <div
            key={idx}
            className="bg-surf border border-bdr rounded-md p-3.5 space-y-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-page text-mu border border-bdr">
                {item.step}
              </span>
              <div className="p-1 rounded tint-wn">{item.icon}</div>
            </div>
            <h3 className="font-bold text-tx text-xs">{item.title}</h3>
            <p className="text-[11px] text-mu leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Notice Box for Dormitory Managers (Nền cam nhạt #fdf1e4, viền cam #c9690f) */}
      <div className="tint-wn border border-wn rounded-md p-3.5 text-xs text-tx leading-relaxed">
        <h4 className="font-bold text-wn uppercase tracking-wide mb-0.5">
          Lưu ý nghiệp vụ dành cho Quản lý & Bảo vệ KTX:
        </h4>
        <p className="text-tx">
          Trước khi công nhân rời đi, người trực ca cần đối chiếu tài sản đã bàn giao (chìa khóa, nệm, thiết bị phòng). Khi thủ tục bàn giao đã hoàn tất, mở tab <strong>&quot;Duyệt Check-out&quot;</strong> để bấm phê duyệt dọn ra, hệ thống sẽ tự động cập nhật số chỗ trống trên toàn bộ ký túc xá.
        </p>
      </div>
    </div>
  );
}
