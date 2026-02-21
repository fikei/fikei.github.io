#!/usr/bin/env python3
"""
reel-to-pins.py — Extract an Instagram Reel into structured board pins.

Pipeline:
  1. yt-dlp extracts video, caption, metadata from Instagram URL
  2. Deepgram Nova-2 transcribes spoken audio (optional, needs API key)
  3. Claude Haiku extracts entities (places, products, music, brands)
  4. Web search resolves each entity to a stable primary-source URL
  5. Outputs structured pin JSON matching the boards schema

Usage:
  pip install yt-dlp anthropic httpx
  export ANTHROPIC_API_KEY=sk-ant-...
  export DEEPGRAM_API_KEY=...          # optional, for audio transcription
  export SUPABASE_URL=...              # optional, for direct pin creation
  export SUPABASE_ANON_KEY=...         # optional, for direct pin creation

  python tools/reel-to-pins.py https://www.instagram.com/reel/DUuIXvviek-/
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path


# ---------------------------------------------------------------------------
# 1. CONTENT EXTRACTION (yt-dlp)
# ---------------------------------------------------------------------------

def extract_reel(url: str, download_video: bool = True) -> dict:
    """Use yt-dlp to extract metadata and optionally download video."""
    print(f"\n{'='*60}")
    print(f"  STEP 1: Extracting reel content")
    print(f"{'='*60}")
    print(f"  URL: {url}")

    # First pass: metadata only
    cmd = ["yt-dlp", "--dump-json", "--no-download", url]
    print(f"  Running: {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        # Try with cookies from browser
        for browser in ["chrome", "firefox", "safari"]:
            print(f"  Retrying with {browser} cookies...")
            cmd_cookies = ["yt-dlp", "--dump-json", "--no-download",
                           "--cookies-from-browser", browser, url]
            result = subprocess.run(cmd_cookies, capture_output=True, text=True, timeout=60)
            if result.returncode == 0:
                break
        if result.returncode != 0:
            print(f"  ERROR: yt-dlp failed: {result.stderr}")
            sys.exit(1)

    meta = json.loads(result.stdout)

    reel = {
        "url": url,
        "shortcode": meta.get("display_id") or meta.get("id"),
        "title": meta.get("title", ""),
        "caption": meta.get("description", ""),
        "author": meta.get("uploader") or meta.get("channel") or "",
        "author_id": meta.get("uploader_id") or meta.get("channel_id") or "",
        "thumbnail": meta.get("thumbnail"),
        "duration": meta.get("duration"),
        "view_count": meta.get("view_count"),
        "like_count": meta.get("like_count"),
        "comment_count": meta.get("comment_count"),
        "timestamp": meta.get("timestamp"),
        "audio_track": None,
        "video_path": None,
    }

    # Extract audio/music track info if available
    track = meta.get("track")
    artist = meta.get("artist") or meta.get("creator")
    if track:
        reel["audio_track"] = f"{artist} - {track}" if artist else track
    elif meta.get("music_track"):
        reel["audio_track"] = meta["music_track"]

    print(f"\n  Author:    @{reel['author_id']}")
    print(f"  Caption:   {reel['caption'][:120]}{'...' if len(reel['caption']) > 120 else ''}")
    print(f"  Duration:  {reel['duration']}s")
    print(f"  Audio:     {reel['audio_track'] or 'none detected'}")
    print(f"  Thumbnail: {reel['thumbnail'][:80]}..." if reel['thumbnail'] else "  Thumbnail: none")

    # Second pass: download video for transcription
    if download_video:
        tmpdir = tempfile.mkdtemp(prefix="reel_")
        video_path = os.path.join(tmpdir, "reel.mp4")
        dl_cmd = ["yt-dlp", "-o", video_path, "--format", "mp4", url]
        # Try with cookies if plain download fails
        dl_result = subprocess.run(dl_cmd, capture_output=True, text=True, timeout=120)
        if dl_result.returncode != 0:
            for browser in ["chrome", "firefox", "safari"]:
                dl_cmd_cookies = ["yt-dlp", "-o", video_path, "--format", "mp4",
                                  "--cookies-from-browser", browser, url]
                dl_result = subprocess.run(dl_cmd_cookies, capture_output=True, text=True, timeout=120)
                if dl_result.returncode == 0:
                    break
        if dl_result.returncode == 0 and os.path.exists(video_path):
            reel["video_path"] = video_path
            size_mb = os.path.getsize(video_path) / (1024 * 1024)
            print(f"  Video:     {video_path} ({size_mb:.1f} MB)")
        else:
            print(f"  Video:     download failed (caption-only extraction)")

    return reel


# ---------------------------------------------------------------------------
# 2. AUDIO TRANSCRIPTION (Deepgram Nova-2)
# ---------------------------------------------------------------------------

def transcribe_audio(video_path: str) -> str | None:
    """Transcribe video audio using Deepgram Nova-2 REST API."""
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        print("\n  STEP 2: Skipping transcription (no DEEPGRAM_API_KEY)")
        print("  Set DEEPGRAM_API_KEY to enable audio transcription.")
        return None

    print(f"\n{'='*60}")
    print(f"  STEP 2: Transcribing audio (Deepgram Nova-2)")
    print(f"{'='*60}")

    with open(video_path, "rb") as f:
        video_data = f.read()

    print(f"  Sending {len(video_data) / (1024*1024):.1f} MB to Deepgram...")

    url = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true"
    req = urllib.request.Request(
        url,
        data=video_data,
        headers={
            "Authorization": f"Token {api_key}",
            "Content-Type": "video/mp4",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode())
        transcript = result["results"]["channels"][0]["alternatives"][0]["transcript"]
        confidence = result["results"]["channels"][0]["alternatives"][0]["confidence"]
        print(f"  Transcript ({confidence:.0%} confidence):")
        print(f"  \"{transcript[:200]}{'...' if len(transcript) > 200 else ''}\"")
        return transcript
    except Exception as e:
        print(f"  Transcription failed: {e}")
        print("  Continuing with caption-only extraction.")
        return None


# ---------------------------------------------------------------------------
# 3. ENTITY EXTRACTION (Claude)
# ---------------------------------------------------------------------------

EXTRACTION_PROMPT = """\
Analyze this Instagram Reel post. Extract every real-world entity mentioned \
or referenced — places, products, brands, songs, restaurants, events, \
people, recipes, tools, etc.

