# Data contract: dữ liệu thế giới 3D đọc

Thế giới 3D chỉ đọc dữ liệu qua `data-connector.js`. Dữ liệu là **một object JSON có 17 key gốc** như dưới đây, hiện nằm trong `live_campus_data.json` (dữ liệu mẫu). Khi nối database thật, bản xuất từ Supabase (hoặc `/api/db` qua `_transformRawDb`) phải có đúng hình này.

Nguồn duy nhất của contract là `data-contract.js`. Bảng trường bên dưới được sinh ra từ file đó, đừng sửa tay.

## Kiểm tra một file dữ liệu

```
npm run check:data                          # kiểm live_campus_data.json
npm run check:data -- duong/dan/file.json   # kiểm file khác, ví dụ bản xuất thật
npm run check:data -- --write-doc           # sinh lại bảng trường trong file này sau khi sửa data-contract.js
```

Lệnh thoát với mã 1 và in từng lỗi kèm đường dẫn trường (`projects[3].duedate: cần ngày dd/mm/yyyy, nhận …`) khi dữ liệu sai hình. Mỗi lần chạy nó cũng tự làm hỏng một bản dữ liệu tốt theo 15 kiểu và kiểm rằng cả 15 đều bị bắt.

- **Lỗi** (chặn): thiếu trường bắt buộc, sai kiểu, ngày sai định dạng, id trùng, `projectId` trỏ tới dự án không có, `buildingPages` trỏ tới trang không có.
- **Ghi chú** (không chặn): giá trị lạ ở trường có danh sách giá trị đã biết (thế giới 3D có cách hiện trung tính), trường ngoài contract, `buildingId` không có trong `physical-topology.json`, `workspace.baseUrl` trống.

## Trong trình duyệt

Mỗi lần nạp (lúc mở và mỗi 31 giây), `dataConnector.load()` chạy cùng phép kiểm đó. Dữ liệu sai contract **không được vẽ**: các bảng giữ số liệu nạp lần trước và HUD báo rõ. `dataConnector.getDataStatus().state` có năm giá trị:

| state | Khi nào | HUD hiện gì |
|---|---|---|
| `ok` | Nạp được, đúng contract, `updatedAt` chưa quá 24 giờ | Không hiện gì thêm |
| `stale` | Nạp được nhưng `updatedAt` đã quá 24 giờ | Chip vàng "Dữ liệu cũ · 3 ngày" trên thanh trên |
| `failed` | Lần nạp gần nhất lỗi (mất mạng, 404, không phải JSON), còn số liệu cũ | Chip đỏ "Mất kết nối · số liệu lúc 14:32" |
| `invalid` | Lần nạp gần nhất sai contract | Chip đỏ "Dữ liệu mới sai cấu trúc · giữ số liệu lúc 14:32"; rê chuột để xem các lỗi đầu tiên |
| `offline` | Chưa nạp được lần nào | Chip đỏ "Chưa nạp được dữ liệu"; các bảng ghi rõ là chưa có số liệu |

Bấm vào chip để thử nạp lại ngay. Dòng "DB: …" trong Cài đặt hiện cùng trạng thái. Lỗi được ghi một lần vào Console (`[DataConnector] …`), không lặp lại mỗi lần thử.

## Quy ước chung

- **Ngày**: `dd/mm/yyyy` (`11/12/2026`). **Ngày giờ**: `dd/mm/yyyy hh:mm`. Riêng `updatedAt` là ISO (`2026-11-21T16:00:00`).
- **Số tiền**: số VND (`45000000`), kèm bản chữ `…Formatted` (`"45.000.000 đ"`) để hiện.
- **URL**: `http(s)://…` hoặc đường dẫn trong site; `""` nghĩa là chưa có.
- **Không bắt buộc**: bỏ trường hoặc để `null` đều được.
- **`sample: true`** (ngoài 17 key): đánh dấu dữ liệu mẫu. Khi có, HUD ghi "DB: Dữ liệu mẫu", không báo dữ liệu cũ, và "hôm nay" là ngày của `updatedAt` để lịch mẫu khớp. Bản xuất thật **không** có key này: "hôm nay" là ngày thật và dữ liệu quá 24 giờ bị báo cũ.
- **Id không đổi**: `id`, `legacyId`, `projectId` của tòa nằm trong `physical-topology.json`. Dữ liệu chỉ trỏ tới chúng (`buildingId`, và số cuối của `projects[].id`).

