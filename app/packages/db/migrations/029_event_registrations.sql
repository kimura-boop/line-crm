-- イベント定義（日程・振込先情報などをまとめて管理）
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  completion_message TEXT NOT NULL,
  bank_info TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 日程×時間帯スロット（定員を持つ）
CREATE TABLE IF NOT EXISTS event_slots (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  time_slot TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 10,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

-- 申し込み記録
CREATE TABLE IF NOT EXISTS event_registrations (
  id TEXT PRIMARY KEY,
  event_slot_id TEXT NOT NULL,
  friend_id TEXT,
  line_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT DEFAULT 'confirmed',
  created_at TEXT NOT NULL,
  UNIQUE(event_slot_id, line_user_id),
  FOREIGN KEY (event_slot_id) REFERENCES event_slots(id)
);