For each entity:
- type: place | product | brand | song | food | event | person | generic
- name: canonical name (e.g., "Blue Bottle Coffee" not "this coffee spot")
- location_hint: any geographic context (e.g., "Valencia St, San Francisco")
- category: which board category (eat, go, wear, watch, listen, use, follow, read)
- confidence: 0.0-1.0
- source: which input it came from ("caption" | "transcript" | "audio_track")
- search_query: a Google search query that would find this entity's primary \
  website or listing (e.g., "Blue Bottle Coffee Valencia St San Francisco \
  Google Maps" or "Khruangbin Maria También Spotify")

Be aggressive about extraction. If someone says "this place" while tagged \
at a location, that's a place entity. If a song is playing, that's a song \
entity. If they mention a brand, that's a brand entity even if the product \
isn't named. For products, include the brand if known.

Return ONLY valid JSON, no markdown fences:
{
  "entities": [...],
  "post_category": "eat|go|wear|watch|listen|use|follow|read",
  "post_summary": "one sentence summary of what this reel is about"
}
"""


def extract_entities(reel: dict, transcript: str | None) -> dict:
    """Use Claude to extract entities from caption + transcript."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("\n  STEP 3: ERROR — ANTHROPIC_API_KEY required for entity extraction")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  STEP 3: Extracting entities (Claude Haiku)")
    print(f"{'='*60}")

    # Build context for Claude
    context_parts = []
    context_parts.append(f"Author: @{reel['author_id']}")
    if reel["caption"]:
        context_parts.append(f"Caption: {reel['caption']}")
    if transcript:
        context_parts.append(f"Transcript (spoken audio): {transcript}")
    if reel["audio_track"]:
        context_parts.append(f"Audio track playing: {reel['audio_track']}")

    user_message = "\n\n".join(context_parts)
    print(f"  Input length: {len(user_message)} chars")

    # Call Claude API directly via urllib (no SDK dependency required)
    payload = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 2048,
        "messages": [
            {"role": "user", "content": f"{EXTRACTION_PROMPT}\n\n---\n\n{user_message}"}
        ],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
        text = result["content"][0]["text"]

        # Parse JSON from response (strip markdown fences if present)
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\n?", "", text)
            text = re.sub(r"\n?```$", "", text)
        extraction = json.loads(text)

        entity_count = len(extraction.get("entities", []))
        print(f"  Found {entity_count} entities:")
        for ent in extraction.get("entities", []):
            conf = ent.get("confidence", 0)
            print(f"    [{ent['category']}] {ent['name']} "
                  f"({ent['type']}, {conf:.0%} confidence)")

        return extraction

    except Exception as e:
        print(f"  Entity extraction failed: {e}")
        return {"entities": [], "post_category": "follow", "post_summary": ""}


