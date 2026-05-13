-- 074a — auto-bump vision_field.updated_at whenever value changes,
-- regardless of writer. The agent tool sets updated_at explicitly today,
-- but direct SQL / future writers shouldn't have to remember.

create or replace function job.vision_field_bump_updated_at()
returns trigger
language plpgsql
as $$
begin
  if old.value is distinct from new.value then
    new.updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists vision_field_bump_updated_at on job.vision_field;
create trigger vision_field_bump_updated_at
  before update on job.vision_field
  for each row
  execute function job.vision_field_bump_updated_at();
