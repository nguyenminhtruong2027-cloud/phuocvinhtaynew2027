'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useKtxStructure } from '@/lib/ktxStructure';
import { fetchWorkerHierarchy } from '@/lib/workerHierarchy';
import { CheckCircle2, AlertCircle, Loader2, User, X, QrCode, Home, ScanLine, CheckCircle, Camera, AlertTriangle, Check, RefreshCw } from 'lucide-react';

interface RegistrationForm {
  ma_nv: string;
  ho_va_ten: string;
  gioi_tinh: string;
  ngay_sinh: string;
  so_dien_thoai: string;
  so_cccd: string;
  ho_khau_tinh: string;
  ktx: string;
  tieu_doan: string;
  day: string;
  phong_so: string;
  giuong: string;
  don_vi: string;
  ngay_vao_ktx: string;
  to_truong: string;
  sdt_to_truong: string;
  ghi_chu: string;
}

const INITIAL_FORM: RegistrationForm = {
  ma_nv: '', ho_va_ten: '', gioi_tinh: '', ngay_sinh: '',
  so_dien_thoai: '', so_cccd: '', ho_khau_tinh: '',
  ktx: '', tieu_doan: '', day: '', phong_so: '', giuong: '', don_vi: '', ngay_vao_ktx: '',
  to_truong: '', sdt_to_truong: '',
  ghi_chu: '',
};

const PROVINCES = [
  'An Giang','Bạc Liêu','Bến Tre','Bình Dương','Bình Phước','Bình Thuận',
  'Cà Mau','Cần Thơ','Đà Nẵng','Đắk Lắk','Đồng Nai','Đồng Tháp',
  'Gia Lai','Hải Phòng','Hậu Giang','Khánh Hòa','Kiên Giang','Lâm Đồng',
  'Lạng Sơn','Long An','Nghệ An','Quảng Nam','Quảng Ngãi','Quảng Trị',
  'Sóc Trăng','Tây Ninh','Tiền Giang','TP Hồ Chí Minh','Trà Vinh',
  'Vĩnh Long','Thanh Hóa','Thừa Thiên Huế','Bình Định','Ninh Bình',
];

interface CCCDData {
  cccd: string;
  hoVaTen: string;
  ngaySinh: string;
  gioiTinh: string;
  hoKhauTinh: string;
}

function parseCCCDQR(raw: string): CCCDData | null {
  const parts = raw.split('|');
  if (parts.length < 7) return null;
  const cccd = parts[0].trim();
  if (!/^\d{9,12}$/.test(cccd)) return null;
  const hoVaTen = parts[2].trim();
  const dobRaw = parts[3].trim();
  let ngaySinh = dobRaw;
  if (/^\d{8}$/.test(dobRaw)) {
    ngaySinh = `${dobRaw.slice(0, 2)}/${dobRaw.slice(2, 4)}/${dobRaw.slice(4)}`;
  }
  const genderRaw = parts[4].trim().toLowerCase();
  const gioiTinh = genderRaw === 'nam' || genderRaw === '0' || genderRaw === 'male' ? 'Nam' : 'Nữ';
  const hoKhauTinh = parts[5].trim();
  return { cccd, hoVaTen, ngaySinh, gioiTinh, hoKhauTinh };
}

function extractOCRFromText(text: string): Partial<CCCDData> {
  const result: Partial<CCCDData> = {};
  const cccdMatch = text.match(/\b(\d{12})\b/);
  if (cccdMatch) result.cccd = cccdMatch[1];
  const dobMatch = text.match(/\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/);
  if (dobMatch) result.ngaySinh = `${dobMatch[1]}/${dobMatch[2]}/${dobMatch[3]}`;
  if (/\bNam\b/i.test(text)) result.gioiTinh = 'Nam';
  else if (/\bN[uư][̃]?\b/i.test(text) || /\bFemale\b/i.test(text)) result.gioiTinh = 'Nữ';
  const nameMatch = text.match(/([A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]{2,}\s+){1,3}[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠƯẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]{2,}/);
  if (nameMatch) result.hoVaTen = nameMatch[0].trim();
  for (const p of PROVINCES) {
    if (text.includes(p)) { result.hoKhauTinh = p; break; }
  }
  return result;
}

