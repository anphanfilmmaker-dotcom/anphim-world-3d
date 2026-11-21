# AN PHIM WORLD — GROUND PLANE & SPATIAL PLANNING CHANGES
**CHI TIẾT THAY ĐỔI MẶT BẰNG & QUY HOẠCH KHÔNG GIAN ART REVIEW C**

* **Phiên bản:** AN PHIM World V2.5 — Art Review C
* **Tham chiếu đối chiếu:** Art Review B (`world_v25_art_review_b/`) & Baseline V2.5
* **Tình trạng:** Sẵn sàng nghiệm thu mỹ thuật (`PENDING USER REVIEW`)

---

## 1. SO SÁNH QUY HOẠCH KHÔNG GIAN: REVIEW B VS REVIEW C

| Hạng mục không gian | Hiện trạng Art Review B | Cải tiến Đột phá Art Review C | Ý nghĩa Quy hoạch & Kiến trúc |
| :--- | :--- | :--- | :--- |
| **Central Commons** | Đặt tại sảnh trước HQ ($Z = 14.5$), gây lẫn lộn với khu đón tiếp khách ngoài. | **Di dời ra phía sau HQ ($X = 0, Z = -21$)**, nằm ở lõi trung tâm nội bộ. | Tạo thành công viên sinh hoạt nội bộ ấm cúng, kết nối tự nhiên với khối Hành chính (Tây) và khối Sáng tạo (Đông). |
| **HQ Forecourt** | Bị gộp chung với Central Commons, không có khoảng đệm thương hiệu. | **Thiết lập sân trước độc lập ($X = 0, Z = 7$)**, diện tích $14 \times 9\text{m}$. | Tôn vinh tháp nghiêng HQ, tạo không gian tiền sảnh trang trọng tiếp đón đối tác và khách VIP. |
| **Hồ nước trước HQ** | Một tấm mặt nước phẳng hình chữ nhật thô cứng chắn trước sảnh. | **LOẠI BỎ HOÀN TOÀN** theo quyết định mỹ thuật đã chốt. | Giải phóng tầm nhìn sảnh chính, nhường chỗ cho thảm cỏ xanh và tuyến bộ hành thẳng tắp. |
| **HQ Arrival Driveway** | Dải decal phẳng dán trên mặt cỏ phẳng lì, mép đường cắt sắc nhọn. | **Tuyến đường san nền bám địa hình**, độ dốc dọc 8.70%, dải bó vỉa hè mỏng 0.08m. | Xe cộ tiếp cận tự nhiên, hạ cốt êm thuận, có bãi quay đầu bán kính 7.0m không tắc nghẽn. |
| **Cấu trúc Nền sân** | Các khối hộp `BoxGeometry` xám/trắng nổi lơ lửng trên mặt cỏ. | **Continuous Single-Mesh Terrain** với 5 sub-materials tích hợp phẳng. | Triệt tiêu 100% mép hở, triệt tiêu z-fighting, mặt đất liền mạch giữa sân lát, vỉa hè và thảm cỏ. |
| **Bậc thang Internal** | Vách đứng vuông góc 1.5m ngăn cách thô bạo giữa các tầng studio. | **Hệ thống 4 cụm bậc thang đá chuẩn nhân trắc học** kèm chiếu nghỉ. | Tạo hành lang dạo bộ sinh động kết nối nhịp nhàng 4 tầng cao độ từ 5.2m xuống 3.1m. |

---

## 2. QUY CHUẨN CÁC SÂN CHUNG NỘI KHU (COURTYARDS MATRIX)

Toàn bộ các sân chung được định hình bằng thuật toán bo góc đa giác mềm (`chamfered rectangular profile`) tích hợp trực tiếp vào lưới địa hình:

1. **HQ Forecourt (`court:forecourt`):**
   - Vị trí: $X = 0, Z = 7$ (Cao độ $Y = 6.8\text{m}$).
   - Kích thước: Rộng $14\text{m}$ &times; Dài $9\text{m}$, Bán kính bo góc $R = 2.0\text{m}$.
   - Chức năng: Sảnh đón tiếp đối tác, kết nối trực tiếp với cửa chính HQ qua `door:bld:facility:hq`.
2. **Central Commons (`court:commons`):**
   - Vị trí: $X = 0, Z = -21$ (Cao độ $Y = 5.2\text{m}$).
   - Kích thước: Rộng $17\text{m}$ &times; Dài $8\text{m}$, Bán kính bo góc $R = 2.0\text{m}$.
   - Chức năng: Trái tim sinh hoạt cộng đồng, giao lưu giữa các phòng ban.
