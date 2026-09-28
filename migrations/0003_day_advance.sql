-- 世界日を進める仕組み。
-- 日は draft として作られ、その日の仕事が最後まで終わったときだけ published になる。
-- 途中で失敗した日は draft のまま残り、観測者には前日の世界が見え続ける。

ALTER TABLE world_days ADD COLUMN status TEXT NOT NULL DEFAULT 'published';

CREATE INDEX world_days_status_idx ON world_days(status, world_day);

-- 運営のつまみ。値は文字列で持ち、意味は読む側が決める。
CREATE TABLE world_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 初日を公開するまで、世界日は自動では進めない。
-- 準備が整った日に 'on' へ変えると、翌朝の Cron から Day 2 が始まる。
INSERT INTO world_settings (key, value) VALUES ('daily_advance', 'off');

-- その日の画像は、神の書いた日記ではなく世界日そのものに属する。
-- 神が何も語らなかった日にも画像は残るため、genesis_diary から移す。
ALTER TABLE world_days ADD COLUMN screenshot_key TEXT;

UPDATE world_days
SET screenshot_key = (SELECT screenshot_key FROM genesis_diary WHERE genesis_diary.world_day = world_days.world_day);
