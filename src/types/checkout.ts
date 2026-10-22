export interface CheckoutRequest {
  id: string;
  worker_id?: string;
  ho_va_ten: string;
  ma_nv: string;
  so_cccd: string;
  so_dien_thoai: string;
  ktx: string;
  day: string;
  phong_so: string;
  giuong?: string;
  ly_do: string;
  ngay_don_ra: string;
  ghi_chu?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}
