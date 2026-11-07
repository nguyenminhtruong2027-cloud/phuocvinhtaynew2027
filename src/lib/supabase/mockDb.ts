// Mock in-memory & localStorage database for KTX Phước Vĩnh Tây
// Automatically active when remote Supabase is unconfigured, unreachable, or dummy URL.

export interface MockRow {
  [key: string]: any;
}

const STORAGE_PREFIX = 'ktx_mock_db_';

// Initial Seed Data
const INITIAL_FACILITIES: MockRow[] = [
  // KTX 1 - Dãy 1
  { id: 'fac-101', ktx: 'KTX 1', day: 'Dãy 1', phong_khu_vuc: '1', giuong: 20, dieu_hoa: 2, tu: 4, quat: 4, o_cam_dien: 8, remote: 2, bong_tuyp: 4, ban_an: 1, ghe_an: 8, tinh_trang: 'Hoạt động tốt', ghi_chu: 'Phòng nam' },
  { id: 'fac-102', ktx: 'KTX 1', day: 'Dãy 1', phong_khu_vuc: '2', giuong: 20, dieu_hoa: 2, tu: 4, quat: 4, o_cam_dien: 8, remote: 2, bong_tuyp: 4, ban_an: 1, ghe_an: 8, tinh_trang: 'Hoạt động tốt', ghi_chu: 'Phòng nam' },
  { id: 'fac-103', ktx: 'KTX 1', day: 'Dãy 1', phong_khu_vuc: '3', giuong: 20, dieu_hoa: 2, tu: 4, quat: 4, o_cam_dien: 8, remote: 2, bong_tuyp: 4, ban_an: 1, ghe_an: 8, tinh_trang: 'Hoạt động tốt', ghi_chu: 'Phòng nam' },
  // KTX 1 - Dãy 2
  { id: 'fac-104', ktx: 'KTX 1', day: 'Dãy 2', phong_khu_vuc: '1', giuong: 20, dieu_hoa: 2, tu: 4, quat: 4, o_cam_dien: 8, remote: 2, bong_tuyp: 4, ban_an: 1, ghe_an: 8, tinh_trang: 'Hoạt động tốt', ghi_chu: 'Phòng nam' },
  { id: 'fac-105', ktx: 'KTX 1', day: 'Dãy 2', phong_khu_vuc: '2', giuong: 20, dieu_hoa: 2, tu: 4, quat: 4, o_cam_dien: 8, remote: 2, bong_tuyp: 4, ban_an: 1, ghe_an: 8, tinh_trang: 'Hoạt động tốt', ghi_chu: 'Phòng nữ' },
  // KTX 2 - Dãy 1
  { id: 'fac-201', ktx: 'KTX 2', day: 'Dãy 1', phong_khu_vuc: '1', giuong: 20, dieu_hoa: 2, tu: 4, quat: 4, o_cam_dien: 8, remote: 2, bong_tuyp: 4, ban_an: 1, ghe_an: 8, tinh_trang: 'Hoạt động tốt', ghi_chu: 'Phòng nam' },
  { id: 'fac-202', ktx: 'KTX 2', day: 'Dãy 1', phong_khu_vuc: '2', giuong: 20, dieu_hoa: 2, tu: 4, quat: 4, o_cam_dien: 8, remote: 2, bong_tuyp: 4, ban_an: 1, ghe_an: 8, tinh_trang: 'Hoạt động tốt', ghi_chu: 'Phòng nam' },
];

