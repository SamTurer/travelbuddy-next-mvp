#!/usr/bin/env python3
"""
Consolidate vibe_tags and energy_tags in nyc-places.json to ~20 each
"""
import json
import sys

# Top 20 consolidated vibe tags (semantic grouping)
VIBE_TAG_MAPPING = {
    # Keep these core tags
    "classic": ["classic", "NYC classic", "NYC icon", "heritage NYC", "NYC legend", "NYC-famous", "iconic smoked fish"],
    "local": ["local", "local favorite", "neighborhood favorite", "neighborhood staple", "neighborhood gem", "neighborhood cozy", "neighborhood reliable", "neighborhood regulars"],
    "cafe": ["café", "coffee", "espresso bar", "espresso in miniature cups", "flat whites", "European café", "Australian café", "Aussie café", "French café", "cute French café", "Paris café fantasy", "Parisian tea salon", "Malaysian café"],
    "bakery": ["bakery", "modern bakery", "neighborhood bake shop", "artisanal donut shop", "Scandi bakery", "grain-obsessed bakery", "heritage wheat energy", "sourdough-forward", "precision pastry", "laminated dough temple", "laminated dough obsession", "old-school bakery", "Taiwanese-American bakery", "Filipino American bakery", "Mexican-Jewish bakery", "Caribbean bakery", "Bahraini-owned bakery"],
    "bar": ["bar", "cocktails", "drinks", "night", "aperitivo-adjacent", "speakeasy"],
    "dinner": ["dinner", "date night", "chef-driven", "chef-y plating", "modern Mexican fine dining", "family-style", "fine-dining"],
    "breakfast": ["breakfast", "brunch", "morning", "comfort brunch", "legendary pancakes", "thick pancakes", "challah French toast", "better-for-you brunch", "Brooklyn brunch classic"],
    "shop": ["shop", "browse", "design", "shopping", "boutique"],
    "sightseeing": ["sightseeing", "photo ops", "views", "landmark", "tourist-meets-local"],
    "art": ["art", "culture", "gallery", "inspiration", "museum", "pastry-as-art"],
    "walk": ["walk", "walkable", "outdoors", "green space", "park"],
    "food-hall": ["food hall", "market", "wander-and-graze", "busy market energy"],
    "quick-bite": ["fast", "quick recharge", "midday fuel", "walk-up", "grab-and-go", "portable", "street food energy", "24-hour snack vibe", "NYC to-go"],
    "comfort": ["comfort", "cozy", "family warmth", "family-friendly Tribeca brunch", "Southern comfort", "home-baked", "warm counter"],
    "sweet": ["sweet-treat", "dessert case", "cookie temple", "house-baked cookies", "Belle-Époque dessert cart", "cream cheese frosting mountain", "hot chocolate ritual"],
    "deli": ["deli", "bagel counter", "bagel drop", "Jewish appetizing landmark", "old-school lox case", "Jamaican beef patty stand"],
    "matcha": ["matcha", "tea bar", "tea house", "Taiwanese tea house"],
    "specialty": ["local specialty", "only-in-NYC", "cult following", "cult preorders", "limited batches", "micro-batch", "small-batch pastry"],
    "modern": ["modern café", "modern pastry lab", "futurist French", "glow-in-the-dark pastry lab", "croissant experiments"],
    "authentic": ["family-run", "Harlem icon", "Palestinian restaurant", "Cantonese dim sum", "dumpling-focused", "old-school Chinese bakery", "Southern + global soul food"]
}

