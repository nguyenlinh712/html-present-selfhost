# HTML Present — tự lưu trữ

[English](README.md)

HTML Present phục vụ các bản trình bày HTML tĩnh và cung cấp trang quản lý thư viện với một tài khoản quản trị. Bản tự lưu trữ giữ cấu hình, nội dung tải lên và nhật ký trên hệ thống tệp cục bộ.

## Yêu cầu

- Node.js 20 trở lên và npm, hoặc Docker cùng Docker Compose.
- Một thư mục dữ liệu có quyền ghi và đủ chỗ cho nội dung trình bày.

## Chạy bằng Node.js

```sh
npm install
DATA_DIR="$HOME/.html-present" PORT=3301 npm start
```

Mở `http://127.0.0.1:3301/_admin` và tạo mật khẩu quản trị lần đầu. Thư mục dữ liệu mặc định là `~/.html-present`; đặt `DATA_DIR` để chọn vị trí khác. Hãy giữ thư mục này ngoài mã nguồn và sao lưu định kỳ.

Khi kiểm tra cục bộ, dùng thư mục tạm và cổng không dành cho production, ví dụ `DATA_DIR=/tmp/html-present-data PORT=3302 npm start`. Npm không tự đọc `.env.example`; file này dành cho Docker Compose.

## Chạy bằng Docker Compose

```sh
cp .env.example .env
docker compose up -d --build
```

Container nghe cổng 3301; Compose mặc định mở cổng 3302 trên máy chủ. Đặt `PORT` trong `.env` để đổi cổng máy chủ. Volume `html-present-data` giữ dữ liệu qua các lần khởi động lại.

Khi HTTPS kết thúc tại reverse proxy đáng tin cậy, đặt `COOKIE_SECURE=1`. Chỉ cấu hình `CLIENT_IP_HEADER` hoặc `COUNTRY_HEADER` nếu ứng dụng chỉ nhận request qua proxy có ghi đè các header đó. Không tin header do client công khai tự gửi.

Nếu toàn bộ request đi qua Cloudflare, có thể đặt `PROXY_PROFILE=cloudflare` để dùng header IP và quốc gia của Cloudflare. Không bật preset này nếu client có thể truy cập ứng dụng trực tiếp.

## Chuyển dữ liệu hiện có

Dùng `--source` cho thư mục dữ liệu cũ và `--target` cho `DATA_DIR` mới. Xem kết quả dry-run trước; script chỉ sao chép và không xóa nguồn.

```sh
node scripts/migrate-data-dir.js --source /duong-dan/du-lieu-cu --target /duong-dan/du-lieu-moi
node scripts/migrate-data-dir.js --source /duong-dan/du-lieu-cu --target /duong-dan/du-lieu-moi --apply
```

Sao lưu cả hai thư mục trước khi đổi dịch vụ. Chỉ chuyển `DATA_DIR` sau khi script xác nhận SHA-256 khớp. Nếu cần quay lại, dừng ứng dụng và trỏ `DATA_DIR` về thư mục cũ.

## Lưu ý bảo mật

Chỉ tải lên HTML và JavaScript mà bạn tin cậy. HTML tải lên sẽ chạy trong trình duyệt khách với quyền của origin đó. Để cách ly tốt hơn, hãy phục vụ slide từ origin khác với trang quản trị và bật HTTPS. Xem [SECURITY.md](SECURITY.md).

Thiết lập lần đầu yêu cầu mật khẩu quản trị mạnh. Trang quản trị có CSRF, session file bền vững và giới hạn đăng nhập sai. Bảo vệ `DATA_DIR` vì thư mục này chứa session, nhật ký truy cập và nội dung slide.

Tên thương hiệu, logo, màu chính và chân trang có thể đổi tại **Cài đặt → Thương hiệu** trong trang quản trị.

## Sao lưu

Dừng ứng dụng hoặc tạo snapshot nhất quán của filesystem rồi sao lưu toàn bộ `DATA_DIR`. Hãy thử phục hồi bằng một bản sao dữ liệu và instance riêng trên cổng không dùng cho production.