const INITIAL_PROFILES: MockRow[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin@ktx.vn',
    full_name: 'Quản Trị Viên KTX',
    role: 'admin',
    assigned_blocks: ['KTX 1 - Dãy 1', 'KTX 1 - Dãy 2', 'KTX 1 - Dãy 3', 'KTX 2 - Dãy 1'],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'staff@ktx.vn',
    full_name: 'Trần Văn Cán Bộ',
    role: 'staff',
    assigned_blocks: ['KTX 1 - Dãy 1', 'KTX 1 - Dãy 2'],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

const INITIAL_WORKERS: MockRow[] = [
  {
    id: 'w-001', stt: 1, ho_va_ten: 'Nguyễn Văn Hùng', ma_nv: 'NV-1001', tieu_doan: 'Tiểu đoàn 1',
    ktx: 'KTX 1', don_vi: 'Tổng thầu Coteccons', gioi_tinh: 'Nam', ngay_sinh: '15/04/1992',
    so_dien_thoai: '0912345671', day: 'Dãy 1', phong_so: '1', giuong: '1', cccd: '079092001111',
    ho_khau_tinh: 'Long An', to_truong: 'Nguyễn Văn Bình', sdt_to_truong: '0908111222',
    ngay_vao_ktx: '2026-01-10', ngay_ra_ktx: null, ghi_chu: 'Công nhân cốt thép',
    khoa_tra_cuu: 'KTX 1|Dãy 1|1', avatar: '', tam_tru_status: 'registered',
  },
  {
    id: 'w-002', stt: 2, ho_va_ten: 'Trần Quốc Tuấn', ma_nv: 'NV-1002', tieu_doan: 'Tiểu đoàn 1',
    ktx: 'KTX 1', don_vi: 'Tổng thầu Coteccons', gioi_tinh: 'Nam', ngay_sinh: '20/08/1995',
    so_dien_thoai: '0912345672', day: 'Dãy 1', phong_so: '1', giuong: '2', cccd: '079095002222',
    ho_khau_tinh: 'Tiền Giang', to_truong: 'Nguyễn Văn Bình', sdt_to_truong: '0908111222',
    ngay_vao_ktx: '2026-01-10', ngay_ra_ktx: null, ghi_chu: '',
    khoa_tra_cuu: 'KTX 1|Dãy 1|1', avatar: '', tam_tru_status: 'registered',
  },
  {
    id: 'w-003', stt: 3, ho_va_ten: 'Lê Minh Đức', ma_nv: 'NV-1003', tieu_doan: 'Tiểu đoàn 1',
    ktx: 'KTX 1', don_vi: 'Nhà thầu Hòa Bình', gioi_tinh: 'Nam', ngay_sinh: '10/02/1988',
    so_dien_thoai: '0912345673', day: 'Dãy 1', phong_so: '2', giuong: '1', cccd: '079088003333',
    ho_khau_tinh: 'Bến Tre', to_truong: 'Nguyễn Văn Bình', sdt_to_truong: '0908111222',
    ngay_vao_ktx: '2026-01-12', ngay_ra_ktx: null, ghi_chu: '',
    khoa_tra_cuu: 'KTX 1|Dãy 1|2', avatar: '', tam_tru_status: 'registered',
  },
  {
    id: 'w-004', stt: 4, ho_va_ten: 'Phạm Văn Nam', ma_nv: 'NV-1004', tieu_doan: 'Tiểu đoàn 1',
    ktx: 'KTX 1', don_vi: 'Nhà thầu Hòa Bình', gioi_tinh: 'Nam', ngay_sinh: '05/11/1996',
    so_dien_thoai: '0912345674', day: 'Dãy 1', phong_so: '2', giuong: '2', cccd: '079096004444',
    ho_khau_tinh: 'Đồng Tháp', to_truong: 'Nguyễn Văn Bình', sdt_to_truong: '0908111222',
    ngay_vao_ktx: '2026-01-15', ngay_ra_ktx: null, ghi_chu: '',
    khoa_tra_cuu: 'KTX 1|Dãy 1|2', avatar: '', tam_tru_status: 'registered',
  },
  {
    id: 'w-005', stt: 5, ho_va_ten: 'Hoàng Đình Trọng', ma_nv: 'NV-1005', tieu_doan: 'Tiểu đoàn 2',
    ktx: 'KTX 1', don_vi: 'Cơ điện REE', gioi_tinh: 'Nam', ngay_sinh: '18/06/1990',
    so_dien_thoai: '0912345675', day: 'Dãy 2', phong_so: '1', giuong: '1', cccd: '079090005555',
    ho_khau_tinh: 'An Giang', to_truong: 'Trần Quốc Toản', sdt_to_truong: '0909333444',
    ngay_vao_ktx: '2026-01-16', ngay_ra_ktx: null, ghi_chu: '',
    khoa_tra_cuu: 'KTX 1|Dãy 2|1', avatar: '', tam_tru_status: 'registered',
  },
  {
    id: 'w-006', stt: 6, ho_va_ten: 'Lê Thị Thu Mai', ma_nv: 'NV-1006', tieu_doan: 'Tiểu đoàn 2',
    ktx: 'KTX 1', don_vi: 'Vệ sinh & Môi trường', gioi_tinh: 'Nữ', ngay_sinh: '22/09/1994',
    so_dien_thoai: '0912345676', day: 'Dãy 2', phong_so: '2', giuong: '1', cccd: '079094006666',
    ho_khau_tinh: 'Cần Thơ', to_truong: 'Trần Quốc Toản', sdt_to_truong: '0909333444',
    ngay_vao_ktx: '2026-01-18', ngay_ra_ktx: null, ghi_chu: 'Tổ trưởng phòng nữ',
    khoa_tra_cuu: 'KTX 1|Dãy 2|2', avatar: '', tam_tru_status: 'registered',
  },
  {
    id: 'w-007', stt: 7, ho_va_ten: 'Nguyễn Thị Hồng', ma_nv: 'NV-1007', tieu_doan: 'Tiểu đoàn 2',
    ktx: 'KTX 1', don_vi: 'Vệ sinh & Môi trường', gioi_tinh: 'Nữ', ngay_sinh: '30/12/1997',
    so_dien_thoai: '0912345677', day: 'Dãy 2', phong_so: '2', giuong: '2', cccd: '079097007777',
    ho_khau_tinh: 'Vĩnh Long', to_truong: 'Trần Quốc Toản', sdt_to_truong: '0909333444',
    ngay_vao_ktx: '2026-01-18', ngay_ra_ktx: null, ghi_chu: '',
    khoa_tra_cuu: 'KTX 1|Dãy 2|2', avatar: '', tam_tru_status: 'registered',
  },
  {
    id: 'w-008', stt: 8, ho_va_ten: 'Đỗ Quang Khải', ma_nv: 'NV-2001', tieu_doan: 'Tiểu đoàn 3',
    ktx: 'KTX 2', don_vi: 'Công ty XD Số 1', gioi_tinh: 'Nam', ngay_sinh: '12/03/1991',
    so_dien_thoai: '0912345678', day: 'Dãy 1', phong_so: '1', giuong: '1', cccd: '079091008888',
    ho_khau_tinh: 'TP Hồ Chí Minh', to_truong: 'Lê Văn Hùng', sdt_to_truong: '0918555666',
    ngay_vao_ktx: '2026-02-01', ngay_ra_ktx: null, ghi_chu: 'Lái máy đào',
    khoa_tra_cuu: 'KTX 2|Dãy 1|1', avatar: '', tam_tru_status: 'registered',
  },
  {
    id: 'w-009', stt: 9, ho_va_ten: 'Vũ Hải Đăng', ma_nv: 'NV-2002', tieu_doan: 'Tiểu đoàn 3',
    ktx: 'KTX 2', don_vi: 'Công ty XD Số 1', gioi_tinh: 'Nam', ngay_sinh: '25/07/1993',
    so_dien_thoai: '0912345679', day: 'Dãy 1', phong_so: '1', giuong: '2', cccd: '079093009999',
    ho_khau_tinh: 'Hải Phòng', to_truong: 'Lê Văn Hùng', sdt_to_truong: '0918555666',
    ngay_vao_ktx: '2026-02-01', ngay_ra_ktx: null, ghi_chu: '',
    khoa_tra_cuu: 'KTX 2|Dãy 1|1', avatar: '', tam_tru_status: 'registered',
  },
  {
    id: 'w-010', stt: 10, ho_va_ten: 'Bùi Thế Anh', ma_nv: 'NV-3001', tieu_doan: 'Tiểu đoàn 4',
    ktx: 'KTX 1', don_vi: 'Tư vấn giám sát Apave', gioi_tinh: 'Nam', ngay_sinh: '08/08/1985',
    so_dien_thoai: '0912345680', day: 'Dãy 3', phong_so: '3', giuong: '1', cccd: '079085001010',
    ho_khau_tinh: 'Đà Nẵng', to_truong: 'Lê Văn Hùng', sdt_to_truong: '0918555666',
    ngay_vao_ktx: '2026-02-10', ngay_ra_ktx: null, ghi_chu: 'Kỹ sư trưởng giám sát',
    khoa_tra_cuu: 'KTX 1|Dãy 3|3', avatar: '', tam_tru_status: 'registered',
  },
];

const INITIAL_BEDS: MockRow[] = [
  { id: 'b-01', ktx: 'KTX 1', day: 'Dãy 1', phong_so: '1', giuong: '1', status: 'occupied', ma_nv: 'NV-1001', ho_va_ten: 'Nguyễn Văn Hùng', worker_id: 'w-001' },
  { id: 'b-02', ktx: 'KTX 1', day: 'Dãy 1', phong_so: '1', giuong: '2', status: 'occupied', ma_nv: 'NV-1002', ho_va_ten: 'Trần Quốc Tuấn', worker_id: 'w-002' },
  { id: 'b-03', ktx: 'KTX 1', day: 'Dãy 1', phong_so: '1', giuong: '3', status: 'occupied', ma_nv: 'NV-1003', ho_va_ten: 'Lê Minh Đức', worker_id: 'w-003' },
  { id: 'b-04', ktx: 'KTX 1', day: 'Dãy 1', phong_so: '1', giuong: '4', status: 'empty', ma_nv: null, ho_va_ten: null, worker_id: null },
  { id: 'b-05', ktx: 'KTX 1', day: 'Dãy 1', phong_so: '1', giuong: '5', status: 'empty', ma_nv: null, ho_va_ten: null, worker_id: null },
  { id: 'b-06', ktx: 'KTX 1', day: 'Dãy 1', phong_so: '2', giuong: '1', status: 'occupied', ma_nv: 'NV-1004', ho_va_ten: 'Phạm Văn Nam', worker_id: 'w-004' },
  { id: 'b-07', ktx: 'KTX 1', day: 'Dãy 1', phong_so: '2', giuong: '2', status: 'occupied', ma_nv: 'NV-1005', ho_va_ten: 'Hoàng Đình Trọng', worker_id: 'w-005' },
  { id: 'b-08', ktx: 'KTX 1', day: 'Dãy 1', phong_so: '2', giuong: '3', status: 'empty', ma_nv: null, ho_va_ten: null, worker_id: null },
  { id: 'b-09', ktx: 'KTX 1', day: 'Dãy 2', phong_so: '1', giuong: '1', status: 'occupied', ma_nv: 'NV-1006', ho_va_ten: 'Lê Thị Thu Mai', worker_id: 'w-006' },
  { id: 'b-10', ktx: 'KTX 1', day: 'Dãy 2', phong_so: '1', giuong: '2', status: 'occupied', ma_nv: 'NV-1007', ho_va_ten: 'Nguyễn Thị Hồng', worker_id: 'w-007' },
  { id: 'b-11', ktx: 'KTX 2', day: 'Dãy 1', phong_so: '1', giuong: '1', status: 'occupied', ma_nv: 'NV-2001', ho_va_ten: 'Đỗ Quang Khải', worker_id: 'w-008' },
  { id: 'b-12', ktx: 'KTX 2', day: 'Dãy 1', phong_so: '1', giuong: '2', status: 'occupied', ma_nv: 'NV-2002', ho_va_ten: 'Vũ Hải Đăng', worker_id: 'w-009' },
  { id: 'b-13', ktx: 'KTX 2', day: 'Dãy 1', phong_so: '2', giuong: '1', status: 'occupied', ma_nv: 'NV-3001', ho_va_ten: 'Bùi Thế Anh', worker_id: 'w-010' },
];

const INITIAL_AUDIT_LOGS: MockRow[] = [
  { id: 'log-1', timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), account: 'admin@ktx.vn', action: 'CREATE', detail: 'Khởi tạo dữ liệu KTX Phước Vĩnh Tây' },
  { id: 'log-2', timestamp: new Date(Date.now() - 3600000).toISOString(), account: 'admin@ktx.vn', action: 'Chuyển phòng', detail: 'Xếp phòng cho công nhân KTX 1' },
];

