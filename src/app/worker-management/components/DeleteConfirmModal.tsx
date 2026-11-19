'use client';
import React from 'react';
import { motion } from 'motion/react';
import { Worker } from '@/data/workers';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { CraftIconBadge } from '@/components/ui/CraftIcon';

interface Props {
  target: Worker | Worker[];
  onConfirm: () => void;
  onClose: () => void;
}

export default function DeleteConfirmModal({ target, onConfirm, onClose }: Props) {
  const isBulk = Array.isArray(target);
  const count = isBulk ? target.length : 1;
  const name = !isBulk ? (target as Worker).hoVaTen : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        onClick={e => e.stopPropagation()}
        className="surface-elevated rounded-2xl shadow-2xl w-full max-w-md border border-dgr/40 overflow-hidden"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3.5">
              <CraftIconBadge icon={AlertTriangle} tone="rose" size="md" interactive={false} />
              <div>
                <h3 className="text-base font-extrabold text-tx">
                  {isBulk ? `Xóa ${count} công nhân đã chọn?` : 'Xác nhận xóa công nhân'}
                </h3>
                <p className="text-xs sm:text-sm text-mu mt-1 leading-relaxed">
                  {isBulk
                    ? `Bạn có chắc chắn muốn xóa ${count} hồ sơ đã chọn? Thao tác này không thể hoàn tác.`
                    : `Bạn có chắc chắn muốn xóa hồ sơ của "${name}"? Dữ liệu sẽ bị xóa khỏi hệ thống.`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-mu hover:text-tx hover:bg-act transition-colors shrink-0"
              aria-label="Đóng"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-bdr">
            <button type="button" onClick={onClose} className="btn-secondary text-xs sm:text-sm">
              Hủy
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="btn-danger text-xs sm:text-sm shadow-sm cursor-pointer"
            >
              <Trash2 size={14} />
              <span>{isBulk ? `Xóa ${count} hồ sơ` : 'Xóa hồ sơ'}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}