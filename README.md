# KuKu Sticker ×3

Extension Chrome Manifest V3 cho **https://kuku.vn/**. Bạn chọn sticker trả lời trong bảng trên trang, thêm sticker từ menu chuột phải và chọn chế độ chỉ phản hồi những sticker đã theo dõi. Mỗi đợt gom tin **2 giây** chỉ gửi tối đa **3 sticker**, không cộng dồn.

## Cài vào Chrome đang đăng nhập

1. Mở `chrome://extensions`, bật **Developer mode / Chế độ dành cho nhà phát triển**.
2. Bấm **Load unpacked / Tải tiện ích đã giải nén** và chọn `/Volumes/SS500GB/spam-kuku-sticker/extension`.
3. Quay lại KuKu, **F5**. Bấm **Chọn sticker** cạnh nút ×3 để mở bảng chọn.
4. Trong tab **Sticker trả lời**, chọn ít nhất một mẫu. Danh sách được lưu ngay và giữ lại khi tải lại trang.

Nếu dùng ZIP, giải nén rồi chọn thư mục có `manifest.json`. Khi nâng cấp, bấm biểu tượng tải lại của extension trong `chrome://extensions`, sau đó F5 KuKu.

## Chọn sticker và chế độ

- Bảng chọn có tìm kiếm tên sticker / bộ sticker, phân trang và nút tải lại khay. Bấm một hình để chọn hoặc bỏ chọn; bấm × trên một hình đã chọn để xoá khỏi danh sách.
- **Sticker trả lời** là danh sách mẫu sẽ gửi. Một mẫu lặp 3 lần; nhiều mẫu được gửi lần lượt, mỗi lượt vẫn chỉ có 3 sticker. Không có mẫu nào được gắn cứng trong mã nguồn.
- **Sticker theo dõi** là danh sách mẫu sẽ kích hoạt tự trả lời trong chế độ **Chỉ sticker trong danh sách theo dõi**. Chế độ này bỏ qua các sticker khác và ảnh đính kèm. Bản sao có cùng ID gốc được coi là cùng mẫu.
- Chế độ **Mọi sticker / ảnh mới** phản hồi các sticker mới của người khác và có tuỳ chọn bật/tắt phản hồi ảnh đính kèm.
- Có thể mở bảng chọn từ popup của extension hoặc từ nút **Chọn sticker** ngay trên trang.

## Menu chuột phải

Chuột phải sticker trong chat hoặc bấm nút tuỳ chọn tin nhắn. Menu của KuKu có thêm nhóm **KUKU ×3**:

- **Thêm vào sticker trả lời**: đưa mẫu đó vào danh sách mẫu sẽ gửi. Với sticker của người khác chưa có trong khay, extension dùng thao tác thêm vào khay bình thường của KuKu trước khi lưu. Không gửi sticker vào chat khi bạn chỉ đang chọn mẫu.
- **Theo dõi sticker này để tự reply**: thêm mẫu đó vào danh sách kích hoạt và chuyển sang chế độ Theo danh sách. Danh sách sticker trả lời được giữ nguyên.
- **Mở bảng chọn sticker**: chỉnh cả hai danh sách.

Các mục gốc của menu KuKu vẫn được giữ. Nếu KuKu không mở menu riêng, extension hiển thị nhóm lựa chọn ở vị trí chuột. Muốn thay sticker đang dùng, bỏ mẫu cũ và chọn mẫu mới trong bảng.

## Giới hạn gửi

- Chỉ xử lý **tin mới trong chat đang mở**. Bỏ qua lịch sử cũ và tin của chính bạn, kể cả gửi từ thiết bị khác.
- Cửa sổ gom tin kéo dài **2 giây từ tin đầu tiên**. Các tin tiếp theo cập nhật tin sẽ được reply, không thêm lượt vào hàng đợi. Trong lúc gửi, tin đến thêm không tạo lượt chờ.
- Mỗi lượt trích dẫn đúng tin cuối của cửa sổ và gửi tối đa **3 sticker từ danh sách đã chọn**. Khoảng cách mặc định là **800 ms**, có thể chỉnh trong popup.
- Chưa chọn mẫu thì không tự gửi. Nếu các mẫu đã chọn không còn dùng được, extension dừng và yêu cầu cập nhật danh sách, không lấy một mẫu ngẫu nhiên để thay thế.
- Bấm ×3 hoặc công tắc popup để bật/tắt. Đổi danh sách, đổi chế độ hoặc tắt sẽ huỷ cửa sổ chờ và phần chưa gửi của lượt hiện tại. Yêu cầu đã gửi tới máy chủ có thể vẫn hoàn tất.
- Đổi chat sẽ bỏ phần chưa gửi cho chat trước. Nhiều tab không gửi trùng nhờ Chrome Web Locks và sổ ID đã xử lý trên KuKu.
- Mất mạng, hết phiên hoặc gặp giới hạn gửi của KuKu sẽ tự dừng. Kiểm tra rồi bật lại; không tự gửi lại yêu cầu có kết quả không rõ ràng.

## Dữ liệu và quyền

Chỉ xin quyền `storage` và chỉ chạy trên `kuku.vn`, `www.kuku.vn`. Hai danh sách chỉ lưu ID, tên và đường dẫn ảnh của sticker trong Chrome của bạn. Token đăng nhập được dùng ngay trong trang để gọi API cùng tên miền, không chuyển sang extension storage hay máy chủ trung gian. Không đọc kho cookie Chrome, không có phân tích người dùng hoặc thư viện tải từ xa.

Tích hợp dựa trên mã web KuKu kiểm tra ngày **20/11/2026**: `zeplao.auth`, `/api/stickers/mine`, `/api/stickers/recent`, `/api/stickers/system`, `/api/sticker-packs/mine`, `/api/stickers/{id}/adopt`, `POST /api/messages`, SignalR `MessageCreated`, `.message-list`, `.message-row[data-message-id]`, `.message-menu`. Nếu KuKu đổi API hoặc giao diện, cần cập nhật extension.

## Phát triển

```sh
npm install
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

Kiểm tra trình duyệt nạp extension thật trên Chromium với website/API mô phỏng; không gửi tin đến người thật. Bao gồm chọn và lưu danh sách, menu chuột phải, thêm sticker từ người khác, bộ lọc theo mẫu, giới hạn 2 giây, tránh gửi trùng và huỷ lượt gửi. ZIP tại `dist/kuku-sticker-x3.zip`.

Sau khi sửa `core.js` hoặc `content.js`, chạy `npm run build` trước khi tải lại extension. `content.bundle.js` được sinh tự động để phần giao diện và cấu hình chạy cùng nhau trong isolated world; `page.js` theo dõi KuKu trong main world.
