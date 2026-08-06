#!/usr/bin/env python3
"""job-radar board fetcher.

Pulls live job postings from first-party ATS APIs (Greenhouse, Lever, Workable,
SmartRecruiters, Rippling, Workday, Ashby) for the companies in companies.json,
normalizes them, and writes one JSON file per company plus a summary.

Every record is stamped with fetched_at (UTC) so downstream reporting can prove
each role was seen live. Companies whose board can't be reached are recorded as
failures — they must be reported as UNVERIFIED, never backfilled from search
engines or aggregators (stale aggregator listings are the whole reason this
script exists).

Stdlib only — no pip installs needed.

Usage:
  python3 fetch_boards.py                       # all companies
  python3 fetch_boards.py --segments bay-area outdoor-tech
  python3 fetch_boards.py --companies "Peak Design" Strava
  python3 fetch_boards.py --out job-scans/raw-2026-08-06
"""
import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TIMEOUT = 25
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def http_get(url, data=None, extra_headers=None):
    headers = dict(HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    req = Request(url, data=data, headers=headers)
    with urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read().decode("utf-8", "replace")


def http_json(url, **kw):
    return json.loads(http_get(url, **kw))


# ---------------------------------------------------------------- fetchers

def fetch_greenhouse(c):
    data = http_json(f"https://boards-api.greenhouse.io/v1/boards/{c['slug']}/jobs")
    return [
        {
            "title": j.get("title", ""),
            "location": (j.get("location") or {}).get("name", ""),
            "url": j.get("absolute_url", ""),
            "posted": j.get("updated_at", ""),
        }
        for j in data.get("jobs", [])
    ]


def fetch_lever(c):
    data = http_json(f"https://api.lever.co/v0/postings/{c['slug']}?mode=json")
    jobs = []
    for j in data:
        posted = ""
        if j.get("createdAt"):
            posted = datetime.fromtimestamp(
                j["createdAt"] / 1000, tz=timezone.utc
            ).date().isoformat()
        cats = j.get("categories") or {}
        loc = cats.get("location", "")
        if cats.get("commitment"):
            loc = f"{loc} ({cats['commitment']})" if loc else cats["commitment"]
        jobs.append(
            {"title": j.get("text", ""), "location": loc,
             "url": j.get("hostedUrl", ""), "posted": posted}
        )
    return jobs


def fetch_workable(c):
    data = http_json(
        f"https://apply.workable.com/api/v1/widget/accounts/{c['slug']}?details=false"
    )
    jobs = []
    for j in data.get("jobs", []):
        loc = ", ".join(
            p for p in [j.get("city"), j.get("state"), j.get("country")] if p
        )
        if j.get("telecommuting"):
            loc = f"{loc} (remote)" if loc else "Remote"
        jobs.append(
            {"title": j.get("title", ""), "location": loc,
             "url": j.get("url") or j.get("shortlink", ""),
             "posted": j.get("published_on", "")}
        )
    return jobs


def fetch_ashby(c):
    data = http_json(
        f"https://api.ashbyhq.com/posting-api/job-board/{c['slug']}"
        "?includeCompensation=true"
    )
    return [
        {
            "title": j.get("title", ""),
            "location": j.get("location", ""),
            "url": j.get("jobUrl") or j.get("applyUrl", ""),
            "posted": j.get("publishedAt", ""),
        }
        for j in data.get("jobs", [])
    ]


def fetch_smartrecruiters(c):
    data = http_json(
        f"https://api.smartrecruiters.com/v1/companies/{c['slug']}/postings"
    )
    return [
        {
            "title": j.get("name", ""),
            "location": ", ".join(
                p for p in [
                    (j.get("location") or {}).get("city"),
                    (j.get("location") or {}).get("country"),
                ] if p
            ),
            "url": f"https://jobs.smartrecruiters.com/{c['slug']}/{j.get('id', '')}",
            "posted": j.get("releasedDate", ""),
        }
        for j in data.get("content", [])
    ]


def fetch_rippling(c):
    data = http_json(
        f"https://api.rippling.com/platform/api/ats/v1/board/{c['slug']}/jobs"
    )
    raw = data if isinstance(data, list) else (
        data.get("jobs") or data.get("results") or data.get("items") or []
    )
    jobs = []
    for j in raw:
        loc = j.get("workLocation") or j.get("locations") or ""
        if isinstance(loc, dict):
            loc = loc.get("label") or loc.get("name") or ""
        elif isinstance(loc, list):
            loc = ", ".join(
                (x.get("label") or x.get("name") or str(x)) if isinstance(x, dict)
                else str(x) for x in loc
            )
        jobs.append(
            {"title": j.get("name") or j.get("title", ""),
             "location": str(loc), "url": j.get("url", ""), "posted": ""}
        )
    return jobs


def fetch_workday(c):
    host, tenant, site = c["host"], c["tenant"], c["site"]
    api = f"https://{host}/wday/cxs/{tenant}/{site}/jobs"
    jobs, offset, total = [], 0, None
    while True:
        body = json.dumps(
            {"appliedFacets": {}, "limit": 20, "offset": offset,
             "searchText": c.get("search", "")}
        ).encode()
        data = json.loads(http_get(api, data=body, extra_headers={
            "Content-Type": "application/json",
        }))
        batch = data.get("jobPostings", [])
        total = data.get("total", 0) if total is None else total
        for j in batch:
            jobs.append(
                {"title": j.get("title", ""),
                 "location": j.get("locationsText", ""),
                 "url": f"https://{host}/en-US/{site}{j.get('externalPath', '')}",
                 "posted": j.get("postedOn", "")}
            )
        offset += 20
        # Cap at 200 postings per board — enough for any brand board; the big
        # corporate boards should be narrowed with the "search" field instead.
        if not batch or offset >= min(total, 200):
            break
    return jobs


def fetch_html(c):
    """No structured API — dump the careers page text for Claude to parse."""
    text = http_get(c["careers_url"])
    text = re.sub(r"<script\b.*?</script>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<style\b.*?</style>", " ", text, flags=re.S | re.I)
    # Keep hrefs so posting links survive tag-stripping.
    text = re.sub(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>", r" [link: \1] ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return {"raw_text": text[:20000]}


FETCHERS = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "workable": fetch_workable,
    "ashby": fetch_ashby,
    "smartrecruiters": fetch_smartrecruiters,
    "rippling": fetch_rippling,
    "workday": fetch_workday,
    "html": fetch_html,
}


# ---------------------------------------------------------------- runner

def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def fetch_company(company):
    record = {
        "company": company["name"],
        "type": company["type"],
        "segments": company.get("segments", []),
        "location": company.get("location", ""),
        "careers_url": company.get("careers_url", ""),
        "notes": company.get("notes", ""),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "ok": False,
        "jobs": [],
    }
    ctype = company["type"]
    if ctype == "none":
        record["ok"] = True
        record["kind"] = "no-board"
        return record
    try:
        result = FETCHERS[ctype](company)
        record["ok"] = True
        if isinstance(result, dict) and "raw_text" in result:
            record["kind"] = "html-text"
            record["raw_text"] = result["raw_text"]
        else:
            record["kind"] = "structured"
            record["jobs"] = result
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError) as e:
        record["error"] = f"{type(e).__name__}: {e}"
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--segments", nargs="*", default=None,
                        help="Only companies tagged with any of these segments")
    parser.add_argument("--companies", nargs="*", default=None,
                        help="Only these company names (case-insensitive substring)")
    parser.add_argument("--registry", default=None,
                        help="Path to companies.json (default: alongside this script)")
    parser.add_argument("--out", default=None,
                        help="Output dir (default: job-scans/raw-<UTC date>)")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    registry_path = Path(args.registry) if args.registry else (
        Path(__file__).resolve().parent.parent / "companies.json"
    )
    registry = json.loads(registry_path.read_text())["companies"]

    selected = registry
    if args.segments:
        wanted = set(args.segments)
        selected = [c for c in selected if wanted & set(c.get("segments", []))]
    if args.companies:
        terms = [t.lower() for t in args.companies]
        selected = [c for c in selected
                    if any(t in c["name"].lower() for t in terms)]
    if not selected:
        print("No companies matched the filters.", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.out) if args.out else Path(
        f"job-scans/raw-{datetime.now(timezone.utc).date().isoformat()}"
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    records = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_company, c): c for c in selected}
        for fut in as_completed(futures):
            rec = fut.result()
            records.append(rec)
            (out_dir / f"{slugify(rec['company'])}.json").write_text(
                json.dumps(rec, indent=2)
            )

    records.sort(key=lambda r: r["company"].lower())
    summary = {
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "companies_attempted": len(records),
        "ok": sum(1 for r in records if r["ok"]),
        "failed": sum(1 for r in records if not r["ok"]),
        "results": [
            {
                "company": r["company"],
                "ok": r["ok"],
                "kind": r.get("kind", "error"),
                "job_count": len(r["jobs"]) if r.get("kind") == "structured" else None,
                "error": r.get("error"),
                "file": f"{slugify(r['company'])}.json",
            }
            for r in records
        ],
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))

    # Human-readable table on stdout.
    print(f"\njob-radar fetch — {summary['run_at']}  "
          f"(ok: {summary['ok']}, failed: {summary['failed']})\n")
    for r in summary["results"]:
        if r["kind"] == "structured":
            status = f"OK   {r['job_count']:>3} jobs"
        elif r["kind"] == "html-text":
            status = "OK   html (parse raw_text)"
        elif r["kind"] == "no-board":
            status = "--   no board (outreach only)"
        else:
            status = f"FAIL {r['error']}"
        print(f"  {r['company']:<28} {status}")
    print(f"\nOutput: {out_dir}/")


if __name__ == "__main__":
    main()
