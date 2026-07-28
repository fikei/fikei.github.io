-- 131: fix handle_new_user failing for brand-new OAuth users.
-- GoTrue inserts into auth.users with search_path = auth, so the unqualified
-- `profiles` reference in handle_new_user() (025_profiles.sql) raised
-- `relation "profiles" does not exist`, aborting the whole sign-up with a
-- 500 at /callback. Pin the search_path and schema-qualify the table.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    NEW.id,
    NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
