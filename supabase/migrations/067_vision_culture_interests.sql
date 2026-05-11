-- 066_vision_culture_interests.sql
-- Fit v3: capture culture preferences, interest tags, role-match output,
-- and tunable per-user weights. Lets values/impact dominate; folds
-- title+skills into a single role-match bucket.

alter table job.vision
  add column if not exists culture_keywords text[] default '{}',
  add column if not exists interest_tags    text[] default '{}',
  add column if not exists score_weights    jsonb default '{}'::jsonb;

alter table job.recommended_roles
  add column if not exists role_match_score     integer,
  add column if not exists role_match_rationale text;

alter table job.pipeline_roles
  add column if not exists role_match_score     integer,
  add column if not exists role_match_rationale text;

-- Seed Ian's culture + interest pools.
update job.vision
   set culture_keywords = array[
         -- AI-native / first
         'ai-native','ai native','ai-first','ai first','foundation model','llm','agentic','model evaluation','retrieval','rag',
         -- Strong eng/design bar
         'engineering-led','engineering led','principal engineer','staff engineer','technical depth','raise the bar','eng-driven','engineering culture','rigorous',
         -- Autonomy / IC / player-coach
         'autonomy','autonomous','player-coach','player coach','ic role','individual contributor','ownership','end-to-end','end to end','small team',
         -- Mission-led / civic / social good
         'mission-driven','mission driven','civic','public good','public benefit','b-corp','b corp','nonprofit','non-profit','social impact','community'
       ],
       interest_tags = array[
         -- Clinician experience
         'clinician','clinician experience','provider workflow','physician','clinical workflow','ehr','emr','clinical operations',
         -- Platform / infra
         'platform','infrastructure','internal tooling','internal platform','developer tools','dev tools','api product','sdk','platform team',
         -- Behavioral loops
         'engagement','retention','habit','behavior change','behavior-change','adherence','daily active','activation','loop','onboarding loop',
         -- Billing / insurance / cost reduction
         'billing','claims','insurance','payer','eligibility','prior authorization','cost reduction','reduce cost','affordable','underserved',
         -- Public Benefit Corp
         'public benefit corporation','public benefit','pbc','b-corporation','b corporation','social enterprise','mission-led'
       ],
       score_weights = jsonb_build_object(
         'values',  25,
         'culture', 15,
         'role',    25,
         'domain',  15,
         'arc',     10,
         'stage',    4,
         'comp',     4,
         'geo',      2
       ),
       updated_at = now()
 where id = (select id from job.vision order by updated_at desc limit 1);
