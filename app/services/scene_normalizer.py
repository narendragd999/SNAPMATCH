"""
app/services/scene_normalizer.py

Maps the raw Places365 scene labels (365 verbose categories) to:
  1. Clean display names    — e.g. "lecture_room" → "Lecture Room"
  2. Broad category groups  — e.g. "lecture_room" → "Education"
  3. Category emoji         — e.g. "Education" → "🎓"

Only a meaningful subset of Places365 is shown; irrelevant/noisy labels
(e.g. "slum", "butchers_shop", "biology_laboratory") are mapped to "Other"
and can be hidden in the UI.

Usage:
    from app.services.scene_normalizer import normalize_scene, HIDDEN_LABELS

    label, group, emoji = normalize_scene("lecture_room")
    # → ("Lecture Room", "Education", "🎓")

    if label in HIDDEN_LABELS:   # skip irrelevant labels in UI
        continue
"""

from __future__ import annotations

# ── Category → emoji ──────────────────────────────────────────────────────────
CATEGORY_EMOJI: dict[str, str] = {
    "Outdoor":      "🌿",
    "Indoor":       "🏠",
    "Education":    "🎓",
    "Event/Party":  "🎉",
    "Food & Drink": "🍽️",
    "Cultural":     "🏛️",
    "Healthcare":   "🏥",
    "Transport":    "🚆",
    "Shopping":     "🛒",
    "Sports":       "🏃",
    "Workspace":    "💼",
    "Other":        "📸",
}

