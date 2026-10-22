'use client';
import React from 'react';
import { Worker } from '@/data/workers';
import { AlertTriangle } from 'lucide-react';

interface Props {
  target: Worker | Worker[];
  onConfirm: () => void;
  onClose: () => void;
}

export default function DeleteConfirmModal({ target, onConfirm, onClose }: Props) {
  const isMulti = Array.isArray(target);
  const count = isMulti ? (target as Worker[]).length : 1;
  const workerName = isMulti ? '' : (target as Worker).hoVaTen;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm fade-in">
      <div className="modal-enter bg-card rounded-xl shadow-modal w-full max-w-sm">
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={18} className="text-red-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Xác nhận xóa</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {isMulti ? (
                  <>Bạn có chắc chắn muốn xóa <strong className="text-foreground">{count} công nhân</strong> đã chọn khỏi hệ thống?</>
                ) : (
                  <>Bạn có chắc chắn muốn xóa công nhân <strong className="text-foreground">{workerName}</strong> khỏi hệ thống?</>
                )}
              </p>
              <p className="text-xs text-red-500 mt-1.5">Hành động này không thể hoàn tác.</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-secondary text-xs">Hủy bỏ</button>
            <button onClick={onConfirm} className="btn-danger text-xs">
              {isMulti ? `Xóa ${count} công nhân` : 'Xóa công nhân'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}