## Nối database thật

1. Viết phần đổi tên bảng/cột của Supabase sang các trường dưới đây trong `_transformRawDb` (`data-connector.js`), hoặc trong script xuất `live_campus_data.json`. Đây là chỗ duy nhất biết tên cột của database.
2. Chạy `npm run check:data -- file-xuat.json` cho tới khi đạt.
3. Bỏ `sample: true`, điền `workspace.baseUrl` thật và `driveUrl` thật của từng dự án (bản mẫu đang dùng địa chỉ `https://example.com/…-mau`).

## 17 key gốc

<!-- contract:start -->
### 1. `updatedAt`

Thời điểm xuất dữ liệu. Quá 24 giờ thì HUD báo "Dữ liệu cũ".

Kiểu: ISO date-time.

### 2. `kpi`

Số trên thanh tài nguyên. Bản *Formatted là chữ hiện ra, bản số để rút gọn và cảnh báo.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `kpi.cashAvailable` | số | có |  |
| `kpi.cashAvailableFormatted` | chữ | có |  |
| `kpi.receivable` | số | có |  |
| `kpi.receivableFormatted` | chữ | có |  |
| `kpi.activeProjectsCount` | số nguyên | có |  |
| `kpi.missingDocumentsCount` | số nguyên | có |  |
| `kpi.pendingActionsCount` | số nguyên | có |  |
| `kpi.estimatedProfit` | số |  |  |
| `kpi.estimatedProfitFormatted` | chữ |  |  |
| `kpi.invoicesPendingCount` | số nguyên |  |  |

### 3. `clients`

Mỗi khách hàng một khu (district). kind "internal" là AN PHIM, ở lại campus chính.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `clients[].id` | chữ | có |  |
| `clients[].name` | chữ | có |  |
| `clients[].kind` | "client" / "internal" |  |  |
| `clients[].aliases` | danh sách chữ |  | Tên khác của khách (ví dụ Winterland87 cho K87K). |

### 4. `projects`

Mỗi dự án một tòa. Thứ tự trong danh sách là thứ tự nhận lô đất trong khu.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `projects[].id` | chữ | có | Kết thúc bằng số (proj_5). Số này nối với projectId trong physical-topology.json, không đổi. |
| `projects[].name` | chữ | có |  |
| `projects[].client` | chữ | có | Tên, id hoặc alias của một khách trong clients. |
| `projects[].type` | chữ |  |  |
| `projects[].status` | "Đang làm" / "Chờ feedback" / "Cần revise" / "Tạm dừng" / "Hoàn thành" | có | Quyết định hình ngoài của tòa: giàn giáo, cờ, biển delay. |
| `projects[].budget` | số | có |  |
| `projects[].budgetFormatted` | chữ | có |  |
| `projects[].received` | số | có |  |
| `projects[].receivedFormatted` | chữ | có |  |
| `projects[].paymentd1` | số |  |  |
| `projects[].paymentd2` | số |  |  |
| `projects[].paymentd3` | số |  |  |
| `projects[].duedate` | ngày dd/mm/yyyy | có | Hạn giao. Quá hạn mà chưa Hoàn thành thì tòa hiện trễ hạn. |
| `projects[].nextaction` | chữ |  |  |
| `projects[].lot` | số nguyên |  | Số lô cố định trong khu (1..n). Bỏ trống thì nhận lô trống đầu tiên. |
| `projects[].driveUrl` | URL http(s) |  | Thư mục Drive của dự án. Thiếu thì nút "Mở Drive" bị mờ. |
| `projects[].milestones` | danh sách | có | Chiều cao đã xây = tỉ lệ milestone completed. |
| `projects[].milestones[].date` | ngày dd/mm/yyyy |  |  |
| `projects[].milestones[].name` | chữ | có |  |
| `projects[].milestones[].completed` | true/false | có |  |
| `projects[].documents` | danh sách | có |  |
| `projects[].documents[].title` | chữ | có |  |
| `projects[].documents[].status` | chữ | có |  |
| `projects[].paperwork` | object |  | Sáu giấy tờ trang Giấy tờ theo dõi; true = có, false = thiếu, bỏ trống = chưa rõ. |
| `projects[].paperwork.quote` | true/false |  |  |
| `projects[].paperwork.contract` | true/false |  |  |
| `projects[].paperwork.vat1` | true/false |  |  |
| `projects[].paperwork.vat2` | true/false |  |  |
| `projects[].paperwork.vat3` | true/false |  |  |
| `projects[].paperwork.handover` | true/false |  |  |

