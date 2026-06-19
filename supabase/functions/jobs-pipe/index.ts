// jobs-pipe — read pipeline from Postgres, write status changes there.
//
//   GET                                       → list pipeline_roles
//   POST { slug, status, stage?, exit_reason?, exit_context? } → status writeback
//   POST { slug, action: 'engage' }           → stamp engaged_at
//   POST { slug, archived }                   → archive / unarchive
//   POST { slug, action: 'delete' }           → soft delete
//
// Status taxonomy (3 values):
//   Saved   — leads. status_changed_at on first save.
//   Active  — drafting / applied / interviewing / offer (stage column)
//   Archive — rejected / didn't apply / role closed (exit_reason column)
//
// Auto-promotion: setting a stage on a Saved row promotes status to
// Active. Inverse: clearing stage doesn't demote — caller must set
// status explicitly. Archive transitions require exit_reason.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.11.0';
console.log(`[jobs-pipe] v${VERSION} - return location for Role-cell nesting on list views`);

const STATUS_ENUM = new Set(['Saved', 'Active', 'Archive']);
const STAGE_ENUM  = new Set(['drafting', 'applied', 'interviewing', 'offer']);
const EXIT_REASON_ENUM = new Set([
  'changed_mind',                // Read the JD again and decided not to pursue
  'wrong_comp',                  // Comp not in the range I'm looking for
  'wrong_sector_or_stage',
  'wrong_location',
  'applied_no_response',
  'rejected_after_screen',
  'rejected_after_interview',
  'role_closed',
  'withdrew',                    // I stepped away mid-process
  'other',
]);

