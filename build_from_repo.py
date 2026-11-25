#!/usr/bin/env python3
"""Generate final multi-language datasets from parsed TCGdex repository JSON."""
import json
import os
import re

import opencc

OUT_DIR = "/Users/winniehe/WorkBuddy/2026-11-24-11-59-40/ptcg-browser/data"
EN = json.load(open("/tmp/ptcg-repo-en.json", encoding="utf-8"))
ASIA = json.load(open("/tmp/ptcg-repo-asia.json", encoding="utf-8"))
CONV = opencc.OpenCC("t2s")

# Verified fast image URLs from the previous English dataset
old_path = os.path.join(OUT_DIR, "cards.js")
old_images = {}
if os.path.exists(old_path):
    raw = open(old_path, encoding="utf-8").read()
    raw = raw[len("window.PTCG_DATA = "):].strip().rstrip(";")
    try:
        old = json.loads(raw)
        for c in old["cards"]:
            old_images[c["id"]] = c["images"]
    except Exception:
        pass


def clean(s, zh=False):
    if s is None:
        return ""
    s = re.sub(r"\s+", " ", str(s)).strip()
    return CONV.convert(s) if zh else s


def has_localized(v, langs):
    return isinstance(v, dict) and any(v.get(l) for l in langs)


def loc(v, langs, zh=False):
    if v is None:
        return ""
    if isinstance(v, dict):
        for l in langs:
            if v.get(l):
                return clean(v[l], zh)
        for val in v.values():
            if val:
                return clean(val, zh)
        return ""
    return clean(v, zh)


def norm_num(lid):
    return str(int(lid)) if lid.isdigit() else lid


def en_set_id(sid):
    """Normalize TCGdex set ids to the official pokemontcg.io CDN naming."""
    # sv03pt5 / sv04pt5 / sv06pt5 -> sv3pt5 / sv4pt5 / sv6pt5
    m = re.match(r"^(sv|swsh)(\d+)pt(\d+)$", sid, re.I)
    if m:
        return m.group(1) + str(int(m.group(2))) + "pt" + m.group(3)
    # me03 -> me3, me02pt5 -> me2pt5
    m = re.match(r"^me(\d+)(pt\d+)?$", sid, re.I)
    if m:
        return "me" + str(int(m.group(1))) + (m.group(2) or "")
    return sid.replace(".5", "pt5")


def image_urls(card, lang, serie_id, set_id, lid):
    if lang == "en":
        for key in (set_id + "-" + lid, set_id + "-" + norm_num(lid)):
            if key in old_images:
                imgs = old_images[key]
                return imgs.get("small") or imgs.get("large") or "", imgs.get("large") or imgs.get("small") or ""
        sid = en_set_id(set_id)
        fast = f"https://images.pokemontcg.io/{sid}/{norm_num(lid)}.png"
        return fast, fast
    # TCGdex image CDN has no zh-cn prefix; Chinese cards live under zh-tw.
    # (Simplified text is preserved from the card data, only images use zh-tw.)
    img_lang = "zh-tw" if lang == "zh-cn" else lang
    base = f"https://assets.tcgdex.net/{img_lang}/{serie_id}/{set_id}/{lid}"
    low = base + "/low.webp"
    return low, low


def build(lang):
    zh = lang == "zh"
    source = EN if lang == "en" else ASIA
    langs = ["en"] if lang == "en" else (["zh-cn", "zh-tw"] if zh else ["ja"])
    api_lang = "zh-cn" if zh else lang
    img_lang = "zh-tw" if zh else lang
    series_by_id = {}
    for s in (source.get("series") or {}).values():
        if s and s.get("id"):
            series_by_id[s["id"]] = s

    cards = []
    for c in source["cards"]:
        sid = c.get("_setId")
        set_obj = source["sets"].get(sid) or {}
        if not has_localized(c.get("name"), langs):
            continue
        name = loc(c.get("name"), langs, zh)
        if not name:
            continue
        serie_id = c.get("_serieId") or set_obj.get("_serieId") or ""
        serie_obj = series_by_id.get(serie_id) or {}
        lid = c.get("_localId", "")
        small, large = image_urls(c, api_lang, serie_id, sid, lid)
        rd = set_obj.get("releaseDate") or ""
        if isinstance(rd, dict):
            rd = loc(rd, langs, zh)

        def wr(w):
            if not isinstance(w, dict):
                return {"t": "", "v": ""}
            return {"t": loc(w.get("type"), langs, zh), "v": loc(w.get("value"), langs, zh)}

        atks = []
        for a in c.get("attacks") or []:
            atks.append({
                "n": loc(a.get("name"), langs, zh),
                "c": a.get("cost") or [],
                "d": loc(a.get("damage"), langs, zh),
                "t": loc(a.get("effect"), langs, zh),
            })
        abis = []
        for a in c.get("abilities") or []:
            abis.append({
                "n": loc(a.get("name"), langs, zh),
                "y": loc(a.get("type"), langs, zh),
                "t": loc(a.get("effect"), langs, zh),
            })
        reg = clean(c.get("regulationMark"), zh)
        cards.append({
            "id": f"{sid}-{lid}",
            "n": name,
            "lid": lid,
            "st": loc(c.get("category"), langs, zh),
            "sub": loc(c.get("stage"), langs, zh),
            "hp": str(c.get("hp") or ""),
            "ty": c.get("types") or [],
            "r": loc(c.get("rarity"), langs, zh),
            "art": clean(c.get("illustrator"), zh),
            "ft": loc(c.get("description"), langs, zh),
            "dex": c.get("dexId") or [],
            "reg": reg,
            "std": "Legal" if reg in ("G", "H", "I", "J") else "",
            "weak": [wr(w) for w in (c.get("weaknesses") or [])],
            "res": [wr(w) for w in (c.get("resistances") or [])],
            "rc": c.get("retreat") or 0,
            "atk": atks,
            "abi": abis,
            "evoF": loc(c.get("evolveFrom"), langs, zh),
            "s": sid,
            "sn": loc(set_obj.get("name"), langs, zh) or sid,
            "se": loc(serie_obj.get("name"), langs, zh),
            "sd": rd,
            "sl": f"https://assets.tcgdex.net/{img_lang}/{serie_id}/{sid}/logo",
            "ssym": f"https://assets.tcgdex.net/{img_lang}/{serie_id}/{sid}/symbol",
            "img": small,
            "big": large,
        })

    cards.sort(key=lambda x: (x["sd"], x["s"], x["lid"]))
    set_map = {}
    for c in cards:
        sid = c["s"]
        if sid and sid not in set_map:
            set_map[sid] = {
                "id": sid, "name": c["sn"], "series": c["se"],
                "releaseDate": c["sd"], "logo": c["sl"], "symbol": c["ssym"],
            }
    sets = sorted(set_map.values(), key=lambda s: s["releaseDate"], reverse=True)
    payload = {
        "label": {"en": "美版 English", "ja": "日版 日本語", "zh": "简中 简体中文"}[lang],
        "sets": sets,
        "cards": cards,
    }
    path = os.path.join(OUT_DIR, f"{lang}.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write("window.PTCG_LANG_DATA = window.PTCG_LANG_DATA || {};\n")
        f.write(f"window.PTCG_LANG_DATA['{lang}'] = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"WROTE {lang}: {len(cards)} cards / {len(sets)} sets -> {os.path.getsize(path)//1024} KB")


if __name__ == "__main__":
    for lang in ["zh", "ja", "en"]:
        build(lang)