const INITIAL_SESSIONS: MockRow[] = [
  { id: 'sess-today', session_date: new Date().toISOString().slice(0, 10), is_active: true, zone_ktx: '', zone_day: '', zone_phong: '' },
];

const INITIAL_ROOM_UNITS: MockRow[] = INITIAL_FACILITIES.map(f => ({
  id: `ru-${f.id}`,
  ktx: f.ktx,
  day_nha: f.day,
  phong_so: f.phong_khu_vuc,
  suc_chua: f.giuong,
  room_label: f.ghi_chu?.includes('nữ') ? 'Nữ' : 'Nam',
  unit: f.ghi_chu || '',
  room_note: '',
}));

// In-Memory Database Map
class MockDatabase {
  private tables: Map<string, MockRow[]> = new Map();
  private eventListeners: Map<string, Array<(payload: any) => void>> = new Map();

  constructor() {
    this.init();
  }

  private init() {
    this.tables.set('facilities', this.loadFromStorage('facilities', INITIAL_FACILITIES));
    this.tables.set('profiles', this.loadFromStorage('profiles', INITIAL_PROFILES));
    this.tables.set('workers', this.loadFromStorage('workers', INITIAL_WORKERS));
    this.tables.set('beds', this.loadFromStorage('beds', INITIAL_BEDS));
    this.tables.set('audit_logs', this.loadFromStorage('audit_logs', INITIAL_AUDIT_LOGS));
    this.tables.set('attendance_sessions', this.loadFromStorage('attendance_sessions', INITIAL_SESSIONS));
    this.tables.set('attendance_records', this.loadFromStorage('attendance_records', []));
    this.tables.set('worker_registrations', this.loadFromStorage('worker_registrations', []));
    this.tables.set('room_units', this.loadFromStorage('room_units', INITIAL_ROOM_UNITS));
    this.tables.set('specialist_duty_roster', this.loadFromStorage('specialist_duty_roster', []));
  }

