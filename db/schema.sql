-- OAuth Setup Guide Library — Postgres schema
-- Requires Postgres 13+ (gen_random_uuid built in)

-- =========================================================
-- 1. APPS — one row per provider (Google, Slack, Notion...)
-- =========================================================
CREATE TABLE apps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,             -- 'notion' -> /guides/notion
  name            TEXT NOT NULL,                    -- 'Notion'
  primary_domain  TEXT NOT NULL UNIQUE,             -- 'notion.so' (dedupe key)
  aliases         TEXT[] NOT NULL DEFAULT '{}',     -- {'notion.com','Notion API'}
  category        TEXT,                             -- 'productivity', 'crm'...
  developer_portal_url TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_apps_aliases ON apps USING GIN (aliases);

-- =========================================================
-- 2. GUIDES — the "live" pointer for each app
-- =========================================================
CREATE TABLE guides (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id             UUID NOT NULL UNIQUE REFERENCES apps(id) ON DELETE CASCADE,
  current_version_id UUID,                          -- FK added below
  status     TEXT NOT NULL DEFAULT 'draft'
             CHECK (status IN ('draft','published','failed')),
  freshness  TEXT NOT NULL DEFAULT 'fresh'
             CHECK (freshness IN ('fresh','rechecking','outdated')),
  last_verified_at   TIMESTAMPTZ,
  next_check_at      TIMESTAMPTZ,                   -- when the cron should re-check
  check_interval_days INT NOT NULL DEFAULT 30,      -- hard apps: shorter
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_guides_next_check ON guides (next_check_at);

-- =========================================================
-- 3. GUIDE_VERSIONS — immutable snapshots; every change = new version
-- =========================================================
CREATE TABLE guide_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id         UUID NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  version_no       INT  NOT NULL,
  content          JSONB NOT NULL,                  -- full rendered guide (UI reads this)
  difficulty       TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  difficulty_reasons TEXT[] NOT NULL DEFAULT '{}',  -- rule hits: {'app_review_required'}
  hands_on_minutes_min INT,
  hands_on_minutes_max INT,
  approval_wait_days_min INT,                       -- 0 = no review
  approval_wait_days_max INT,
  change_summary   TEXT,                            -- 'Google added X requirement'
  created_by       TEXT NOT NULL DEFAULT 'agent' CHECK (created_by IN ('agent','human')),
  job_id           UUID,                            -- which job produced it (FK below)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guide_id, version_no)
);

ALTER TABLE guides
  ADD CONSTRAINT fk_guides_current_version
  FOREIGN KEY (current_version_id) REFERENCES guide_versions(id);

-- =========================================================
-- 4. SOURCES — every web page the agent read (shared across apps)
-- =========================================================
CREATE TABLE sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url             TEXT NOT NULL UNIQUE,
  domain          TEXT NOT NULL,
  title           TEXT,
  source_type     TEXT NOT NULL DEFAULT 'official_docs'
                  CHECK (source_type IN ('official_docs','changelog','policy','community','other')),
  is_official     BOOLEAN NOT NULL DEFAULT true,
  current_hash    TEXT,                             -- sha256 of cleaned text
  latest_snapshot_id UUID,                          -- FK added below
  http_status     INT,
  fetch_error     TEXT,
  last_fetched_at TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sources_last_fetched ON sources (last_fetched_at);

-- =========================================================
-- 5. SOURCE_SNAPSHOTS — page content over time (enables diffs)
-- =========================================================
CREATE TABLE source_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  content_hash  TEXT NOT NULL,
  content_text  TEXT NOT NULL,                      -- cleaned text (or object-storage key)
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, content_hash)                  -- store only when content changes
);

ALTER TABLE sources
  ADD CONSTRAINT fk_sources_latest_snapshot
  FOREIGN KEY (latest_snapshot_id) REFERENCES source_snapshots(id);

-- =========================================================
-- 6. PROBE_RUNS — real tests the agent ran (the "tested" evidence)
-- =========================================================
CREATE TABLE probe_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id       UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  probe_type   TEXT NOT NULL CHECK (probe_type IN (
                 'oidc_discovery','oauth_metadata','authorize_endpoint',
                 'token_endpoint','developer_console','docs_page')),
  target_url   TEXT NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('pass','fail','changed','error')),
  http_status  INT,
  result       JSONB,                               -- e.g. scopes_supported, redirect target
  ran_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_probe_runs_app ON probe_runs (app_id, probe_type, ran_at DESC);

