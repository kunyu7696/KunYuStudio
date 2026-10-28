#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract-ai-reference.py
========================
Reproducible builder for resources/ai-reference (M7 active path).

Source : resources/ai-reference-source/KunYuEcosystem_AI_Reference.pdf
Output : resources/ai-reference/
           - templates/fabric/1.20.1/**            (35 files verbatim from PDF
                                                    + 6 reconstructed scaffold
                                                    files = 41 active templates)
           - manifest.json                         (machine readable index)
           - system_prompt_base.md                 (v3.0 skeleton)

The PDF's Chinese annotations have no ToUnicode mapping and are unrecoverable;
code bodies (ASCII) are extracted verbatim. Empty comment lines left behind by
the missing glyphs are removed; every extracted file receives an English
provenance banner. 6 project scaffold files (README/build.gradle/
settings.gradle are embedded; the other 6 project files are not) are
reconstructed from the file list and version table in project/README.md and
are flagged provenance="scaffold" in manifest.json.

Requires: pypdf   (pip install pypdf)
Run     : python scripts/extract-ai-reference.py
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
PDF_PATH = ROOT / "resources" / "ai-reference-source" / "KunYuEcosystem_AI_Reference.pdf"
OUT_DIR = ROOT / "resources" / "ai-reference"
TEMPLATES_DIR = OUT_DIR / "templates" / "fabric" / "1.20.1"
DATA_DIR = SCRIPT_DIR / "ai-reference-data"
SCAFFOLD_DIR = SCRIPT_DIR / "ai-reference-scaffold"

TARGET_LOADER = "fabric"
TARGET_VERSION = "1.20.1"

# Section anchors inside the PDF code appendix (exact standalone first lines).
SECTION_START = "Fabric 1.20.1"
SECTION_END = "Fabric 1.20.4"
APPENDIX_FIRST_PAGE_INDEX = 15  # PDF page 16 ("... code appendix") = index 15

HEADER_RE = re.compile(
    r"^(advancement|block|command|enchantment|entity|gui|item|mixin|project|recipe|tag|worldgen)"
    r"/([A-Za-z0-9][A-Za-z0-9._-]*)$"
)

# Chinese/English keyword vocabulary for content type detection (PDF p433 table
# plus the filename vocabulary used across the appendix).
TYPE_KEYWORDS: dict[str, list[str]] = {
    "advancement": ["advancement", "advancements", "进度", "成就", "criteria", "trigger"],
    "block": ["block", "blocks", "方块", "blockstate", "block state", "方块状态",
              "loot table", "掉落物", "block entity", "方块实体"],
    "command": ["command", "commands", "指令", "命令", "brigadier"],
    "enchantment": ["enchantment", "enchantments", "附魔", "enchant"],
    "entity": ["entity", "entities", "实体", "生物", "mob", "attribute", "属性",
               "renderer", "渲染", "spawn egg", "刷怪蛋"],
    "gui": ["gui", "screen", "screens", "界面", "屏幕", "菜单", "menu", "handled screen"],
    "item": ["item", "items", "物品", "工具", "tool", "盔甲", "armor", "食物", "food"],
    "mixin": ["mixin", "mixins", "混入", "注入", "inject", "injector", "bytecode", "字节码"],
    "project": ["project", "工程", "项目骨架", "build.gradle", "settings.gradle",
                "gradle.properties", "fabric.mod.json", "entrypoint", "入口", "loom",
                "loader", "构建配置"],
    "recipe": ["recipe", "recipes", "配方", "合成", "shaped", "有序合成", "shapeless",
               "无序合成", "smelting", "熔炼", "smithing", "锻造", "stonecutting", "切石"],
    "tag": ["tag", "tags", "标签"],
    "worldgen": ["worldgen", "世界生成", "biome", "biomes", "群系", "生物群系",
                 "ore", "矿石", "feature", "地物", "placed feature"],
}

# Expected distribution of the 41 active templates (PDF p438).
EXPECTED_DISTRIBUTION = {
    "advancement": 1, "block": 5, "command": 1, "enchantment": 1, "entity": 4,
    "gui": 2, "item": 5, "mixin": 3, "project": 9, "recipe": 5, "tag": 3, "worldgen": 2,
}
EXPECTED_PDF_COUNT = 35  # files physically embedded for fabric/1.20.1
EXPECTED_TOTAL = 41

# 16 registered-but-inactive combos (counts from PDF p439, fingerprints p445-446).
INACTIVE_COMBOS = [
    ("fabric", "1.16.5", "0.19.5", "yarn", 8, "high", 1, "legacy, project-only"),
    ("fabric", "1.18.2", "0.19.5", "yarn", 17, "medium", 12, "not yet adapted for M7"),
    ("fabric", "1.19.2", "0.19.5", "yarn", 17, "medium", 12, "not yet adapted for M7"),
    ("fabric", "1.20.4", "0.19.5", "yarn", 17, "medium", 12, "not yet adapted for M7"),
    ("fabric", "1.20.6", "0.19.5", "yarn", 21, "medium", 12, "not yet adapted for M7"),
    ("fabric", "1.21.1", "0.19.5", "yarn", 21, "medium", 12, "not yet adapted for M7"),
    ("forge", "1.16.5", "36.2.42", "mojang_official", 8, "high", 2, "legacy, project-only"),
    ("forge", "1.18.2", "40.2.0", "mojang_official", 17, "medium", 12, "not yet adapted for M7"),
    ("forge", "1.19.2", "43.4.0", "mojang_official", 17, "medium", 11, "not yet adapted for M7"),
    ("forge", "1.20.1", "47.4.23", "mojang_official", 17, "low", 12, "not yet adapted for M7"),
    ("forge", "1.20.4", "45.0.66", "mojang_official", 17, "medium", 12, "not yet adapted for M7"),
    ("forge", "1.21.1", "51.0.98", "mojang_official", 21, "medium", 12, "not yet adapted for M7"),
    ("neoforge", "1.20.4", "20.4.240", "mojang_official", 17, "medium", 12, "not yet adapted for M7"),
    ("neoforge", "1.20.6", "20.6.132", "mojang_official", 21, "medium", 12, "not yet adapted for M7"),
    ("neoforge", "1.21.1", "21.1.250", "mojang_official", 21, "medium", 12, "not yet adapted for M7"),
    ("neoforge", "1.21.3", "21.3.0-beta", "mojang_official", 21, "high", 1, "transition version, diff only"),
]

# Scaffold files reconstructed from project/README.md's manifest (flat naming
# used by the appendix "project" category).
SCAFFOLD_FILES = [
    ("gradle.properties", "gradle.properties"),
    ("LICENSE", "LICENSE"),
    ("fabric.mod.json", "fabric.mod.json"),
    ("ModMain.java", "ModMain.java"),
    ("ModClient.java", "ModClient.java"),
    ("ModServer.java", "ModServer.java"),
]


def fail(msg: str) -> None:
    print(f"[extract] FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def find_anchor(pages, anchor: str, after_page: int) -> int:
    """Return page index whose text contains a standalone `anchor` line directly
    followed by a template file header (section boundaries do not align with
    page boundaries in this PDF)."""
    for i in range(after_page, len(pages)):
        lines = (pages[i].extract_text() or "").replace("\x00", "").splitlines()
        for j, line in enumerate(lines):
            if line.strip() != anchor:
                continue
            nxt = next((l.strip() for l in lines[j + 1:] if l.strip()), "")
            if HEADER_RE.match(nxt):
                return i
    return -1


def extract_section_text() -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        fail("pypdf is required: pip install pypdf")

    reader = PdfReader(str(PDF_PATH))
    pages = reader.pages
    start_idx = find_anchor(pages, SECTION_START, APPENDIX_FIRST_PAGE_INDEX)
    end_idx = find_anchor(pages, SECTION_END, start_idx + 1) if start_idx != -1 else -1
    if start_idx == -1 or end_idx == -1:
        fail(f"section anchors not found (start={start_idx}, end={end_idx})")

    chunks: list[str] = []
    for i in range(start_idx, end_idx + 1):
        chunks.append((pages[i].extract_text() or "").replace("\x00", ""))
    text = "\n".join(chunks)

    # Slice exactly between the two anchors (they may sit mid-page).
    start_lines = (pages[start_idx].extract_text() or "").replace("\x00", "").splitlines()
    prefix_anchor_line = next(
        (j for j, line in enumerate(start_lines)
         if line.strip() == SECTION_START
         and HEADER_RE.match(next((l.strip() for l in start_lines[j + 1:] if l.strip()), ""))),
        -1,
    )
    prefix_text = "\n".join(start_lines[:prefix_anchor_line])
    start_cut = len(prefix_text) + (1 if prefix_text else 0)
    text = text[start_cut:]

    end_pos = text.find(f"{SECTION_END}\n")
    if end_pos == -1:
        fail("end anchor missing in concatenated text")
    # Drop the section title line at the top.
    title_pos = text.find(f"{SECTION_START}\n")
    return text[title_pos + len(SECTION_START) + 1:end_pos]


def is_empty_comment_line(line: str, ext: str) -> bool:
    s = line.strip()
    if ext in (".java", ".json", ".gradle"):
        return s == "//"
    if ext == ".properties":
        return s == "#"
    if ext == ".md":
        return s in ("<!--", "-->")
    return False


def clean_file(lines: list[str], filename: str) -> str:
    ext = Path(filename).suffix.lower()
    cleaned: list[str] = []
    for raw in lines:
        line = raw.rstrip()
        if is_empty_comment_line(line, ext):
            continue
        cleaned.append(line)
    while cleaned and not cleaned[0].strip():
        cleaned.pop(0)
    while cleaned and not cleaned[-1].strip():
        cleaned.pop()
    collapsed: list[str] = []
    blank_run = 0
    for line in cleaned:
        if not line.strip():
            blank_run += 1
            if blank_run >= 2:
                continue
        else:
            blank_run = 0
        collapsed.append(line)
    if not any(l.strip() for l in collapsed):
        fail(f"template {filename} extracted empty")
    return "\n".join(collapsed) + "\n"


def banner(rel_path: str) -> dict[str, str]:
    n = rel_path.name
    ext = rel_path.suffix.lower()
    line = (f"KunYuEcosystem AI Reference v3.0 | fabric/1.20.1/{rel_path.as_posix()} "
            f"| mapping: Yarn | provenance: extracted verbatim from source PDF; "
            f"Chinese annotations unrecoverable (no ToUnicode)")
    if ext in (".java", ".json", ".gradle"):
        return {"prefix": "// ============================================================================\n"
                          f"// {line}\n"
                          "// ============================================================================\n"}
    if ext == ".properties":
        return {"prefix": f"# {line}\n"}
    if ext == ".md":
        return {"prefix": f"[//]: # ({line})\n\n"}
    return {"prefix": ""}


def split_templates(section_text: str) -> dict[str, str]:
    files: dict[str, list[str]] = {}
    current: str | None = None
    for line in section_text.splitlines():
        m = HEADER_RE.match(line.strip())
        if m:
            current = f"{m.group(1)}/{m.group(2)}"
            files.setdefault(current, [])
            continue
        if current is not None:
            files[current].append(line)
    if not files:
        fail("no template headers parsed from section")
    return {name: clean_file(lines, name) for name, lines in files.items()}


def build_template_entry(rel: str, provenance: str) -> dict:
    parts = Path(rel).parts  # ('block', 'simple_block.java')
    content_type = parts[0]
    filename = Path(rel).name
    stem = Path(rel).stem
    keywords = list(TYPE_KEYWORDS.get(content_type, []))
    for token in re.findall(r"[a-z]+", stem.lower()):
        if token not in keywords and len(token) > 1:
            keywords.append(token)
    return {
        "id": f"{TARGET_LOADER}-{TARGET_VERSION}-{rel.replace('/', '-')}",
        "loader": TARGET_LOADER,
        "version": TARGET_VERSION,
        "type": content_type,
        "file": f"templates/{TARGET_LOADER}/{TARGET_VERSION}/{rel.replace(chr(92), '/')}",
        "filename": filename,
        "contentTypes": [content_type],
        "keywords": keywords,
        "appliesTo": {"loaders": [TARGET_LOADER], "mcVersions": [TARGET_VERSION]},
        "verified": None,
        "verifiedAt": None,
        "build": "pending",
        "active": True,
        "provenance": provenance,
    }


def load_json(name: str) -> list:
    with open(DATA_DIR / name, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        fail(f"{name} must be a JSON array")
    return data


def main() -> None:
    if not PDF_PATH.exists():
        fail(f"source PDF missing: {PDF_PATH}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Extract the 35 verbatim templates.
    section = extract_section_text()
    extracted = split_templates(section)

    pdf_distribution: dict[str, int] = {}
    for rel in extracted:
        pdf_distribution[rel.split("/", 1)[0]] = pdf_distribution.get(rel.split("/", 1)[0], 0) + 1
    if len(extracted) != EXPECTED_PDF_COUNT:
        fail(f"expected {EXPECTED_PDF_COUNT} embedded files, got {len(extracted)}: "
             f"{sorted(extracted)}")

    # 2. Reset generated tree and write extracted files.
    if TEMPLATES_DIR.exists():
        shutil.rmtree(TEMPLATES_DIR)
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

    entries: list[dict] = []
    for rel, content in sorted(extracted.items()):
        target = TEMPLATES_DIR / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(banner(Path(rel))["prefix"] + content, encoding="utf-8")
        entries.append(build_template_entry(rel, "pdf"))

    # 3. Copy the 6 reconstructed scaffold files into the project/ category.
    for src_name, dst_name in SCAFFOLD_FILES:
        src = SCAFFOLD_DIR / src_name
        if not src.exists():
            fail(f"scaffold source missing: {src}")
        dst = TEMPLATES_DIR / "project" / dst_name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        entries.append(build_template_entry(f"project/{dst_name}", "scaffold"))

    # 4. Assertions: 41 files, distribution matches PDF p438.
    on_disk = [p for p in TEMPLATES_DIR.rglob("*") if p.is_file()]
    if len(on_disk) != EXPECTED_TOTAL:
        fail(f"on-disk template count {len(on_disk)} != {EXPECTED_TOTAL}")
    dist: dict[str, int] = {}
    for p in on_disk:
        t = p.relative_to(TEMPLATES_DIR).parts[0]
        dist[t] = dist.get(t, 0) + 1
    if dist != EXPECTED_DISTRIBUTION:
        fail(f"distribution mismatch:\n  got      {dist}\n  expected {EXPECTED_DISTRIBUTION}")

    # 5. Authored reference data.
    error_patterns = load_json("error-patterns.json")
    api_index = load_json("api-index.json")
    if len(error_patterns) < 20:
        fail(f"error-patterns.json has {len(error_patterns)} entries, expected >= 20")
    if len(api_index) < 20:
        fail(f"api-index.json has {len(api_index)} entries, expected >= 20")

    shutil.copyfile(DATA_DIR / "system_prompt_base.md", OUT_DIR / "system_prompt_base.md")

    # 6. Inactive combos + fingerprint seeds.
    registered_inactive = []
    fingerprints = []
    inactive_template_total = 0
    for loader, version, loader_ver, mapping, jdk, risk, count, note in INACTIVE_COMBOS:
        inactive_template_total += count
        registered_inactive.append({
            "loader": loader, "version": version, "templateCount": count,
            "active": False, "note": note,
        })
        fingerprints.append({
            "id": f"{loader}-{version}", "loader": loader, "mcVersion": version,
            "loaderVersion": loader_ver, "mapping": mapping, "jdk": jdk,
            "health": "unknown", "verifiedAt": None, "driftRisk": risk, "note": note,
        })
    # Active combo (PDF p445 row + README environment pin).
    fingerprints.insert(0, {
        "id": "fabric-1.20.1", "loader": "fabric", "mcVersion": "1.20.1",
        "loaderVersion": "0.19.5", "mapping": "yarn", "jdk": 17,
        "health": "unknown", "verifiedAt": None, "driftRisk": "low",
        "note": "M7 active path; Fabric loader rolling releases require periodic re-probe",
        "templatePin": {
            "loaderVersion": "0.16.9", "yarnMappings": "1.20.1+build.10",
            "fabricApi": "0.83.0+1.20.1", "loom": "1.6-SNAPSHOT", "gradle": "8.6",
        },
    })

    # 7. Assemble manifest. Stats are computed, never hand-typed.
    provenance_counts = {"pdf": 0, "scaffold": 0}
    for e in entries:
        provenance_counts[e["provenance"]] += 1

    manifest = {
        "manifestVersion": "3.1.0",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": "KunYuEcosystem anti-hallucination AI reference package (M7 active: fabric/1.20.1)",
        "scopeControl": {
            "m7ActiveVersions": [{"loader": TARGET_LOADER, "version": TARGET_VERSION}],
            "registeredButInactive": registered_inactive,
            "rule": "Search and context injection MUST only return templates whose "
                    "loader/version is listed in m7ActiveVersions. Inactive combos are "
                    "registered for drift monitoring only.",
        },
        "mappingTypes": {
            "fabric": {
                "type": "yarn",
                "identifierClass": "net.minecraft.util.Identifier",
                "registryClass": "net.minecraft.registry.Registries",
                "description": "Fabric uses Yarn mappings (e.g. Identifier, Registries).",
            },
            "forge": {
                "type": "mojang_official",
                "identifierClass": "net.minecraft.resources.ResourceLocation",
                "registryClass": "net.minecraftforge.registries.ForgeRegistries",
                "description": "Forge uses official Mojang mappings (e.g. ResourceLocation).",
            },
            "neoforge": {
                "type": "mojang_official",
                "identifierClass": "net.minecraft.resources.ResourceLocation",
                "registryClass": "net.neoforged.neoforge.registries.DeferredRegister",
                "description": "NeoForge uses official Mojang mappings with DeferredRegister.",
            },
        },
        "versionFingerprints": fingerprints,
        "templates": entries,
        "errorPatterns": error_patterns,
        "apiIndex": api_index,
        "stats": {
            "templateCount": len(entries),
            "activeTemplateCount": len(entries),
            "inactiveComboCount": len(registered_inactive),
            "inactiveRegisteredTemplateCount": inactive_template_total,
            "errorPatternCount": len(error_patterns),
            "apiIndexCount": len(api_index),
            "contentTypes": len(dist),
            "provenance": provenance_counts,
            "vendorClaims": {
                "document": "KunYuEcosystem AI Reference v3.0",
                "claimedTemplateFiles": 243,
                "claimedActiveTemplates": 41,
                "claimedInactiveTemplates": 202,
                "claimedErrorPatterns": 50,
                "claimedApiIndex": 40,
                "note": "The source PDF's code appendix physically embeds 35 files for "
                        "fabric/1.20.1; 6 project scaffold files listed in project/README.md "
                        "are reconstructed (provenance=scaffold), yielding the claimed 41 "
                        "active templates. errorPatterns/apiIndex counts reflect entries "
                        "actually authored and shipped, not the document's targets.",
            },
        },
    }

    # 8. Cross-check manifest entries against disk.
    for e in entries:
        p = OUT_DIR / e["file"]
        if not p.is_file():
            fail(f"manifest template missing on disk: {e['file']}")

    manifest_path = OUT_DIR / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("[extract] OK")
    print(f"  source PDF      : {PDF_PATH.relative_to(ROOT)}")
    print(f"  extracted (pdf) : {provenance_counts['pdf']}")
    print(f"  scaffold        : {provenance_counts['scaffold']}")
    print(f"  total active    : {len(entries)}")
    print(f"  distribution    : {dict(sorted(dist.items()))}")
    print(f"  inactive combos : {len(registered_inactive)} "
          f"({inactive_template_total} registered templates)")
    print(f"  error patterns  : {len(error_patterns)}")
    print(f"  api index       : {len(api_index)}")
    print(f"  manifest        : {manifest_path.relative_to(ROOT)}")
    print(f"  prompt base     : system_prompt_base.md")


if __name__ == "__main__":
    main()
