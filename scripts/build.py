#!/usr/bin/env python3
"""Build the stand-alone HTML files for one program.

Usage:
    python scripts/build.py data/uaa-bsce                  # standard build (no Program tab)
    python scripts/build.py data/uaa-bsce --program-tab    # editor with the Program tab

The standard build is the one for advisors: the program is fixed by program.json
(UAA BSCE here). --program-tab adds the editor's Program tab plus the course
import / remove-all tools, for adapting the tool to a different program.

Reads src/app.js, src/app.css and <program folder>/program.json (whose catalog
"image" fields point at PNG/JPG files in that folder), embeds everything, and
writes two files to dist/:

    <SHORT>_DegreePlan_TEMPLATE_v<version>.html   blank plan for students/advisors
    <SHORT>_DegreePlan_EDITOR_v<version>.html     editor for the program owner

Only the Python standard library is needed.
"""
import base64
import json
import mimetypes
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def embed_images(data, folder):
    for key, cat in data["catalogs"].items():
        img = cat["image"]
        if img.startswith("data:"):
            continue
        path = (folder / img).resolve()
        if not path.exists():
            sys.exit(f"Catalog {key}: image not found: {path}")
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        cat["image"] = f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()
    return data


def page(css, js, data_json, editor, short, program_tab=False):
    if "</script" in js.lower() or "</style" in css.lower():
        sys.exit("src files must not contain a literal </script> or </style>")
    title = f"{short} Degree Plan Editor" if editor else f"{short} Degree Plan Template"
    return (
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{title}</title><style id="dp-css">{css}</style></head><body>'
        f'<script type="application/json" id="dp-mode">{json.dumps({"editor": True, "programTab": True} if editor and program_tab else {"editor": editor})}</script>'
        f'<script type="application/json" id="dp-data">{data_json}</script>'
        f'<script id="dp-app">{js}</script></body></html>'
    )


def main():
    args = sys.argv[1:]
    program_tab = "--program-tab" in args
    args = [a for a in args if a != "--program-tab"]
    if len(args) != 1 or args[0].startswith("-"):
        sys.exit(__doc__)
    folder = (ROOT / args[0]).resolve() if not pathlib.Path(args[0]).is_absolute() else pathlib.Path(args[0])
    data = json.loads((folder / "program.json").read_text(encoding="utf-8"))
    data = embed_images(data, folder)
    css = (ROOT / "src" / "app.css").read_text(encoding="utf-8")
    js = (ROOT / "src" / "app.js").read_text(encoding="utf-8")
    data_json = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    short = re.sub(r"[^A-Za-z0-9_-]+", "", data.get("program", {}).get("short", "Degree")) or "Degree"
    version = data.get("toolVersion", "1.0")
    out = ROOT / "dist"
    out.mkdir(exist_ok=True)
    for editor, kind in ((False, "TEMPLATE"), (True, "EDITOR")):
        f = out / f"{short}_DegreePlan_{kind}_v{version}.html"
        f.write_text(page(css, js, data_json, editor, short, program_tab), encoding="utf-8")
        note = " with Program tab" if editor and program_tab else ""
        print(f"wrote {f.relative_to(ROOT)}{note} ({f.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
