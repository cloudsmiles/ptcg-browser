#!/usr/bin/env python3
"""Merge cached GraphQL card details with REST set catalogs into multi-language datasets."""
import hashlib
import json
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import build_multilang as bm

CACHE = "/tmp/ptcg-gql-cache"
OUT = bm.OUT_DIR
API_LANG = bm.API_LANG
LANGS = bm.LANGS


def get_json(url, timeout=35):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def load_cached_details(api_lang):
    """Reconstruct query hashes and load any cached responses for this language."""
    try:
        rarities = get_json(f"https://api.tcgdex.net/v2/{api_lang}/rarities")
        stages = get_json(f"https://api.tcgdex.net/v2/{api_lang}/stages")
    except Exception as e:
        print("  metadata error", api_lang, e)
        return {}

    q = bm.QUERY.replace("__LANG__", api_lang)
    qs = bm.QUERY_STAGE.replace("__LANG__", api_lang)
    payloads = []
    for r in rarities:
        for c in ["Trainer", "Energy"]:
            payloads.append({"query": q, "variables": {"r": r, "c": c}})
        for s in stages:
            payloads.append({"query": qs, "variables": {"r": r, "c": c, "s": s}})

    out = {}
    hit = 0
    for p in payloads:
        data = json.dumps(p, sort_keys=True).encode("utf-8")
        path = os.path.join(CACHE, hashlib.sha1(data).hexdigest() + ".json")
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                res = json.load(f)
        except Exception:
            continue
        cards = (res.get("data") or {}).get("cards") or []
        hit += 1
        for c in cards:
            if c.get("id"):
                out[c["id"]] = c
    print(f"  {api_lang}: cached queries {hit}, unique cards {len(out)}")
    return out


def load_set_meta(api_lang):
    sets = get_json(f"https://api.tcgdex.net/v2/{api_lang}/sets")

    def detail(s):
        sid = s.get("id")
        try:
            d = get_json(f"https://api.tcgdex.net/v2/{api_lang}/sets/{sid}")
            serie = d.get("serie") or {}
            return sid, {
                "name": d.get("name") or s.get("name") or sid,
                "series": serie.get("name") if isinstance(serie, dict) else (serie or ""),
                "releaseDate": d.get("releaseDate") or "",
                "logo": d.get("logo") or "",
                "symbol": d.get("symbol") or "",
                "cards": d.get("cards") or [],
            }
        except Exception:
            return sid, {
                "name": s.get("name") or sid, "series": "", "releaseDate": "",
                "logo": "", "symbol": "", "cards": [],
            }

    meta = {}
    with ThreadPoolExecutor(max_workers=16) as ex:
        for fut in as_completed([ex.submit(detail, s) for s in sets]):
            sid, m = fut.result()
            meta[sid] = m
    return meta


def build(lang):
    sources = [API_LANG[lang]] + (["zh-tw"] if lang == "zh" else [])
    details = {}
    for src in sources:
        details.update(load_cached_details(src))

    ja_details = {}
    if lang == "zh":
        ja_details = load_cached_details("ja")
        if not ja_details:
            # fall back to REST brief images for Japanese
            try:
                for sid, m in load_set_meta("ja").items():
                    for c in m["cards"]:
                        if c.get("image"):
                            ja_details[c["id"]] = {"image": c["image"], "localId": c.get("localId"), "set": {"id": sid}}
            except Exception:
                pass

    cards = []
    set_meta_all = {}
    for src in sources:
        metas = load_set_meta(src)
        set_meta_all.update(metas)
        for sid, m in metas.items():
            for brief in m["cards"]:
                cid = brief.get("id")
                if not cid:
                    continue
                full = details.get(cid)
                if not full:
                    full = {
                        "id": cid,
                        "name": brief.get("name"),
                        "localId": brief.get("localId", ""),
                        "image": brief.get("image"),
                        "category": "", "rarity": "", "hp": None, "types": [],
                        "attacks": [], "abilities": [], "weaknesses": [], "resistances": [],
                        "retreat": None, "description": "", "illustrator": "", "dexId": [],
                        "legal": {}, "regulationMark": "", "stage": "", "set": {"id": sid},
                    }
                # fill in image if detail lacks one
                if not full.get("image") and brief.get("image"):
                    full = dict(full)
                    full["image"] = brief["image"]
                cards.append((cid, full, m))

    seen = set()
    unique = []
    for cid, full, m in cards:
        if cid in seen:
            continue
        seen.add(cid)
        # use the set metadata from whichever source produced this card
        card = dict(full)
        card["_meta"] = m
        if not card.get("image") and lang == "zh":
            ja = ja_details.get(cid)
            if ja and ja.get("image"):
                card["image"] = ja["image"]
        unique.append(card)

    compact = []
    for c in unique:
        meta = c["_meta"]
        item = bm.compact_card(c, lang, {}, {})
        item["sn"] = bm.clean_text(meta.get("name") or item["s"], lang)
        item["se"] = bm.clean_text(meta.get("series"), lang)
        item["sd"] = meta.get("releaseDate") or ""
        item["sl"] = meta.get("logo") or ""
        item["ssym"] = meta.get("symbol") or ""
        compact.append(item)

    compact.sort(key=lambda c: (c["sd"], c["s"], c["lid"]))
    set_map = {}
    for c in compact:
        sid = c["s"]
        if sid and sid not in set_map:
            set_map[sid] = {
                "id": sid, "name": c["sn"], "series": c["se"],
                "releaseDate": c["sd"], "logo": c["sl"], "symbol": c["ssym"],
            }
    sets = sorted(set_map.values(), key=lambda s: s["releaseDate"], reverse=True)

    payload = {"label": LANGS[lang], "sets": sets, "cards": compact}
    path = os.path.join(OUT, f"{lang}.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write("window.PTCG_LANG_DATA = window.PTCG_LANG_DATA || {};\n")
        f.write(f"window.PTCG_LANG_DATA['{lang}'] = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"WROTE {lang}: {len(compact)} cards / {len(sets)} sets -> {os.path.getsize(path)//1024} KB")


def cid_of(c):
    return (c.get("set") or {}).get("id", "")


if __name__ == "__main__":
    for lang in ["zh", "ja", "en"]:
        print(f"=== {lang} ===")
        build(lang)
