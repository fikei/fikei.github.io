// work-history — CRUD for structured projects + clients attached to roles
// in the work history. Roles still live in the markdown body of
// job.companies; projects pivot off the (company_slug, role_title) pair.
//
//   GET                                         → { projects: [...with clients[]] }
//   GET ?company=X                              → projects for one company
//   GET ?company=X&role=Y                       → projects for one role
//   POST { type: 'project', id?, company_slug, role_title, name,
//          description?, outcome?, metric?, started_at?, ended_at?, position? }
//   POST { type: 'client', id?, project_id, name, kind?, description? }
//   POST { type: 'project'|'client', id, delete: true }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.1.0';
console.log(`[work-history] v${VERSION} - role projects + clients CRUD`);

const ID_RE = /^[a-z0-9_-]+$/;
const KIND_RE = /^(customer|stakeholder|partner|internal)$/;
const MAX_TEXT = 8 * 1024;
const MAX_NAME = 256;

function newId(): string { return Math.random().toString(36).slice(2, 12); }

async function loadProjects(sql: any, where: { company?: string | null; role?: string | null }) {
  const company = where.company || null;
  const role = where.role || null;
  const rows = await sql`
    select id, company_slug, role_title, name, description, outcome, metric,
           started_at, ended_at, position, created_at, updated_at
    from job.role_projects
    where (${company}::text is null or company_slug = ${company})
      and (${role}::text    is null or role_title   = ${role})
    order by company_slug, role_title, position, created_at;
  `;
  if (rows.length === 0) return [];
  const ids = rows.map((r: any) => r.id);
  const clients = await sql`
    select id, project_id, name, kind, description, created_at
    from job.project_clients
    where project_id = any(${ids})
    order by created_at;
  `;
  const byProject = new Map<string, any[]>();
  for (const c of clients) {
    if (!byProject.has(c.project_id)) byProject.set(c.project_id, []);
    byProject.get(c.project_id)!.push(c);
  }
  return rows.map((r: any) => ({ ...r, clients: byProject.get(r.id) || [] }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);
    const sql = db();

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const company = url.searchParams.get('company');
      const role = url.searchParams.get('role');
      const projects = await loadProjects(sql, { company, role });
      return jsonResp({ projects });
    }

    if (req.method !== 'POST') return err('GET or POST only', 405);

    const body = await req.json().catch(() => ({}));
    const type = String(body.type || '');

    if (type === 'project') {
      if (body.delete === true) {
        const id = String(body.id || '');
        if (!ID_RE.test(id)) return err('invalid id', 400);
        await sql`delete from job.role_projects where id = ${id}`;
        return jsonResp({ ok: true, deleted: id });
      }
      const id = String(body.id || '') || newId();
      if (!ID_RE.test(id)) return err('invalid id', 400);
      const company_slug = String(body.company_slug || '').trim();
      const role_title = String(body.role_title || '').trim();
      const name = String(body.name || '').trim().slice(0, MAX_NAME);
      if (!company_slug || !role_title || !name) return err('company_slug, role_title, name required', 400);
      // Confirm the company exists; we don't auto-create.
      const co = await sql`select 1 from job.companies where slug = ${company_slug} limit 1`;
      if (co.length === 0) return err('company not found', 404);

      const description = String(body.description || '').slice(0, MAX_TEXT);
      const outcome     = String(body.outcome || '').slice(0, MAX_TEXT);
      const metric      = String(body.metric || '').slice(0, 512);
      const started_at  = body.started_at ? String(body.started_at) : null;
      const ended_at    = body.ended_at ? String(body.ended_at) : null;
      const position    = Number.isInteger(body.position) ? body.position : 0;

      const rows = await sql`
        insert into job.role_projects
          (id, company_slug, role_title, name, description, outcome, metric, started_at, ended_at, position)
        values
          (${id}, ${company_slug}, ${role_title}, ${name}, ${description}, ${outcome}, ${metric}, ${started_at}, ${ended_at}, ${position})
        on conflict (id) do update set
          name = excluded.name,
          description = excluded.description,
          outcome = excluded.outcome,
          metric = excluded.metric,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          position = excluded.position,
          role_title = excluded.role_title,
          company_slug = excluded.company_slug,
          updated_at = now()
        returning *;
      `;
      return jsonResp({ project: { ...rows[0], clients: [] } });
    }

    if (type === 'client') {
      if (body.delete === true) {
        const id = String(body.id || '');
        if (!ID_RE.test(id)) return err('invalid id', 400);
        await sql`delete from job.project_clients where id = ${id}`;
        return jsonResp({ ok: true, deleted: id });
      }
      const id = String(body.id || '') || newId();
      if (!ID_RE.test(id)) return err('invalid id', 400);
      const project_id = String(body.project_id || '');
      if (!ID_RE.test(project_id)) return err('invalid project_id', 400);
      const name = String(body.name || '').trim().slice(0, MAX_NAME);
      if (!name) return err('name required', 400);
      const kindIn = String(body.kind || 'customer');
      if (!KIND_RE.test(kindIn)) return err('invalid kind', 400);
      const description = String(body.description || '').slice(0, MAX_TEXT);

      // Confirm the project exists.
      const p = await sql`select 1 from job.role_projects where id = ${project_id} limit 1`;
      if (p.length === 0) return err('project not found', 404);

      const rows = await sql`
        insert into job.project_clients (id, project_id, name, kind, description)
        values (${id}, ${project_id}, ${name}, ${kindIn}, ${description})
        on conflict (id) do update set
          name = excluded.name,
          kind = excluded.kind,
          description = excluded.description
        returning *;
      `;
      return jsonResp({ client: rows[0] });
    }

    return err('type must be "project" or "client"', 400);
  } catch (e) {
    console.error('[work-history] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