  private loadFromStorage(table: string, defaults: MockRow[]): MockRow[] {
    if (typeof window === 'undefined') return defaults.map(r => ({ ...r }));
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + table);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return defaults.map(r => ({ ...r }));
  }

  private saveToStorage(table: string) {
    if (typeof window === 'undefined') return;
    try {
      const rows = this.tables.get(table) || [];
      localStorage.setItem(STORAGE_PREFIX + table, JSON.stringify(rows));
    } catch {}
  }

  public getTable(table: string): MockRow[] {
    if (!this.tables.has(table)) {
      this.tables.set(table, []);
    }
    return this.tables.get(table)!;
  }

  public emit(table: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE', newRow?: MockRow, oldRow?: MockRow) {
    const payload = {
      eventType,
      table,
      schema: 'public',
      commit_timestamp: new Date().toISOString(),
      new: newRow ?? {},
      old: oldRow ?? {},
    };
    const listeners = this.eventListeners.get(table) || [];
    listeners.forEach(cb => {
      try { cb(payload); } catch (e) { console.warn('listener error:', e); }
    });
    // Global channel listeners
    const globalListeners = this.eventListeners.get('*') || [];
    globalListeners.forEach(cb => {
      try { cb(payload); } catch (e) { console.warn('global listener error:', e); }
    });
  }

  public subscribe(table: string, cb: (payload: any) => void): () => void {
    if (!this.eventListeners.has(table)) {
      this.eventListeners.set(table, []);
    }
    this.eventListeners.get(table)!.push(cb);
    return () => {
      const list = this.eventListeners.get(table) || [];
      this.eventListeners.set(table, list.filter(l => l !== cb));
    };
  }

  public insert(table: string, data: MockRow | MockRow[]): MockRow[] {
    const rows = this.getTable(table);
    const items = Array.isArray(data) ? data : [data];
    const inserted: MockRow[] = [];

    items.forEach(item => {
      const row: MockRow = {
        id: item.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
        created_at: item.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...item,
      };
      rows.push(row);
      inserted.push(row);
      this.emit(table, 'INSERT', row);
    });

    this.saveToStorage(table);
    return inserted;
  }

  public update(table: string, filterFn: (row: MockRow) => boolean, updates: Partial<MockRow>): MockRow[] {
    const rows = this.getTable(table);
    const updated: MockRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      if (filterFn(rows[i])) {
        const oldRow = { ...rows[i] };
        rows[i] = {
          ...rows[i],
          ...updates,
          updated_at: new Date().toISOString(),
        };
        updated.push(rows[i]);
        this.emit(table, 'UPDATE', rows[i], oldRow);
      }
    }

    if (updated.length > 0) {
      this.saveToStorage(table);
    }
    return updated;
  }

  public upsert(table: string, data: MockRow | MockRow[], onConflictKey?: string): MockRow[] {
    const rows = this.getTable(table);
    const items = Array.isArray(data) ? data : [data];
    const keys = (onConflictKey || 'id').split(',').map(s => s.trim());
    const results: MockRow[] = [];

    items.forEach(item => {
      const existingIdx = rows.findIndex(r => keys.every(k => String(r[k] ?? '') === String(item[k] ?? '')));
      if (existingIdx >= 0) {
        const oldRow = { ...rows[existingIdx] };
        rows[existingIdx] = {
          ...rows[existingIdx],
          ...item,
          updated_at: new Date().toISOString(),
        };
        results.push(rows[existingIdx]);
        this.emit(table, 'UPDATE', rows[existingIdx], oldRow);
      } else {
        const newRow: MockRow = {
          id: item.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
          created_at: item.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...item,
        };
        rows.push(newRow);
        results.push(newRow);
        this.emit(table, 'INSERT', newRow);
      }
    });

    this.saveToStorage(table);
    return results;
  }

  public delete(table: string, filterFn: (row: MockRow) => boolean): MockRow[] {
    const rows = this.getTable(table);
    const remaining: MockRow[] = [];
    const deleted: MockRow[] = [];

    for (const r of rows) {
      if (filterFn(r)) {
        deleted.push(r);
        this.emit(table, 'DELETE', undefined, r);
      } else {
        remaining.push(r);
      }
    }

    this.tables.set(table, remaining);
    if (deleted.length > 0) {
      this.saveToStorage(table);
    }
    return deleted;
  }
}

