#!/usr/bin/env python3
"""Push a job-radar sweep into Ladder (job.ats_radar_scans → For You).

Reads job-scans/raw-<date>/ (newest by default), bundles every per-company
JSON plus summary.json run_at into one batch, and POSTs it to the
ats-radar-ingest edge function. The endpoint stages the scan, stamps the
source health note (unverified boards are surfaced, never counted as "no
openings"), and force-runs the recommendations worker so verified-open
roles flow through the normal gate → dedupe → grade pipeline.

Auth resolution order:
  1. $LADDER_CRON_SECRET      → sent as X-Cron-Secret
  2. $SUPABASE_SERVICE_ROLE_KEY → sent as Bearer
  3. `supabase projects api-keys --project-ref yfhudwakpgzswiylhfbh -o json`
     (uses the CLI's own login; picks the service_role key)

Usage:
  python3 push_to_ladder.py                 # newest job-scans/raw-*/
  python3 push_to_ladder.py --dir job-scans/raw-2026-08-06
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

PROJECT_REF = "yfhudwakpgzswiylhfbh"
INGEST_URL = f"https://{PROJECT_REF}.supabase.co/functions/v1/ats-radar-ingest"


def find_scan_dir(arg: str | None) -> Path:
    if arg:
        p = Path(arg)
        if not p.is_dir():
            sys.exit(f"scan dir not found: {p}")
        return p
    root = Path("job-scans")
    dirs = sorted(root.glob("raw-*"), reverse=True)
    if not dirs:
        sys.exit("no job-scans/raw-*/ directories found — run fetch_boards.py first")
    return dirs[0]


def resolve_auth() -> list[dict]:
    """Candidate auth headers, tried in order until one isn't rejected.

    The project may hold either legacy-JWT keys or new sb_secret keys in the
    function's SUPABASE_SERVICE_ROLE_KEY env, so both formats are tried.
    """
    if os.environ.get("LADDER_CRON_SECRET"):
        return [{"X-Cron-Secret": os.environ["LADDER_CRON_SECRET"]}]
    if os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        return [{"X-Ingest-Key": os.environ["SUPABASE_SERVICE_ROLE_KEY"]}]
    candidates = []
    try:
        out = subprocess.run(
            ["supabase", "projects", "api-keys", "--project-ref", PROJECT_REF, "-o", "json"],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout
        rows = json.loads(out)
        # X-Ingest-Key sidesteps the gateway's Authorization handling; the
        # function compares it to its SUPABASE_SERVICE_ROLE_KEY env, which
        # may be either the legacy JWT or the new sb_secret — try both.
        for row in rows:
            if row.get("name") == "service_role":
                candidates.append({"X-Ingest-Key": row["api_key"]})
        for row in rows:
            if str(row.get("api_key", "")).startswith("sb_secret_"):
                candidates.append({"X-Ingest-Key": row["api_key"]})
    except Exception as e:  # noqa: BLE001 — any failure falls through to the message below
        print(f"  (supabase CLI key lookup failed: {e})", file=sys.stderr)
    if not candidates:
        sys.exit("no auth available — set LADDER_CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY, or `supabase login`")
    return candidates


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", help="scan directory (default: newest job-scans/raw-*)")
    args = ap.parse_args()

    scan_dir = find_scan_dir(args.dir)
    summary_path = scan_dir / "summary.json"
    if not summary_path.exists():
        sys.exit(f"missing {summary_path} — incomplete sweep?")
    summary = json.loads(summary_path.read_text())

    companies = []
    for f in sorted(scan_dir.glob("*.json")):
        if f.name == "summary.json":
            continue
        data = json.loads(f.read_text())
        data["slug"] = f.stem
        data.pop("raw_text", None)  # html-text bodies stay local; server only needs the health row
        companies.append(data)

    payload = {"runAt": summary["run_at"], "companies": companies}
    print(f"Pushing {scan_dir} — {len(companies)} boards, run_at {summary['run_at']}")

    body = json.dumps(payload).encode()
    result = None
    last_err = "no auth candidates"
    for auth in resolve_auth():
        headers = {"Content-Type": "application/json", **auth}
        req = urllib.request.Request(INGEST_URL, body, headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                result = json.loads(resp.read())
            break
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code} — {e.read().decode()[:300]}"
            if e.code not in (401, 403):
                break  # a non-auth failure won't be fixed by another key
    if result is None:
        sys.exit(f"ingest failed: {last_err}")

    print(json.dumps(result, indent=2))
    if result.get("kicked"):
        print("Worker kicked — grading runs in the background; new recs land in the Inbox "
              "and the Sources row shows lastRunAt/lastError in a minute or two.")


if __name__ == "__main__":
    main()
