-- Migration: Enable required PostgreSQL extensions
-- Up Migration

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Down Migration
-- Note: Dropping extensions can break other objects that depend on them.
-- Only drop if you are sure no other tables/functions rely on these extensions.

---- create above / drop below ----

-- DROP EXTENSION IF EXISTS "postgis";
-- DROP EXTENSION IF EXISTS "uuid-ossp";
