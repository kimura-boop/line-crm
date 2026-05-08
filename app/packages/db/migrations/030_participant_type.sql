-- event_registrations に参加者種別（スクール生 / 外部生）カラムを追加
ALTER TABLE event_registrations ADD COLUMN participant_type TEXT DEFAULT 'school';
