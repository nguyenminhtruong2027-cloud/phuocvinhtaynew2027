'use client';

import React, { useState, useEffect } from 'react';
import {
  Download,
  Printer,
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  KeyRound,
  FileCheck2,
  ClipboardList,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { QrCodeImage, downloadQrPng } from '@/components/QrCodeImage';
import { printQrBulletinPoster, PosterPaperSize } from '@/lib/qrPosterPrint';

export default function CheckoutPortalClient({
  onOpenApprovalTab,
}: {
  onOpenApprovalTab?: () => void;
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState('/checkout');
  const [copied, setCopied] = useState(false);
  const [paperSize, setPaperSize] = useState<PosterPaperSize>('A4');

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
    else toast.success('Đã tải ảnh QR Check-out.');
  };

  const handlePrint = async (size: PosterPaperSize = paperSize) => {
    const ok = await printQrBulletinPoster({
      url: checkoutUrl,
      paperSize: size,
      badgeText: 'Thủ tục dọn ra & trả phòng',
      title: 'Khai Báo Check-out Ký Túc Xá',
      subtitle:
        'Công nhân rời ký túc xá vui lòng quét mã QR bên dưới để khai báo trả phòng, hoàn trả giường và bàn giao cơ sở vật chất.',
      accentHex: '#b45309',
      steps: [
        {
          title: 'Quét mã QR',
          detail: 'Dùng Camera điện thoại hoặc Zalo quét mã niêm yết tại bảng tin / cổng KTX.',
        },
        {
          title: 'Xác nhận vị trí',
          detail: 'Điền Mã NV / Họ tên, số phòng, giường đang lưu trú và lý do dọn ra.',
        },
        {
          title: 'Bàn giao & phê duyệt',
          detail: 'Bàn giao chìa khóa, nệm cho bảo vệ hoặc quản lý để hoàn tất giải phóng giường.',
        },
      ],
      footerNote:
        'Ban Quản Lý KTX Phước Vĩnh Tây · Vui lòng hoàn tất bàn giao chìa khóa & thiết bị trước khi rời khu lưu trú',
    });
    if (!ok) toast.error('Không thể tạo mẫu in Poster QR.');
  };

  const handleCopyLink = () => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(checkoutUrl);
      setCopied(true);
      toast.success('Đã sao chép đường dẫn check-out.');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto font-sans">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-bdr">
        <div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight text-tx">
            Mã QR Check-out &amp; Bàn Giao Phòng
          </h1>
          <p className="text-xs text-mu mt-0.5">
            Mã tiếp nhận khai báo dọn ra khỏi KTX để bảo vệ và ban quản trị đối chiếu bàn giao, giải phóng chỗ ở
          </p>
        </div>
        {onOpenApprovalTab && (
          <button
            type="button"
            onClick={onOpenApprovalTab}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-bdr bg-surf hover:bg-act text-tx rounded-lg text-xs font-semibold transition-colors cursor-pointer w-fit whitespace-nowrap shrink-0"
          >
            <span>Mở danh sách Duyệt Check-out</span>
            <ArrowRight size={13} />
          </button>
        )}
      </div>

      {/* Main QR Card */}
      <div className="bg-surf border border-bdr rounded-xl p-5">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="shrink-0 flex flex-col items-center gap-2.5 w-44">
            <div className="p-2.5 border border-bdr bg-white rounded-lg">
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
                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-side hover:bg-act text-tx border border-bdr rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-colors"
              >
                <Download size={12} />
                <span>Tải mã</span>
              </button>
              <button
                type="button"
                onClick={() => handlePrint(paperSize)}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-pri hover:opacity-90 text-white rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-opacity"
                title={`In Poster niêm yết khổ ${paperSize}`}
              >
                <Printer size={12} />
                <span>In {paperSize}</span>
              </button>
            </div>

            <div className="inline-flex items-center w-full bg-page border border-bdr rounded-lg p-0.5 text-[11px]">
              {(['A4', 'A5'] as const).map(sz => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setPaperSize(sz)}
                  className={`flex-1 py-1 rounded font-semibold transition-colors cursor-pointer ${
                    paperSize === sz ? 'bg-surf text-tx border border-bdr' : 'text-mu hover:text-tx'
                  }`}
                >
                  Poster {sz}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 text-center sm:text-left space-y-3 w-full">
            <div>
              <p className="text-xs font-semibold text-wn">Cổng dọn ra trực tuyến</p>
              <h2 className="font-bold text-base text-tx mt-0.5">
                Khai Báo Check-out &amp; Bàn Giao Cơ Sở Vật Chất
              </h2>
              <p className="text-xs text-mu mt-1 leading-relaxed">
                In mẫu poster khổ A4 hoặc A5 và niêm yết tại văn phòng quản lý, cổng kiểm soát hoặc bảng tin các dãy. Công nhân quét mã để điền thông tin trả phòng và xác nhận lý do rời KTX.
              </p>
            </div>

            {/* URL Box */}
            <div className="bg-page rounded-lg border border-bdr p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-mu">Đường dẫn trả phòng</span>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1 text-wn hover:underline font-semibold cursor-pointer whitespace-nowrap"
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

              <code className="block text-xs bg-surf px-2.5 py-1.5 rounded font-mono text-tx break-all border border-bdr">
                {checkoutUrl}
              </code>

              <div className="pt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <a
                  href="/checkout"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-tx hover:underline font-semibold"
                >
                  <ExternalLink size={12} className="text-wn" />
                  <span>Mở trang check-out để kiểm tra giao diện</span>
                </a>
              </div>
            </div>

            {/* Clean unboxed operational metadata */}
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-2.5 gap-y-1 pt-0.5 text-xs text-mu">
              <span className="text-ok font-medium">Tiếp nhận trực tuyến 24/7</span>
              <span aria-hidden="true">·</span>
              <span>Đối chiếu bàn giao chìa khóa &amp; thiết bị</span>
              <span aria-hidden="true">·</span>
              <span>Hoàn trả giường phòng ngay khi duyệt</span>
            </div>
          </div>
        </div>
      </div>

      {/* Step Guide Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            step: '01',
            title: 'Quét mã QR',
            desc: 'Công nhân quét mã QR bằng Camera điện thoại hoặc Zalo tại bảng tin KTX.',
            icon: <ClipboardList className="text-wn" size={16} />,
          },
          {
            step: '02',
            title: 'Điền thông tin',
            desc: 'Nhập Mã NV / Họ tên, xác nhận số phòng, giường và dãy nhà đang cư trú.',
            icon: <FileCheck2 className="text-wn" size={16} />,
          },
          {
            step: '03',
            title: 'Bàn giao tài sản',
            desc: 'Bàn giao nệm, chìa khóa và kiểm tra tình trạng cơ sở vật chất phòng ở.',
            icon: <KeyRound className="text-wn" size={16} />,
          },
          {
            step: '04',
            title: 'Quản lý phê duyệt',
            desc: 'Quản lý duyệt đơn trên tab "Duyệt Check-out" để hoàn trả chỗ trống tức thì.',
            icon: <CheckCircle2 className="text-ok" size={16} />,
          },
        ].map((item) => (
          <div
            key={item.step}
            className="bg-surf border border-bdr rounded-xl p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-mu font-tabular">
                Bước {item.step}
              </span>
              <div className="p-1.5 rounded-lg bg-page border border-bdr">{item.icon}</div>
            </div>
            <h3 className="font-bold text-tx text-sm">{item.title}</h3>
            <p className="text-xs text-mu leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Notice Box */}
      <div className="tint-wn border border-wn/40 rounded-xl p-4 text-xs text-tx leading-relaxed">
        <p className="font-semibold text-wn mb-1">
          Lưu ý nghiệp vụ dành cho Quản lý &amp; Bảo vệ KTX
        </p>
        <p className="text-tx/90">
          Trước khi công nhân rời đi, người trực ca cần đối chiếu tài sản đã bàn giao (chìa khóa, nệm, thiết bị phòng). Khi thủ tục bàn giao đã hoàn tất, mở tab{' '}
          {onOpenApprovalTab ? (
            <button
              type="button"
              onClick={onOpenApprovalTab}
              className="font-bold text-wn underline hover:opacity-80 cursor-pointer"
            >
              Duyệt Check-out
            </button>
          ) : (
            <strong>&ldquo;Duyệt Check-out&rdquo;</strong>
          )}{' '}
          để bấm phê duyệt dọn ra, hệ thống sẽ tự động cập nhật số chỗ trống trên toàn bộ ký túc xá.
        </p>
      </div>
    </div>
  );
}
