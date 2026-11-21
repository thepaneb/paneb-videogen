#!/usr/bin/env python3
"""Converte o workflow UI (com subgraph LTX-2.3 I2V) para API Format com placeholders.
Uso: python scripts/convert_ltx23_ui_to_api.py
Le: backend/workflows/video_ltx2_3_i2v.ui.json
Escreve: backend/workflows/ltx2-i2v.api.json
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "backend" / "workflows" / "video_ltx2_3_i2v.ui.json"
DST = ROOT / "backend" / "workflows" / "ltx2-i2v.api.json"

wf = json.load(open(SRC, encoding="utf-8"))
sg = wf["definitions"]["subgraphs"][0]
links = {l["id"]: l for l in sg["links"]}

# slots 8..12 (modelos: ckpt, loras, upscale, text_encoder) -> mantem o nome
# fixo gravado no widget; o link do subgraph-input e ignorado.
FIXED_SLOTS = {8, 9, 10, 11, 12}
SLOT_ACTION = {
    0: ("image", "{{image}}"),      # first_frame -> via LoadImage dedicado
    1: ("prompt", "{{prompt}}"),    # prompt
    2: ("prompt_enhance", False),   # desliga enhance p/ resultado previsivel
    3: ("width", "{{width}}"),
    4: ("height", "{{height}}"),
    5: ("duration", "{{duration}}"),
    6: ("fps", "{{fps}}"),
    7: ("seed", "{{seed}}"),
    # 8..12: modelos -> mantem fixo (nomes ja gravados nos widgets)
}

api = {}
# No auxiliar: LoadImage que consome o upload da API
api["1000"] = {"class_type": "LoadImage", "inputs": {"image": "{{image}}"}}

def resolve(link_id):
    """Resolve link interno -> [node_id, slot] ou valor placeholder."""
    l = links[link_id]
    if l["origin_id"] == -10:
        slot = l["origin_slot"]
        if slot == 0:
            return ["1000", 0]  # imagem vem do LoadImage auxiliar
        if slot in FIXED_SLOTS:
            return ("__keep__", None)  # usa o valor fixo do widget
        action = SLOT_ACTION.get(slot)
        if action:
            return ("__literal__", action[1])
        raise ValueError(f"slot externo sem mapeamento: {slot}")
    return [str(l["origin_id"]), l["origin_slot"]]

# Nos Reroute precisam ser resolvidos (API nao tem Reroute)
reroute_src = {}
for n in sg["nodes"]:
    if n["type"] == "Reroute":
        for i in n.get("inputs", []) or []:
            if i.get("link") is not None:
                # reroute tem 1 entrada e 1 saida; guarda origem da entrada
                reroute_src[str(n["id"])] = i["link"]
                break

def deref(ref):
    seen = set()
    while isinstance(ref, list) and ref[0] in reroute_src and ref[0] not in seen:
        seen.add(ref[0])
        # a saida do reroute aponta para a origem da entrada dele
        link = links[reroute_src[ref[0]]]
        if link["origin_id"] == -10:
            slot = link["origin_slot"]
            if slot == 0:
                ref = ["1000", 0]
            elif slot in FIXED_SLOTS:
                return ("__keep__", None)
            else:
                ref = ("__literal__", SLOT_ACTION[slot][1])
        else:
            ref = [str(link["origin_id"]), link["origin_slot"]]
    return ref

skipped = []
for n in sg["nodes"]:
    nid = str(n["id"])
    ctype = n["type"]
    if ctype == "Reroute":
        continue  # resolvido via deref
    if ctype == "MarkdownNote":
        continue
    inputs = {}
    wvn = n.get("widgets_values_named") or {}
    # 1) entradas ligadas
    for i in n.get("inputs", []) or []:
        if i.get("link") is None:
            continue
        r = deref(resolve(i["link"]))
        if isinstance(r, tuple) and r[0] == "__keep__":
            # usa o valor fixo do widget (nome do modelo gravado no template)
            w = (i.get("widget") or {}).get("name")
            if w and w in wvn:
                inputs[i["name"]] = wvn[w]
            continue
        if isinstance(r, tuple) and r[0] == "__literal__":
            inputs[i["name"]] = r[1]
        else:
            inputs[i["name"]] = r
    # 2) widgets sem ligacao -> valor fixo (prefere widgets_values_named)
    # mapeia widget name -> input name
    w2i = {}
    for i in n.get("inputs", []) or []:
        w = (i.get("widget") or {}).get("name")
        if w and i.get("link") is None:
            w2i[w] = i["name"]
    for wname, iname in w2i.items():
        if iname in inputs:
            continue
        if wname in wvn:
            inputs[iname] = wvn[wname]
    # fallback: widgets_values em ordem (para nos sem _named)
    if not wvn:
        vals = list(n.get("widgets_values") or [])
        for i in n.get("inputs", []) or []:
            w = (i.get("widget") or {}).get("name")
            if w and i.get("link") is None and vals and i["name"] not in inputs:
                inputs[i["name"]] = vals.pop(0)
    api[nid] = {"class_type": ctype, "inputs": inputs}

# negative prompt -> placeholder (node 313 CLIPTextEncode)
if "313" in api:
    api["313"]["inputs"]["text"] = "{{negative}}"
# knobs expostos no app (valores padrao = os do template oficial)
if "328" in api:
    api["328"]["inputs"]["value"] = "{{promptEnhance}}"   # bool: expansor de prompt do LTX
for _nid in ("282", "314"):
    if _nid in api:
        api[_nid]["inputs"]["cfg"] = "{{cfg}}"            # aderencia ao prompt
if "296" in api:
    api["296"]["inputs"]["strength"] = "{{imgStrength}}" # forca da imagem (estagio final)
if "281" in api:
    api["281"]["inputs"]["sigmas"] = "{{sigmas1}}"       # cronograma do estagio 1 (por preset)
if "306" in api:
    api["306"]["inputs"]["sigmas"] = "{{sigmas2}}"       # cronograma do estagio 2 (por preset)
# SaveVideo externo -> prefixo do job. O VIDEO do subgraph sai do CreateVideo (link 536 -> node 310).
api["75"] = {"class_type": "SaveVideo",
             "inputs": {"video": ["310", 0],
                        "filename_prefix": "{{prefix}}",
                        "format": "auto",
                        "codec": "auto"}}

json.dump(api, open(DST, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"ok: {len(api)} nos -> {DST}")
print("placeholders usados:",
      sorted({v for n in api.values() for v in n["inputs"].values() if isinstance(v, str) and v.startswith('{{')}))
