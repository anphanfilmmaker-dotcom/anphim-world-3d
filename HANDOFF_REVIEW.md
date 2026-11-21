# AN PHIM CAMPUS COCKPIT — TECHNICAL & ART HANDOFF DOSSIER
> **Target Audience:** External Senior Reviewer (Claude / Codex / Lead Technical Artist)  
> **Repository Scope:** `E:\.agents\Cloud\dashboard\public\world_v25_art_review_d`  
> **Tech Stack:** Vanilla JavaScript (ES Modules), Three.js (r186 standard), WebGL, HTML5 Canvas.  
> **Context:** Interactive 3D Macro City / Campus Cockpit managing company infrastructure, operations, and partner districts.

---

## 1. Executive Summary & Context

Hệ thống **AN PHIM Campus Cockpit** là một không gian 3D tương tác (Isometric / Diorama) trực quan hóa hạ tầng thực tế của công ty AN PHIM (Trụ sở HQ, Khối Tài chính, Khối Công nghệ IT & Cloud, Khối Dự án Phim & Sáng tạo) cùng Quận Đối tác (VistaX) và Mạng lưới giao thông vành đai.

Người dùng vừa thực hiện một đợt rà soát mỹ thuật (Art Review) và đưa ra các chỉ đạo điều chỉnh cốt lõi sau:
1. **Khôi phục thiết kế kiến trúc gốc của Campus:** Hủy bỏ bộ model thử nghiệm `stylized_buildings.glb`, trả lại 13 tòa nhà về hình khối procedural/custom logic nguyên bản, giữ nguyên 100% Trụ sở chính HQ ở trung tâm.
2. **Khôi phục màu sắc đường nội khu & sân chung:** Loại bỏ texture gạch lát nung thử nghiệm, đưa màu đường đi bộ và sân chung về phong cách flat color tối giản chuẩn mỹ thuật:
   - Đường đi bộ: Vàng nung ấm `#dca658`.
   - Vùng sân chung / quảng trường: Cam đất gạch nung `#b76e4b`.
   - Nền cỏ: Xanh rừng đậm `Deep Forest Moss #3a6948`.
   - Mặt đường nhựa: Xám asphalt sẫm `#383f44`.
3. **Thu hẹp đại lộ vành đai trung tâm:**
   - Cánh Tây (Trái): Tim đường thu hẹp từ $X = -64$ vào $X = -52$ (rút ngắn 12m).
   - Cánh Đông (Phải): Tim đường thu hẹp từ $X = 64$ vào $X = 58$ (rút ngắn 6m để đảm bảo khoảng lùi của tòa nhà Phim lịch sử).
   - Dời nền móng và hạ tầng Quận VistaX vào theo để khớp nối hoàn hảo với nhánh dẫn vành đai mới.
4. **Gỡ bỏ hoàn toàn khu nhà mẫu (District Showcase):** Dọn sạch nhóm kiến trúc trưng bày tạm thời bên cánh phải, xóa các nút liên quan trên HUD điều hướng.
5. **Nâng cấp tài liệu kỹ thuật (Skills):** Bổ sung chuẩn PBR ORM Texture Packing (`aoMap`, `roughnessMap`, `metalnessMap` chung 1 texture) và Real-Time GPU Particle VFX vào hệ thống skill phát triển.

---

## 2. Architecture & Spatial Topology

### 2.1 Cấu trúc Khuôn viên (`physical-topology.json`)

Tọa độ và phân khu của 14 công trình trọng điểm:

| ID Tòa nhà | Tên Công trình | Phân khu | Cấp bậc (Grade) | Tọa độ Thế giới $[X, Y, Z]$ | Mô tả Kiến trúc |
| :--- | :--- | :--- | :---: | :---: | :--- |
| `bld:facility:hq` | **AN PHIM HQ** | Campus Center | **E** ($17 \times 24 \times 14\text{m}$) | `[0, 6.8, -5]` | Trụ sở chính giật cấp, vách kính mặt tiền, sảnh vòm cam, ban công sân thượng. |
| `bld:facility:documents` | **Giấy tờ Dự án** | Administration | **B** ($7 \times 7 \times 7\text{m}$) | `[-29, 4, -18]` | Khối công vụ lưu trữ pháp lý & hợp đồng. |
| `bld:facility:drive` | **Kho Google Drive** | Administration | **A** ($5 \times 4 \times 5\text{m}$) | `[-20, 4, -26]` | Trạm lưu trữ dữ liệu số nội bộ. |
| `bld:facility:bank` | **Ngân hàng (Bank)** | Finance | **D** ($13 \times 17 \times 11\text{m}$) | `[-30, 4, 8.5]` | Trụ sở tài chính & dòng tiền. |
| `bld:facility:reserve` | **Kho Dự trữ / Tiết kiệm** | Finance | **B** ($7 \times 7 \times 7\text{m}$) | `[-20, 4, 21]` | Khối két an toàn (Vault). |
| `bld:facility:ai` | **AI Team** | Internal | **B** ($7 \times 7 \times 7\text{m}$) | `[24, 5.2, -26]` | Tòa nhà nghiên cứu thuật toán & Agents. |
| `bld:facility:hermes` | **Hermes Robot Lab** | Internal | **B** ($7 \times 7 \times 7\text{m}$) | `[36, 4.5, -28]` | Phòng thí nghiệm tự động hóa. |
| `bld:project:proj_24` | **Website AN PHIM 2027** | Internal | **B** ($7 \times 7 \times 7\text{m}$) | `[24, 5.2, -15.5]` | Studio phát triển cổng thông tin. |
| `bld:project:proj_25` | **AN PHIM Trailer** | Internal | **A** ($5 \times 4 \times 5\text{m}$) | `[36, 3.8, -17]` | Studio dựng hậu kỳ trailer. |
| `bld:project:proj_05` | **Phim Lịch Sử** | Internal | **A** ($5 \times 4 \times 5\text{m}$) | `[47, 3.1, -22]` | Phân khu sản xuất phim lịch sử. |
| `bld:facility:supabase` | **Database (PostgreSQL)** | IT & Cloud | **B** ($7 \times 7 \times 7\text{m}$) | `[26, 3.8, 8.5]` | Trung tâm dữ liệu quan hệ điện toán. |
| `bld:facility:oracle` | **Oracle Cloud** | IT & Cloud | **D** ($13 \times 17 \times 11\text{m}$) | `[40, 3.8, 8]` | Cụm máy chủ hạ tầng cấp doanh nghiệp. |
| `bld:facility:google` | **Google Cloud** | IT & Cloud | **A** ($5 \times 4 \times 5\text{m}$) | `[27, 3.8, 20]` | Nền tảng dịch vụ đám mây vệ tinh. |
| `bld:facility:telegram` | **Telegram Tiếp Sóng** | IT & Cloud | **C** ($10 \times 11 \times 9\text{m}$) | `[39, 3.8, 21.5]` | Tháp ăng-ten phát sóng điều phối bot. |

---

## 3. Core Source Files & Key Changes

### 3.1 `main.js` (Core Application Lifecycle)
- **Building Instantiation:** Loại bỏ hoàn toàn khối `getStudioModelById` thử nghiệm. Trả lại vòng lặp tạo tòa nhà chuẩn:
  ```javascript
  if (b.style === 'hq') {
    rawBuilding = A.HQ();
    // Vertex height modification cho mái HQ
  } else {
    if (b.legacyId === 'telegram') rawBuilding = A.telegramTower();
    else if (b.legacyId === 'hermes' || b.style === 'research') rawBuilding = A.hermesLab();
    else if (b.legacyId === 'reserve' || b.style === 'vault') rawBuilding = A.vaultBuilding();
    else if (b.legacyId === 'ai' || b.style === 'office') rawBuilding = A.officeBuilding();
    else rawBuilding = await registry.building(V23.bindings[b.legacyId], A, b.legacyId);
    f = A.fit(mergeBuilding(rawBuilding), b.grade, L.grades);
    g = f.group;
    bbox = f.bbox;
  }
  ```
