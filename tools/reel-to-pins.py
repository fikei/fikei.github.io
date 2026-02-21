#!/usr/bin/env python3
"""
reel-to-pins.py — Extract an Instagram Reel into structured board pins.

Pipeline:
  1. Extract reel metadata + video URL (ScrapeCreators API or yt-dlp fallback)
  2. Transcribe audio (Supadata API, Deepgram Nova-2, or yt-dlp local)
  3. Claude Haiku extracts entities (places, products, music, brands)
  4. Web search resolves each entity to a stable primary-source URL
  5. Outputs structured pin JSON matching the boards schema

Usage:
  # Production mode (recommended — API-based, no local tools needed):
  export SCRAPECREATORS_API_KEY=...   # metadata extraction
  export SUPADATA_API_KEY=...         # audio transcription (or DEEPGRAM_API_KEY)
  export ANTHROPIC_API_KEY=sk-ant-... # entity extraction

  python tools/reel-to-pins.py https://www.instagram.com/reel/DUuIXvviek-/

  # Local mode (uses yt-dlp + Deepgram — requires pip install yt-dlp):
  python tools/reel-to-pins.py --backend=ytdlp https://www.instagram.com/reel/DUuIXvviek-/

  # Extraction backends (--backend flag):
  #   scrapecreators  — ScrapeCreators API (default, needs SCRAPECREATORS_API_KEY)
  #   ytdlp           — yt-dlp local tool (needs yt-dlp installed)
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
# 1. CONTENT EXTRACTION
# ---------------------------------------------------------------------------

def parse_shortcode(url: str) -> str | None:
    """Extract Instagram shortcode from a URL."""
    match = re.search(r'instagram\.com/(?:reel|p|tv)/([A-Za-z0-9_-]+)', url)
    return match.group(1) if match else None


def extract_via_scrapecreators(url: str) -> dict:
    """Use ScrapeCreators API to extract reel metadata and video URL."""
    api_key = os.environ.get("SCRAPECREATORS_API_KEY")
    if not api_key:
        raise RuntimeError("SCRAPECREATORS_API_KEY not set")

    encoded_url = urllib.parse.quote(url, safe='')
    api_url = f"https://api.scrapecreators.com/v2/instagram/post?url={encoded_url}"

    req = urllib.request.Request(api_url, headers={
        "x-api-key": api_key,
        "Accept": "application/json",
    })

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())

    # ScrapeCreators returns nested data — normalize to our format
    post = data if "shortcode" in data else data.get("data", data)

    reel = {
        "url": url,
        "shortcode": post.get("shortcode") or parse_shortcode(url),
        "title": post.get("title", ""),
        "caption": post.get("caption") or post.get("description") or "",
        "author": post.get("author_name") or post.get("owner_username") or "",
        "author_id": post.get("author_username") or post.get("owner_username") or "",
        "thumbnail": post.get("thumbnail_url") or post.get("display_url"),
        "duration": post.get("duration") or post.get("video_duration"),
        "view_count": post.get("video_view_count") or post.get("view_count"),
        "like_count": post.get("like_count"),
        "comment_count": post.get("comment_count"),
        "timestamp": post.get("taken_at") or post.get("timestamp"),
        "audio_track": None,
        "video_url": post.get("video_url"),
        "video_path": None,
        "tagged_location": post.get("location", {}).get("name") if isinstance(post.get("location"), dict) else post.get("location"),
        "tagged_accounts": post.get("tagged_users") or [],
        "auto_transcript": post.get("transcript") or post.get("accessibility_caption"),
    }

    # Extract audio/music track
    music = post.get("music_info") or post.get("clips_metadata", {}).get("music_info", {})
    if isinstance(music, dict):
        asset = music.get("music_asset_info", music)
        track_name = asset.get("title") or asset.get("track_name")
        artist = asset.get("display_artist") or asset.get("artist_name")
        if track_name:
            reel["audio_track"] = f"{artist} - {track_name}" if artist else track_name

    return reel


def extract_via_ytdlp(url: str, download_video: bool = True) -> dict:
    """Use yt-dlp to extract metadata and optionally download video."""
    cmd = ["yt-dlp", "--dump-json", "--no-download", url]
    print(f"  Running: {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        for browser in ["chrome", "firefox", "safari"]:
            print(f"  Retrying with {browser} cookies...")
            cmd_cookies = ["yt-dlp", "--dump-json", "--no-download",
                           "--cookies-from-browser", browser, url]
            result = subprocess.run(cmd_cookies, capture_output=True, text=True, timeout=60)
            if result.returncode == 0:
                break
        if result.returncode != 0:
            raise RuntimeError(f"yt-dlp failed: {result.stderr}")

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
        "video_url": None,
        "video_path": None,
        "tagged_location": None,
        "tagged_accounts": [],
        "auto_transcript": None,
    }

    # Extract audio/music track info
    track = meta.get("track")
    artist = meta.get("artist") or meta.get("creator")
    if track:
        reel["audio_track"] = f"{artist} - {track}" if artist else track

    # Download video for transcription
    if download_video:
        tmpdir = tempfile.mkdtemp(prefix="reel_")
        video_path = os.path.join(tmpdir, "reel.mp4")
        dl_cmd = ["yt-dlp", "-o", video_path, "--format", "mp4", url]
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


def extract_reel(url: str, backend: str = "scrapecreators", download_video: bool = True) -> dict:
    """Extract reel content using the specified backend."""
    print(f"\n{'='*60}")
    print(f"  STEP 1: Extracting reel content ({backend})")
    print(f"{'='*60}")
    print(f"  URL: {url}")

    if backend == "scrapecreators":
        try:
            reel = extract_via_scrapecreators(url)
        except Exception as e:
            print(f"  ScrapeCreators failed: {e}")
            print(f"  Falling back to yt-dlp...")
            reel = extract_via_ytdlp(url, download_video=download_video)
    elif backend == "ytdlp":
        reel = extract_via_ytdlp(url, download_video=download_video)
    else:
        raise ValueError(f"Unknown backend: {backend}")

    print(f"\n  Author:    @{reel['author_id']}")
    print(f"  Caption:   {reel['caption'][:120]}{'...' if len(reel['caption']) > 120 else ''}")
    if reel.get("duration"):
        print(f"  Duration:  {reel['duration']}s")
    print(f"  Audio:     {reel['audio_track'] or 'none detected'}")
    if reel.get("tagged_location"):
        print(f"  Location:  {reel['tagged_location']}")
    if reel.get("thumbnail"):
        print(f"  Thumbnail: {reel['thumbnail'][:80]}...")
    if reel.get("video_url"):
        print(f"  Video URL: available (CDN, ~48h expiry)")
    if reel.get("auto_transcript"):
        print(f"  IG Transcript: available ({len(reel['auto_transcript'])} chars)")

    return reel


# ---------------------------------------------------------------------------
# 2. AUDIO TRANSCRIPTION
# ---------------------------------------------------------------------------

def transcribe_via_supadata(url: str) -> str | None:
    """Transcribe using Supadata API — URL to transcript in one call."""
    api_key = os.environ.get("SUPADATA_API_KEY")
    if not api_key:
        return None

    print(f"  Trying Supadata API...")

    payload = json.dumps({"url": url}).encode()
    req = urllib.request.Request(
        "https://api.supadata.ai/v1/transcript",
        data=payload,
        headers={
            "x-api-key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
        transcript = result.get("content") or result.get("transcript") or result.get("text")
        if transcript:
            lang = result.get("lang", "unknown")
            print(f"  Supadata transcript ({lang}):")
            print(f"  \"{transcript[:200]}{'...' if len(transcript) > 200 else ''}\"")
            return transcript
    except Exception as e:
        print(f"  Supadata failed: {e}")

    return None


def transcribe_via_deepgram(video_source: str) -> str | None:
    """Transcribe using Deepgram Nova-2 REST API.

    video_source can be a local file path or a CDN video URL.
    """
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        return None

    print(f"  Trying Deepgram Nova-2...")

    # Load video data from file or URL
    if os.path.exists(video_source):
        with open(video_source, "rb") as f:
            video_data = f.read()
        print(f"  Sending {len(video_data) / (1024*1024):.1f} MB to Deepgram...")
    else:
        # Download from CDN URL first
        print(f"  Downloading video from CDN...")
        dl_req = urllib.request.Request(video_source, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
        })
        with urllib.request.urlopen(dl_req, timeout=60) as resp:
            video_data = resp.read()
        print(f"  Downloaded {len(video_data) / (1024*1024):.1f} MB")

    api_url = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&detect_language=true"
    req = urllib.request.Request(
        api_url,
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
        print(f"  Deepgram transcript ({confidence:.0%} confidence):")
        print(f"  \"{transcript[:200]}{'...' if len(transcript) > 200 else ''}\"")
        return transcript
    except Exception as e:
        print(f"  Deepgram failed: {e}")

    return None


def transcribe_audio(reel: dict) -> str | None:
    """Transcribe reel audio using the best available method.

    Priority:
      1. Instagram's own auto-transcript (free, already in metadata)
      2. Supadata API (one call, URL -> transcript)
      3. Deepgram Nova-2 (needs video file or CDN URL)
    """
    print(f"\n{'='*60}")
    print(f"  STEP 2: Transcribing audio")
    print(f"{'='*60}")

    # 1. Check for Instagram's own auto-transcript
    if reel.get("auto_transcript"):
        print(f"  Using Instagram auto-transcript (free)")
        return reel["auto_transcript"]

    # 2. Try Supadata (URL -> transcript in one call)
    transcript = transcribe_via_supadata(reel["url"])
    if transcript:
        return transcript

    # 3. Try Deepgram with video file or CDN URL
    video_source = reel.get("video_path") or reel.get("video_url")
    if video_source:
        transcript = transcribe_via_deepgram(video_source)
        if transcript:
            return transcript

    print(f"  No transcription available.")
    print(f"  Set SUPADATA_API_KEY or DEEPGRAM_API_KEY to enable.")
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
- source: which input it came from ("caption" | "transcript" | "audio_track" | "tagged_location" | "tagged_account")
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
    if reel.get("tagged_location"):
        context_parts.append(f"Tagged location: {reel['tagged_location']}")
    if reel.get("tagged_accounts"):
        accounts = reel["tagged_accounts"]
        if isinstance(accounts, list) and accounts:
            context_parts.append(f"Tagged accounts: {', '.join('@' + a for a in accounts)}")

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
        match = re.search(r'class="result__a"[^>]*href="([^"]+)"', html)
        if match:
            result_url = match.group(1)
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
            "tagged_location": reel.get("tagged_location"),
            "tagged_accounts": reel.get("tagged_accounts", []),
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
            "image": None,
            "domain": urllib.parse.urlparse(entity["resolved_url"]).netloc.replace("www.", ""),
            "category": entity.get("category", "uncategorized"),
            "content_type": entity.get("type", "generic"),
            "type_confidence": entity.get("confidence", 0.5),
            "source": "social",
            "source_url": reel["url"],
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

    categories = {}
    for p in derived:
        cat = p["category"]
        categories[cat] = categories.get(cat, 0) + 1
    for cat, count in sorted(categories.items()):
        print(f"    {cat}: {count}")

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
        epilog="Backends:\n"
               "  scrapecreators  ScrapeCreators API (default, needs SCRAPECREATORS_API_KEY)\n"
               "  ytdlp           yt-dlp local tool (needs pip install yt-dlp)\n\n"
               "Transcription (checked in order):\n"
               "  1. Instagram auto-transcript (free, when available)\n"
               "  2. SUPADATA_API_KEY   Supadata API (URL -> transcript)\n"
               "  3. DEEPGRAM_API_KEY   Deepgram Nova-2 (video -> transcript)\n\n"
               "Required: ANTHROPIC_API_KEY for entity extraction",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("url", help="Instagram Reel URL")
    parser.add_argument("-o", "--output", help="Output JSON file path")
    parser.add_argument("--backend", choices=["scrapecreators", "ytdlp"],
                        default="scrapecreators",
                        help="Extraction backend (default: scrapecreators)")
    parser.add_argument("--no-video", action="store_true",
                        help="Skip video download (caption-only extraction, yt-dlp only)")
    parser.add_argument("--no-transcribe", action="store_true",
                        help="Skip audio transcription")
    parser.add_argument("--no-resolve", action="store_true",
                        help="Skip entity resolution (extraction only)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be created without writing files")
    args = parser.parse_args()

    # Validate URL
    if "instagram.com" not in args.url:
        print("ERROR: URL must be an Instagram URL")
        sys.exit(1)

    # Auto-detect backend: fall back to ytdlp if no ScrapeCreators key
    backend = args.backend
    if backend == "scrapecreators" and not os.environ.get("SCRAPECREATORS_API_KEY"):
        print("  Note: SCRAPECREATORS_API_KEY not set, falling back to yt-dlp")
        backend = "ytdlp"

    print("\n" + "="*60)
    print("  REEL TO PINS")
    print("  Instagram Reel -> Structured Board Pins")
    print("="*60)

    # Step 1: Extract reel content
    reel = extract_reel(args.url, backend=backend,
                        download_video=not args.no_video)

    # Step 2: Transcribe audio
    transcript = None
    if not args.no_transcribe:
        transcript = transcribe_audio(reel)

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
