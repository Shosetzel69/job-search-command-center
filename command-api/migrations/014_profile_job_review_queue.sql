-- #530 WP7 / #663 W2: additive personal review-queue membership.
-- Apply through approved DEV Nile migration gate before deploying dependent code.
ALTER TABLE profile_job_state
  ADD COLUMN review_required_at timestamptz;

CREATE INDEX pjs_review_queue_idx
  ON profile_job_state (tenant_id, review_required_at, job_id)
  WHERE review_required_at IS NOT NULL;
