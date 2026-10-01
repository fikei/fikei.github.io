#!/usr/bin/env python3
"""Build halloween/data/guide.json — the guest guide's rooms + art.

Sources (2026-10-01 snapshot):
  * Who's in and which room: the '26 planning sheet — 📝 Performers (Confirmed to
    play? = YES) and 📝 Collaborators (Location). Curated below in PIECES.
  * What the art is: the Call for Collaborators form (halloween/data/proposals.json),
    matched by proposal id. Contact details are never copied (public site).
  * Theater times: halloween/data/theater.json slots (the guide also reads the
    live theater schedule from Supabase at runtime).

Edit ROOMS / PIECES and re-run:  python3 scripts/halloween-guide.py
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'halloween' / 'data'

MEDIUMS = [
    {'id': 'theater', 'name': 'Theater & performance'},
    {'id': 'music', 'name': 'Music & DJ'},
    {'id': 'installation', 'name': 'Installation & space'},
    {'id': 'interactive', 'name': 'Interactive experience'},
    {'id': 'photo', 'name': 'Photo & film'},
    {'id': 'food', 'name': 'Food & drink'},
]

# Floors top-down. Each room sits on a 4-column schematic grid: [col, row, w, h].
FLOORS = [
    {'id': 'roof', 'name': 'Roof', 'rooms': [
        {'id': 'roof', 'name': 'Roof', 'sub': 'Sunrise', 'grid': [0, 0, 4, 1], 'outdoor': True},
    ]},
    {'id': 'f3', 'name': '3rd floor', 'rooms': [
        {'id': 'loft', 'name': 'Loft', 'sub': 'Ambient stage', 'grid': [0, 0, 3, 2]},
        {'id': 'kate', 'name': "Kate's room", 'sub': 'Tea lounge', 'grid': [3, 0, 1, 1]},
        {'id': 'bathtub', 'name': 'Bathtub restroom', 'grid': [3, 1, 1, 1]},
    ]},
    {'id': 'f2', 'name': '2nd floor', 'rooms': [
        {'id': 'theater', 'name': 'Theater', 'sub': "Justine & Colin's room · under the rear stairs", 'grid': [0, 0, 2, 2]},
        {'id': 'ianmelina', 'name': "Ian & Melina's room", 'grid': [2, 0, 2, 1]},
        {'id': 'franky', 'name': "Franky's room", 'grid': [2, 1, 1, 1]},
        {'id': 'sophia', 'name': "Sophia's room", 'grid': [3, 1, 1, 1]},
        {'id': 'jo', 'name': "Jo's room", 'grid': [0, 2, 1, 1]},
        {'id': 'chris', 'name': "Chris' room", 'grid': [1, 2, 1, 1]},
        {'id': 'shower2', 'name': 'Shower', 'sub': 'Melt stage', 'grid': [2, 2, 1, 1]},
        {'id': 'backstairs', 'name': 'Back stairs', 'grid': [3, 2, 1, 1]},
    ]},
    {'id': 'f1', 'name': '1st floor', 'rooms': [
        {'id': 'living', 'name': 'Living room', 'sub': 'Main stage', 'grid': [0, 0, 2, 2]},
        {'id': 'piano', 'name': 'Piano room', 'grid': [2, 0, 2, 1]},
        {'id': 'dining', 'name': 'Dining room', 'grid': [2, 1, 1, 1]},
        {'id': 'circle', 'name': 'Circle room', 'grid': [3, 1, 1, 1]},
        {'id': 'sam', 'name': "Sam's room", 'grid': [0, 2, 1, 1]},
        {'id': 'closet', 'name': 'Front storage closet', 'sub': 'Lost & found', 'grid': [1, 2, 1, 1]},
        {'id': 'storagebath', 'name': 'Storage bathroom', 'grid': [2, 2, 1, 1]},
        {'id': 'kitchen', 'name': 'Kitchen', 'sub': 'Breakfast', 'grid': [3, 2, 1, 1]},
        {'id': 'sideyard', 'name': 'Sideyard', 'sub': 'Entrance · bonfire', 'grid': [0, 3, 4, 1], 'outdoor': True},
    ]},
    {'id': 'basement', 'name': 'Basement', 'rooms': [
        {'id': 'bassroom', 'name': 'Bass room', 'sub': 'Basement stage', 'grid': [0, 0, 3, 2]},
        {'id': 'basebath', 'name': 'Basement bathroom', 'grid': [3, 0, 1, 1]},
        {'id': 'basehall', 'name': 'Hallway to bathroom', 'grid': [3, 1, 1, 1]},
    ]},
    {'id': 'outside', 'name': 'Yard', 'rooms': [
        {'id': 'yard', 'name': 'Yard', 'sub': 'Out back', 'grid': [0, 0, 4, 1], 'outdoor': True},
    ]},
    {'id': 'roaming', 'name': 'Roaming', 'rooms': [
        {'id': 'roaming', 'name': 'Roaming', 'sub': 'Moving through the whole house', 'grid': [0, 0, 4, 1]},
    ]},
]

ALL_NIGHT = [['21:00', '09:00']]

# id, title, artists, medium, room(s), proposal id or None, times, extra
PIECES = [
    # ── Music · Living room main stage (Performers: Living room, YES)
    dict(id='twins-online', title='TWINS ONLINE', artists='Michaela & Milana Vachuska', medium='music', rooms=['living'], blurb='DJ set on the main stage.'),
    dict(id='arreola-grande', title='Arreola Grande', artists='Chris Arreola', medium='music', rooms=['living'], blurb='DJ set on the main stage.'),
    dict(id='ms-smith', title='MS.SMITH', artists='Kel Lynn Smith', medium='music', rooms=['living'], blurb='DJ set on the main stage.'),
    dict(id='clearcast', title='Clearcast', artists='Franky Kohn', medium='music', rooms=['living'], proposal='p-5c59d62f'),
    # ── Music · Basement (Performers: Basement, YES)
    dict(id='cyber1a', title='CYBER1A', artists='Jess Yeung & Juliette Mohr', medium='music', rooms=['bassroom'], blurb='DJ set in the basement bass room.'),
    dict(id='subfeels', title='subfeels', artists='Justine Sun Dela Cruz', medium='music', rooms=['bassroom'], blurb='DJ set in the basement bass room.'),
    # ── Music · Loft ambient stage (Performers: Loft, YES)
    dict(id='em-tomio', title='Modular + Tape + DJ ambient set', artists='Emily & Tomio Ueda', medium='music', rooms=['loft'], proposal='p-8b3cc800'),
    dict(id='optia', title='Optia', artists='Gray Crawford', medium='music', rooms=['loft'], proposal='p-6c9dec65'),
    dict(id='dj-habibz', title='DJ Habibz', artists='Haytham Hakim', medium='music', rooms=['loft'], blurb='DJ set on the ambient stage.'),
    dict(id='babys-first-firearm', title="baby's first firearm", artists='Andi Doud & Alex Zharchuk', medium='music', rooms=['loft'], blurb='Live set on the ambient stage.'),
    dict(id='beyond-light', title='Remember your Echo', artists='Beyond Light (Arthur Wandzel)', medium='music', rooms=['loft'], proposal='p-ce6725f6'),
    dict(id='fp-matrix', title='FP Matrix', artists='Franky Kohn & Pauline', medium='music', rooms=['loft'], proposal='p-be368733'),
    # ── Theater (Collaborators: Theater stage - Justine&Colin's room; times from the theater schedule)
    dict(id='jashon', title='Blood of the Dragon', artists="Ja'Shon Wright (Haus of Hyte)", medium='theater', rooms=['theater'], proposal='p-ad4f5f31', theater='jashon'),
    dict(id='garden', title='Garden of Eternal Party', artists='Jonathan Schoonhoven & crew', medium='theater', rooms=['theater'], proposal='p-ced5efaf', theater='garden'),
    dict(id='wizards', title='The Wizards', artists='Carla Bagdonas & crew', medium='theater', rooms=['roaming', 'theater'], proposal='p-8f96dcf1', theater='wizards', roaming=True),
    dict(id='jyotsna', title='The Body is an Archive', artists='Jyotsna Jayamaran', medium='theater', rooms=['theater'], proposal='p-0ad1d3a6', theater='jyotsna'),
    dict(id='jordan', title='Jordan Corey', artists='Jordan Corey', medium='music', rooms=['theater'], proposal='p-465a5da1', theater='jordan'),
    dict(id='vacbed', title='Latex vac bed', artists='Bizzie Bisignani', medium='interactive', rooms=['theater'], blurb='A latex vacuum bed in the theater, from 2am.', theater='vacbed'),
    dict(id='mise-en-pieces', title='Mise en Pièces', artists='Diane Rodriguez', medium='theater', rooms=['sam'], proposal='p-a1f60766'),
    dict(id='dental-damned', title='Dental Damned', artists='Jose (WHO) Sanabria & crew', medium='theater', rooms=['franky'], proposal='p-a798a5fc'),
    # ── Installations & spaces (Collaborators)
    dict(id='cabbage-lamps', title='Cabbage lamps + cushions', artists='Lina Bond', medium='installation', rooms=['theater'], blurb='Cabbage lamps and cushions that dress the theater.'),
    dict(id='simple-lights', title='Simple lights', artists="Colin O'Donnell", medium='installation', rooms=['basehall'], blurb='Light along the basement hallway.'),
    dict(id='textiles', title='Textiles', artists='Linden JL', medium='installation', rooms=['basebath'], blurb='A textile installation in the basement bathroom.'),
    dict(id='tag-island', title='Tag Island', artists='Toni Antonova', medium='installation', rooms=['ianmelina'], proposal='p-1f9ec6c3'),
    dict(id='bioplastic-town', title='bioplastic town', artists='Justine Sun Dela Cruz', medium='installation', rooms=['piano', 'dining'], proposal='p-293a2512'),
    dict(id='ecdysis-oracle', title='ecdysis oracle', artists='Nele Ponce', medium='installation', rooms=['yard'], proposal='p-ac97964d'),
    dict(id='memory-melange', title='Memory Melange', artists='Charlie Stigler & Zain Shah', medium='installation', rooms=['sophia'], proposal='p-4ba8fb58'),
    dict(id='digest-me', title='Digest me, damn it!', artists='Emma Strebel, Emma Arnesty-Good & Chandler', medium='installation', rooms=['jo'], proposal='p-7789b7fe'),
    dict(id='the-bower', title='The Bower', artists='Hannah Long', medium='installation', rooms=['chris'], proposal='p-c6f1e1d5'),
    dict(id='hong-kong', title='Journey Through Hong Kong', artists='Nicole Shek', medium='installation', rooms=['backstairs'], proposal='p-567753e2'),
    # ── Interactive experiences
    dict(id='listening-room', title='A Listening Room', artists='Winnie Xu', medium='interactive', rooms=['ianmelina'], proposal='p-0fc3aabe'),
    dict(id='sewing-station', title='Sewing station', artists='Chaz Pratt', medium='interactive', rooms=['piano'], blurb='Stitch, patch and mend — a sewing station in the piano room.'),
    dict(id='game-parlour', title='The Preposterous Game Parlour', artists='Ava Maag & Emily Miller', medium='interactive', rooms=['piano'], proposal='p-960fc99b'),
    dict(id='memory-stitcher', title='Memory Stitcher', artists='Timothy Monkiewicz', medium='interactive', rooms=['yard'], proposal='p-8612e793'),
    dict(id='broken-toy-box', title='The Broken Toy Box', artists='M.E. Francis & JB Bolber', medium='interactive', rooms=['closet'], proposal='p-16a931e9'),
    dict(id='empathy-kintsugi', title='Empathy Kintsugi', artists='Louis Anderson', medium='interactive', rooms=['storagebath'], proposal='p-7c1f76cc'),
    dict(id='regenerative-touch', title='Regenerative Touch', artists='Elena Lake Polozova', medium='interactive', rooms=['circle'], proposal='p-e8869634'),
    dict(id='message-future', title='Send a Message to the Future', artists='Kat Ramirez', medium='interactive', rooms=['roaming'], proposal='p-ba937349', roaming=True),
    # ── Photo & film
    dict(id='photo', title='Party photography', artists='Elizabeth Alexeyev', medium='photo', rooms=['roaming'], blurb='Roaming photographer — say hi.', roaming=True),
    dict(id='video', title='Party film', artists='Fern Lukban', medium='photo', rooms=['roaming'], blurb='Roaming videographer capturing the night.', roaming=True),
    # ── Food & drink
    dict(id='tea-lounge', title='Tea lounge', artists='Carmen Liu', medium='food', rooms=['kate'], blurb="A tea lounge in Kate's room — sit down, slow down."),
    dict(id='boschian-breakfast', title='Boschian Breakfast', artists='Samantha Ong', medium='food', rooms=['kitchen'], proposal='p-ef6b279c', times=[['07:00', '09:00']]),
]


MOJIBAKE = re.compile(r'[\u00c2-\u00f4][\u0080-\u00bf\u2018-\u203a\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc]+')


def fix_mojibake(s):
    """The sheet export double-encoded some UTF-8 (emoji arrive as 'ð\x9f…'); undo it run by run."""
    def one(m):
        t = m.group(0)
        for enc in ('latin-1', 'cp1252'):
            try:
                return t.encode(enc).decode('utf-8')
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
        return ''
    return MOJIBAKE.sub(one, s)


def clean(s):
    s = fix_mojibake(s or '').replace('\u00a0', ' ')
    s = re.sub(r'\S+@\S+\.\S+', '', s)                              # no emails
    s = re.sub(r'(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}', '', s)  # no phone numbers
    return re.sub(r'[ \t]+', ' ', s).strip()


# Form answers were written to the organisers; drop the asks before guests see them.
ASK = re.compile(r"\b(tickets?|grants?|stipend|budget|funding|artist fee|out-of-pocket|TOOLS NEEDED|I would need|I'd need)\b|\$\s?\d", re.I)


def guest_text(s):
    sents = re.split(r'(?<=[.!?])\s+', clean(s))
    return ' '.join(x for x in sents if x and not ASK.search(x)).strip()


# Hand-written one-liners where the form's first sentence doesn't read well to guests.
BLURBS = {
    'jashon': "Immersive theatre: the Empress of the Universe, bound by grief, is freed by the Jade Dragon's sacrifice.",
    'garden': 'A shadow-puppet musical — short shows through the night.',
    'jordan': 'An acoustic alt-R&B set that opens and closes with a guided meditation.',
    'clearcast': 'Live/DJ set on the main stage.',
    'optia': 'A live ambient set — arpeggios, reverb and organic synthesis.',
    'tag-island': 'A concrete wall and island to sit on and tag with markers — plus Walkmen loaded with 90s CDs.',
    'message-future': 'Pass analog messages between guests: leave one, receive one.',
    'boschian-breakfast': 'A Hieronymus Bosch–inspired breakfast as the sun comes up.',
    'bioplastic-town': 'Glowing bioplastic panels and lanterns made from gelatin and glycerin.',
    'memory-stitcher': 'An 8-foot sculpture, lamp and shrine built from reclaimed materials.',
    'empathy-kintsugi': 'Two strangers, one projection, and a few shared vulnerable moments.',
    'game-parlour': 'Classic board games remixed into absurd, play-with-able chaos.',
    'wizards': 'Nonverbal musical "magicians" who pull strangers into improvised group singing.',
    'regenerative-touch': 'Bodywork sessions in a new modality, Regenerative Touch.',
    'digest-me': "Crawl into a patchwork creature's mouth, through its gut, to a guided meditation in its stomach.",
}


def first_sentence(s, limit=180):
    s = clean(s)
    m = re.match(r'(.{30,}?[.!?])(\s|$)', s)
    out = m.group(1) if m else s
    return out if len(out) <= limit else out[:limit - 1].rsplit(' ', 1)[0] + '…'


def main():
    props = {p['id']: p for p in json.loads((DATA / 'proposals.json').read_text())['proposals']}
    theater = json.loads((DATA / 'theater.json').read_text())
    tacts = {a['id']: a for a in theater['acts']}
    room_ids = {r['id'] for f in FLOORS for r in f['rooms']}

    def hhmm_add(t, mins):
        h, m = map(int, t.split(':'))
        v = (h * 60 + m + mins) % 1440
        return f'{v // 60:02d}:{v % 60:02d}'

    pieces = []
    for p in PIECES:
        for r in p['rooms']:
            assert r in room_ids, (p['id'], r)
        prop = props.get(p.get('proposal'))
        desc = guest_text(prop['description']) if prop else ''
        journey = guest_text(prop['journey']) if prop else ''
        times = p.get('times')
        if p.get('theater') and p['theater'] in tacts:
            a = tacts[p['theater']]
            run = a.get('run') or 30
            times = [[s, hhmm_add(s, run)] for s in a.get('slots', [])] or None
        all_night = not times and p['medium'] in ('installation', 'interactive', 'food', 'photo')
        pieces.append({
            'id': p['id'], 'title': p['title'], 'artists': p['artists'], 'medium': p['medium'],
            'rooms': p['rooms'], 'roaming': bool(p.get('roaming')),
            'blurb': BLURBS.get(p['id']) or p.get('blurb') or first_sentence(desc) or '',
            'description': desc, 'journey': journey,
            'times': times or (ALL_NIGHT if all_night else None),
            'theater': p.get('theater'),
            'proposal': p.get('proposal'),
        })

    out = {
        'event': {'name': 'Agape XV: Reassemblage', 'date': '2026-10-24', 'tz': 'America/Los_Angeles',
                  'start': '2026-10-24T21:00:00-07:00', 'end': '2026-10-25T09:00:00-07:00',
                  'discord': 'https://discord.gg/qunsekyQS'},
        'generated_at': '2026-10-01',
        'source': "Planning sheet (📝 Performers YES + 📝 Collaborators) for who/where; Call for Collaborators form for descriptions; theater.json for theater times.",
        'mediums': MEDIUMS,
        'floors': FLOORS,
        'pieces': pieces,
    }
    (DATA / 'guide.json').write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n')
    print(f"wrote guide.json: {len(pieces)} pieces, {len(room_ids)} rooms")


if __name__ == '__main__':
    main()
