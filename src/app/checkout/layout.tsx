import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Khai Báo Check-out / Dọn Ra KTX | KTX Phước Vĩnh Tây',
  description: 'Trang khai báo trực tuyến thủ tục check-out, dọn ra khỏi Ký túc xá Phước Vĩnh Tây',
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
}
