import * as XLSX from 'xlsx';

/**
 * Xuất file Excel (.xlsx) chuẩn cấu trúc binary OOXML không bị lỗi corruption trên Microsoft Excel & WPS Office.
 * Tự động tính toán độ rộng cột (!cols) phù hợp với độ dài văn bản Tiếng Việt.
 */
export function exportToExcel<T extends Record<string, any>>(
  data: T[],
  fileName: string,
  sheetName = 'Danh sách'
): boolean {
  try {
    if (!data || data.length === 0) {
      // Vẫn tạo sheet rỗng với header nếu có
      const ws = XLSX.utils.json_to_sheet([{}]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
      return saveWorkbook(wb, fileName);
    }

    const ws = XLSX.utils.json_to_sheet(data);

    // Tính độ rộng cột tự động để khi mở file Excel không bị che khuất nội dung
    const keys = Object.keys(data[0] || {});
    const colWidths = keys.map((key) => {
      let maxLen = key.length;
      for (let i = 0; i < Math.min(data.length, 500); i++) {
        const val = data[i]?.[key];
        if (val !== undefined && val !== null) {
          const str = String(val);
          if (str.length > maxLen) {
            maxLen = Math.min(str.length, 60);
          }
        }
      }
      return { wch: Math.max(maxLen + 4, 12) };
    });
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    // Tên sheet trong Excel tối đa 31 ký tự và không chứa ký tự cấm: : \ / ? * [ ]
    const safeSheetName = (sheetName || 'Sheet1')
      .replace(/[:\\/?*[\]]/g, '')
      .slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName || 'Sheet1');

    return saveWorkbook(wb, fileName);
  } catch (err) {
    console.error('Lỗi khi xuất file Excel:', err);
    // Fallback sang CSV chuẩn UTF-8 có BOM nếu xuất xlsx gặp sự cố môi trường
    return exportToCsv(data, fileName);
  }
}

export interface ExcelSheetInput<T extends Record<string, any> = Record<string, any>> {
  name: string;
  data: T[];
  emptyHeaders?: string[];
}

/**
 * Xuất nhiều sheet vào cùng 1 file Excel (.xlsx) với độ rộng cột tự động chuẩn Tiếng Việt.
 */
export function exportMultiSheetExcel(
  sheets: ExcelSheetInput[],
  fileName: string
): boolean {
  try {
    const wb = XLSX.utils.book_new();
    const usedNames = new Set<string>();

    sheets.forEach((sheet, idx) => {
      const rows = sheet.data && sheet.data.length > 0
        ? sheet.data
        : sheet.emptyHeaders && sheet.emptyHeaders.length > 0
        ? [Object.fromEntries(sheet.emptyHeaders.map(h => [h, '']))]
        : [{}];

      const ws = XLSX.utils.json_to_sheet(rows);
      const keys = Object.keys(rows[0] || {});
      if (keys.length > 0) {
        ws['!cols'] = keys.map((key) => {
          let maxLen = key.length;
          for (let i = 0; i < Math.min(rows.length, 1000); i++) {
            const val = rows[i]?.[key];
            if (val !== undefined && val !== null) {
              const str = String(val);
              if (str.length > maxLen) {
                maxLen = Math.min(str.length, 60);
              }
            }
          }
          return { wch: Math.max(maxLen + 4, 12) };
        });
      }

      const base = (sheet.name || `Sheet${idx + 1}`)
        .replace(/[:\\/?*[\]]/g, '')
        .trim()
        .slice(0, 31) || `Sheet${idx + 1}`;
      let safeName = base;
      let suffix = 1;
      while (usedNames.has(safeName)) {
        const tag = `_${suffix++}`;
        safeName = `${base.slice(0, Math.max(1, 31 - tag.length))}${tag}`;
      }
      usedNames.add(safeName);
      XLSX.utils.book_append_sheet(wb, ws, safeName);
    });

    return saveWorkbook(wb, fileName);
  } catch (err) {
    console.error('Lỗi khi xuất file Excel nhiều sheet:', err);
    if (sheets[0]?.data) {
      return exportToCsv(sheets[0].data, fileName);
    }
    return false;
  }
}

/**
 * Lưu Workbook SheetJS thành file binary .xlsx thực thụ bằng Blob ArrayBuffer
 * Tránh hoàn toàn lỗi UTF-8 byte expansion khi truyền type: 'binary' vào new Blob()
 */
export function saveWorkbook(wb: XLSX.WorkBook, fileName: string): boolean {
  try {
    // Luôn sử dụng type: 'array' để nhận về ArrayBuffer/Uint8Array chuẩn nhị phân
    const excelBuffer = XLSX.write(wb, {
      bookType: 'xlsx',
      type: 'array',
      compression: true,
    });

    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const safeName = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
    downloadBlob(blob, safeName);
    return true;
  } catch (err) {
    console.error('Lỗi khi tạo binary file Excel:', err);
    return false;
  }
}

/**
 * Xuất file CSV chuẩn UTF-8 có BOM (\uFEFF) giúp Microsoft Excel và WPS Office
 * mở hiển thị đầy đủ Tiếng Việt có dấu không bao giờ bị lỗi font hoặc hỏng file.
 */
export function exportToCsv<T extends Record<string, any>>(
  data: T[],
  fileName: string
): boolean {
  try {
    if (!data || data.length === 0) return false;

    const headers = Object.keys(data[0]);
    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const csvRows: string[] = [];
    csvRows.push(headers.map(escapeCsv).join(','));

    for (const row of data) {
      csvRows.push(headers.map((h) => escapeCsv(row[h])).join(','));
    }

    const csvContent = '\uFEFF' + csvRows.join('\r\n');
    const blob = new Blob([csvContent], {
      type: 'text/csv;charset=utf-8;',
    });

    const safeName = fileName.replace(/\.xlsx$/i, '.csv');
    const finalName = safeName.endsWith('.csv') ? safeName : `${safeName}.csv`;
    downloadBlob(blob, finalName);
    return true;
  } catch (err) {
    console.error('Lỗi khi xuất CSV:', err);
    return false;
  }
}

/** Helper tải Blob về máy người dùng */
function downloadBlob(blob: Blob, fileName: string) {
  if (typeof window === 'undefined') return;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();

  // Dọn dẹp DOM và giải phóng bộ nhớ
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 1000);
}
