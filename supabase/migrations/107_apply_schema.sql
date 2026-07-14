-- 107_apply_schema.sql — persist the extracted application form schema on the
-- role (Phase 16.2c robustness).
--
-- classify-apply-ease / extract-application-fields write the full field schema
-- here whenever the ATS API returns real fields. submit-application's review
-- reads it instead of re-extracting live, because live extraction is flaky
-- from the edge (Ashby/Greenhouse rate-limit the egress IP). A transient
-- failure never overwrites a good schema — the functions only write on success.

alter table job.pipeline_roles
  add column if not exists apply_schema jsonb;
