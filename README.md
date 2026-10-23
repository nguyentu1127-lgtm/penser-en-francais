# Penser en Français — PWA học tiếng Pháp A1 → A2 (32 tuần)

Ứng dụng web cài được lên điện thoại (PWA), chạy offline, **không cần AI, không cần khoá API**, không cần build.

## Cấu trúc

```
index.html, styles.css, app.js   ← giao diện + logic (vanilla JS)
sw.js, manifest.json, icons/     ← PWA: cài lên màn hình chính, chạy offline
content/week-01.txt … week-32.txt← NỘI DUNG GỐC (dễ sửa) — mỗi tuần 5 ngày học
content/dict.txt                 ← từ điển gốc (từ + động từ chia)
tools/build.py, tools/build_dict.py ← chuyển content/*.txt → data/*.json + kiểm tra lỗi
data/curriculum.json             ← lộ trình 32 tuần (tên tuần + 5 chủ đề/ngày)
data/weeks/week-XX.json          ← bài học đã build (app đọc file này)
data/dict.json                   ← từ điển offline đã build
```

## Sửa / cải tiến bài học

1. Sửa file `content/week-XX.txt` (hoặc `content/dict.txt`).
2. Chạy `python3 tools/build.py` → tạo lại `data/weeks/*.json` và `data/dict.json`, đồng thời báo lỗi
   (thiếu bản dịch, câu hỏi trắc nghiệm sai định dạng…).
3. Commit & push lên GitHub → Vercel tự deploy → điện thoại thấy bài mới ở lần mở kế tiếp.

### Định dạng `content/week-XX.txt` (rút gọn)
```
@week 15 / @title … / @level A2
## 1 | Tên ngày
G.title / G.rule: câu Pháp || bản dịch / G.note / G.table / G.row / G.ex: … || … / G.q: …
V: từ | ipa | loại | nghĩa | ví dụ || dịch       VQ: câu hỏi từ vựng
D: câu chính tả   L: Người nói | câu || dịch   LQ: câu hỏi nghe
RA: đọc to   SH: nói đuổi   R.title / R: câu đọc || dịch   RQ: câu hỏi đọc
W.prompt: … || …   W.min: 50   W.must: từ1 ; từ2   W.check: …   W.model: câu mẫu || dịch
```
Câu hỏi: trắc nghiệm `Câu hỏi | lựa chọn | *đáp án đúng | …`, hoặc tự điền `Câu hỏi = đáp án / đáp án khác`.

### Từ điển `content/dict.txt`
- Từ thường: `le mot | nom m. | nghĩa`
- Động từ đều: `@er parler | nói`, `@ir finir | …`, `@re vendre | …`
- Động từ bất quy tắc: `@v venir | đến | viens,viens,vient,venons,venez,viennent | venu | ven | viendr`
  (6 dạng hiện tại | phân từ | gốc imparfait | gốc futur) — app tự sinh mọi dạng chia khi tra từ.

## Tính năng (tất cả offline)
- Lộ trình 32 tuần, mỗi ngày 6 bước: Ngữ pháp, Từ vựng, Nghe, Nói, Đọc, Viết; thứ Bảy kiểm tra (≥80% mở tuần sau), Chủ nhật ôn nhẹ.
- Chạm vào từ bất kỳ để tra (nguyên thể, loại từ, nghĩa, ví dụ, phát âm); nút dịch câu dùng bản dịch soạn sẵn.
- Flashcard SRS 3 mức: đỏ 5 phút, vàng 24 giờ, xanh 72 giờ.
- Phát âm giọng Pháp của trình duyệt (0.75× / 1.0×); luyện nói dùng nhận dạng giọng nói của trình duyệt.
- Viết: tự kiểm tra (số từ, từ bắt buộc, gợi ý lỗi thường gặp) + bài mẫu + danh sách tự chấm.

## Lưu trữ
Tiến độ, flashcard, lỗi sai, bài viết lưu trong trình duyệt (localStorage).
Đổi máy: Cài đặt → Xuất sao lưu / Nhập sao lưu.

## Cài lên điện thoại
- iPhone (Safari): Chia sẻ → Thêm vào MH chính.
- Android (Chrome): menu ⋮ → Cài đặt ứng dụng.
