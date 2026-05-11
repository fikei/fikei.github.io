-- Source-email-link: when a role is added from a Gmail-sourced rec, we
-- stash the Gmail web URL so the user can jump back to the originating
-- email from the role detail page (and rec cards before they're added).
--
-- The URL is constructed from recommended_roles.payload->>'gmailApiId'
-- at add-role time. Format: https://mail.google.com/mail/u/0/#inbox/{id}

alter table job.pipeline_roles
  add column if not exists source_email_url text;

-- Backfill: any pipeline_role that's linked to a Gmail-sourced rec.
update job.pipeline_roles p
   set source_email_url = 'https://mail.google.com/mail/u/0/#inbox/' || (r.payload->>'gmailApiId')
  from job.recommended_roles r
 where r.added_to_pipeline_slug = p.slug
   and r.source = 'gmail-jobs'
   and r.payload ? 'gmailApiId'
   and p.source_email_url is null;
