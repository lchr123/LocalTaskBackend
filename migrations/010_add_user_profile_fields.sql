-- Migration: 010_add_user_profile_fields
-- Description: Add profile fields to users table (birthday, gender, address, bio)
--              Create helper_tags table and user_helper_tags junction table
-- Up Migration

ALTER TABLE users
  ADD COLUMN birthday      DATE,
  ADD COLUMN gender        VARCHAR(10) CHECK (gender IN ('male', 'female', 'other')),
  ADD COLUMN address       VARCHAR(200),
  ADD COLUMN bio           VARCHAR(500);

-- Predefined helper skill/experience tags
CREATE TABLE helper_tags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(50) NOT NULL UNIQUE,
  label_zh    VARCHAR(50) NOT NULL,
  category    VARCHAR(30),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Junction table: users <-> helper_tags (many-to-many)
CREATE TABLE user_helper_tags (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES helper_tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, tag_id)
);

CREATE INDEX idx_user_helper_tags_user ON user_helper_tags(user_id);
CREATE INDEX idx_user_helper_tags_tag ON user_helper_tags(tag_id);

-- Seed default tags
INSERT INTO helper_tags (name, label_zh, category) VALUES
  ('delivery', '跑腿配送', 'task_type'),
  ('pet_care', '宠物照护', 'task_type'),
  ('translation', '翻译陪同', 'task_type'),
  ('moving', '搬家协助', 'task_type'),
  ('airport_transfer', '接送机', 'task_type'),
  ('childcare', '育儿协助', 'task_type'),
  ('driving', '有驾照/可开车', 'skill'),
  ('japanese_fluent', '日语流利', 'skill'),
  ('chinese_fluent', '中文流利', 'skill'),
  ('english_fluent', '英语流利', 'skill'),
  ('heavy_lifting', '可搬重物', 'skill'),
  ('cooking', '擅长做饭', 'skill'),
  ('student', '学生', 'identity'),
  ('freelance', '自由职业', 'identity'),
  ('office_worker', '上班族', 'identity'),
  ('part_time', '打工/兼职', 'identity'),
  ('self_employed', '个体经营', 'identity'),
  ('homemaker', '主妇/主夫', 'identity'),
  ('retired', '退休', 'identity'),
  ('job_seeking', '求职中', 'identity');

-- Down Migration

DROP INDEX IF EXISTS idx_user_helper_tags_tag;
DROP INDEX IF EXISTS idx_user_helper_tags_user;
DROP TABLE IF EXISTS user_helper_tags;
DROP TABLE IF EXISTS helper_tags;

ALTER TABLE users
  DROP COLUMN IF EXISTS birthday,
  DROP COLUMN IF EXISTS gender,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS bio;