-- =========================================================
-- 7. CLAIMS — each fact in a guide version, with its evidence level
-- =========================================================
CREATE TABLE claims (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_version_id UUID NOT NULL REFERENCES guide_versions(id) ON DELETE CASCADE,
  section   TEXT NOT NULL CHECK (section IN (
              'summary','requirement','step','blocker','timing','scope','approval','cost')),
  position  INT  NOT NULL DEFAULT 0,                -- order within section
  text      TEXT NOT NULL,
  owner     TEXT CHECK (owner IN ('agent','you','both')),   -- for steps
  evidence  TEXT NOT NULL CHECK (evidence IN ('tested','sourced','uncertain')),
  status    TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active','needs_review','invalidated')),
  probe_run_id     UUID REFERENCES probe_runs(id),  -- set when evidence = 'tested'
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_claims_version ON claims (guide_version_id, section, position);
CREATE INDEX idx_claims_status  ON claims (status) WHERE status <> 'active';

-- =========================================================
-- 8. CLAIM_SOURCES — which pages support which claim (many-to-many)
-- =========================================================
CREATE TABLE claim_sources (
  claim_id     UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  source_id    UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  snapshot_id  UUID REFERENCES source_snapshots(id),  -- page version used at the time
  excerpt      TEXT,                                -- short supporting excerpt
  PRIMARY KEY (claim_id, source_id)
);
CREATE INDEX idx_claim_sources_source ON claim_sources (source_id);  -- "page changed -> which claims?"

-- =========================================================
-- 9. JOBS — generate / recheck / refresh runs
-- =========================================================
CREATE TABLE jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type      TEXT NOT NULL CHECK (job_type IN ('generate','recheck','full_refresh')),
  app_id        UUID REFERENCES apps(id),           -- null until app is resolved
  input_text    TEXT NOT NULL,                      -- what the user typed
  normalized_domain TEXT,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','succeeded','failed')),
  current_step  TEXT,                               -- 'research','probe','verify','compose'
  trigger       TEXT NOT NULL DEFAULT 'user'
                CHECK (trigger IN ('user','cron','source_change','feedback','manual')),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
CREATE INDEX idx_jobs_status ON jobs (status, created_at);
-- Prevent two concurrent generations for the same app:
CREATE UNIQUE INDEX uq_jobs_active_per_domain
  ON jobs (normalized_domain) WHERE status IN ('queued','running');

ALTER TABLE guide_versions
  ADD CONSTRAINT fk_versions_job FOREIGN KEY (job_id) REFERENCES jobs(id);

-- =========================================================
-- 10. JOB_EVENTS — progress log; powers the live SSE view + replay
-- =========================================================
CREATE TABLE job_events (
  id          BIGSERIAL PRIMARY KEY,
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  step        TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warn','error')),
  message     TEXT NOT NULL,                        -- 'Found developer docs'
  payload     JSONB,                                -- partial guide section, URLs...
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_events_job ON job_events (job_id, id);

-- =========================================================
-- 11. CHANGE_EVENTS — detected doc changes and what they affected
-- =========================================================
CREATE TABLE change_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        UUID NOT NULL REFERENCES sources(id),
  old_snapshot_id  UUID REFERENCES source_snapshots(id),
  new_snapshot_id  UUID NOT NULL REFERENCES source_snapshots(id),
  diff_summary     TEXT,                            -- LLM summary of the diff
  impact           TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (impact IN ('unknown','none','minor','breaking')),
  affected_claim_ids UUID[] NOT NULL DEFAULT '{}',
  resulting_version_id UUID REFERENCES guide_versions(id),
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_change_events_source ON change_events (source_id, detected_at DESC);

-- =========================================================
-- 12. FEEDBACK — developers reporting broken / outdated steps
-- =========================================================
CREATE TABLE feedback (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_version_id UUID NOT NULL REFERENCES guide_versions(id) ON DELETE CASCADE,
  claim_id         UUID REFERENCES claims(id) ON DELETE SET NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('step_failed','outdated','unclear','helpful','other')),
  comment  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_feedback_claim ON feedback (claim_id, kind);

-- =========================================================
-- 13. VERIFICATION_LOG — spot-checks (agent or you) and their outcome
-- =========================================================
CREATE TABLE verification_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id    UUID NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  verified_by TEXT NOT NULL CHECK (verified_by IN ('agent','human')),
  method      TEXT NOT NULL CHECK (method IN ('doc_review','setup_attempt','probe','provider_contact')),
  outcome     TEXT NOT NULL CHECK (outcome IN ('confirmed','corrected','unverifiable')),
  original_text  TEXT,                              -- what it said before a correction
  corrected_text TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_verification_outcome ON verification_log (outcome);