export const mockDb = new MockDatabase();

// ─── Query Builder Implementation (Chaining & Full Promise Interface) ─────
export class MockQueryBuilder {
  private tableName: string;
  private operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any = null;
  private upsertOptions?: { onConflict?: string };
  private filters: Array<(row: MockRow) => boolean> = [];
  private orderCol: string | null = null;
  private orderAsc: boolean = true;
  private rangeFrom: number = 0;
  private rangeTo: number = Number.MAX_SAFE_INTEGER;
  private limitCount: number | null = null;
  private isCountExact: boolean = false;
  private isHeadOnly: boolean = false;
  private isSingleResult: boolean = false;
  private isMaybeSingle: boolean = false;

  constructor(table: string) {
    this.tableName = table;
  }

  select(columns: string = '*', options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    if (this.operation === 'select') {
      if (options?.count === 'exact') this.isCountExact = true;
      if (options?.head) this.isHeadOnly = true;
    }
    return this;
  }

  insert(data: MockRow | MockRow[]) {
    this.operation = 'insert';
    this.payload = data;
    return this;
  }

  update(updates: Partial<MockRow>) {
    this.operation = 'update';
    this.payload = updates;
    return this;
  }

  upsert(data: MockRow | MockRow[], options?: { onConflict?: string }) {
    this.operation = 'upsert';
    this.payload = data;
    this.upsertOptions = options;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push(r => String(r[column] ?? '') === String(value ?? ''));
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push(r => String(r[column] ?? '') !== String(value ?? ''));
    return this;
  }

