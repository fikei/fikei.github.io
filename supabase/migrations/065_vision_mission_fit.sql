-- 065_vision_mission_fit.sql
-- Fit-score v2: capture mission/impact preferences in job.vision so the
-- scorer can weight cultural alignment alongside title/skills/arc.

alter table job.vision
  add column if not exists impact_themes      text[] default '{}',
  add column if not exists mission_keywords   text[] default '{}',
  add column if not exists mission_required   boolean not null default false,
  add column if not exists anti_mission_terms text[] default '{}';

-- Seed Ian's selected themes + the keyword expansion the scorer matches
-- posting text against. Anti-mission mirrors the deal-breakers list.
update job.vision
   set impact_themes = array['ai_ethics','healthcare_outcomes','cost_reduction','education_access'],
       mission_keywords = array[
         -- healthcare_outcomes
         'patient','clinical','clinician','provider','care','outcomes','health equity',
         'chronic','therapeutic','telehealth','payer','medicare','medicaid','mental health',
         -- cost_reduction
         'affordable','affordability','lower cost','cost reduction','reduce cost','savings',
         'access','underserved','equity',
         -- education_access
         'student','learner','teacher','classroom','school','curriculum','literacy','tutoring','workforce','reskill',
         -- ai_ethics
         'responsible ai','ai safety','alignment','model evaluation','trust and safety','interpretability','fairness','bias'
       ],
       anti_mission_terms = array['gambling','casino','crypto','web3','token','payday','tobacco','vape','defense contractor','surveillance'],
       mission_required = false,
       updated_at = now()
 where id = (select id from job.vision order by updated_at desc limit 1);