# ---------------------------------------------------------------------------
# 4. ENTITY RESOLUTION (web search for primary source URLs)
# ---------------------------------------------------------------------------

def search_duckduckgo(query: str) -> str | None:
    """Search DuckDuckGo and return the first result URL."""
    # Use DuckDuckGo HTML search (no API key needed)
    encoded = urllib.parse.quote_plus(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/120.0.0.0 Safari/537.36"
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="replace")
        # Extract first result URL from DuckDuckGo HTML
        # Results are in <a class="result__a" href="...">
        match = re.search(r'class="result__a"[^>]*href="([^"]+)"', html)
        if match:
            result_url = match.group(1)
            # DuckDuckGo wraps URLs in a redirect; extract the actual URL
            parsed = urllib.parse.urlparse(result_url)
            params = urllib.parse.parse_qs(parsed.query)
            if "uddg" in params:
                return params["uddg"][0]
            return result_url
    except Exception:
        pass
    return None


def resolve_entity(entity: dict) -> dict:
    """Resolve an entity to its primary source URL via web search."""
    etype = entity.get("type", "generic")
    name = entity["name"]
    location = entity.get("location_hint", "")
    search_query = entity.get("search_query", "")

    # Build targeted search queries by entity type
    if etype == "place" or entity.get("category") == "eat":
        query = search_query or f"{name} {location} Google Maps".strip()
    elif etype == "song":
        artist = entity.get("artist", "")
        query = search_query or f"{name} {artist} Spotify".strip()
    elif etype == "brand":
        query = search_query or f"{name} official site"
    elif etype == "product":
        query = search_query or f"{name} buy"
    elif etype == "person":
        query = search_query or f"{name} Instagram"
    else:
        query = search_query or name

    url = search_duckduckgo(query)
    entity["resolved_url"] = url
    entity["resolved_via"] = "duckduckgo-search"
    return entity


def resolve_all_entities(extraction: dict) -> dict:
    """Resolve all high-confidence entities to primary source URLs."""
    print(f"\n{'='*60}")
    print(f"  STEP 4: Resolving entities to primary sources")
    print(f"{'='*60}")

    for entity in extraction.get("entities", []):
        confidence = entity.get("confidence", 0)
        if confidence < 0.5:
            print(f"  SKIP: {entity['name']} (confidence {confidence:.0%} too low)")
            entity["resolved_url"] = None
            entity["status"] = "discarded"
            continue

        if confidence < 0.7:
            entity["status"] = "review"
        else:
            entity["status"] = "auto"

        entity = resolve_entity(entity)
        status = "found" if entity["resolved_url"] else "NOT FOUND"
        print(f"  [{status}] {entity['name']}")
        if entity["resolved_url"]:
            print(f"           -> {entity['resolved_url'][:80]}")

        time.sleep(0.5)  # Be polite to DuckDuckGo

    return extraction


# ---------------------------------------------------------------------------
# 5. PIN CREATION (structured output)
# ---------------------------------------------------------------------------

def create_pins(reel: dict, extraction: dict, transcript: str | None) -> list[dict]:
    """Create structured pin objects from reel + extracted entities."""
    print(f"\n{'='*60}")
    print(f"  STEP 5: Creating pins")
    print(f"{'='*60}")

    pins = []
    ts = int(time.time() * 1000)

    # Source pin (the reel itself)
    source_pin = {
        "id": f"link_{ts}_{os.urandom(3).hex()}",
        "url": reel["url"],
        "title": f"Reel by @{reel['author_id']}",
        "description": (reel["caption"] or "")[:200],
        "image": reel["thumbnail"],
        "domain": "instagram.com",
        "category": "follow",
        "content_type": "social",
        "type_confidence": 1.0,
        "source": "social",
        "source_id": "instagram",
        "instagram": {
            "shortcode": reel["shortcode"],
            "media_type": "reel",
            "author_username": reel["author_id"],
            "audio_track": reel["audio_track"],
            "transcript": transcript,
            "extracted_entities_count": len(extraction.get("entities", [])),
        },
        "addedAt": int(time.time()),
    }
    pins.append(source_pin)
    print(f"  [SOURCE]  Reel by @{reel['author_id']} -> follow")

    # Derived pins (one per resolved entity)
    for entity in extraction.get("entities", []):
        if entity.get("status") == "discarded":
            continue
        if not entity.get("resolved_url"):
            continue

        ts += 1
        derived = {
            "id": f"link_{ts}_{os.urandom(3).hex()}",
            "url": entity["resolved_url"],
            "title": entity["name"],
            "description": f"From @{reel['author_id']}: {extraction.get('post_summary', '')}",
            "image": None,  # Will be enriched by standard pipeline
            "domain": urllib.parse.urlparse(entity["resolved_url"]).netloc.replace("www.", ""),
            "category": entity.get("category", "uncategorized"),
            "content_type": entity.get("type", "generic"),
            "type_confidence": entity.get("confidence", 0.5),
            "source": "social",
            "source_url": reel["url"],  # BACKLINK to source reel
            "extraction": {
                "method": "ai-caption" + ("+transcript" if transcript else ""),
                "source_platform": "instagram",
                "source_shortcode": reel["shortcode"],
                "confidence": entity.get("confidence", 0.5),
                "entity_type": entity.get("type"),
                "resolved_via": entity.get("resolved_via"),
            },
            "addedAt": int(time.time()),
        }
        pins.append(derived)
        status_tag = "AUTO" if entity.get("status") == "auto" else "REVIEW"
        print(f"  [{status_tag}]    {entity['name']} -> {entity['category']} ({entity['resolved_url'][:60]})")

    # Report unresolved entities
    unresolved = [e for e in extraction.get("entities", [])
                  if not e.get("resolved_url") and e.get("status") != "discarded"]
    if unresolved:
        print(f"\n  Unresolved ({len(unresolved)}):")
        for e in unresolved:
            print(f"    - {e['name']} ({e['type']}, {e.get('confidence', 0):.0%})")

    return pins