# Top 20 consolidated energy tags (atmosphere/vibe)
ENERGY_TAG_MAPPING = {
    "quiet": ["quiet", "calm", "soft-volume", "gentle conversation", "low volume", "soft-spoken", "quiet focus", "quiet admiration"],
    "cozy": ["cozy", "intimate", "warm", "homey", "comfort-food cozy", "soft lighting", "low lighting", "warm wood tones", "warm staff"],
    "lively": ["lively", "bustling", "busy", "buzzy", "chatty", "chattery", "lively tables", "lively dining room", "lively but not chaotic", "pleasant hum", "soft buzz"],
    "crowded": ["crowded", "packed", "high foot traffic", "busy brunch hours", "busy weekend mornings", "busy counter", "line out the door", "lines", "line-y", "line culture", "cash line", "comfortably chaotic brunch rush", "tightly packed", "tight space"],
    "social": ["social", "friendly", "welcoming", "community energy", "friendly service", "friendly counter", "family tables", "sit-and-chat"],
    "dimly-lit": ["dimly lit", "night-out", "night-out energy", "date-y", "romantic"],
    "relaxed": ["relaxed", "unhurried", "idle-paced", "laid-back", "low-key", "chill", "slow pace", "slow enjoyment", "slow afternoon", "gentle morning pace", "camp-out-with-a-book"],
    "touristy": ["touristy", "wallet-danger", "touristy energy", "refined tourist energy", "celebratory", "special occasion", "treat-yourself", "treat as event"],
    "fast-paced": ["fast", "rushy", "fast turnover", "fast-moving", "efficient", "on-the-go", "grab-and-go", "quick bite", "counter service", "counter-service", "take-a-number"],
    "aesthetic": ["aesthetic", "Instagram latte art", "flower-wall energy", "blue-and-white branding", "social media hype", "loud visuals", "polished"],
    "casual": ["casual", "no-frills", "straightforward", "informal", "walk-in", "walk-up window", "drop-by", "slightly gruff"],
    "local": ["local", "neighborhood-y", "local regulars", "neighborhood loyalists", "neighborhood slow burn", "writer hangout", "grad student energy"],
    "solo-friendly": ["solo-friendly", "lingering laptops", "coffee date", "order-and-relax", "coffee-sip calm", "weekday coffee break"],
    "family-friendly": ["family-friendly", "family tables", "stroller energy", "welcoming"],
    "bustling": ["midday bustle", "mild bustle", "AM foot traffic", "morning rush", "morning line", "Brooklyn buzz", "busy brunch hours"],
    "calm-indoors": ["indoors", "calm indoors", "reflective", "ritual-y", "soft chatter", "light chatter", "low hum"],
    "outdoors": ["outdoors", "open air", "open space", "fresh air", "street-adjacent", "active", "people-watching"],
    "hyped": ["hyped", "high anticipation", "DM-to-order", "DM-to-get-it energy", "limited runs", "limited batches", "small batch"],
    "elegant": ["elegant", "polished", "refined", "delicate", "decadent", "soft music", "soft pop playlist"],
    "energetic": ["loud", "rowdy brunch crowd", "night-out", "late-night", "late-night weirdos", "sugar rush"]
}

def consolidate_tags(tags, mapping):
    """Map old tags to new consolidated tags"""
    if not tags:
        return []

    new_tags = set()
    for tag in tags:
        found = False
        for new_tag, old_tags in mapping.items():
            if tag in old_tags:
                new_tags.add(new_tag)
                found = True
                break
        # If not found in mapping, keep original if it's in the top-level keys
        if not found and tag in mapping.keys():
            new_tags.add(tag)

    return sorted(list(new_tags))

def main():
    input_file = "/Users/samturer/Downloads/travelbuddy-next-mvp/data/nyc-places.json"
    output_file = "/Users/samturer/Downloads/travelbuddy-next-mvp/data/nyc-places.json"

    # Read the JSON
    with open(input_file, 'r') as f:
        places = json.load(f)

    # Process each place
    updated_count = 0
    for place in places:
        old_vibe = place.get('vibe_tags', [])
        old_energy = place.get('energy_tags', [])

        new_vibe = consolidate_tags(old_vibe, VIBE_TAG_MAPPING)
        new_energy = consolidate_tags(old_energy, ENERGY_TAG_MAPPING)

        if new_vibe != old_vibe or new_energy != old_energy:
            updated_count += 1

        place['vibe_tags'] = new_vibe
        place['energy_tags'] = new_energy

    # Write back
    with open(output_file, 'w') as f:
        json.dump(places, f, indent=2, ensure_ascii=False)

    print(f"✓ Updated {updated_count} places")
    print(f"✓ Consolidated to {len(VIBE_TAG_MAPPING)} vibe_tags and {len(ENERGY_TAG_MAPPING)} energy_tags")

    # Show the new tag lists
    print("\nNew vibe_tags:")
    for i, tag in enumerate(sorted(VIBE_TAG_MAPPING.keys()), 1):
        print(f"  {i}. {tag}")

    print("\nNew energy_tags:")
    for i, tag in enumerate(sorted(ENERGY_TAG_MAPPING.keys()), 1):
        print(f"  {i}. {tag}")

if __name__ == '__main__':
    main()