  in(column: string, values: any[]) {
    const set = new Set((values || []).map(v => String(v ?? '')));
    this.filters.push(r => set.has(String(r[column] ?? '')));
    return this;
  }

  is(column: string, value: any) {
    if (value === null) {
      this.filters.push(r => r[column] === null || r[column] === undefined || r[column] === '');
    } else {
      this.filters.push(r => r[column] === value);
    }
    return this;
  }

  not(column: string, operator: string, value: any) {
    if (operator === 'is' && value === null) {
      this.filters.push(r => r[column] !== null && r[column] !== undefined && r[column] !== '');
    } else if (operator === 'eq') {
      this.filters.push(r => String(r[column] ?? '') !== String(value ?? ''));
    } else if (operator === 'in' && Array.isArray(value)) {
      const set = new Set(value.map(v => String(v ?? '')));
      this.filters.push(r => !set.has(String(r[column] ?? '')));
    }
    return this;
  }

  like(column: string, pattern: string) {
    const regexStr = '^' + (pattern || '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$';
    const regex = new RegExp(regexStr, 'i');
    this.filters.push(r => regex.test(String(r[column] ?? '')));
    return this;
  }

  ilike(column: string, pattern: string) {
    return this.like(column, pattern);
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderCol = column;
    this.orderAsc = options?.ascending !== false;
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.isSingleResult = true;
    return this;
  }

  maybeSingle() {
    this.isMaybeSingle = true;
    return this;
  }

  private execute(): { data: any; error: any; count: number | null } {
    const filterFn = this.filters.length > 0 ? (r: MockRow) => this.filters.every(f => f(r)) : () => true;

    if (this.operation === 'insert') {
      const inserted = mockDb.insert(this.tableName, this.payload);
      const resData = Array.isArray(this.payload) ? inserted : inserted[0];
      if (this.isSingleResult) {
        return { data: inserted[0] ?? null, error: null, count: inserted.length };
      }
      return { data: resData, error: null, count: inserted.length };
    }

    if (this.operation === 'update') {
      const updated = mockDb.update(this.tableName, filterFn, this.payload || {});
      if (this.isSingleResult) {
        return { data: updated[0] ?? null, error: null, count: updated.length };
      }
      if (this.isMaybeSingle) {
        return { data: updated[0] || null, error: null, count: updated.length };
      }
      return { data: updated, error: null, count: updated.length };
    }

    if (this.operation === 'upsert') {
      const upserted = mockDb.upsert(this.tableName, this.payload, this.upsertOptions?.onConflict);
      const resData = Array.isArray(this.payload) ? upserted : upserted[0];
      if (this.isSingleResult) {
        return { data: upserted[0] ?? null, error: null, count: upserted.length };
      }
      return { data: resData, error: null, count: upserted.length };
    }

    if (this.operation === 'delete') {
      const deleted = mockDb.delete(this.tableName, filterFn);
      return { data: deleted, error: null, count: deleted.length };
    }

    // Default: 'select'
    let rows = mockDb.getTable(this.tableName);
    if (this.filters.length > 0) {
      rows = rows.filter(r => this.filters.every(f => f(r)));
    }
    const totalCount = rows.length;

    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      rows = [...rows].sort((a, b) => {
        const valA = a[col];
        const valB = b[col];
        if (typeof valA === 'number' && typeof valB === 'number') {
          return asc ? valA - valB : valB - valA;
        }
        return asc ? String(valA ?? '').localeCompare(String(valB ?? '')) : String(valB ?? '').localeCompare(String(valA ?? ''));
      });
    }

    let result = rows;
    if (this.rangeFrom > 0 || this.rangeTo < Number.MAX_SAFE_INTEGER) {
      result = result.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.limitCount !== null) {
      result = result.slice(0, this.limitCount);
    }

    if (this.isHeadOnly) {
      return { data: null, error: null, count: totalCount };
    }

    if (this.isSingleResult) {
      if (result.length === 0) {
        return { data: null, error: { message: 'Row not found' }, count: totalCount };
      }
      return { data: result[0], error: null, count: totalCount };
    }

    if (this.isMaybeSingle) {
      return { data: result[0] || null, error: null, count: totalCount };
    }

    return {
      data: result,
      error: null,
      count: this.isCountExact ? totalCount : null,
    };
  }

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    try {
      const res = this.execute();
      return Promise.resolve(res).then(resolve, reject);
    } catch (err) {
      return Promise.resolve({ data: null, error: err, count: 0 }).then(resolve, reject);
    }
  }

  catch(reject: (reason: any) => any) {
    return this.then(null, reject);
  }
}

