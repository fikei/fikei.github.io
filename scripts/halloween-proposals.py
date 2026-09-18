#!/usr/bin/env python3
"""Regenerate halloween/data/proposals.json from a CSV export of the
"Call for Collaborators (Responses)" Google Sheet.

Usage:
  python3 scripts/halloween-proposals.py path/to/responses.csv

Export the CSV from the sheet with File > Download > CSV (the "Form
Responses 1" tab). Phone numbers and emails are dropped on purpose: the
JSON ships on a public GitHub Pages site.
"""
import csv
import hashlib
import json
import re
import sys
from datetime import datetime, timezone

OUT = "halloween/data/proposals.json"

# Form column headers -> short field names. Matching is by prefix so small
# edits to the form's wording keep working.
FIELDS = [
    ("Timestamp", "ts"),
    ("Full name", "artist"),
    ("Phone number", None),
    ("Email", None),
    ("What would you like to do", "wants"),
    ("What's the name of your project", "project"),
    ("Describe your project", "description"),
    ("Share a step-by-step breakdown", "journey"),
    ("Where does your experience live", "where"),
    ("Upload any files", "files"),
    ("When might your experience be", "when"),
    ("Share any past work", "past_work"),
    ("If any, which Agape Halloweens", "attended"),
    ("Anything you'd like to add", "extra"),
]

WANT_TAGS = [
    ("Design a space", "space"),
    ("Create an experience", "experience"),
    ("Perform", "perform"),
    ("Event photography", "photo"),
    ("Roaming", "roaming"),
    ("Breakfast Chef", "food"),
]

WHEN_TAGS = [
    ("Setup before", "setup"),
    ("Early", "early"),
    ("Midnight", "midnight"),
    ("Late night", "late"),
    ("Morning", "morning"),
    ("All night", "all-night"),
]


def clean(s):
    s = (s or "").replace("\r\n", "\n").strip()
    return s


def split_multi(value):
    """Google Forms joins checkbox answers with ', '. Free-text 'Other'
    answers can themselves contain commas, so we peel known options off
    and keep whatever is left as a note."""
    parts, depth, cur = [], 0, ""
    for ch in value:
        depth += ch == "("
        depth -= ch == ")"
        cur += ch
        if depth <= 0 and cur.endswith(", "):
            parts.append(cur[:-2])
            cur = ""
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def tags_for(value, table):
    tags, rest = [], []
    for part in split_multi(value):
        hit = next((t for prefix, t in table if part.startswith(prefix)), None)
        if hit and hit not in tags:
            tags.append(hit)
        elif not hit:
            rest.append(part)
    return tags, ", ".join(rest)


def links(value):
    return re.findall(r"https?://\S+", value or "")


def pid(ts, artist):
    return "p-" + hashlib.sha1(f"{ts}|{artist}".encode()).hexdigest()[:8]


def normalize(header, rows):
    idx = {}
    for i, h in enumerate(header):
        for prefix, key in FIELDS:
            if h.strip().startswith(prefix):
                idx[key or prefix] = i
    out = []
    for r in rows:
        get = lambda k: clean(r[idx[k]]) if k in idx and idx[k] < len(r) else ""
        if not get("artist") and not get("project"):
            continue
        wants, wants_note = tags_for(get("wants"), WANT_TAGS)
        when, when_note = tags_for(get("when"), WHEN_TAGS)
        out.append({
            "id": pid(get("ts"), get("artist")),
            "ts": get("ts"),
            "artist": get("artist"),
            "project": get("project") or "(untitled)",
            "wants": wants,
            "wants_note": wants_note,
            "description": get("description"),
            "journey": get("journey"),
            "where": get("where"),
            "files": links(get("files")),
            "when": when,
            "when_note": when_note,
            "past_work": get("past_work"),
            "attended": get("attended"),
            "extra": get("extra"),
        })
    return out


def main(path):
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)
    proposals = normalize(header, rows)
    doc = {
        "source": "Agape Halloween XV Reassemblage: Call for Collaborators (Responses)",
        "sheet_id": "1CT_3fD50yJ0i6US7rvjjpo8oJj9VUGKfBhat8zXjOqo",
        "gid": "909181316",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "proposals": proposals,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {len(proposals)} proposals to {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
