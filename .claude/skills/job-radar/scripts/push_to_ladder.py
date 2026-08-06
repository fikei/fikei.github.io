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


def resolve_auth() -> dict:
    if os.environ.get("LADDER_CRON_SECRET"):
        return {"X-Cron-Secret": os.environ["LADDER_CRON_SECRET"]}
    if os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        return {"Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_ROLE_KEY']}"}
    try:
        out = subprocess.run(
            ["supabase", "projects", "api-keys", "--project-ref", PROJECT_REF, "-o", "json"],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout
        for row in json.loads(out):
            if row.get("name") == "service_role":
                return {"Authorization": f"Bearer {row['api_key']}"}
    except Exception as e:  # noqa: BLE001 — any failure falls through to the message below
        print(f"  (supabase CLI key lookup failed: {e})", file=sys.stderr)
    sys.exit("no auth available — set LADDER_CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY, or `supabase login`")


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

    headers = {"Content-Type": "application/json", **resolve_auth()}
    req = urllib.request.Request(INGEST_URL, json.dumps(payload).encode(), headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"ingest failed: HTTP {e.code} — {e.read().decode()[:500]}")

    print(json.dumps({k: v for k, v in result.items() if k != "run"}, indent=2))
    run = result.get("run") or {}
    src = None
    for s in ((run.get("body") or {}).get("sources") or []):
        if s.get("type") == "ats-radar":
            src = s
    if src:
        print(f"Worker: pulled {src.get('pulled')} in-universe roles, inserted {src.get('inserted')} new recs"
              + (f", error: {src['error']}" if src.get("error") else ""))
    else:
        print(f"Worker kick status: {run.get('status')}")


if __name__ == "__main__":
    main()
