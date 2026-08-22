# DJ residency payments — Stripe Payment Link + weekly reconciliation

The residency application fee runs on a Stripe Payment Link (no backend). The
form marks payment provisionally on return; this weekly pass is the
authoritative record.

## Setup (once per listing)

1. Stripe dashboard → Payment Links → new link, $20, name "DJ residency application fee".
2. After-payment behavior → redirect to `https://ctrl.rodeo/apply/?payment=success`.
3. Paste the link URL into the listing's `payment_link` field (listing editor in /applications, Openings view).

The form appends `prefilled_email` and `client_reference_id` (= the applicant
row id) when redirecting out, so both land on the Stripe payment record.

## Weekly reconciliation

1. Stripe dashboard → Payments → export CSV for the week (needs: email, amount, created, client_reference_id, payment id).
2. For each successful $20 payment, match by `client_reference_id` (preferred) or customer email against `recruit_applicants`.
3. Mark matched rows authoritative:

```sql
UPDATE recruit_applicants
   SET payment_status = 'paid',
       paid_at = COALESCE(paid_at, NOW()),
       payment_ref = '<stripe payment id>'
 WHERE id = '<applicant id>';
```

4. Rows with `payment_status = 'paid'` but **no matching Stripe payment** after two weekly passes → set `payment_status = 'failed'` and the triage app shows them unpaid/not-reviewable again. Expect a small tail; chargebacks also land here.
5. Refund requests: refund in Stripe, then set `payment_status = 'failed'` on the row.

Phase 2 replaces steps 2–4 with a Stripe webhook → edge function.
