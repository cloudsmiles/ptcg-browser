#!/usr/bin/env python3
"""Build a compact local dataset for the PTCG browser from PokemonTCG/pokemon-tcg-data."""
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master"
SETS = [
    "base1", "swsh12",
    "sv1", "sv2", "sv3", "sv3pt5", "sv4", "sv4pt5", "sv5", "sv6",
    "sv6pt5", "sv7", "sv8", "sv8pt5", "sv9", "sv10",
    "me1", "me2", "me2pt5", "me3",
]
OUT = "/Users/winniehe/WorkBuddy/2026-11-24-11-59-40/ptcg-browser/data/cards.js"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))


set_meta = {s["id"]: s for s in fetch(f"{BASE}/sets/en.json")}


def load_set(sid):
    cards = fetch(f"{BASE}/cards/en/{sid}.json")
    return sid, cards


compact = []
with ThreadPoolExecutor(max_workers=8) as ex:
    futures = [ex.submit(load_set, sid) for sid in SETS]
    for fut in as_completed(futures):
        sid, cards = fut.result()
        meta = set_meta[sid]
        sm = {
            "id": sid,
            "name": meta["name"],
            "series": meta["series"],
            "releaseDate": meta.get("releaseDate", ""),
            "logo": meta.get("images", {}).get("logo", ""),
            "symbol": meta.get("images", {}).get("symbol", ""),
        }
        for c in cards:
            price = None
            try:
                variants = c.get("tcgplayer", {}).get("prices", {})
                for v in variants.values():
                    if v and v.get("market"):
                        price = v["market"]
                        break
            except Exception:
                pass
            item = {
                "id": c.get("id"),
                "n": c.get("name"),
                "st": c.get("supertype"),
                "sub": c.get("subtypes", []),
                "hp": c.get("hp", ""),
                "ty": c.get("types", []),
                "r": c.get("rarity", ""),
                "no": c.get("number", ""),
                "art": c.get("artist", ""),
                "ft": c.get("flavorText", ""),
                "dex": c.get("nationalPokedexNumbers", []),
                "reg": c.get("regulationMark", ""),
                "std": c.get("legalities", {}).get("standard", ""),
                "weak": c.get("weaknesses", []),
                "res": c.get("resistances", []),
                "rc": c.get("retreatCost", []),
                "atk": [
                    {
                        "n": a.get("name", ""),
                        "c": a.get("cost", []),
                        "d": a.get("damage", ""),
                        "t": a.get("text", ""),
                    }
                    for a in c.get("attacks", [])
                ],
                "abi": [
                    {"n": a.get("name", ""), "t": a.get("type", ""), "x": a.get("text", "")}
                    for a in c.get("abilities", [])
                ],
                "evoF": c.get("evolvesFrom", ""),
                "evoT": c.get("evolvesTo", []),
                "rules": c.get("rules", []),
                "img": c.get("images", {}),
                "set": sm,
                "price": price,
            }
            compact.append(item)

compact.sort(key=lambda x: (x["set"]["releaseDate"], x["id"]))

sets_out = [
    {
        "id": s["id"],
        "name": s["name"],
        "series": s["series"],
        "releaseDate": s.get("releaseDate", ""),
        "logo": s.get("images", {}).get("logo", ""),
        "symbol": s.get("images", {}).get("symbol", ""),
    }
    for s in set_meta.values()
    if s["id"] in SETS
]
sets_out.sort(key=lambda s: s["releaseDate"], reverse=True)

payload = {"updated": "2026-11-24", "sets": sets_out, "cards": compact}
with open(OUT, "w", encoding="utf-8") as f:
    f.write("window.PTCG_DATA = ")
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

print(f"Wrote {len(compact)} cards from {len(sets_out)} sets -> {OUT}")