# ── Places365 raw label → (display_name, category) ───────────────────────────
# Keys are lowercase and match Places365 output (slashes become underscores).
_LABEL_MAP: dict[str, tuple[str, str]] = {

    # ── Outdoor ──────────────────────────────────────────────────────────────
    "beach":                ("Beach",           "Outdoor"),
    "beach_house":          ("Beach House",     "Outdoor"),
    "botanical_garden":     ("Garden",          "Outdoor"),
    "yard":                 ("Yard",            "Outdoor"),
    "garden":               ("Garden",          "Outdoor"),
    "park":                 ("Park",            "Outdoor"),
    "village":              ("Village",         "Outdoor"),
    "beer_garden":          ("Beer Garden",     "Outdoor"),
    "rope_bridge":          ("Bridge/Outdoor",  "Outdoor"),
    "topiary_garden":       ("Garden",          "Outdoor"),
    "botanical_garden":     ("Garden",          "Outdoor"),
    "roof_garden":          ("Rooftop",         "Outdoor"),
    "balcony/exterior":     ("Balcony",         "Outdoor"),
    "balcony/interior":     ("Balcony",         "Indoor"),
    "plaza":                ("Plaza",           "Outdoor"),
    "street":               ("Street",          "Outdoor"),
    "alley":                ("Alley",           "Outdoor"),
    "courtyard":            ("Courtyard",       "Outdoor"),
    "parking_lot":          ("Parking Lot",     "Outdoor"),
    "campsite":             ("Outdoor",         "Outdoor"),
    "forest_path":          ("Forest",          "Outdoor"),
    "forest/broadleaf":     ("Forest",          "Outdoor"),
    "mountain":             ("Mountain",        "Outdoor"),
    "waterfall":            ("Waterfall",       "Outdoor"),
    "river":                ("River",           "Outdoor"),
    "swimming_pool/outdoor":("Pool",            "Outdoor"),
    "bazaar/outdoor":       ("Outdoor Market",  "Outdoor"),
    "flea_market/outdoor":  ("Market",          "Outdoor"),
    "youth_hostel":         ("Hostel",          "Outdoor"),

    # ── Indoor ───────────────────────────────────────────────────────────────
    "living_room":          ("Living Room",     "Indoor"),
    "bedroom":              ("Bedroom",         "Indoor"),
    "childs_room":          ("Children's Room", "Indoor"),
    "dorm_room":            ("Dorm Room",       "Indoor"),
    "home_office":          ("Home Office",     "Indoor"),
    "clean_room":           ("Clean Room",      "Indoor"),
    "locker_room":          ("Locker Room",     "Indoor"),
    "dressing_room":        ("Dressing Room",   "Indoor"),
    "bathroom":             ("Bathroom",        "Indoor"),
    "closet":               ("Closet",          "Indoor"),
    "storage_room":         ("Storage Room",    "Indoor"),
    "laundromat":           ("Laundry",         "Indoor"),

    # ── Education ────────────────────────────────────────────────────────────
    "classroom":            ("Classroom",       "Education"),
    "lecture_room":         ("Lecture Room",    "Education"),
    "art_school":           ("Art School",      "Education"),
    "art_studio":           ("Art Studio",      "Education"),
    "library":              ("Library",         "Education"),
    "biology_laboratory":   ("Laboratory",      "Education"),
    "chemistry_lab":        ("Laboratory",      "Education"),
    "computer_room":        ("Computer Lab",    "Education"),
    "science_museum":       ("Science Museum",  "Education"),

    # ── Event / Party ────────────────────────────────────────────────────────
    "stage/indoor":         ("Stage",           "Event/Party"),
    "stage/outdoor":        ("Outdoor Stage",   "Event/Party"),
    "auditorium":           ("Auditorium",      "Event/Party"),
    "ballroom":             ("Ballroom",        "Event/Party"),
    "banquet_hall":         ("Banquet Hall",    "Event/Party"),
    "concert_hall":         ("Concert Hall",    "Event/Party"),
    "wedding_reception":    ("Wedding",         "Event/Party"),
    "outdoor_wedding":      ("Wedding",         "Event/Party"),
    "amusement_park":       ("Amusement Park",  "Event/Party"),
    "carrousel":            ("Carousel",        "Event/Party"),
    "fair":                 ("Fair",            "Event/Party"),
    "music_studio":         ("Studio",          "Event/Party"),
    "nightclub":            ("Nightclub",       "Event/Party"),
    "discotheque":          ("Nightclub",       "Event/Party"),

    # ── Food & Drink ─────────────────────────────────────────────────────────
    "restaurant":           ("Restaurant",      "Food & Drink"),
    "cafeteria":            ("Cafeteria",       "Food & Drink"),
    "coffee_shop":          ("Café",            "Food & Drink"),
    "bar":                  ("Bar",             "Food & Drink"),
    "pub":                  ("Pub",             "Food & Drink"),
    "kitchen":              ("Kitchen",         "Food & Drink"),
    "dining_room":          ("Dining Room",     "Food & Drink"),
    "food_court":           ("Food Court",      "Food & Drink"),
    "bakery":               ("Bakery",          "Food & Drink"),
    "ice_cream_parlor":     ("Ice Cream",       "Food & Drink"),
    "candy_store":          ("Candy Store",     "Food & Drink"),

    # ── Cultural ─────────────────────────────────────────────────────────────
    "mosque/outdoor":       ("Mosque",          "Cultural"),
    "mosque/indoor":        ("Mosque",          "Cultural"),
    "church/outdoor":       ("Church",          "Cultural"),
    "church/indoor":        ("Church",          "Cultural"),
    "temple/outdoor":       ("Temple",          "Cultural"),
    "temple/india":         ("Temple",          "Cultural"),
    "medina":               ("Medina",          "Cultural"),
    "museum/indoor":        ("Museum",          "Cultural"),
    "art_gallery":          ("Art Gallery",     "Cultural"),
    "palace":               ("Palace",          "Cultural"),
    "amphitheater":         ("Amphitheater",    "Cultural"),

    # ── Healthcare ───────────────────────────────────────────────────────────
    "hospital_room":        ("Hospital",        "Healthcare"),
    "operating_room":       ("Hospital",        "Healthcare"),
    "nursing_home":         ("Care Facility",   "Healthcare"),
    "beauty_salon":         ("Salon",           "Healthcare"),
    "hair_salon":           ("Salon",           "Healthcare"),
    "phone_booth":          ("Phone Booth",     "Other"),

    # ── Transport ────────────────────────────────────────────────────────────
    "berth":                ("Train Berth",     "Transport"),
    "airplane_cabin":       ("Airplane",        "Transport"),
    "train_station":        ("Train Station",   "Transport"),
    "airport_terminal":     ("Airport",         "Transport"),
    "bus_interior":         ("Bus",             "Transport"),
    "subway_station":       ("Subway",          "Transport"),

    # ── Shopping ─────────────────────────────────────────────────────────────
    "clothing_store":       ("Clothing Store",  "Shopping"),
    "fabric_store":         ("Fabric Store",    "Shopping"),
    "bazaar/indoor":        ("Indoor Market",   "Shopping"),
    "flea_market/indoor":   ("Market",          "Shopping"),
    "booth/indoor":         ("Booth",           "Shopping"),
    "shopping_mall":        ("Mall",            "Shopping"),
    "supermarket":          ("Supermarket",     "Shopping"),
    "butchers_shop":        ("Other",           "Other"),     # irrelevant

    # ── Workspace ────────────────────────────────────────────────────────────
    "office":               ("Office",          "Workspace"),
    "office_cubicles":      ("Office",          "Workspace"),
    "waiting_room":         ("Waiting Room",    "Workspace"),
    "conference_center":    ("Conference Room", "Workspace"),
    "conference_room":      ("Conference Room", "Workspace"),
    "reception":            ("Reception",       "Workspace"),

    # ── Sports ───────────────────────────────────────────────────────────────
    "gym/indoor":           ("Gym",             "Sports"),
    "basketball_court":     ("Basketball Court","Sports"),
    "tennis_court":         ("Tennis Court",    "Sports"),
    "swimming_pool/indoor": ("Pool",            "Sports"),
    "stadium":              ("Stadium",         "Sports"),
    "soccer_field":         ("Sports Field",    "Sports"),
    "golf_course":          ("Golf Course",     "Sports"),
}