async function listRoles() {
  const sql = db();
  const rows = await sql`
    select
      r.slug, r.source_row as "rowNumber",
      r.company_name as company, r.title, r.url, r.location, r.source, r.status,
      r.stage, r.exit_reason as "exitReason", r.exit_context as "exitContext",
      r.contact, r.salary_range as salary, r.salary_low, r.salary_high,
      r.sector, r.investors, r.fit_score as score, r.fit_breakdown as breakdown,
      r.fit_rationales as rationales, r.fit_summary as "fitSummary",
      r.candidate_score as "candidateScore", r.candidate_breakdown as "candidateBreakdown",
      r.candidate_rationales as "candidateRationales", r.candidate_summary as "candidateSummary",
      r.comp_acceptable as "compAcceptable",
      r.hard_fails as "hardFails", r.applied_at, r.status_changed_at,
      r.first_seen, r.last_seen,
      r.archived_at as "archivedAt",
      r.closed_detected_at as "closedDetectedAt",
      r.is_live as "isLive",
      r.liveness_checked_at as "livenessCheckedAt",
      r.engaged_at as "engagedAt",
      r.source_email_url as "sourceEmailUrl",
      r.updated_at as "updatedAt",
      coalesce(ra_resume.role_slug is not null, false) as "hasResume",
      coalesce(ra_cover.role_slug is not null, false) as "hasCoverLetter",
      coalesce((
        select array_agg(json_build_object('slug', t.slug, 'name', t.name) order by t.name)
        from job.role_sector_tags rt
        join job.sector_tags t on t.slug = rt.tag_slug
        where rt.role_slug = r.slug
      ), array[]::json[]) as "sectorTags"
    from job.pipeline_roles r
    left join job.role_assets ra_resume on ra_resume.role_slug = r.slug and ra_resume.kind = 'resume'
    left join job.role_assets ra_cover  on ra_cover.role_slug = r.slug and ra_cover.kind = 'cover-letter'
    where r.deleted_at is null
    order by r.fit_score desc nulls last, r.title asc;
  `;
  return rows;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);

    if (req.method === 'GET') {
      const roles = await listRoles();
      return jsonResp({ version: VERSION, count: roles.length, roles });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const slug = body.slug ? String(body.slug) : '';
      const sql = db();
      if (!slug) return err('role not found (provide slug)', 404);

      // Archive / unarchive — flag flip only; doesn't touch status.
      // status='Archive' is the canonical archive signal now; this
      // remains for backwards compat with anything still writing
      // archived_at directly.
      if ('archived' in body) {
        const archived = !!body.archived;
        await sql`
          update job.pipeline_roles
          set archived_at = ${archived ? sql`now()` : null}
          where slug = ${slug};
        `;
        return jsonResp({ ok: true, slug, archived });
      }

      // Engagement signal — drill page open or Apply tap. Stamps
      // engaged_at; does not promote status. (Auto-promotion ties to
      // stage transitions, not passive engagement — until an auto-apply
      // agent exists, engaged_at is "user looked at this" not
      // "user committed to applying.")
      if (body.action === 'engage') {
        await sql`
          update job.pipeline_roles
             set engaged_at = coalesce(engaged_at, now())
           where slug = ${slug};
        -- engage is a passive UI signal; deliberately do NOT touch
        -- updated_at so the drill page's stale-detection (which uses
        -- updated_at as a freshness proxy) doesn't ping-pong a
        -- regenerate on every page open.
        `;
        return jsonResp({ ok: true, slug, engaged: true });
      }

      // Soft delete.
      if (body.action === 'delete') {
        await sql`
          update job.pipeline_roles
          set deleted_at = now()
          where slug = ${slug};
        `;
        return jsonResp({ ok: true, slug, deleted: true });
      }

      // Status / stage / exit_reason writeback.
      const hasStatus = body.status !== undefined;
      const hasStage  = body.stage !== undefined;
      const hasExit   = body.exit_reason !== undefined;

      if (!hasStatus && !hasStage && !hasExit) {
        return err('status, stage, or exit_reason required', 400);
      }

      // Validate inputs.
      let status: string | null = hasStatus ? (body.status === null ? null : String(body.status)) : null;
      const stage: string | null = hasStage ? (body.stage === null ? null : String(body.stage)) : null;
      const exitReason: string | null = hasExit ? (body.exit_reason === null ? null : String(body.exit_reason)) : null;
      const exitContext: string | null = body.exit_context !== undefined
        ? (body.exit_context === null ? null : String(body.exit_context).slice(0, 500))
        : null;

      if (status !== null && !STATUS_ENUM.has(status)) {
        return err(`status must be one of: ${Array.from(STATUS_ENUM).join(', ')}`, 400);
      }
      if (stage !== null && !STAGE_ENUM.has(stage)) {
        return err(`stage must be one of: ${Array.from(STAGE_ENUM).join(', ')}`, 400);
      }
      if (exitReason !== null && !EXIT_REASON_ENUM.has(exitReason)) {
        return err(`exit_reason must be one of: ${Array.from(EXIT_REASON_ENUM).join(', ')}`, 400);
      }

      // Read current row so we can apply the auto-promote / exit-reason rules.
      const cur = await sql<{ status: string | null }[]>`
        select status from job.pipeline_roles where slug = ${slug} limit 1`;
      if (!cur[0]) return err('role not found', 404);
      const currentStatus = cur[0].status || 'Saved';

      // Auto-promotion rule: any non-null stage implies Active. Caller
      // may pass stage='applied' alone (no status) on a Saved row;
      // server flips status to Active.
      let finalStatus = status ?? currentStatus;
      if (hasStage && stage !== null) finalStatus = 'Active';

      // Archive must carry an exit_reason. If transition is going TO
      // Archive without one, reject. If row already IS Archive, allow
      // updates that don't touch exit_reason.
      if (finalStatus === 'Archive' && currentStatus !== 'Archive' && !exitReason) {
        return err('exit_reason required when archiving', 400);
      }

      // Stage only valid on Active rows. Saved/Archive carry stage=null.
      const finalStage = finalStatus === 'Active' ? (stage ?? null) : null;

      // exit_reason cleared when not Archive.
      const finalExitReason = finalStatus === 'Archive'
        ? (exitReason ?? (currentStatus === 'Archive' ? undefined : null))   // keep existing on update-only writes
        : null;
      const finalExitContext = finalStatus === 'Archive' ? exitContext : null;

      const statusChanged = finalStatus !== currentStatus;

      await sql`
        update job.pipeline_roles
           set status = ${finalStatus},
               stage = ${finalStage},
               exit_reason = ${finalExitReason ?? null},
               exit_context = ${finalExitContext ?? null},
               applied_at = case when ${finalStage} in ('applied','interviewing','offer')
                                  and applied_at is null then now()
                             else applied_at end,
               archived_at = case when ${finalStatus} = 'Archive' and archived_at is null then now()
                                  when ${finalStatus} <> 'Archive' then null
                                  else archived_at end,
               status_changed_at = case when ${statusChanged} then now() else status_changed_at end,
               status_history = case when ${statusChanged}
                                     then coalesce(status_history, '[]'::jsonb)
                                          || ${sql.json([{ status: finalStatus, stage: finalStage, exit_reason: finalExitReason, at: new Date().toISOString() }])}
                                     else status_history end,
               updated_at = now()
         where slug = ${slug};
      `;
      return jsonResp({ ok: true, slug, status: finalStatus, stage: finalStage, exit_reason: finalExitReason });
    }

    return err('GET or POST only', 405);
  } catch (e) {
    console.error('[jobs-pipe] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
