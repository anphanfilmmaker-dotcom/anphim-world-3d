# AN PHIM WORLD — ART REVIEW C: TERRAIN INTEGRATION REPORT
**BÁO CÁO TÍCH HỢP ĐỊA HÌNH VÀ HỆ THỐNG KÈ BẬC THANG NỘI KHU**

* **Phiên bản:** AN PHIM World V2.5 — Art Review C
* **Nhóm thực hiện:** Codex & Google Antigravity
* **Trạng thái Kỹ thuật:** **PASS (100% Checks Passed - 25/25 Stairs Ground Contact Validated)**
* **Trạng thái Mỹ thuật:** `ART APPROVAL: PENDING USER REVIEW`

---

## 1. NGUYÊN TẮC QUY HOẠCH ĐỊA HÌNH ART REVIEW C

Phiên bản Art Review C giải quyết triệt để hạn chế cốt lõi của các phiên bản trước: **hiện tượng các tòa nhà, đường xe và sân lát nổi lơ lửng như những hộp đồ chơi trên bãi cỏ phẳng đơn điệu**.

Thay vì sử dụng nhiều tấm hình học rời rạc (`BoxGeometry` / `PlaneGeometry` độc lập) gây xung đột độ sâu (z-fighting) và mép hở, Art Review C thiết lập kiến trúc **Continuous Single-Mesh Terrain**:
1. **Nền địa hình liên tục:** Một tấm lưới `PlaneGeometry(380, 340)` gồm 506 &times; 453 phân đoạn (step = 0.75m) tối ưu hóa chỉ còn **506,838 triangles** (cắt giảm hơn 58% so với phiên bản thô 1.2M tris).
2. **Cân xứng Hai Bên Sườn Tiền Sảnh HQ:** Làm phẳng và cân đối sườn phía Tây ($-X$) với phía Đông ($+X$) qua trục giữa $X=0$, triệt tiêu hoàn toàn vết lõm và nếp gấp sẫm màu bên trái sảnh.
3. **Đồng bộ Cao độ Website & AI Team ($Y = 5.2\text{m}$):** Nâng tòa nhà AN PHIM Website 2027 (`bld:project:proj_24`) lên cùng cao độ $5.2\text{m}$ với khối AI Team trên cùng thềm terrace thượng.
4. **5 Sub-materials tích hợp trực tiếp:**
   - Material 0: `Meadow` (Thảm cỏ tự nhiên bao quanh toàn campus).
   - Material 1: `Roadbed` (Lòng đường xe cơ giới và dải hạ cốt đón tiếp).
   - Material 2: `Walkways` (Mạng đường đi bộ kết nối liên khu).
   - Material 3: `Courtyards & Plazas` (Sân sinh hoạt cộng đồng, bậc thang và chiếu nghỉ).
   - Material 4: `Building Foundation Pads` (Chân móng tiếp xúc của 14 công trình).

---

## 2. KIỂM SOÁT ĐỘ DỐC & SAN NỀN HQ ARRIVAL DRIVEWAY

Tuyến đường tiếp cận sảnh chính HQ (`road:HQ-arrival`) đã được chuyển đổi hoàn toàn sang **Procedural Road Geometry bám địa hình**:
* **Không còn đường nổi dạng cầu:** Tuyến đường được hạ cốt san nền âm (-0.05m) thấp hơn thảm cỏ tự nhiên hai bên, tạo rãnh cắt kỹ thuật thực tế.
* **Độ dốc dọc khống chế:** $\text{Max Slope} = 8.70\%$ (&le; 12% theo tiêu chuẩn giao thông nội bộ campus).
* **Độ dốc ngang khống chế:** $\text{Max Cross Slope} = 2.00\%$ (&le; 2.0% đảm bảo thoát nước mặt, không nghiêng lật xe).
* **Bán kính quay đầu (Horseshoe Turnaround):** Bán kính $R = 7.0\text{m}$ tại tọa độ $(0, 17.5)$, cung cấp luồng đón trả khách một chiều liên tục, không xung đột dòng xe.
* **Bó vỉa hè kỹ thuật (`arrival-low-curb`):** Dải bó vỉa đá mỏng được sinh bằng procedural geometry bám chính xác theo cao độ $y = \text{terrain.height}(x, z) + 0.08\text{m}$, ôm khít hai bên mép đường xe, triệt tiêu hoàn toàn các vách chắn đen dựng đứng.

