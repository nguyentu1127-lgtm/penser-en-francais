# Penser en Français — PWA học tiếng Pháp A1 → A2 (32 tuần)

Ứng dụng web cài được lên điện thoại (PWA), chạy offline, không cần build.

## Cấu trúc

```
index.html, styles.css, app.js   ← giao diện + logic (vanilla JS)
sw.js, manifest.json, icons/     ← PWA: cài lên màn hình chính, chạy offline
api/ai.js, api/_gemini.js        ← hàm Vercel gọi Gemini (chấm bài, tra từ, nhập vai, dịch câu, soạn bài)
data/curriculum.json             ← lộ trình 32 tuần (tên tuần + 5 chủ đề/ngày)
data/weeks/week-01.json …        ← nội dung bài học từng tuần
data/dict.json                   ← từ điển bỏ túi offline (từ chia → nguyên thể + nghĩa)
```

## Cải tiến bài học (quy trình hằng ngày)

1. Sửa/thêm file trong `data/weeks/` trên GitHub (bấm ✏️ ngay trên web GitHub).
2. Commit → Vercel tự deploy trong ~30 giây → mọi điện thoại thấy bài mới ở lần mở kế tiếp.

Tuần chưa có file: trong app bấm **✨ Tạo bằng AI** cho từng ngày → kiểm tra nội dung → **Tải JSON tuần này** → đưa file lên `data/weeks/week-XX.json`.
Muốn xem trước bản sửa trên máy mình trước khi commit: Cài đặt → **Nhập JSON tuần**.

### Schema 1 ngày học
`grammar {title, rule, note_vi, table{head,rows}, examples[], quiz[]}`, `vocab[{fr, ipa, pos, vi, ex}]`, `vocabQuiz[]`,
`listening {dictee[], dialogue[{s,t}], questions[]}`, `speaking {readAloud[], shadowing[], roleplay{scenario, aiRole, starter, goal}}`,
`reading {title, text, questions[]}`, `writing {prompt, minWords}`.
Câu hỏi: trắc nghiệm `{"q","options":[…],"answer":index}` hoặc tự điền `{"q","answer":["đáp án 1","đáp án 2"]}`.

## Biến môi trường trên Vercel

| Tên | Bắt buộc | Ghi chú |
|---|---|---|
| `GEMINI_API_KEY` | có | Lấy miễn phí tại https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | không | Mặc định `gemini-flash-latest` |
| `APP_ACCESS_CODE` | nên đặt | Mã bí mật để người lạ không dùng hết quota AI; nhập mã trong app ở Cài đặt |

## Lưu trữ
Tiến độ, flashcard, lỗi sai, bài viết lưu trong trình duyệt của máy (localStorage) — dùng offline được.
Đổi máy: Cài đặt → Xuất sao lưu / Nhập sao lưu.

## Cài lên điện thoại
- iPhone (Safari): Chia sẻ → Thêm vào MH chính.
- Android (Chrome): menu ⋮ → Cài đặt ứng dụng.