/** OCR Scanner for register page */
function CCCDOCRScanner({ onConfirm, onClose }: {
  onConfirm: (data: Partial<CCCDData>) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'capturing' | 'confirming' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState('');
  const [editData, setEditData] = useState<Partial<CCCDData>>({});

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStatus('ready');
        }
      } catch (e: any) {
        setStatus('error');
        setErrorMsg(e?.message || 'Không thể truy cập camera');
      }
    }
    start();
    return () => { active = false; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setStatus('capturing');
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let extracted: Partial<CCCDData> = {};
    try {
      // @ts-ignore
      if (window.Tesseract) {
        // @ts-ignore
        const result = await window.Tesseract.recognize(canvas, 'vie');
        extracted = extractOCRFromText(result.data.text);
      }
    } catch {}
    setEditData(extracted);
    setStatus('confirming');
    streamRef.current?.getTracks().forEach(t => t.stop());
  };

  const handleRetake = () => {
    setEditData({});
    setStatus('starting');
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(stream => {
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); setStatus('ready'); }
    }).catch(e => { setStatus('error'); setErrorMsg(e?.message || 'Lỗi camera'); });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" suppressHydrationWarning>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden max-h-[90vh] flex flex-col" suppressHydrationWarning>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0" suppressHydrationWarning>
          <div className="flex items-center gap-2" suppressHydrationWarning>
            <Camera size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-gray-900">Chụp mặt trước CCCD (OCR)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            suppressHydrationWarning
          >
            <X size={16} />
          </button>
        </div>
        {status !== 'confirming' && (
          <div className="relative bg-black aspect-video flex-shrink-0" suppressHydrationWarning>
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" suppressHydrationWarning>
              <div className="w-[85%] h-[55%] border-2 border-amber-400/80 rounded-xl relative" suppressHydrationWarning>
                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-amber-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-amber-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-amber-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-amber-400 rounded-br-lg" />
              </div>
            </div>
          </div>
        )}
        <div className="px-4 py-3 flex-1 overflow-y-auto" suppressHydrationWarning>
          {status === 'starting' && <p className="text-xs text-gray-500 flex items-center justify-center gap-1.5 py-2"><Loader2 size={12} className="animate-spin" />Đang khởi động camera...</p>}
          {status === 'ready' && (
            <div className="space-y-2" suppressHydrationWarning>
              <p className="text-xs text-gray-500 text-center">Đặt mặt trước CCCD vào khung, giữ thẳng và rõ nét</p>
              <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg" suppressHydrationWarning>
                <AlertTriangle size={13} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700">Dữ liệu bóc tách cần xác nhận trước khi lưu.</p>
              </div>
              <button
                type="button"
                onClick={handleCapture}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                suppressHydrationWarning
              >
                <Camera size={15} />Chụp ảnh CCCD
              </button>
            </div>
          )}
          {status === 'capturing' && <p className="text-xs text-gray-500 flex items-center justify-center gap-1.5 py-2"><Loader2 size={12} className="animate-spin" />Đang bóc tách dữ liệu...</p>}
          {status === 'error' && <p className="text-xs text-red-500 text-center py-2">{errorMsg}</p>}
          {status === 'confirming' && (
            <div className="space-y-3" suppressHydrationWarning>
              <div className="flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg" suppressHydrationWarning>
                <AlertTriangle size={13} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700 font-medium">Kiểm tra và chỉnh sửa dữ liệu. Bắt buộc nhấn &quot;Xác nhận đúng&quot; để áp dụng.</p>
              </div>
              <div className="space-y-2" suppressHydrationWarning>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Họ và tên</label>
                  <input
                    type="text"
                    value={editData.hoVaTen || ''}
                    onChange={e => setEditData(d => ({ ...d, hoVaTen: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder="Nhập họ tên"
                    suppressHydrationWarning
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Số CCCD</label>
                  <input
                    type="text"
                    value={editData.cccd || ''}
                    onChange={e => setEditData(d => ({ ...d, cccd: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono"
                    placeholder="12 chữ số"
                    maxLength={12}
                    suppressHydrationWarning
                  />
                </div>
                <div className="grid grid-cols-2 gap-2" suppressHydrationWarning>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Ngày sinh</label>
                    <input
                      type="text"
                      value={editData.ngaySinh || ''}
                      onChange={e => setEditData(d => ({ ...d, ngaySinh: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                      placeholder="DD/MM/YYYY"
                      suppressHydrationWarning
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Giới tính</label>
                    <select
                      value={editData.gioiTinh || ''}
                      onChange={e => setEditData(d => ({ ...d, gioiTinh: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                      suppressHydrationWarning
                    >
                      <option value="">Chọn</option>
                      <option value="Nam">Nam</option>
                      <option value="Nữ">Nữ</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Địa chỉ thường trú / Hộ khẩu</label>
                  <input
                    type="text"
                    value={editData.hoKhauTinh || ''}
                    onChange={e => setEditData(d => ({ ...d, hoKhauTinh: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder="VD: 123 Đường ABC, Phường XYZ, Quận 1, TP Hồ Chí Minh"
                    suppressHydrationWarning
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1" suppressHydrationWarning>
                <button
                  type="button"
                  onClick={handleRetake}
                  className="flex-1 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
                  suppressHydrationWarning
                >
                  <RefreshCw size={13} />Chụp lại
                </button>
                <button
                  type="button"
                  onClick={() => onConfirm(editData)}
                  className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
                  suppressHydrationWarning
                >
                  <Check size={13} />Xác nhận đúng
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** QR Scanner for register page */
function CCCDQRScanner({ onScanned, onClose, onSwitchOCR }: {
  onScanned: (data: CCCDData | null) => void;
  onClose: () => void;
  onSwitchOCR: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStatus('scanning');
          scanLoop();
        }
      } catch (e: any) {
        setStatus('error');
        setErrorMsg(e?.message || 'Không thể truy cập camera');
      }
    }

    async function scanLoop() {
      if (!active || !videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          if ('BarcodeDetector' in window) {
            try {
              // @ts-ignore
              const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
              const codes = await detector.detect(canvas);
              if (codes.length > 0) {
                const raw = codes[0].rawValue as string;
                const parsed = parseCCCDQR(raw);
                onScanned(parsed);
                return;
              }
            } catch {}
          } else {
            try {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              // @ts-ignore
              if (window.__jsQR) {
                // @ts-ignore
                const code = window.__jsQR(imageData.data, canvas.width, canvas.height);
                if (code) { onScanned(parseCCCDQR(code.data)); return; }
              }
            } catch {}
          }
        }
      }
      rafRef.current = requestAnimationFrame(scanLoop);
    }

    start();
    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [onScanned]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" suppressHydrationWarning>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" suppressHydrationWarning>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200" suppressHydrationWarning>
          <div className="flex items-center gap-2" suppressHydrationWarning>
            <ScanLine size={16} className="text-blue-600" />
            <span className="text-sm font-semibold text-gray-900">Quét QR mặt sau CCCD</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            suppressHydrationWarning
          >
            <X size={16} />
          </button>
        </div>
        <div className="relative bg-black aspect-video" suppressHydrationWarning>
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" suppressHydrationWarning>
            <div className="w-48 h-48 border-2 border-white/70 rounded-xl relative" suppressHydrationWarning>
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-blue-400 rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-blue-400 rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-blue-400 rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-blue-400 rounded-br-lg" />
            </div>
          </div>
        </div>
        <div className="px-4 py-3 space-y-2" suppressHydrationWarning>
          {status === 'starting' && <p className="text-xs text-gray-500 flex items-center justify-center gap-1.5"><Loader2 size={12} className="animate-spin" />Đang khởi động camera...</p>}
          {status === 'scanning' && <p className="text-xs text-gray-500 text-center">Hướng camera vào mã QR trên mặt sau CCCD gắn chip</p>}
          {status === 'error' && <p className="text-xs text-red-500 text-center">{errorMsg || 'Không thể truy cập camera. Vui lòng nhập tay.'}</p>}
          <button
            type="button"
            onClick={onSwitchOCR}
            className="w-full py-2 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
            suppressHydrationWarning
          >
            <Camera size={12} />
            Mã QR bị hỏng? Chuyển sang chụp mặt trước (OCR)
          </button>
        </div>
      </div>
    </div>
  );
}

/** Unified CCCD Scanner for register page */
function CCCDScanner({ onScanned, onClose }: {
  onScanned: (data: CCCDData | null) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'qr' | 'ocr'>('qr');

  const handleOCRConfirm = (data: Partial<CCCDData>) => {
    onScanned({
      cccd: data.cccd || '',
      hoVaTen: data.hoVaTen || '',
      ngaySinh: data.ngaySinh || '',
      gioiTinh: data.gioiTinh || 'Nam',
      hoKhauTinh: data.hoKhauTinh || '',
    });
  };

  if (mode === 'ocr') {
    return <CCCDOCRScanner onConfirm={handleOCRConfirm} onClose={onClose} />;
  }

  return <CCCDQRScanner onScanned={onScanned} onClose={onClose} onSwitchOCR={() => setMode('ocr')} />;
}

const inputCls = 'w-full px-3 py-2.5 text-sm border border-border rounded-xl bg-background focus:outline-none focus:ring-2 focus:ring-primary/30';
const labelCls = 'text-xs text-muted-foreground mb-1 block';
const sectionTitleCls = 'text-sm font-semibold text-foreground flex items-center gap-2 pt-1';

export default function RegisterPage() {
  const { ktxNames } = useKtxStructure();
  const [isMounted, setIsMounted] = useState(false);
  const [form, setForm] = useState<RegistrationForm>(INITIAL_FORM);
  const [unitOptions, setUnitOptions] = useState<string[]>([
    'XD', 'ME', 'Vin Alpha', 'Trắc đạc', 'DVVS', 'QC', 'Ép cọc', 'QLVTTB', 'Lái xe', 'Tuyển dụng'
  ]);
  const [isCustomUnit, setIsCustomUnit] = useState(false);
  const [customUnit, setCustomUnit] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    setIsMounted(true);
    fetchWorkerHierarchy().then(data => {
      if (data.units && data.units.length > 0) {
        setUnitOptions(data.units);
      }
    }).catch(err => {
      console.warn('Failed to fetch worker units:', err);
    });
  }, []);

  const handleField = (k: keyof RegistrationForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }));
  };

  const handleUnitSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__other__') {
      setIsCustomUnit(true);
      setForm(f => ({ ...f, don_vi: customUnit }));
    } else {
      setIsCustomUnit(false);
      setForm(f => ({ ...f, don_vi: val }));
    }
  };

  const handleCustomUnitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomUnit(val);
    setForm(f => ({ ...f, don_vi: val }));
  };

  const handleScanned = useCallback((parsed: CCCDData | null) => {
    setShowScanner(false);
    if (parsed) {
      setForm(f => ({
        ...f,
        so_cccd: parsed.cccd || f.so_cccd,
        ho_va_ten: parsed.hoVaTen || f.ho_va_ten,
        ngay_sinh: parsed.ngaySinh || f.ngay_sinh,
        gioi_tinh: parsed.gioiTinh || f.gioi_tinh,
        ho_khau_tinh: parsed.hoKhauTinh || f.ho_khau_tinh,
      }));
      setScanSuccess(true);
      setTimeout(() => setScanSuccess(false), 3000);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Required field validation
    const missing: string[] = [];
    if (!form.ngay_sinh.trim()) missing.push('Ngày sinh');
    if (!form.gioi_tinh.trim()) missing.push('Giới tính');
    if (!form.ho_khau_tinh.trim()) missing.push('Địa chỉ thường trú / Hộ khẩu');
    if (!form.ktx.trim()) missing.push('Khu KTX');
    if (!form.day.trim()) missing.push('Dãy nhà');
    if (!form.phong_so.trim()) missing.push('Phòng số');
    if (!form.ho_va_ten.trim()) missing.push('Họ và tên');
    if (!form.so_cccd.trim()) missing.push('Số CCCD');
    if (!form.so_dien_thoai.trim()) missing.push('Số điện thoại');
    if (missing.length > 0) {
      setError(`Vui lòng điền đầy đủ các trường bắt buộc: ${missing.join(', ')}.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { error: insertErr } = await supabase.from('worker_registrations').insert({
        ma_nv: form.ma_nv.trim(),
        ho_va_ten: form.ho_va_ten.trim(),
        so_cccd: form.so_cccd.trim(),
        so_dien_thoai: form.so_dien_thoai.trim(),
        gioi_tinh: form.gioi_tinh.trim(),
        ngay_sinh: form.ngay_sinh.trim(),
        ho_khau_tinh: form.ho_khau_tinh.trim(),
        que_quan: form.ho_khau_tinh.trim(),
        don_vi: form.don_vi.trim(),
        tieu_doan: form.tieu_doan.trim(),
        to_truong: form.to_truong.trim(),
        sdt_to_truong: form.sdt_to_truong.trim(),
        ktx: form.ktx.trim(),
        day: form.day.trim(),
        phong_so: form.phong_so.trim(),
        giuong: form.giuong.trim(),
        ngay_vao_ktx: form.ngay_vao_ktx.trim(),
        ghi_chu: form.ghi_chu.trim(),
        status: 'pending',
      });
      if (insertErr) throw new Error(insertErr.message);
      setSubmitted(true);
    } catch (err: any) {
      setError(`Lỗi gửi đăng ký: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Safe client-side mount check to prevent browser extensions (LastPass, Password autofill)
  // from causing React Hydration Mismatch with fdprocessedid or injected attributes
  if (!isMounted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 py-8 px-4 flex items-center justify-center" suppressHydrationWarning>
        <div className="max-w-lg w-full mx-auto space-y-6" suppressHydrationWarning>
          <div className="text-center space-y-2" suppressHydrationWarning>
            <div className="w-14 h-14 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto shadow-sm animate-pulse">
              <QrCode size={28} className="text-primary opacity-60" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Đăng Ký Cư Trú</h1>
            <p className="text-sm text-muted-foreground">Ký Túc Xá Phước Vĩnh Tây — Đang tải biểu mẫu an toàn...</p>
          </div>
          <div className="bg-white rounded-2xl shadow-lg border border-border p-6 space-y-4 animate-pulse" suppressHydrationWarning>
            <div className="h-5 w-40 bg-muted/60 rounded" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-10 bg-muted/30 rounded-xl" />
              <div className="h-10 bg-muted/30 rounded-xl" />
            </div>
            <div className="h-10 bg-muted/30 rounded-xl" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-10 bg-muted/30 rounded-xl" />
              <div className="h-10 bg-muted/30 rounded-xl" />
            </div>
            <div className="h-10 bg-muted/30 rounded-xl" />
            <div className="h-10 bg-muted/30 rounded-xl" />
            <div className="h-11 bg-primary/30 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 flex items-center justify-center p-4" suppressHydrationWarning>
        <div className="bg-white rounded-2xl shadow-xl border border-border p-8 max-w-md w-full text-center space-y-4" suppressHydrationWarning>
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Đăng ký thành công!</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Hồ sơ của bạn đã được gửi đến Ban quản lý KTX Phước Vĩnh Tây. Vui lòng chờ xét duyệt trong vòng <strong>1–2 ngày làm việc</strong>.
          </p>
          <div className="bg-muted/50 rounded-xl p-4 text-left space-y-1.5 text-sm" suppressHydrationWarning>
            <div className="flex gap-2"><span className="text-muted-foreground w-28">Họ tên:</span><span className="font-medium">{form.ho_va_ten}</span></div>
            <div className="flex gap-2"><span className="text-muted-foreground w-28">CCCD:</span><span className="font-medium">{form.so_cccd}</span></div>
            <div className="flex gap-2"><span className="text-muted-foreground w-28">SĐT:</span><span className="font-medium">{form.so_dien_thoai}</span></div>
            {form.ktx && <div className="flex gap-2"><span className="text-muted-foreground w-28">KTX:</span><span className="font-medium">{form.ktx}</span></div>}
          </div>
          <button
            type="button"
            onClick={() => { setSubmitted(false); setForm(INITIAL_FORM); setScanSuccess(false); }}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:opacity-90 transition-opacity text-sm cursor-pointer"
            suppressHydrationWarning
          >
            Đăng ký thêm
          </button>
        </div>
      </div>
    );
  }

  return (
    <div suppressHydrationWarning>
      {showScanner && <CCCDScanner onScanned={handleScanned} onClose={() => setShowScanner(false)} />}
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 py-8 px-4" suppressHydrationWarning>
        <div className="max-w-lg mx-auto space-y-6" suppressHydrationWarning>
          {/* Header */}
          <div className="text-center space-y-2" suppressHydrationWarning>
            <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mx-auto shadow-lg">
              <QrCode size={28} className="text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Đăng Ký Cư Trú</h1>
            <p className="text-sm text-muted-foreground">Ký Túc Xá Phước Vĩnh Tây — Điền đầy đủ thông tin để được xét duyệt</p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl shadow-lg border border-border p-6 space-y-5"
            suppressHydrationWarning
          >

            {/* ── SECTION 1: Thông tin cá nhân ── */}
            <div className="space-y-3" suppressHydrationWarning>
              <div className="flex items-center justify-between" suppressHydrationWarning>
                <h3 className={sectionTitleCls}>
                  <User size={15} className="text-primary" /> Thông tin cá nhân
                </h3>
                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold transition-colors border border-blue-200 cursor-pointer"
                  suppressHydrationWarning
                >
                  <ScanLine size={13} />
                  Quét CCCD
                </button>
              </div>

              {scanSuccess && (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700" suppressHydrationWarning>
                  <CheckCircle size={13} />
                  Đã tự động điền thông tin từ CCCD gắn chip
                </div>
              )}

              <div className="grid grid-cols-2 gap-3" suppressHydrationWarning>
                <div>
                  <label className={labelCls}>Mã nhân viên</label>
                  <input
                    type="text"
                    value={form.ma_nv}
                    onChange={handleField('ma_nv')}
                    placeholder="NV001 hoặc để trống"
                    className={inputCls}
                    suppressHydrationWarning
                  />
                </div>
                <div>
                  <label className={labelCls}>Giới tính <span className="text-red-500">*</span></label>
                  <select
                    value={form.gioi_tinh}
                    onChange={handleField('gioi_tinh')}
                    className={inputCls}
                    suppressHydrationWarning
                  >
                    <option value="">-- Chọn giới tính --</option>
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                  </select>
                </div>
              </div>

              <div>
                <label className={labelCls}>Họ và tên <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.ho_va_ten}
                  onChange={handleField('ho_va_ten')}
                  required
                  placeholder="Nguyễn Văn A"
                  className={inputCls}
                  suppressHydrationWarning
                />
              </div>

              <div className="grid grid-cols-2 gap-3" suppressHydrationWarning>
                <div>
                  <label className={labelCls}>Ngày sinh <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.ngay_sinh}
                    onChange={handleField('ngay_sinh')}
                    placeholder="VD: 15/06/1990"
                    className={inputCls}
                    suppressHydrationWarning
                  />
                </div>
                <div>
                  <label className={labelCls}>Số điện thoại <span className="text-red-500">*</span></label>
                  <input
                    type="tel"
                    value={form.so_dien_thoai}
                    onChange={handleField('so_dien_thoai')}
                    required
                    placeholder="0901234567"
                    className={inputCls}
                    suppressHydrationWarning
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Số CCCD <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.so_cccd}
                  onChange={handleField('so_cccd')}
                  required
                  placeholder="012345678901"
                  className={inputCls}
                  suppressHydrationWarning
                />
              </div>

              <div>
                <label className={labelCls}>Địa chỉ thường trú / Hộ khẩu <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.ho_khau_tinh}
                  onChange={handleField('ho_khau_tinh')}
                  placeholder="VD: 123 Đường ABC, Phường XYZ, Quận 1, TP Hồ Chí Minh"
                  className={inputCls}
                  suppressHydrationWarning
                />
              </div>
            </div>

            {/* ── SECTION 2: Thông tin KTX ── */}
            <div className="space-y-3 pt-1 border-t border-border" suppressHydrationWarning>
              <h3 className={sectionTitleCls}>
                <Home size={15} className="text-primary" /> Thông tin KTX
              </h3>

              <div className="grid grid-cols-2 gap-3" suppressHydrationWarning>
                <div>
                  <label className={labelCls}>Khu KTX <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.ktx}
                    onChange={handleField('ktx')}
                    placeholder="VD: KTX 1, KTX 2..."
                    list="ktx-list"
                    className={inputCls}
                    suppressHydrationWarning
                  />
                  <datalist id="ktx-list">
                    {ktxNames.map(ktx => (
                      <option key={ktx} value={ktx} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className={labelCls}>Tiểu đoàn / Trung đoàn</label>
                  <input
                    type="text"
                    value={form.tieu_doan}
                    onChange={handleField('tieu_doan')}
                    placeholder="VD: 8, 111, 113..."
                    className={inputCls}
                    suppressHydrationWarning
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3" suppressHydrationWarning>
                <div>
                  <label className={labelCls}>Dãy nhà <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.day}
                    onChange={handleField('day')}
                    placeholder="Dãy 3"
                    className={inputCls}
                    suppressHydrationWarning
                  />
                </div>
                <div>
                  <label className={labelCls}>Phòng số <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.phong_so}
                    onChange={handleField('phong_so')}
                    placeholder="101"
                    className={inputCls}
                    suppressHydrationWarning
                  />
                </div>
                <div>
                  <label className={labelCls}>Số giường</label>
                  <input
                    type="text"
                    value={form.giuong}
                    onChange={handleField('giuong')}
                    placeholder="1–20"
                    className={inputCls}
                    suppressHydrationWarning
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3" suppressHydrationWarning>
                <div>
                  <label className={labelCls}>Đơn vị / Nhà thầu</label>
                  <select
                    value={isCustomUnit ? '__other__' : form.don_vi}
                    onChange={handleUnitSelect}
                    className={inputCls}
                    suppressHydrationWarning
                  >
                    <option value="">-- Chọn đơn vị/nhà thầu --</option>
                    {unitOptions.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                    <option value="__other__">Khác (tự nhập)...</option>
                  </select>
                  {isCustomUnit && (
                    <input
                      type="text"
                      value={customUnit}
                      onChange={handleCustomUnitChange}
                      placeholder="Nhập tên đơn vị/nhà thầu..."
                      className={`${inputCls} mt-2 animate-in fade-in`}
                      autoFocus
                      suppressHydrationWarning
                    />
                  )}
                </div>
                <div>
                  <label className={labelCls}>Ngày vào KTX</label>
                  <input
                    type="text"
                    value={form.ngay_vao_ktx}
                    onChange={handleField('ngay_vao_ktx')}
                    placeholder="VD: 01/09/2026"
                    className={inputCls}
                    suppressHydrationWarning
                  />
                </div>
              </div>
            </div>

            {/* ── SECTION 3: Thông tin tổ trưởng ── */}
            <div className="space-y-3 pt-1 border-t border-border" suppressHydrationWarning>
              <h3 className={sectionTitleCls}>
                <User size={15} className="text-primary" /> Thông tin tổ trưởng
              </h3>
              <div className="grid grid-cols-2 gap-3" suppressHydrationWarning>
                <div>
                  <label className={labelCls}>Họ tên tổ trưởng</label>
                  <input
                    type="text"
                    value={form.to_truong}
                    onChange={handleField('to_truong')}
                    placeholder="Nguyễn Văn B"
                    className={inputCls}
                    suppressHydrationWarning
                  />
                </div>
                <div>
                  <label className={labelCls}>SĐT tổ trưởng</label>
                  <input
                    type="tel"
                    value={form.sdt_to_truong}
                    onChange={handleField('sdt_to_truong')}
                    placeholder="0901234567"
                    className={inputCls}
                    suppressHydrationWarning
                  />
                </div>
              </div>
            </div>

            {/* Ghi chú */}
            <div className="pt-1 border-t border-border" suppressHydrationWarning>
              <label className={labelCls}>Ghi chú (nếu có)</label>
              <textarea
                value={form.ghi_chu}
                onChange={handleField('ghi_chu')}
                rows={2}
                placeholder="Thông tin thêm..."
                className={`${inputCls} resize-none`}
                suppressHydrationWarning
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700" suppressHydrationWarning>
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center justify-center gap-2 cursor-pointer shadow-md"
              suppressHydrationWarning
            >
              {submitting ? <><Loader2 size={16} className="animate-spin" /> Đang gửi...</> : 'Gửi đăng ký'}
            </button>
            <p className="text-xs text-center text-muted-foreground" suppressHydrationWarning>
              <span className="text-red-500">*</span> Trường bắt buộc · Thông tin của bạn được bảo mật và chỉ dùng cho mục đích quản lý cư trú.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