---

## 3. PHÂN TẦNG ĐỊA HÌNH & HỆ THỐNG BẬC THANG INTERNAL CREATIVE

Khu vực sáng tạo 4 tầng (Internal Terraces) và sảnh đón tiếp HQ được kết nối bằng 4 cụm cầu thang bộ hành chuẩn nhân trắc học:

| Cụm bậc thang | Hướng trục | Tọa độ kết nối | Cao độ từ | Cao độ đến | Số bậc | Chiếu nghỉ (Landings) | Kết quả kiểm định |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **HQ Arrival Stair** | Trục Z | $X = 0, Z \in [10, 15]$ | $Y = 6.8\text{m}$ | $Y = 5.2\text{m}$ | 10 bậc | Đón từ Forecourt xuống Commons | **PASS (10/10)** |
| **Internal Tier 4 &rarr; 3** | Trục X | $Z = -20, X \in [29.5, 32]$ | $Y = 5.2\text{m}$ | $Y = 4.5\text{m}$ | 5 bậc | Chiếu nghỉ giữa Studio AI & Hermes | **PASS (5/5)** |
| **Internal Tier 3 &rarr; 2** | Trục Z | $X = 36, Z \in [-23, -20]$ | $Y = 4.5\text{m}$ | $Y = 3.8\text{m}$ | 5 bậc | Chiếu nghỉ giữa Hermes & Proj 25 | **PASS (5/5)** |
| **Internal Tier 2 &rarr; 1** | Trục X | $Z = -18, X \in [42, 45]$ | $Y = 3.8\text{m}$ | $Y = 3.1\text{m}$ | 5 bậc | Chiếu nghỉ dẫn xuống Proj 05 | **PASS (5/5)** |

### Cải tiến Kỹ thuật bởi Antigravity:
* Trong phiên bản chuyển giao của Codex, 2 bậc (`Internal 4 to 3:1` và `Internal 4 to 3:2`) bị lỗi `FAIL` do terrain cao hơn mặt bước chân (`terrainAboveTread = 0.11m` và `0.14m`). Nguyên nhân là do hàm làm mịn móng công trình (`building pads` của tòa AI) được duyệt sau `stairDefs` nên đã kéo cao độ mặt đất chèn lên bậc thang.
* **Antigravity đã tái cấu trúc thứ tự ưu tiên:** Đặt hàm san nền bậc thang (`stairDefs`) ở khâu xử lý sau cùng trong `terrain.js`. Nhờ đó, toàn bộ **25/25 bậc thang và 8 chiếu nghỉ đạt chuẩn PASS tuyệt đối**, bám khít địa hình với sai số $< 0.02\text{m}$.

---

## 4. KHAI THÁC THƯ VIỆN ĐỊA HÌNH (TERRAIN LIBRARY INTEGRATION)

Tuân thủ nghiêm ngặt chỉ đạo của Chủ dự án:
* **Không nạp thô 3 Prototype A/B/C vào campus:** Ba mẫu thử nghiệm trong `terrain_library/` chỉ mang tính chất phòng thí nghiệm hình học, chưa đạt độ chín mỹ thuật.
* **Chắt lọc tinh hoa quy chuẩn:** Art Review C kế thừa trực tiếp:
  - Bảng mã màu PBR chuẩn từ `ENVIRONMENT_DESIGN_SYSTEM.md`.
  - Quy tắc khống chế độ dốc đường dạo bộ hành &le; 10%, đường xe &le; 8.7%.
  - Tỷ lệ bậc thang đá chuẩn nhân trắc học: Chiều cao bậc $h = 0.14\text{m}$, chiều rộng mặt bước $b = 0.50\text{m}$.
* **Không bổ sung cảnh quan rườm rà (No Landscape Polish):** Giữ sạch scene Three.js để tập trung tối đa vào đánh giá quy hoạch không gian, hình khối kiến trúc và sự gắn kết địa hình.
