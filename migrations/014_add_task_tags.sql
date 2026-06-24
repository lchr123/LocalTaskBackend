-- Migration: 014_add_task_tags
-- Description: Predefined task tag dictionary + many-to-many junction with tasks.
--              Coexists with tasks.type (type is left unchanged).

-- Up Migration

CREATE TABLE task_tags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(50) NOT NULL UNIQUE,
  label_zh    VARCHAR(50) NOT NULL,
  category    VARCHAR(30),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE task_task_tags (
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (task_id, tag_id)
);

CREATE INDEX idx_task_task_tags_task ON task_task_tags(task_id);
CREATE INDEX idx_task_task_tags_tag ON task_task_tags(tag_id);

-- Seed default task tags (categories: scene 场景 / requirement 要求 / other 其他)
INSERT INTO task_tags (name, label_zh, category) VALUES
  ('construction', '建筑工地', 'scene'),
  ('rent', '房产短租', 'scene'),
  ('restaurant', '餐饮服务', 'scene'),
  ('IT', 'IT工程', 'scene'),
  ('chinese', '中文沟通', 'requirement'),
  ('japanese', '日语沟通', 'requirement'),
  ('english', '英语沟通', 'requirement'),
  ('heavy_lifting', '重体力劳动', 'requirement'),
  ('experienced', '需相关经验/资质', 'requirement'),
  ('need_driving', '需开车/驾照', 'requirement'),
  ('reward_negotiable', '报酬可商量', 'other');


-- Down Migration

DROP INDEX IF EXISTS idx_task_task_tags_tag;
DROP INDEX IF EXISTS idx_task_task_tags_task;
DROP TABLE IF EXISTS task_task_tags;
DROP TABLE IF EXISTS task_tags;