# Labels to suppress entirely from the UI (too noisy / irrelevant)
HIDDEN_LABELS = {
    "slum", "biology_laboratory", "butchers_shop", "nursing_home",
    "phone_booth", "parking_lot", "closet", "storage_room",
    "clean_room", "locker_room",
}


def _clean_raw_label(raw: str) -> str:
    """Normalise raw Places365 label for dict lookup."""
    return raw.strip().lower().replace(" ", "_")


def normalize_scene(raw_label: str | None) -> tuple[str, str, str]:
    """
    Convert a raw Places365 label to (display_name, category, emoji).

    Returns:
        ("Classroom", "Education", "🎓")
        ("Other",     "Other",     "📸")   ← for unknown labels
    """
    if not raw_label:
        return ("Unknown", "Other", "📸")

    key = _clean_raw_label(raw_label)
    entry = _LABEL_MAP.get(key)

    if entry:
        display_name, category = entry
        emoji = CATEGORY_EMOJI.get(category, "📸")
        return (display_name, category, emoji)

    # Fallback: pretty-print raw label as display name
    pretty = raw_label.replace("_", " ").replace("/", " / ").title()
    return (pretty, "Other", "📸")


def is_relevant_scene(raw_label: str | None) -> bool:
    """Return False for labels that should be suppressed from UI."""
    if not raw_label:
        return False
    return _clean_raw_label(raw_label) not in HIDDEN_LABELS


def group_scenes(
    scene_counts: list[dict],
    max_top: int = 12,
) -> dict:
    """
    Accepts a list of {"scene_label": str, "count": int} dicts.
    Returns a normalised structure for UI consumption:

    {
        "top_scenes": [
            {
                "raw_label":    "lecture_room",
                "display_name": "Lecture Room",
                "category":     "Education",
                "emoji":        "🎓",
                "count":        7,
            }, ...
        ],
        "categories": {
            "Education": 12,
            "Outdoor":   8,
            ...
        },
        "total_labelled": 20,
    }

    Only includes relevant labels.  Sorted by count desc, capped at max_top.
    """
    filtered = [
        s for s in scene_counts
        if is_relevant_scene(s.get("scene_label"))
    ]

    enriched = []
    category_totals: dict[str, int] = {}

    for sc in filtered:
        raw   = sc["scene_label"]
        count = sc["count"]
        display, category, emoji = normalize_scene(raw)

        if display == "Other":
            continue          # silently drop generic "Other" entries

        enriched.append({
            "raw_label":    raw,
            "display_name": display,
            "category":     category,
            "emoji":        emoji,
            "count":        count,
        })
        category_totals[category] = category_totals.get(category, 0) + count

    enriched.sort(key=lambda x: x["count"], reverse=True)

    return {
        "top_scenes":     enriched[:max_top],
        "categories":     category_totals,
        "total_labelled": len(enriched),
    }
