'use client';

import React, { useState } from 'react';
import { Download, Smartphone, Share, PlusSquare, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '@/hooks/usePWAInstall';

interface PWAInstallButtonProps {
  collapsed?: boolean;
  compact?: boolean;
  onInstalled?: () => void;
}

export default function PWAInstallButton({
  collapsed = false,
  compact = false,
  onInstalled,
}: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  // Automatically suppress once running in standalone app mode
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok && onInstalled) onInstalled();
      return;
    }
    setShowGuideModal(true);
  };

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => void handleClick()}
          title={isInstallable ? 'Cài ứng dụng lên màn hình chính' : 'Hướng dẫn cài ứng dụng lên điện thoại'}
          className="p-2 rounded-xl text-nav hover:text-tx hover:bg-act transition-colors duration-100 cursor-pointer"
          aria-label="Cài ứng dụng KTX PVT"
        >
          <Smartphone size={17} className="text-lnk" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void handleClick()}
          title="Cài ứng dụng KTX PVT lên điện thoại / máy tính"
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-nav hover:text-tx hover:bg-act/80 border border-transparent hover:border-bdr2 transition-colors duration-100 cursor-pointer ${
            collapsed ? 'justify-center px-2' : ''
          }`}
        >
          {isInstallable ? (
            <Download size={16} className="text-lnk flex-shrink-0" />
          ) : (
            <Smartphone size={16} className="text-lnk flex-shrink-0" />
          )}
          {!collapsed && (
            <span className="truncate">
              {isInstallable ? 'Cài ứng dụng (App)' : 'Cài lên màn hình chính'}
            </span>
          )}
        </button>
      )}

      {showGuideModal && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center modal-backdrop-scrim p-4"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-surf border border-bdr2 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-bdr bg-side flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-pri/15 text-lnk border border-pri2/35 flex items-center justify-center shrink-0">
                  <Smartphone size={18} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-tx">
                    Cài Ứng Dụng KTX PVT lên Điện Thoại
                  </h3>
                  <p className="text-[11px] text-mu">Mở toàn màn hình nhanh như ứng dụng gốc</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act cursor-pointer"
                aria-label="Đóng"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs sm:text-sm text-tx">
              {isIOS ? (
                <div className="space-y-3">
                  <p className="text-mu">
                    Trên <strong className="text-tx">iPhone / iPad (Safari)</strong>, thực hiện 2 bước nhanh sau:
                  </p>
                  <div className="rounded-xl bg-page border border-bdr p-3.5 space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-pri text-white text-xs font-bold flex items-center justify-center shrink-0">
                        1
                      </span>
                      <p className="leading-relaxed">
                        Nhấn nút <strong className="inline-flex items-center gap-1 text-lnk"><Share size={13} /> Chia sẻ</strong> ở thanh dưới cùng trình duyệt Safari.
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-pri text-white text-xs font-bold flex items-center justify-center shrink-0">
                        2
                      </span>
                      <p className="leading-relaxed">
                        Cuộn xuống và chọn <strong className="inline-flex items-center gap-1 text-lnk"><PlusSquare size={13} /> Thêm vào MH chính</strong> → bấm <strong>Thêm</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-mu">
                    Trên <strong className="text-tx">Android (Chrome)</strong> hoặc <strong className="text-tx">Máy tính (Chrome / Edge)</strong>:
                  </p>
                  <div className="rounded-xl bg-page border border-bdr p-3.5 space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-pri text-white text-xs font-bold flex items-center justify-center shrink-0">
                        1
                      </span>
                      <p className="leading-relaxed">
                        Nhấn biểu tượng <strong>ba chấm (⋮)</strong> ở góc phải trình duyệt (hoặc biểu tượng cài đặt trên thanh địa chỉ máy tính).
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-pri text-white text-xs font-bold flex items-center justify-center shrink-0">
                        2
                      </span>
                      <p className="leading-relaxed">
                        Chọn <strong>Cài đặt ứng dụng</strong> hoặc <strong>Thêm vào Màn hình chính</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-okbg/70 border border-ok2/30 px-3.5 py-2.5 text-xs text-ok flex items-center gap-2">
                <CheckCircle2 size={15} className="shrink-0" />
                <span>Sau khi cài, biểu tượng <strong>KTX PVT</strong> sẽ hiện ngay trên màn hình chính điện thoại.</span>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-bdr bg-side/60 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="px-4 py-2 rounded-xl bg-pri hover:bg-pri2 text-white text-xs font-bold cursor-pointer"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
