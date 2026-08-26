#!/usr/bin/env python3
"""
Structural PDF editor — replaces text blocks and logo/cover regions in-place,
preserving the original PDF's vector quality, fonts, and layout.

Usage:
  python3 pdf_edit.py --input in.pdf --output out.pdf --overrides overrides.json \
      [--logo logo.png --logo-rect x,y,w,h] \
      [--logo-slot pageNum,x,y,w,h[,kind] --logo-image path ...] \
      [--font-cache dir]

overrides.json format (values are plain strings, or objects with text/bg/fg):
  { "page1": { "block-0": "new text", "block-2": {"text": "", "bg": "#0b1220"} }, "page2": { ... } }
  Or flat: { "block-0": "new text" }  (applied to page 1)

Logo slots replace the region on the given page: kind 'logo' fits the image
inside the rect (contain); kind 'cover' fills the rect and center-crops the
overflow. Without slots, --logo replaces the largest image on page 1.

Replacement text renders in the nearest Google-font equivalent of the original
(downloaded on demand into --font-cache); falls back to base14 Helvetica.
"""

import argparse
import json
import re
import sys
import os
import urllib.parse
import urllib.request

import fitz  # PyMuPDF

FONT_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "fonts")

# Lowercased Google families matched exactly against cleaned PDF font names.
GOOGLE_FAMILIES = {
    "inter": "Inter",
    "roboto": "Roboto",
    "open sans": "Open Sans",
    "lato": "Lato",
    "montserrat": "Montserrat",
    "poppins": "Poppins",
    "source sans 3": "Source Sans 3",
    "nunito sans": "Nunito Sans",
    "work sans": "Work Sans",
    "playfair display": "Playfair Display",
    "merriweather": "Merriweather",
    "lora": "Lora",
    "pt serif": "PT Serif",
    "arimo": "Arimo",
    "tinos": "Tinos",
    "gelasio": "Gelasio",
    "carlito": "Carlito",
    "dm sans": "DM Sans",
    "space grotesk": "Space Grotesk",
}

# Licensed/corporate fonts -> metric-compatible Google Font (mirrors the client map).
METRIC_COMPATIBLE = {
    "arial": "Arimo",
    "helvetica": "Arimo",
    "helvetica neue": "Arimo",
    "times new roman": "Tinos",
    "times": "Tinos",
    "georgia": "Gelasio",
    "cambria": "Gelasio",
    "calibri": "Carlito",
}

SANS_SHORTLIST = ["Inter", "Roboto", "Open Sans", "Work Sans"]
SERIF_SHORTLIST = ["Lora", "PT Serif", "Merriweather", "Playfair Display"]


def normalize_font_name(raw):
    """Strip subset prefixes and style suffixes: 'ABCDEF+Calibri-Bold' -> 'Calibri'."""
    if not raw:
        return ""
    name = re.sub(r"^[A-Z]{6}\+", "", raw)
    name = re.sub(r"[-,](Bold|Italic|BoldItalic|Regular|Medium|Light|SemiBold|Oblique)$", "", name, flags=re.IGNORECASE)
    return name.strip()


def looks_serif(font_name):
    return bool(re.search(r"serif|times|georgia|garamond|cambria|book|minion|palatino", font_name, re.IGNORECASE))


def resolve_google_family(raw_font_name):
    """Map a raw embedded font name to a downloadable Google family (or None)."""
    cleaned = normalize_font_name(raw_font_name).lower()
    if not cleaned:
        return None
    if cleaned in GOOGLE_FAMILIES:
        return GOOGLE_FAMILIES[cleaned]
    if cleaned in METRIC_COMPATIBLE:
        return METRIC_COMPATIBLE[cleaned]
    shortlist = SERIF_SHORTLIST if looks_serif(cleaned) else SANS_SHORTLIST
    return shortlist[1] if len(shortlist) > 1 else shortlist[0]


