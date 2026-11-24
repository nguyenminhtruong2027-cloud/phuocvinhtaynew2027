'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Compass,
  Download,
  Layers,
  MapPin,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { CampusKtxNode } from '../types';
import {
  findBuildingBlueprint,
  sanitizeBlueprintConfig,
  type BuildingBlueprintOverride,
  type CampusBlueprintConfig,
  type CampusLandmarkConfig,
  type CampusLandmarkType,
} from '../scene/campusLayoutConfig';

interface BlueprintEditorPanelProps {
  config: CampusBlueprintConfig;
  allKtxNodes: CampusKtxNode[];
  isLight: boolean;
  saving: boolean;
  getBuiltBuildingPositions: () => Record<
    string,
    { x: number; z: number; rotationDeg: number }
  >;
  onChange: (next: CampusBlueprintConfig) => void;
  onSave: () => void;
  onResetAuto: () => void;
  onClose: () => void;
  onFocusBuilding: (buildingKey: string) => void;
}

const LANDMARK_LABELS: Record<CampusLandmarkType, string> = {
  gate: 'Cổng bảo vệ',
  parking: 'Nhà xe',
  courtyard: 'Sân chung',
  canteen: 'Căn tin / Nhà ăn',
  utility: 'Kỹ thuật / Phụ trợ',
};

