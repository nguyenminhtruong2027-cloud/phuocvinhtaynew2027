'use client';

import jsQR from 'jsqr';

export interface DecodedCCCDData {
  cccd: string;
  hoVaTen: string;
  ngaySinh: string;
  gioiTinh: string;
  hoKhauTinh: string;
}

/**
 * Parse Vietnamese chip-based CCCD QR string:
 * Format: CCCD|CMND|Họ và tên|DDMMYYYY|Giới tính|Địa chỉ thường trú|Ngày cấp
 */
export function parseVietnameseCCCDQR(raw: string): DecodedCCCDData | null {
  const cleaned = (raw || '').trim();
  if (!cleaned) return null;
  const parts = cleaned.split('|');
  if (parts.length < 6) return null;

  const cccd = (parts[0] || '').trim();
  const hoVaTen = (parts[2] || '').trim();
  const rawDob = (parts[3] || '').trim();
  let ngaySinh = rawDob;
  if (rawDob.length === 8 && /^\d{8}$/.test(rawDob)) {
    ngaySinh = `${rawDob.slice(0, 2)}/${rawDob.slice(2, 4)}/${rawDob.slice(4, 8)}`;
  }

  const rawGender = (parts[4] || '').trim().toLowerCase();
  const gioiTinh = rawGender.includes('nữ') || rawGender === 'nu' || rawGender === 'f' ? 'Nữ' : 'Nam';
  const hoKhauTinh = (parts[5] || '').trim();

  if (!cccd && !hoVaTen) return null;
  return { cccd, hoVaTen, ngaySinh, gioiTinh, hoKhauTinh };
}

/**
 * Decode a QR code from a canvas element.
 * Works reliably on iPhone/iOS Safari, Android Chrome, and Desktop browsers:
 * tries native BarcodeDetector first when available, and always falls back to bundled jsQR.
 */
export async function decodeQrTextFromCanvas(
  canvas: HTMLCanvasElement,
  ctx?: CanvasRenderingContext2D | null
): Promise<string | null> {
  const context = ctx ?? canvas.getContext('2d', { willReadFrequently: true });
  if (!context || canvas.width === 0 || canvas.height === 0) return null;

  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      type BarcodeDetectorCtor = new (opts: { formats: string[] }) => {
        detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
      };
      const DetectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (DetectorCtor) {
        const detector = new DetectorCtor({ formats: ['qr_code'] });
        const codes = await detector.detect(canvas);
        if (Array.isArray(codes) && codes.length > 0 && codes[0]?.rawValue) {
          return String(codes[0].rawValue);
        }
      }
    } catch {
      // Fall through cleanly to bundled jsQR
    }
  }

  try {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth',
    });
    if (code?.data) return code.data;
  } catch {
    // ignore frame read error
  }

  return null;
}

/**
 * Decode CCCD QR code from an uploaded photo (e.g. phone gallery or photo sent via Zalo).
 * Performs multi-pass scan: full scaled image + top-right/center crops for dense CCCD QR codes.
 */
export async function decodeCCCDFromImageFile(
  file: File
): Promise<{ data: DecodedCCCDData | null; rawText: string | null; error?: string }> {
  if (!file || !file.type.startsWith('image/')) {
    return { data: null, rawText: null, error: 'Vui lòng chọn tệp hình ảnh hợp lệ (JPG, PNG, WEBP).' };
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không thể đọc file ảnh này.'));
      el.src = imageUrl;
    });

    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) {
      return { data: null, rawText: null, error: 'Ảnh rỗng hoặc không đọc được kích thước.' };
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { data: null, rawText: null, error: 'Trình duyệt không hỗ trợ xử lý ảnh Canvas.' };
    }

    // Pass 1: Full image at high clarity (up to 1600px max edge)
    // Pass 2: Smaller normalized pass (900px) — sometimes jsQR handles dense QR better when smoothed
    // Pass 3: Top-right quadrant (standard location of QR on Vietnamese CCCD front/back photos)
    const passes: Array<{ sx: number; sy: number; sw: number; sh: number; maxDim: number }> = [
      { sx: 0, sy: 0, sw: naturalW, sh: naturalH, maxDim: 1600 },
      { sx: 0, sy: 0, sw: naturalW, sh: naturalH, maxDim: 960 },
      {
        sx: Math.floor(naturalW * 0.45),
        sy: 0,
        sw: Math.ceil(naturalW * 0.55),
        sh: Math.ceil(naturalH * 0.6),
        maxDim: 1200,
      },
      {
        sx: Math.floor(naturalW * 0.15),
        sy: Math.floor(naturalH * 0.15),
        sw: Math.ceil(naturalW * 0.7),
        sh: Math.ceil(naturalH * 0.7),
        maxDim: 1200,
      },
    ];

    for (const pass of passes) {
      const scale = Math.min(1, pass.maxDim / Math.max(pass.sw, pass.sh));
      canvas.width = Math.max(1, Math.round(pass.sw * scale));
      canvas.height = Math.max(1, Math.round(pass.sh * scale));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, pass.sx, pass.sy, pass.sw, pass.sh, 0, 0, canvas.width, canvas.height);

      const raw = await decodeQrTextFromCanvas(canvas, ctx);
      if (raw) {
        const parsed = parseVietnameseCCCDQR(raw);
        if (parsed) {
          return { data: parsed, rawText: raw };
        }
        return {
          data: null,
          rawText: raw,
          error: 'Đã đọc được mã QR nhưng không đúng định dạng CCCD gắn chip Việt Nam.',
        };
      }
    }

    return {
      data: null,
      rawText: null,
      error: 'Không tìm thấy mã QR rõ nét trong ảnh. Hãy chụp gần mã QR hơn hoặc chuyển sang chụp OCR mặt trước.',
    };
  } catch (err) {
    return {
      data: null,
      rawText: null,
      error: err instanceof Error ? err.message : 'Lỗi khi đọc ảnh CCCD.',
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
