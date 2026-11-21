# KỸ THUẬT: NHẬN DIỆN & THEO DÕI LỖI ĐỊNH TUYẾN OPERATIONS / SYSTEM MODE
*Mã phiếu: TECH-ROUTING-01*
*Phạm vi: Tách biệt hoàn toàn khỏi tiến trình Art Direction (Art D)*
*Trạng thái: Logged & Awaiting Network Graph Topology Fix*

---

## 1. Hiện Tượng (Symptoms)
- Trong chế độ hiển thị **Operations Mode** và **System Mode**, một số mối quan hệ phụ thuộc giữa các công trình hiển thị nhãn:
  `DISCONNECTED: [Công trình A] → [Công trình B]`
- Các đường dây năng lượng / luồng dữ liệu 3D không vẽ được spline nối giữa 2 tòa nhà này.

## 2. Nguyên Nhân Kỹ Thuật (Root Cause)
1. **Bộ định tuyến người đi bộ (`pedestrian-router.js`):**
   - Bộ định tuyến dựa trên các đoạn đường dạo bộ vật lý (`paths.filter(p => p.class === 1)`).
   - Mỗi tòa nhà cần một điểm kết nối cửa (`door:<id>`) cắm vào mạng lưới đường dạo với khoảng cách tiếp giáp $\le 0.85\text{m}$.
2. **Điểm đứt gãy kết nối (Graph Disconnection):**
   - Một số node ảo hạ tầng (ví dụ: Cloud Database / Supabase hoặc node ngoài biên) hoặc công trình mới chưa được gắn điểm `door:` nối vào mạng lưới đường dạo chính.
   - Ngưỡng tiếp xúc giữa các nhánh đường dạo `d = 0.85m` bị hở tại một số nút giao trên địa hình giật cấp mới của Art C.

## 3. Hướng Xử Lý Kỹ Thuật (Remediation Plan - Sau khi chốt Art D)
- **Bước 1:** Bổ sung các đoạn đường đi bộ kết nối (`roads.walk('door:' + id, [...])`) cho 100% các công trình tham gia đồ thị.
- **Bước 2:** Với các luồng System/Data (vốn là sóng vi ba hoặc đường cáp ngầm, không phải người đi bộ), thiết lập chế độ định tuyến đường cong không gian 3D trên không (`aerial spline bezier`) thay vì ép buộc phải đi theo đường bộ mặt đất.
- **Bước 3:** Đảm bảo 100% các edge trong `operational-graph.json` và `system-graph.json` đạt trạng thái `routed`.