### 5. `recentExpenses`

Khoản chi mới nhất (thẻ Ngân hàng).

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `recentExpenses[].id` | chữ | có |  |
| `recentExpenses[].description` | chữ | có |  |
| `recentExpenses[].amount` | số | có |  |
| `recentExpenses[].amountFormatted` | chữ | có |  |
| `recentExpenses[].date` | ngày dd/mm/yyyy | có |  |
| `recentExpenses[].category` | chữ |  |  |
| `recentExpenses[].method` | chữ |  |  |
| `recentExpenses[].projectId` | chữ |  |  |

### 6. `allExpenses`

Mọi khoản chi của kỳ (trang Tài chính).

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `allExpenses[].id` | chữ | có |  |
| `allExpenses[].description` | chữ | có |  |
| `allExpenses[].amount` | số | có |  |
| `allExpenses[].amountFormatted` | chữ | có |  |
| `allExpenses[].date` | ngày dd/mm/yyyy | có |  |
| `allExpenses[].category` | chữ |  |  |
| `allExpenses[].method` | chữ |  |  |
| `allExpenses[].projectId` | chữ |  |  |

### 7. `allIncomes`

Mọi khoản thu của kỳ (trang Tài chính).

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `allIncomes[].id` | chữ | có |  |
| `allIncomes[].description` | chữ | có |  |
| `allIncomes[].amount` | số | có |  |
| `allIncomes[].amountFormatted` | chữ | có |  |
| `allIncomes[].date` | ngày dd/mm/yyyy | có |  |
| `allIncomes[].category` | chữ |  |  |
| `allIncomes[].method` | chữ |  |  |
| `allIncomes[].projectId` | chữ |  |  |

### 8. `actionsPending` (không bắt buộc)

Việc chờ duyệt bên dashboard. Thế giới 3D chưa đọc; dùng missions.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `actionsPending[].id` | chữ | có |  |
| `actionsPending[].title` | chữ | có |  |
| `actionsPending[].priority` | chữ |  |  |
| `actionsPending[].assignee` | chữ |  |  |
| `actionsPending[].deadline` | ngày dd/mm/yyyy |  |  |

### 9. `dailyBriefing`

Tóm tắt trong ngày của Trâm Anh và Hermes.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `dailyBriefing.tramanh` | object | có |  |
| `dailyBriefing.tramanh.activeProjectsSummary` | chữ | có |  |
| `dailyBriefing.tramanh.pendingActionsSummary` | chữ | có |  |
| `dailyBriefing.tramanh.highlights` | danh sách chữ | có |  |
| `dailyBriefing.hermes` | object | có |  |
| `dailyBriefing.hermes.systemStatus` | chữ | có |  |
| `dailyBriefing.hermes.mailScanStatus` | chữ | có |  |
| `dailyBriefing.hermes.dbLatency` | chữ | có |  |
| `dailyBriefing.hermes.backupStatus` | chữ | có |  |

### 10. `missions`

Việc An phải làm: danh sách Mission và huy hiệu trên tòa.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `missions[].id` | chữ | có |  |
| `missions[].title` | chữ | có |  |
| `missions[].priority` | "high" / "medium" / "low" | có |  |
| `missions[].tag` | chữ |  | "Cần Input" được tô nổi; chữ khác hiện nguyên văn. |
| `missions[].projectId` | chữ |  |  |
| `missions[].buildingId` | chữ |  | Id tòa trong physical-topology.json, hoặc bld:project:proj_NN. |
| `missions[].date` | ngày dd/mm/yyyy |  |  |
| `missions[].time` | chữ |  |  |
| `missions[].done` | true/false | có |  |
| `missions[].source` | chữ |  |  |
| `missions[].actionId` | chữ |  |  |
| `missions[].expenseId` | chữ |  |  |

### 11. `notifications`