// ─── Mock Realtime Channel ─────────────────────────────────────────────────
export class MockChannel {
  public name: string;
  private unsubscribes: Array<() => void> = [];

  constructor(name: string) {
    this.name = name;
  }

  on(type: string, filter: any, callback: (payload: any) => void) {
    const table = filter?.table || '*';
    const unsub = mockDb.subscribe(table, payload => {
      if (filter?.event && filter.event !== '*' && filter.event !== payload.eventType) return;
      callback(payload);
    });
    this.unsubscribes.push(unsub);
    return this;
  }

  subscribe(callback?: (status: string) => void) {
    if (callback) {
      setTimeout(() => callback('SUBSCRIBED'), 10);
    }
    return this;
  }

  unsubscribe() {
    this.unsubscribes.forEach(u => u());
    this.unsubscribes = [];
    return this;
  }
}

// ─── Mock Supabase Client ──────────────────────────────────────────────────
export function createMockSupabaseClient() {
  const currentAdminUser = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin@ktx.vn',
    user_metadata: { full_name: 'Quản Trị Viên KTX' },
    app_metadata: { role: 'admin' },
    role: 'authenticated',
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const authListeners: Array<(event: string, session: any) => void> = [];

  const client: any = {
    from(tableName: string) {
      return new MockQueryBuilder(tableName);
    },

    channel(channelName: string) {
      return new MockChannel(channelName);
    },

    removeChannel(channel: any) {
      if (channel && typeof channel.unsubscribe === 'function') {
        channel.unsubscribe();
      }
    },

    auth: {
      async getUser() {
        return { data: { user: currentAdminUser }, error: null };
      },
      async getSession() {
        return {
          data: {
            session: {
              access_token: 'mock-access-token-ktx',
              token_type: 'bearer',
              expires_in: 3600,
              user: currentAdminUser,
            },
          },
          error: null,
        };
      },
      onAuthStateChange(callback: (event: string, session: any) => void) {
        authListeners.push(callback);
        setTimeout(() => {
          callback('SIGNED_IN', {
            access_token: 'mock-access-token-ktx',
            user: currentAdminUser,
          });
        }, 10);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                const idx = authListeners.indexOf(callback);
                if (idx >= 0) authListeners.splice(idx, 1);
              },
            },
          },
        };
      },
      async signInWithPassword({ email }: { email: string; password?: string }) {
        const user = {
          ...currentAdminUser,
          email,
          user_metadata: { full_name: email.split('@')[0] },
        };
        const session = { access_token: 'mock-token', user };
        authListeners.forEach(cb => cb('SIGNED_IN', session));
        return { data: { user, session }, error: null };
      },
      async signOut() {
        authListeners.forEach(cb => cb('SIGNED_OUT', null));
        return { error: null };
      },
      async updateUser(updates: any) {
        return { data: { user: currentAdminUser, ...updates }, error: null };
      },
    },

    storage: {
      from(_bucket: string) {
        return {
          upload: async (path: string) => ({ data: { path }, error: null }),
          getPublicUrl: (_path: string) => ({ data: { publicUrl: '/assets/images/no_image.png' } }),
        };
      },
    },
  };

  return client;
}
