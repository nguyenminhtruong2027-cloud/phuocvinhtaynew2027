'use client';

import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, Loader2, ScanLine, X } from 'lucide-react';

interface BedQrCameraScannerProps {
  open: boolean;
  onClose: () => void;
  onDecoded: (rawText: string) => void;
}

export default function BedQrCameraScanner({
  open,
  onClose,
  onDecoded,
}: BedQrCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const decodedRef = useRef(false);

  const [starting, setStarting] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    decodedRef.current = false;
    setStarting(true);
    setCameraError(null);

    const stopCamera = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };

    const startCamera = async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStarting(false);
        setCameraError('Trình duyệt hiện tại không hỗ trợ truy cập Camera trực tiếp. Bạn có thể dán mã QR bên dưới.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();
        setStarting(false);

        const NativeBarcodeDetector = (window as any).BarcodeDetector;
        const detector =
          typeof NativeBarcodeDetector === 'function'
            ? new NativeBarcodeDetector({ formats: ['qr_code'] })
            : null;

        let lastScanTs = 0;

        const scanFrame = async (ts: number) => {
          if (cancelled || decodedRef.current) return;

          if (ts - lastScanTs >= 180 && video.readyState === video.HAVE_ENOUGH_DATA) {
            lastScanTs = ts;
            try {
              if (detector) {
                const barcodes = await detector.detect(video);
                const firstValue = barcodes?.[0]?.rawValue?.trim();
                if (firstValue && !decodedRef.current) {
                  decodedRef.current = true;
                  stopCamera();
                  onDecoded(firstValue);
                  return;
                }
              }

              const canvas = canvasRef.current;
              if (canvas && video.videoWidth > 0 && video.videoHeight > 0) {
                const targetW = Math.min(video.videoWidth, 640);
                const scale = targetW / video.videoWidth;
                const targetH = Math.round(video.videoHeight * scale);
                if (canvas.width !== targetW || canvas.height !== targetH) {
                  canvas.width = targetW;
                  canvas.height = targetH;
                }
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(video, 0, 0, targetW, targetH);
                  const imageData = ctx.getImageData(0, 0, targetW, targetH);
                  const qr = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: 'dontInvert',
                  });
                  if (qr?.data && !decodedRef.current) {
                    decodedRef.current = true;
                    stopCamera();
                    onDecoded(qr.data.trim());
                    return;
                  }
                }
              }
            } catch {
              // ignore transient frame decode error
            }
          }

          rafRef.current = requestAnimationFrame(scanFrame);
        };

        rafRef.current = requestAnimationFrame(scanFrame);
      } catch (err: any) {
        if (cancelled) return;
        setStarting(false);
        const name = err?.name || '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setCameraError('Bạn chưa cấp quyền Camera cho trình duyệt. Hãy bật quyền Camera hoặc dán mã QR bên dưới.');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setCameraError('Không tìm thấy thiết bị Camera trên máy này. Bạn có thể dùng máy quét cầm tay hoặc dán mã QR bên dưới.');
        } else {
          setCameraError('Không thể khởi động Camera. Vui lòng kiểm tra thiết bị hoặc dán mã QR bên dưới.');
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, onDecoded]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualInput.trim();
    if (!cleaned) return;
    setManualInput('');
    onDecoded(cleaned);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop-scrim fade-in p-4"
      onClick={onClose}
    >
      <div
        className="modal-enter bg-surf border border-bdr rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 bg-side border-b border-bdr">
          <div className="flex items-center gap-2">
            <Camera size={16} className="text-pri2" />
            <h3 className="text-sm font-bold text-tx">Quét Mã QR Giường</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act cursor-pointer transition-colors"
            aria-label="Đóng trình quét QR"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="relative aspect-[4/3] w-full rounded-lg overflow-hidden bg-page border border-bdr flex items-center justify-center">
            {cameraError ? (
              <div className="p-5 text-center space-y-2 max-w-xs">
                <CameraOff size={28} className="mx-auto text-mu" />
                <p className="text-xs font-medium text-tx leading-relaxed">{cameraError}</p>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                {starting && (
                  <div className="absolute inset-0 bg-page/80 flex flex-col items-center justify-center gap-2 text-xs text-mu">
                    <Loader2 size={22} className="animate-spin text-pri2" />
                    <span>Đang khởi động camera...</span>
                  </div>
                )}
                {!starting && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="w-48 h-48 border-2 border-pri2 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] flex items-center justify-center">
                      <ScanLine size={24} className="text-pri2/80" />
                    </div>
                  </div>
                )}
              </>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label className="text-xs font-medium text-mu block">
              Hoặc dán liên kết / mã tem QR giường (hỗ trợ máy quét cầm tay):
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                placeholder="Dán link ?bed_qr=... hoặc KTX1|Dãy 1|3|8"
                className="flex-1 px-3 py-2 text-xs bg-page border border-bdr rounded-lg text-tx placeholder:text-mu focus:outline-none focus:border-pri2"
              />
              <button
                type="submit"
                disabled={!manualInput.trim()}
                className="px-3 py-2 bg-pri hover:opacity-90 text-white rounded-lg text-xs font-semibold disabled:opacity-40 cursor-pointer whitespace-nowrap"
              >
                Mở giường
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