def download_font(family, cache_dir):
    """Download the family's regular TTF from Google Fonts into the cache; return path or None."""
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", family)
    cache_path = os.path.join(cache_dir, safe + ".ttf")
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 1000:
        return cache_path
    try:
        os.makedirs(cache_dir, exist_ok=True)
        css_url = "https://fonts.googleapis.com/css2?family=" + urllib.parse.quote(family)
        # A non-browser UA makes Google serve plain TTF urls instead of woff2.
        req = urllib.request.Request(css_url, headers={"User-Agent": "Wget/1.20"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            css = resp.read().decode("utf-8", "replace")
        match = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.ttf)\)", css)
        if not match:
            return None
        req = urllib.request.Request(match.group(1), headers={"User-Agent": "Wget/1.20"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        if len(data) < 1000:
            return None
        tmp_path = cache_path + ".tmp"
        with open(tmp_path, "wb") as f:
            f.write(data)
        os.replace(tmp_path, cache_path)
        return cache_path
    except Exception as e:
        print("Font download failed for %s: %s" % (family, e), file=sys.stderr)
        return None


def get_font(raw_font_name, font_cache_dir):
    """Resolve an embedded font name to a fitz.Font; fall back to base14 Helvetica."""
    family = resolve_google_family(raw_font_name)
    if family:
        path = download_font(family, font_cache_dir)
        if path:
            try:
                return fitz.Font(fontfile=path)
            except Exception:
                pass
    return fitz.Font("helv")


def hex_to_pdf_color(hex_str):
    """Convert hex color string to PyMuPDF color tuple (0-1 range)."""
    h = str(hex_str or "").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        r = int(h[0:2], 16) / 255.0
        g = int(h[2:4], 16) / 255.0
        b = int(h[4:6], 16) / 255.0
        return (r, g, b)
    except (ValueError, IndexError):
        return None


def int_to_pdf_color(color_int):
    """Convert PDF integer color (0xRRGGBB) to tuple."""
    r = ((color_int >> 16) & 0xFF) / 255.0
    g = ((color_int >> 8) & 0xFF) / 255.0
    b = (color_int & 0xFF) / 255.0
    return (r, g, b)


def sample_fill_color(page, rect):
    """Sample the dominant color around a region's border before redaction —
    used as the redaction fill so patches blend into dark/colored panels."""
    try:
        clip = fitz.Rect(rect) & page.rect
        if clip.is_empty:
            return (1, 1, 1)
        pix = page.get_pixmap(clip=clip, width=32, height=32, alpha=False)
        counts = {}
        w, h = pix.width, pix.height
        step = max(1, w // 16)
        # Sample only the border ring: the text sits in the middle.
        for y in list(range(0, max(1, h // 6))) + list(range(h - max(1, h // 6), h)):
            for x in range(0, w, step):
                counts[pix.pixel(x, min(max(y, 0), h - 1))] = counts.get(pix.pixel(x, min(max(y, 0), h - 1)), 0) + 1
        for x in list(range(0, max(1, w // 6))) + list(range(w - max(1, w // 6), w)):
            for y in range(0, h, step):
                counts[pix.pixel(min(max(x, 0), w - 1), y)] = counts.get(pix.pixel(min(max(x, 0), w - 1), y), 0) + 1
        if not counts:
            return (1, 1, 1)
        best = max(counts.items(), key=lambda kv: kv[1])[0]
        return (best[0] / 255.0, best[1] / 255.0, best[2] / 255.0)
    except Exception:
        return (1, 1, 1)


def extract_page_blocks(page, page_num):
    """Extract text spans from a page with positions in PDF points."""
    blocks = []
    text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
    block_id = 0
    for block in text_dict.get("blocks", []):
        if block.get("type") != 0:  # text block
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if not text:
                    continue
                bbox = span.get("bbox", [0, 0, 0, 0])
                blocks.append({
                    "id": "block-%d" % block_id,
                    "text": text,
                    "x": bbox[0],
                    "y": bbox[1],
                    "width": bbox[2] - bbox[0],
                    "height": bbox[3] - bbox[1],
                    "font_size": span.get("size", 12),
                    "font_name": span.get("font", ""),
                    "color": span.get("color", 0),
                    "page": page_num,
                })
                block_id += 1
    return blocks


def replace_text_on_page(page, matches, font_cache_dir):
    """Redact matched spans (sampled fills) and insert replacement text.

    matches: list of (pdf_block, override) where override is a dict with
    keys text/bg/fg (bg/fg optional). All redactions are applied in one pass,
    then the new text is written on top.
    """
    if not matches:
        return

    prepared = []
    for pb, ov in matches:
        new_text = ov.get("text", "")
        if new_text is None:
            new_text = ""
        bbox = fitz.Rect(pb["x"], pb["y"], pb["x"] + pb["width"], pb["y"] + pb["height"])
        expand = pb["height"] * 0.15
        redact_rect = fitz.Rect(bbox.x0 - expand, bbox.y0 - expand, bbox.x1 + expand, bbox.y1 + expand) & page.rect
        if redact_rect.is_empty:
            continue
        bg = hex_to_pdf_color(ov.get("bg"))
        if bg is None:
            bg = sample_fill_color(page, redact_rect)
        fg = hex_to_pdf_color(ov.get("fg"))
        if fg is None and isinstance(pb.get("color"), int):
            fg = int_to_pdf_color(pb["color"])
        if fg is None:
            fg = (0, 0, 0)
        prepared.append({"pb": pb, "text": new_text, "rect": redact_rect, "bg": bg, "fg": fg})

    # One redaction pass for the whole page (fills sampled beforehand).
    for item in prepared:
        page.add_redact_annot(item["rect"], fill=item["bg"])
    if prepared:
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

    for item in prepared:
        pb, new_text = item["pb"], item["text"]
        if not new_text:
            continue  # redact-only: clear the text
        font = get_font(pb.get("font_name", ""), font_cache_dir)
        baseline = pb["y"] + pb["height"] * 0.8
        try:
            tw = fitz.TextWriter(page.rect)
            tw.append((pb["x"], baseline), new_text, font=font, fontsize=pb["font_size"])
            tw.write_text(page, color=item["fg"])
        except Exception:
            try:
                page.insert_text((pb["x"], baseline), new_text, fontsize=pb["font_size"], color=item["fg"])
            except Exception as e:
                print("Text insert failed for %s: %s" % (pb["id"], e), file=sys.stderr)


def find_largest_image_rect(page):
    """Find the largest image on a page and return its rectangle."""
    best = None
    best_area = 0
    for img in page.get_images(full=True):
        for rect in page.get_image_rects(img[0]):
            area = rect.width * rect.height
            if area > best_area:
                best_area = area
                best = rect
    return best


def insert_logo_contain(page, rect, image_path):
    """Fit the image inside the rect, aspect preserved and centered."""
    page.insert_image(fitz.Rect(rect), filename=image_path, keep_proportion=True)


def insert_cover(page, rect, image_path):
    """Fill the rect completely, center-cropping the overflow (cover fit)."""
    rect = fitz.Rect(rect)
    try:
        pix = fitz.Pixmap(image_path)
        iw, ih = float(pix.width), float(pix.height)
    except Exception:
        page.insert_image(rect, filename=image_path, keep_proportion=False)
        return
    # Stage the image on a source page with the slot's exact aspect ratio so
    # the oversized placement is clipped to the slot when embedded.
    src = fitz.open()
    try:
        spage = src.new_page(width=rect.width, height=rect.height)
        scale = max(rect.width / max(iw, 1), rect.height / max(ih, 1))
        w, h = iw * scale, ih * scale
        x0, y0 = (rect.width - w) / 2.0, (rect.height - h) / 2.0
        spage.insert_image(fitz.Rect(x0, y0, x0 + w, y0 + h), filename=image_path)
        page.show_pdf_page(rect, src, 0)
    finally:
        src.close()


def replace_region(page, image_path, rect, kind="logo"):
    """Replace a region's content with an image: redact with sampled fill, then insert."""
    if not image_path or not os.path.exists(image_path):
        print("Slot image missing: %s" % image_path, file=sys.stderr)
        return
    rect = fitz.Rect(rect) & page.rect
    if rect.is_empty:
        return
    fill = sample_fill_color(page, rect)
    page.add_redact_annot(rect, fill=fill)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE)
    if kind == "cover":
        insert_cover(page, rect, image_path)
    else:
        insert_logo_contain(page, rect, image_path)


def parse_slot_arg(slot_str):
    """Parse 'pageNum,x,y,w,h[,kind]' (canvas px converted by the caller)."""
    parts = [p.strip() for p in slot_str.split(",")]
    if len(parts) < 5:
        raise ValueError("--logo-slot expects pageNum,x,y,w,h[,kind]")
    return {
        "page": int(float(parts[0])),
        "x": float(parts[1]),
        "y": float(parts[2]),
        "w": float(parts[3]),
        "h": float(parts[4]),
        "kind": parts[5] if len(parts) > 5 and parts[5] in ("logo", "cover") else "logo",
    }


def process_pdf(input_path, output_path, overrides, logo_path=None, logo_rect=None,
                logo_slots=None, font_cache_dir=None):
    """Main processing function."""
    if font_cache_dir is None:
        font_cache_dir = FONT_CACHE_DIR
    doc = fitz.open(input_path)

    slots_by_page = {}
    for s in (logo_slots or []):
        slots_by_page.setdefault(s["page"], []).append(s)

    for page_num in range(len(doc)):
        page = doc[page_num]
        page_key = "page%d" % (page_num + 1)

        page_overrides = overrides.get(page_key, overrides.get(str(page_num + 1), {}))
        if not page_overrides and any(k.startswith("block-") for k in overrides):
            page_overrides = overrides if page_num == 0 else {}

        if page_overrides:
            pdf_blocks = extract_page_blocks(page, page_num + 1)
            by_id = {pb["id"]: pb for pb in pdf_blocks}
            matches = []
            for block_id, value in page_overrides.items():
                pb = by_id.get(block_id)
                if pb is None:
                    continue
                if isinstance(value, dict):
                    ov = {"text": value.get("text", ""), "bg": value.get("bg"), "fg": value.get("fg")}
                else:
                    ov = {"text": value, "bg": None, "fg": None}
                matches.append((pb, ov))
            replace_text_on_page(page, matches, font_cache_dir)

        for s in slots_by_page.get(page_num + 1, []):
            replace_region(page, s["image"], fitz.Rect(s["x"], s["y"], s["x"] + s["w"], s["y"] + s["h"]), s["kind"])

        # Legacy single-logo behavior: largest image on page 1.
        if logo_path and logo_rect and page_num == 0:
            x, y, w, h = logo_rect
            replace_region(page, logo_path, fitz.Rect(x, y, x + w, y + h), "logo")

    try:
        doc.subset_fonts()  # drop unused glyphs from downloaded fonts (big size win)
    except Exception:
        pass
    doc.save(output_path, garbage=3, deflate=True)
    doc.close()
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Structural PDF editor")
    parser.add_argument("--input", required=True, help="Input PDF path")
    parser.add_argument("--output", required=True, help="Output PDF path")
    parser.add_argument("--overrides", required=True, help="JSON file with text overrides")
    parser.add_argument("--logo", help="Logo image path (legacy: replaces largest image on page 1)")
    parser.add_argument("--logo-rect", help="Logo rectangle as x,y,w,h (PDF points)")
    parser.add_argument("--logo-slot", action="append", default=[],
                        help="Slot rect 'pageNum,x,y,w,h[,kind]' (kind: logo|cover); paired with --logo-image")
    parser.add_argument("--logo-image", action="append", default=[],
                        help="Image path for the preceding --logo-slot")
    parser.add_argument("--font-cache", default=FONT_CACHE_DIR, help="Font cache directory")
    args = parser.parse_args()

    with open(args.overrides, "r") as f:
        overrides = json.load(f)

    logo_rect = None
    if args.logo_rect:
        logo_rect = tuple(float(v) for v in args.logo_rect.split(","))

    if len(args.logo_slot) != len(args.logo_image):
        print("Error: each --logo-slot needs a paired --logo-image", file=sys.stderr)
        sys.exit(2)

    logo_slots = []
    for slot_str, image_path in zip(args.logo_slot, args.logo_image):
        slot = parse_slot_arg(slot_str)
        slot["image"] = image_path
        logo_slots.append(slot)

    result = process_pdf(args.input, args.output, overrides, args.logo, logo_rect,
                         logo_slots=logo_slots, font_cache_dir=args.font_cache)
    print(json.dumps({"ok": True, "output": result}))


if __name__ == "__main__":
    main()