Thông báo dưới danh sách Mission.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `notifications[].id` | chữ | có |  |
| `notifications[].type` | chữ |  |  |
| `notifications[].level` | "alert" / "warn" / "info" | có |  |
| `notifications[].text` | chữ | có |  |
| `notifications[].time` | ngày dd/mm/yyyy hh:mm |  |  |
| `notifications[].buildingId` | chữ |  |  |
| `notifications[].projectId` | chữ |  |  |

### 12. `aiWorkforce`

Đội AI: người đi lại trong tòa và bảng AI Workforce.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `aiWorkforce[].id` | chữ | có |  |
| `aiWorkforce[].name` | chữ | có |  |
| `aiWorkforce[].role` | chữ | có |  |
| `aiWorkforce[].status` | "active" / "idle" | có |  |
| `aiWorkforce[].task` | chữ |  |  |
| `aiWorkforce[].loadPct` | số |  |  |
| `aiWorkforce[].buildingId` | chữ |  |  |
| `aiWorkforce[].buildingIds` | danh sách chữ |  | Các tòa agent có mặt; thiếu thì dùng buildingId. |

### 13. `systems`

Hạ tầng (Supabase, Oracle, Telegram, Google): trạng thái trên tòa hạ tầng.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `systems[].id` | chữ | có |  |
| `systems[].buildingId` | chữ | có |  |
| `systems[].name` | chữ | có |  |
| `systems[].status` | "online" / "slow" / "down" | có |  |
| `systems[].detail` | chữ |  |  |
| `systems[].lastCheck` | ngày dd/mm/yyyy hh:mm |  |  |

### 14. `scheduleToday`

Lịch của ngày xuất dữ liệu (ngày của updatedAt), dùng khi không có schedule.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `scheduleToday[].id` | chữ | có |  |
| `scheduleToday[].title` | chữ | có |  |
| `scheduleToday[].time` | chữ |  |  |
| `scheduleToday[].priority` | "high" / "medium" / "low" |  |  |
| `scheduleToday[].projectId` | chữ |  |  |
| `scheduleToday[].done` | true/false |  |  |

### 15. `marketing` (không bắt buộc)

Bài fanpage. Thiếu thì tòa Marketing hiện "chưa kết nối".

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `marketing.totalPosts` | số nguyên | có |  |
| `marketing.pendingApproval` | số nguyên | có |  |
| `marketing.approvedQueued` | số nguyên | có |  |
| `marketing.published` | số nguyên | có |  |
| `marketing.posts` | danh sách |  |  |
| `marketing.posts[].id` | chữ | có |  |
| `marketing.posts[].page` | chữ |  |  |
| `marketing.posts[].status` | "pending" / "approved" / "published" | có |  |
| `marketing.posts[].title` | chữ | có |  |
| `marketing.posts[].author` | chữ |  |  |
| `marketing.posts[].date` | ngày dd/mm/yyyy |  |  |
| `marketing.posts[].image` | URL http(s) |  |  |
| `marketing.posts[].url` | URL http(s) |  |  |

### 16. `workspace`

Link sang AN PHIM Workspace.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `workspace.baseUrl` | URL http(s) | có | Địa chỉ Workspace. Để "" thì mọi nút "Mở dashboard" bị mờ (có cảnh báo). |
| `workspace.pages` | object (key tự do) | có | Các tab của dashboard: key -> {label, path}; link = baseUrl + path. |
| `workspace.pages.<key>` | object | có |  |
| `workspace.pages.<key>.label` | chữ | có |  |
| `workspace.pages.<key>.path` | chữ | có |  |
| `workspace.buildingPages` | object (key tự do) | có | Id tòa -> key trong pages. |
| `workspace.buildingPages.<key>` | chữ | có |  |

### 17. `schedule` (không bắt buộc)

Lịch cả tháng. Thiếu thì trang Lịch chỉ có hôm nay.

| Trường | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `schedule[].id` | chữ | có |  |
| `schedule[].title` | chữ | có |  |
| `schedule[].time` | chữ |  |  |
| `schedule[].priority` | "high" / "medium" / "low" |  |  |
| `schedule[].projectId` | chữ |  |  |
| `schedule[].done` | true/false |  |  |
| `schedule[].date` | ngày dd/mm/yyyy | có |  |
| `schedule[].dateEnd` | ngày dd/mm/yyyy |  |  |
<!-- contract:end -->