3. **Administration Courtyard (`court:admin`):**
   - Vị trí: $X = -23, Z = -18$ (Cao độ $Y = 4.0\text{m}$).
   - Kích thước: Rộng $7\text{m}$ &times; Dài $8\text{m}$, Bán kính bo góc $R = 1.5\text{m}$.
   - Chức năng: Sân nội bộ Ban Hành chính - Nhân sự & Lưu trữ tài liệu.
4. **Finance Courtyard (`court:finance`):**
   - Vị trí: $X = -25, Z = 16$ (Cao độ $Y = 4.0\text{m}$).
   - Kích thước: Rộng $10\text{m}$ &times; Dài $5\text{m}$, Bán kính bo góc $R = 1.4\text{m}$.
   - Chức năng: Sân nội bộ Ban Tài chính - Kế toán & Ngân hàng đối tác.
5. **IT Technical Courtyard (`court:it`):**
   - Vị trí: $X = 32.5, Z = 15$ (Cao độ $Y = 3.8\text{m}$).
   - Kích thước: Rộng $13\text{m}$ &times; Dài $4\text{m}$, Bán kính bo góc $R = 1.2\text{m}$.
   - Chức năng: Không gian kỹ thuật mở liên kết phòng Lab R&D và cụm Server.

---

## 3. MẠNG ĐƯỜNG BỘ HÀNH & KẾT NỐI SẢNH CHÍNH (PEDESTRIAN CONNECTIVITY)

* **Tuyến đón tiếp trục chính (`walk:direct-arrival`):**
  - Tuyến đường mới được bổ sung nối thẳng từ bãi đón xe $(0, 17.5)$ &rarr; $(0, 10)$ &rarr; sảnh HQ Forecourt $(0, 4)$ &rarr; cửa chính HQ.
  - Vượt qua chênh lệch cao độ từ $5.2\text{m}$ lên $6.8\text{m}$ bằng cụm bậc thang đá 10 bậc (`HQ arrival stair`).
* **Vòng dạo bộ nội khu (`walk:ecosystem-loop`):**
  - Tuyến khép kín ôm lấy toàn bộ campus, đi xuyên qua Central Commons ở tọa độ $(0, -20)$.
  - Phân nhánh mượt mà sang Admin Courtyard ở phía Tây và Internal Terraces ở phía Đông.
* **Bảo toàn 100% Tuyến Nghiệp vụ (Operations & System Lines):**
  - Tất cả 27 liên kết luồng công việc (Hợp đồng, Báo giá, Dự án, Hạ tầng Cloud) tiếp tục bám sát polyline của vỉa hè theo thuật toán A*, không có bất kỳ đường thẳng bay xuyên không gian nào.

---

## 4. BẢO TOÀN THỰC THỂ & DỮ LIỆU CÔNG TY (BUSINESS INTEGRITY)

* **Cân xứng Hai Bên Tiền Sảnh HQ:** Sườn phía Tây và phía Đông được cân bằng hoàn hảo qua trục đối xứng $X=0$, loại bỏ hoàn toàn vết lõm gấp nếp.
* **Kiosk Lịch Làm Việc Lớn & Kết Nối Database:** Kiosk LED kỹ thuật số bề thế $5.8\text{m} \times 3.2\text{m}$ được đặt trang trọng trước sảnh chính HQ bên phải cầu thang $(5.2, 6.8, 8.5)$, kết nối trực tiếp với bảng `schedule` PostgreSQL.
* **Nâng Tòa Nhà Website Ngang Bằng AI Team ($Y = 5.2\text{m}$):** Khối AN PHIM Website 2027 đứng cùng thềm terrace với AI Team.
* **Trạm Tiếp Sóng & Loa Phát Thanh Telegram:** Thay thế khối nhà cũ bằng tháp giàn thép không gian, 4 loa phóng thanh nén công cộng và 2 chảo tiếp sóng vi ba.
* **Tối ưu hóa Lưới Địa hình (-58% Triangles):** Rút gọn từ 1.2M triangles xuống còn **506,838 triangles**, giải phóng GPU và tăng tốc độ dựng hình đạt 60 FPS ổn định.
* **Xóa bỏ Ghế Chắn Đường:** Dọn sạch các ghế nghỉ hardcode cắm ngang vỉa hè `[-10, 10]` và `[10, 10]`, dời toàn bộ ghế vào công viên Central Commons và các sân trong.
* **14 Tòa nhà nghiệp vụ:** Tọa độ, kích thước móng (`hx`, `hz`) và định danh thực thể (`Entity IDs`) được bảo toàn tuyệt đối 100% khớp với baseline của Chủ dự án.
* **Oracle Cloud độc lập:** Trạm máy chủ `bld:facility:oracle` tại tọa độ $(38, 3.8, 10)$ giữ nguyên sự độc lập với Datacenter vật lý, đảm bảo đúng sơ đồ kiến trúc hạ tầng thực tế của AN PHIM.