- **Showcase Removal:** Gỡ bỏ lệnh gọi `createDistrictShowcase(...)`.
- **Game Shaders Default:** Đảm bảo `game-postprocessing.js` khởi tạo với `enabled = false` (tắt toàn bộ Master, Bloom, Tilt-Shift, Vignette mặc định).

### 3.2 `terrain.js` (Continuous Mesh Ground)
- **Vật liệu Địa hình:** Loại bỏ các canvas texture sinh tự động (`createWalkwayPaverTexture`, `createPlazaTileTexture`).
- **Phục hồi Material Array:**
  ```javascript
  const materials = [
    '#3a6948',  // 0: Nền cỏ xanh rừng đậm (Deep Forest Moss)
    '#383f44',  // 1: Đường chính asphalt sẫm
    '#dca658',  // 2: Lối đi bộ màu vàng nung ấm
    '#b76e4b',  // 3: Vùng sinh hoạt chung màu gạch nung cam đất
    '#918c7c'   // 4: Chân đế móng
  ].map(color => new T.MeshStandardMaterial({ color, roughness: 0.94, vertexColors: true }));
  ```

### 3.3 `physical-topology.json` & `district-vistax.js` (Road Hierarchy & Bounds)
- **Ring Road Coordinates (`ringCorners`):**
  - Cũ: `[[48, 20, 0], [-48, 20, 90], [-48, -40, 180], [48, -40, 270]]`
  - Mới (Đã thu hẹp): `[[42, 20, 0], [-36, 20, 90], [-36, -40, 180], [42, -40, 270]]`
- **Tâm điểm Quận VistaX:** Dời từ `cx = -89` thành `cx = -77` để khớp chính xác với nhánh đường nối từ vành đai $X = -52$.

---

## 4. System Status & Verification Data

Từ báo cáo chạy kiểm thử qua Chrome DevTools Protocol (`Runtime.evaluate`):
- `ready`: `true`
- `errors`: `[]` (Không có bất kỳ lỗi Runtime / WebGL / Three.js nào).
- `drawCalls`: `2,819` (Nằm trong ngân sách hiệu năng mượt mà).
- `frameMedian`: `17.5ms` (~57-60 FPS).
- `activeNPCs`: `0`.

---

## 5. Review Checklist for Reviewer (Claude / Codex)

Khi tiếp nhận dossier này, đề nghị Reviewer đánh giá các khía cạnh sau:

1. **Hiệu năng & Draw Calls:**
   - Việc `mergeBuilding` đối với các tòa procedural hiện tại đang gom mesh theo material. Liệu có nguy cơ memory leak khi chuyển đổi cảnh hoặc inspect cutaway không?
2. **Quy hoạch Không gian (Spatial & Setbacks):**
   - Vành đai bên phải thu hẹp vào $X = 58$, khoảng cách giữa mép đường và tòa Phim Lịch Sử (`proj_05` tại $X = 47$) là ~11m (trừ bán kính móng còn ~7m). Khoảng lùi này đã đạt tỷ lệ vàng đô thị chưa?
3. **Ánh sáng & Tone Mapping:**
   - Hệ thống chiếu sáng hiện tại dùng `DirectionalLight` (sunIntensity: 3.15, hemisphereIntensity: 0.9, toneMapping: ACESFilmic). Trong ảnh chụp mới nhất, tông cảnh quan có xu hướng đầm/trầm hơn. Cần tinh chỉnh thêm `ambientLight` hay tăng `exposure` lên 1.15 để cảnh tươi sáng hơn không?
4. **Mở rộng Shaders:**
   - Mẫu GPU Particle VFX vừa thêm vào `shader-programming` đã tối ưu hóa phép tính harmonic turbulence bằng vector field chưa?

---
*Tài liệu được sinh tự động bởi Antigravity Pair Programmer.*