export default function BlueprintEditorPanel({
  config,
  allKtxNodes,
  isLight,
  saving,
  getBuiltBuildingPositions,
  onChange,
  onSave,
  onResetAuto,
  onClose,
  onFocusBuilding,
}: BlueprintEditorPanelProps) {
  const [tab, setTab] = useState<'buildings' | 'landmarks'>('buildings');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allBuildings = useMemo(
    () =>
      allKtxNodes.flatMap(k =>
        k.buildings.map(b => ({
          key: b.key,
          ktx: k.ktx,
          day: b.day,
          roomCount: b.rooms.length,
        }))
      ),
    [allKtxNodes]
  );

  const [selectedBuildingKey, setSelectedBuildingKey] = useState<string>(
    () => allBuildings[0]?.key || ''
  );

  const activeBuilding = useMemo(
    () => allBuildings.find(b => b.key === selectedBuildingKey) || allBuildings[0] || null,
    [allBuildings, selectedBuildingKey]
  );

  const activeOverride: BuildingBlueprintOverride | null = useMemo(() => {
    if (!activeBuilding) return null;
    const found = findBuildingBlueprint(config, activeBuilding.ktx, activeBuilding.day);
    if (found) return found;
    const builtMap = getBuiltBuildingPositions();
    const built = builtMap[activeBuilding.key];
    return {
      ktx: activeBuilding.ktx,
      day: activeBuilding.day,
      x: built ? built.x : 0,
      z: built ? built.z : 0,
      rotationDeg: built ? built.rotationDeg : 0,
      floors: 1,
      roomsPerFloor: undefined,
    };
  }, [activeBuilding, config, getBuiltBuildingPositions]);

  // Seed all current built positions when switching to custom override mode so NO building ever jumps to (0, 0)
  const buildSeededBuildings = () => {
    const builtMap = getBuiltBuildingPositions();
    const seeded: BuildingBlueprintOverride[] = [...config.buildings];
    allBuildings.forEach(b => {
      const exists = findBuildingBlueprint({ ...config, buildings: seeded }, b.ktx, b.day);
      if (!exists) {
        const pos = builtMap[b.key];
        seeded.push({
          ktx: b.ktx,
          day: b.day,
          x: pos ? pos.x : 0,
          z: pos ? pos.z : 0,
          rotationDeg: pos ? pos.rotationDeg : 0,
          floors: 1,
          roomsPerFloor: undefined,
        });
      }
    });
    return seeded;
  };

  const updateBuildingOverride = (patch: Partial<BuildingBlueprintOverride>) => {
    if (!activeBuilding || !activeOverride) return;
    const baseList =
      config.mode === 'vincons' || config.buildings.length < allBuildings.length
        ? buildSeededBuildings()
        : config.buildings;

    const currentEntry =
      findBuildingBlueprint({ ...config, buildings: baseList }, activeBuilding.ktx, activeBuilding.day) ||
      activeOverride;

    const nextEntry: BuildingBlueprintOverride = {
      ...currentEntry,
      ...patch,
      ktx: activeBuilding.ktx,
      day: activeBuilding.day,
    };
    const filtered = baseList.filter(
      b =>
        !(
          b.ktx.trim().toLowerCase() === activeBuilding.ktx.trim().toLowerCase() &&
          b.day.trim().toLowerCase() === activeBuilding.day.trim().toLowerCase()
        )
    );
    onChange({
      ...config,
      mode: 'blueprint',
      buildings: [...filtered, nextEntry],
    });
  };

  const handleAddLandmark = () => {
    const idx = config.landmarks.length + 1;
    const next: CampusLandmarkConfig = {
      id: `lm-${Date.now()}-${idx}`,
      type: 'gate',
      label: `Cổng / Công trình ${idx}`,
      subtext: 'Hạ tầng KTX',
      x: 0,
      z: 16,
      width: 4,
      depth: 2.5,
      rotationDeg: 0,
    };
    onChange({
      ...config,
      landmarks: [...config.landmarks, next],
    });
  };

  const updateLandmark = (id: string, patch: Partial<CampusLandmarkConfig>) => {
    onChange({
      ...config,
      landmarks: config.landmarks.map(l => (l.id === id ? { ...l, ...patch } : l)),
    });
  };

  const removeLandmark = (id: string) => {
    onChange({
      ...config,
      landmarks: config.landmarks.filter(l => l.id !== id),
    });
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ktx_3d_blueprint_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Đã xuất file cấu hình mặt bằng (JSON)');
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = sanitizeBlueprintConfig(JSON.parse(String(reader.result || '{}')));
        onChange(parsed);
        toast.success('Đã nạp cấu hình mặt bằng — bấm "Lưu mặt bằng" để áp dụng lâu dài');
      } catch {
        toast.error('File JSON không hợp lệ');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const cardCls = isLight
    ? 'bg-white/95 border-slate-300 text-slate-900 shadow-xl'
    : 'bg-[#0f172a]/96 border-slate-700/85 text-slate-100 shadow-2xl';
  const mutedCls = isLight ? 'text-slate-600' : 'text-slate-400';
  const inputCls = isLight
    ? 'bg-slate-50 border-slate-300 text-slate-900'
    : 'bg-slate-900 border-slate-700 text-slate-100';
  const subtleBtn = isLight
    ? 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200';
  const dividerCls = isLight ? 'border-slate-200' : 'border-slate-800';

  return (
    <div
      className={`pointer-events-auto w-[min(92vw,360px)] max-h-[calc(100vh-140px)] flex flex-col rounded-2xl border overflow-hidden ${cardCls}`}
    >
      {/* Header */}
      <div className={`flex items-center justify-between gap-2 px-3.5 py-2.5 border-b ${dividerCls}`}>
        <div className="flex items-center gap-2 min-w-0">
          <Compass size={15} className="text-blue-500 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-xs font-bold truncate">Chỉnh mặt bằng 3D (Admin)</h3>
            <p className={`text-[10px] truncate ${mutedCls}`}>
              Sơ đồ 1 tầng theo bản vẽ VHM.PVT.CTT.KTX-00
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`p-1 rounded-lg ${mutedCls} hover:text-blue-500`}
          aria-label="Đóng trình chỉnh mặt bằng"
        >
          <X size={14} />
        </button>
      </div>

      {/* Mode Switch + Tabs */}
      <div className={`px-3.5 py-2.5 border-b space-y-2 ${dividerCls}`}>
        <div className="space-y-1">
          <span className={`text-[11px] font-semibold block ${mutedCls}`}>Bố cục mặt bằng:</span>
          <div
            className={`grid grid-cols-2 gap-0.5 rounded-lg border p-0.5 text-[11px] ${
              isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-900 border-slate-800'
            }`}
          >
            <button
              type="button"
              onClick={() => onChange({ ...config, mode: 'vincons' })}
              className={`px-2 py-1 rounded-md font-semibold transition-colors ${
                config.mode === 'vincons' ? 'bg-blue-600 text-white' : mutedCls
              }`}
            >
              Bản vẽ gốc
            </button>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...config,
                  mode: 'blueprint',
                  buildings:
                    config.buildings.length < allBuildings.length
                      ? buildSeededBuildings()
                      : config.buildings,
                })
              }
              className={`px-2 py-1 rounded-md font-semibold transition-colors ${
                config.mode === 'blueprint' ? 'bg-blue-600 text-white' : mutedCls
              }`}
            >
              Tùy chỉnh tọa độ
            </button>
          </div>
          {config.mode === 'vincons' && (
            <p className={`text-[10px] leading-snug ${mutedCls}`}>
              Khớp 1:1 bản vẽ <strong>VHM.PVT.CTT.KTX-00</strong> — <strong>Khu Lán Trại Vincons</strong> (151,2m × 145,6m · 1 tầng): 6 dãy nhà ở (3 Bắc + 3 Nam), 2 nhà ăn &amp; 4 gian soạn đồ ăn, 3 Căng Teen (20), Container Face ID (8), Khu thăm thân (5), 3 Bồn Inox 20m³ (10), WC/Tắm/Giặt (13–17), Bể XLNT (19), 13 nhà xe (6) &amp; rào B40 phía Bắc.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => setTab('buildings')}
            className={`py-1.5 rounded-lg border font-semibold transition-colors ${
              tab === 'buildings' ? 'bg-blue-600 border-blue-500 text-white' : subtleBtn
            }`}
          >
            Dãy nhà ({allBuildings.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('landmarks')}
            className={`py-1.5 rounded-lg border font-semibold transition-colors ${
              tab === 'landmarks' ? 'bg-blue-600 border-blue-500 text-white' : subtleBtn
            }`}
          >
            Công trình ({config.landmarks.length})
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3.5 space-y-3 text-xs">
        {tab === 'buildings' ? (
          <>
            <div className="space-y-1">
              <label className={`text-[11px] font-semibold ${mutedCls}`}>Chọn dãy nhà cần căn chỉnh</label>
              <div className="flex items-center gap-1.5">
                <select
                  value={activeBuilding?.key || ''}
                  onChange={e => setSelectedBuildingKey(e.target.value)}
                  className={`flex-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-blue-500 ${inputCls}`}
                >
                  {allBuildings.map(b => (
                    <option key={b.key} value={b.key}>
                      {b.ktx} · {b.day} ({b.roomCount} phòng)
                    </option>
                  ))}
                </select>
                {activeBuilding && (
                  <button
                    type="button"
                    onClick={() => onFocusBuilding(activeBuilding.key)}
                    title="Bay camera tới dãy này"
                    className={`p-1.5 rounded-xl border ${subtleBtn}`}
                  >
                    <MapPin size={14} />
                  </button>
                )}
              </div>
            </div>

            {activeOverride && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={`text-[10px] font-semibold block mb-1 ${mutedCls}`}>
                      Tọa độ X (Trái / Phải - m)
                    </label>
                    <input
                      type="number"
                      step={1}
                      value={activeOverride.x}
                      onChange={e => updateBuildingOverride({ x: Number(e.target.value) || 0 })}
                      className={`w-full rounded-lg border px-2 py-1.5 text-xs font-mono font-tabular focus:outline-none focus:border-blue-500 ${inputCls}`}
                    />
                  </div>
                  <div>
                    <label className={`text-[10px] font-semibold block mb-1 ${mutedCls}`}>
                      Tọa độ Z (Trước / Sau - m)
                    </label>
                    <input
                      type="number"
                      step={1}
                      value={activeOverride.z}
                      onChange={e => updateBuildingOverride({ z: Number(e.target.value) || 0 })}
                      className={`w-full rounded-lg border px-2 py-1.5 text-xs font-mono font-tabular focus:outline-none focus:border-blue-500 ${inputCls}`}
                    />
                  </div>
                </div>

                {/* Quick 4-way spatial nudge (±2m) */}
                <div className="flex items-center justify-between gap-1.5">
                  <span className={`text-[10px] font-semibold ${mutedCls}`}>Dịch chuyển nhanh (±2m):</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => updateBuildingOverride({ x: Math.round((activeOverride.x - 2) * 10) / 10 })}
                      title="Dịch sang trái 2m"
                      className={`p-1 rounded-lg border ${subtleBtn}`}
                    >
                      <ArrowLeft size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateBuildingOverride({ z: Math.round((activeOverride.z - 2) * 10) / 10 })}
                      title="Dịch ra sau 2m"
                      className={`p-1 rounded-lg border ${subtleBtn}`}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateBuildingOverride({ z: Math.round((activeOverride.z + 2) * 10) / 10 })}
                      title="Dịch ra trước 2m"
                      className={`p-1 rounded-lg border ${subtleBtn}`}
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateBuildingOverride({ x: Math.round((activeOverride.x + 2) * 10) / 10 })}
                      title="Dịch sang phải 2m"
                      className={`p-1 rounded-lg border ${subtleBtn}`}
                    >
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>

                {/* Free-Angle 0°–359° Rotation Slider + Quick Step Buttons */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className={`text-[10px] font-semibold ${mutedCls}`}>
                      Góc xoay tự do (0° – 359°)
                    </label>
                    <span className="text-[11px] font-mono font-bold text-blue-500 font-tabular">
                      {(((activeOverride.rotationDeg || 0) % 360) + 360) % 360}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    step={1}
                    value={(((activeOverride.rotationDeg || 0) % 360) + 360) % 360}
                    onChange={e => updateBuildingOverride({ rotationDeg: Number(e.target.value) })}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() =>
                        updateBuildingOverride({
                          rotationDeg: (((activeOverride.rotationDeg || 0) - 15) % 360 + 360) % 360,
                        })
                      }
                      title="Xoay ngược chiều -15°"
                      className={`px-1.5 py-1 rounded-lg border text-[10px] font-mono font-semibold ${subtleBtn}`}
                    >
                      -15°
                    </button>
                    {[0, 45, 90, 180, 270].map(deg => (
                      <button
                        key={deg}
                        type="button"
                        onClick={() => updateBuildingOverride({ rotationDeg: deg })}
                        className={`px-1.5 py-1 rounded-lg border text-[10px] font-mono font-semibold ${
                          (((activeOverride.rotationDeg || 0) % 360) + 360) % 360 === deg
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : subtleBtn
                        }`}
                      >
                        {deg}°
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateBuildingOverride({
                          rotationDeg: ((activeOverride.rotationDeg || 0) + 15) % 360,
                        })
                      }
                      title="Xoay thuận chiều +15°"
                      className={`px-1.5 py-1 rounded-lg border text-[10px] font-mono font-semibold ${subtleBtn}`}
                    >
                      +15°
                    </button>
                    <input
                      type="number"
                      step={1}
                      value={activeOverride.rotationDeg || 0}
                      onChange={e =>
                        updateBuildingOverride({ rotationDeg: Number(e.target.value) || 0 })
                      }
                      className={`w-14 rounded-lg border px-1.5 py-0.5 text-[11px] font-mono font-tabular focus:outline-none focus:border-blue-500 ${inputCls}`}
                    />
                  </div>
                </div>

                <div
                  className={`rounded-xl border px-2.5 py-2 text-[11px] ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/75 border-slate-800'
                  } ${mutedCls}`}
                >
                  <Layers size={12} className="inline mr-1 text-blue-500" />
                  Toàn bộ dãy nhà KTX được thiết lập cố định <strong>1 tầng</strong> theo bản vẽ thực tế.
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handleAddLandmark}
              className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
            >
              <Plus size={13} />
              <span>Thêm Cổng / Nhà xe / Sân chung</span>
            </button>

            {config.landmarks.length === 0 ? (
              <p className={`text-center py-4 text-[11px] ${mutedCls}`}>
                Chưa có công trình phụ trợ tùy chỉnh (đang hiện Cổng KTX mặc định).
              </p>
            ) : (
              config.landmarks.map(lm => (
                <div
                  key={lm.id}
                  className={`rounded-xl border p-2.5 space-y-2 ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-900/70 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <select
                      value={lm.type}
                      onChange={e =>
                        updateLandmark(lm.id, { type: e.target.value as CampusLandmarkType })
                      }
                      className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${inputCls}`}
                    >
                      {(Object.keys(LANDMARK_LABELS) as CampusLandmarkType[]).map(k => (
                        <option key={k} value={k}>
                          {LANDMARK_LABELS[k]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={lm.label}
                      onChange={e => updateLandmark(lm.id, { label: e.target.value })}
                      placeholder="Tên hiển thị..."
                      className={`flex-1 min-w-0 rounded-lg border px-2 py-1 text-[11px] font-semibold ${inputCls}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeLandmark(lm.id)}
                      className="p-1 rounded-lg text-rose-500 hover:bg-rose-500/15"
                      title="Xóa công trình"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                    <div>
                      <span className={mutedCls}>X</span>
                      <input
                        type="number"
                        value={lm.x}
                        onChange={e => updateLandmark(lm.id, { x: Number(e.target.value) || 0 })}
                        className={`w-full rounded border px-1.5 py-0.5 font-mono ${inputCls}`}
                      />
                    </div>
                    <div>
                      <span className={mutedCls}>Z</span>
                      <input
                        type="number"
                        value={lm.z}
                        onChange={e => updateLandmark(lm.id, { z: Number(e.target.value) || 0 })}
                        className={`w-full rounded border px-1.5 py-0.5 font-mono ${inputCls}`}
                      />
                    </div>
                    <div>
                      <span className={mutedCls}>Rộng</span>
                      <input
                        type="number"
                        value={lm.width}
                        onChange={e =>
                          updateLandmark(lm.id, { width: Math.max(1.5, Number(e.target.value) || 3) })
                        }
                        className={`w-full rounded border px-1.5 py-0.5 font-mono ${inputCls}`}
                      />
                    </div>
                    <div>
                      <span className={mutedCls}>Sâu</span>
                      <input
                        type="number"
                        value={lm.depth}
                        onChange={e =>
                          updateLandmark(lm.id, { depth: Math.max(1.5, Number(e.target.value) || 2) })
                        }
                        className={`w-full rounded border px-1.5 py-0.5 font-mono ${inputCls}`}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <RotateCw size={11} className={mutedCls} />
                    <input
                      type="range"
                      min={0}
                      max={359}
                      step={1}
                      value={(((lm.rotationDeg || 0) % 360) + 360) % 360}
                      onChange={e => updateLandmark(lm.id, { rotationDeg: Number(e.target.value) })}
                      className="flex-1 accent-blue-500 cursor-pointer"
                    />
                    <span className="text-[10px] font-mono font-tabular w-8 text-right">
                      {(((lm.rotationDeg || 0) % 360) + 360) % 360}°
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Footer Save / Export / Import / Reset */}
      <div className={`px-3.5 py-2.5 border-t space-y-2 ${dividerCls}`}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-bold transition-colors"
          >
            <Save size={13} />
            <span>{saving ? 'Đang lưu...' : 'Lưu mặt bằng'}</span>
          </button>
          <button
            type="button"
            onClick={onResetAuto}
            title="Khôi phục về bản vẽ gốc Vincons"
            className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold ${subtleBtn}`}
          >
            <RotateCcw size={13} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={handleExportJson}
            className={`inline-flex items-center justify-center gap-1.5 py-1 rounded-lg border text-[11px] font-semibold ${subtleBtn}`}
          >
            <Download size={12} />
            <span>Xuất JSON</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`inline-flex items-center justify-center gap-1.5 py-1 rounded-lg border text-[11px] font-semibold ${subtleBtn}`}
          >
            <Upload size={12} />
            <span>Nhập JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportJson}
            className="hidden"
          />
        </div>
      </div>
    </div>
  );
}
