-- 076 — Audit log for job.vision_field.
-- Every value change is captured as a before/after pair with the same
-- source + source_detail attribution the live row carries. Enables
-- "what changed last week" queries and a future undo affordance.

create table if not exists job.vision_field_history (
  id              uuid primary key default gen_random_uuid(),
  field_id        uuid not null references job.vision_field(id) on delete cascade,
  user_id         uuid not null,
  name            text not null,
  value_before    jsonb,
  value_after     jsonb,
  source          text not null,
  source_detail   jsonb,
  changed_at      timestamptz not null default now()
);
create index vision_field_history_user_idx on job.vision_field_history (user_id, changed_at desc);
create index vision_field_history_name_idx on job.vision_field_history (name, changed_at desc);

comment on table job.vision_field_history is
  'Append-only audit log of job.vision_field changes. Populated by the vision_field_audit trigger on every UPDATE where value actually changed.';

create or replace function job.vision_field_audit()
returns trigger
language plpgsql
as $$
begin
  if old.value is distinct from new.value then
    insert into job.vision_field_history
      (field_id, user_id, name, value_before, value_after, source, source_detail)
    values
      (new.id, new.user_id, new.name, old.value, new.value, coalesce(new.source, 'user'), new.source_detail);
  end if;
  return new;
end
$$;

drop trigger if exists vision_field_audit on job.vision_field;
create trigger vision_field_audit
  after update on job.vision_field
  for each row
  execute function job.vision_field_audit();

alter table job.vision_field_history enable row level security;
drop policy if exists "vision_field_history: owner select" on job.vision_field_history;
create policy "vision_field_history: owner select" on job.vision_field_history
  for select using (auth.uid() = user_id);
grant select on job.vision_field_history to authenticated;