# ---------------------------------------------------------------------------
# 6. OUTPUT
# ---------------------------------------------------------------------------

def output_pins(pins: list[dict], output_path: str | None = None):
    """Write pin JSON and summary."""
    print(f"\n{'='*60}")
    print(f"  RESULTS")
    print(f"{'='*60}")

    source = [p for p in pins if p.get("source_id") == "instagram"]
    derived = [p for p in pins if "source_url" in p]

    print(f"\n  1 reel -> {len(source)} source pin + {len(derived)} derived pins\n")

    # Category breakdown
    categories = {}
    for p in derived:
        cat = p["category"]
        categories[cat] = categories.get(cat, 0) + 1
    for cat, count in sorted(categories.items()):
        print(f"    {cat}: {count}")

    # Write JSON
    if output_path:
        path = output_path
    else:
        path = f"pins-{pins[0].get('instagram', {}).get('shortcode', 'output')}.json"

    with open(path, "w") as f:
        json.dump(pins, f, indent=2)
    print(f"\n  Written to: {path}")
    print(f"\n  To add to your board, paste these URLs in the boards add modal:")
    for p in derived:
        print(f"    {p['url']}")

    return path


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Convert an Instagram Reel into structured board pins.",
        epilog="Requires: pip install yt-dlp\n"
               "Optional: DEEPGRAM_API_KEY for audio transcription\n"
               "Required: ANTHROPIC_API_KEY for entity extraction",
    )
    parser.add_argument("url", help="Instagram Reel URL")
    parser.add_argument("-o", "--output", help="Output JSON file path")
    parser.add_argument("--no-video", action="store_true",
                        help="Skip video download (caption-only extraction)")
    parser.add_argument("--no-resolve", action="store_true",
                        help="Skip entity resolution (extraction only)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be created without writing files")
    args = parser.parse_args()

    # Validate URL
    if "instagram.com" not in args.url:
        print("ERROR: URL must be an Instagram URL")
        sys.exit(1)

    print("\n" + "="*60)
    print("  REEL TO PINS")
    print("  Instagram Reel -> Structured Board Pins")
    print("="*60)

    # Step 1: Extract reel content
    reel = extract_reel(args.url, download_video=not args.no_video)

    # Step 2: Transcribe audio
    transcript = None
    if reel.get("video_path") and not args.no_video:
        transcript = transcribe_audio(reel["video_path"])

    # Step 3: Extract entities
    extraction = extract_entities(reel, transcript)

    # Step 4: Resolve entities to primary sources
    if not args.no_resolve:
        extraction = resolve_all_entities(extraction)

    # Step 5: Create pins
    pins = create_pins(reel, extraction, transcript)

    # Step 6: Output
    if not args.dry_run:
        output_pins(pins, args.output)
    else:
        print("\n  DRY RUN — no files written")
        print(f"  Would create {len(pins)} pins")

    # Cleanup video file
    if reel.get("video_path") and os.path.exists(reel["video_path"]):
        os.remove(reel["video_path"])
        os.rmdir(os.path.dirname(reel["video_path"]))
        print("\n  Cleaned up temporary video file.")

    print("\n  Done.\n")


if __name__ == "__main__":
    main()
