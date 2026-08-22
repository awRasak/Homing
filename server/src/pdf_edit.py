#!/usr/bin/env python3
"""
Structural PDF editor — replaces text blocks and logos in-place,
preserving the original PDF's vector quality, fonts, and layout.

Usage:
  python3 pdf_edit.py --input in.pdf --output out.pdf --overrides overrides.json [--logo logo.png --logo-rect x,y,w,h]

overrides.json format:
  { "page1": { "block-0": "new text", "block-2": "" }, "page2": { ... } }
  Or flat: { "block-0": "new text" }  (applied to page 1)
"""

import argparse
import json
import sys
import os

import fitz  # PyMuPDF


def extract_page_blocks(page, page_num):
    """Extract text blocks from a page with positions in PDF points."""
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
                font_size = span.get("size", 12)
                font_name = span.get("font", "")
                color = span.get("color", 0)
                blocks.append({
                    "id": f"block-{block_id}",
                    "text": text,
                    "x": bbox[0],
                    "y": bbox[1],
                    "width": bbox[2] - bbox[0],
                    "height": bbox[3] - bbox[1],
                    "font_size": font_size,
                    "font_name": font_name,
                    "color": color,
                    "page": page_num,
                })
                block_id += 1
    return blocks


def match_blocks(pdf_blocks, canvas_blocks, page_width, canvas_width):
    """Match PDF-space blocks to canvas-space blocks by position (scaled)."""
    scale = page_width / canvas_width if canvas_width else 1.0
    matches = []  # list of (pdf_block, canvas_block_id, new_text)

    for cb in canvas_blocks:
        cb_x = cb.get("x", 0) * scale
        cb_y = cb.get("y", 0) * scale
        cb_w = cb.get("width", 0) * scale
        cb_h = cb.get("height", 0) * scale

        best = None
        best_dist = float("inf")
        for pb in pdf_blocks:
            # Calculate overlap / distance
            dx = abs((cb_x + cb_w / 2) - (pb["x"] + pb["width"] / 2))
            dy = abs((cb_y + cb_h / 2) - (pb["y"] + pb["height"] / 2))
            dist = dx + dy
            # Must be reasonably close and similar size
            size_ratio = max(cb_h, 1) / max(pb["height"], 1)
            if dist < best_dist and 0.3 < size_ratio < 3.0 and dx < pb["width"] * 2:
                best_dist = dist
                best = pb

        if best and best_dist < best["width"] * 3:
            matches.append((best, cb))

    return matches


def hex_to_pdf_color(hex_str):
    """Convert hex color string to PyMuPDF color tuple (0-1 range)."""
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        r = int(h[0:2], 16) / 255.0
        g = int(h[2:4], 16) / 255.0
        b = int(h[4:6], 16) / 255.0
        return (r, g, b)
    except (ValueError, IndexError):
        return (0, 0, 0)


def int_to_pdf_color(color_int):
    """Convert PDF integer color (0xRRGGBB) to tuple."""
    r = ((color_int >> 16) & 0xFF) / 255.0
    g = ((color_int >> 8) & 0xFF) / 255.0
    b = (color_int & 0xFF) / 255.0
    return (r, g, b)


def find_font_path(font_name):
    """Try to find a system font matching the given name."""
    # Common font directories on macOS
    font_dirs = [
        "/System/Library/Fonts",
        "/Library/Fonts",
        os.path.expanduser("~/Library/Fonts"),
        "/System/Library/Fonts/Supplemental",
    ]
    # Normalize the font name for matching
    normalized = font_name.lower().replace(" ", "").replace("-", "").replace("_", "")

    for d in font_dirs:
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if not f.lower().endswith((".ttf", ".otf", ".ttc")):
                continue
            f_normalized = f.lower().replace(" ", "").replace("-", "").replace("_", "")
            if normalized in f_normalized or f_normalized.startswith(normalized):
                return os.path.join(d, f)
    return None


def replace_text_on_page(page, matches, canvas_blocks_map):
    """Replace text blocks on a page using redaction + re-insertion."""
    page_width = page.rect.width
    page_height = page.rect.height

    for pdf_block, canvas_block in matches:
        block_id = canvas_block.get("id", "")
        new_text = canvas_block.get("new_text", "")
        bg_hex = canvas_block.get("bg", "#ffffff")
        fg_hex = canvas_block.get("fg", "#000000")

        if not new_text and new_text != "":
            continue

        bbox = fitz.Rect(pdf_block["x"], pdf_block["y"],
                         pdf_block["x"] + pdf_block["width"],
                         pdf_block["y"] + pdf_block["height"])

        # Expand bbox slightly to catch any connected glyphs
        expand = pdf_block["height"] * 0.15
        redact_rect = fitz.Rect(
            bbox.x0 - expand, bbox.y0 - expand,
            bbox.x1 + expand, bbox.y1 + expand
        )
        # Clamp to page
        redact_rect = redact_rect & page.rect

        if new_text:
            # Redact original, then insert new text
            bg_color = hex_to_pdf_color(bg_hex)
            page.add_redact_annot(redact_rect, fill=bg_color)
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

            # Find a suitable font
            font_path = find_font_path(pdf_block.get("font_name", ""))
            font_size = pdf_block["font_size"]
            text_color = int_to_pdf_color(pdf_block["color"]) if isinstance(pdf_block["color"], int) else hex_to_pdf_color(fg_hex)

            # Insert text at the original position
            tw = fitz.TextWriter(page.rect)
            try:
                if font_path:
                    font = fitz.Font(fontfile=font_path)
                else:
                    font = fitz.Font("helv")  # fallback to Helvetica
                tw.append((pdf_block["x"], pdf_block["y"] + pdf_block["height"] * 0.8),
                          new_text, font=font, fontsize=font_size, color=text_color)
                tw.write_text(page)
            except Exception:
                # Fallback: plain insert
                page.insert_text(
                    (pdf_block["x"], pdf_block["y"] + pdf_block["height"] * 0.8),
                    new_text,
                    fontsize=font_size,
                    color=text_color,
                )
        else:
            # Empty text: just redact to clear
            bg_color = hex_to_pdf_color(bg_hex)
            page.add_redact_annot(redact_rect, fill=bg_color)
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)


def find_largest_image_rect(page):
    """Find the largest image on a page and return its rectangle."""
    images = page.get_images(full=True)
    if not images:
        return None
    # Find the largest image by area
    best = None
    best_area = 0
    for img in images:
        xref = img[0]
        rects = page.get_image_rects(xref)
        for rect in rects:
            area = rect.width * rect.height
            if area > best_area:
                best_area = area
                best = rect
    return best


def replace_logo(page, logo_path, rect_tuple=None):
    """Replace an image region with a new logo."""
    if not logo_path or not os.path.exists(logo_path):
        return
    if rect_tuple:
        x, y, w, h = rect_tuple
        rect = fitz.Rect(x, y, x + w, y + h)
    else:
        # Auto-detect: find the largest image on page 1
        rect = find_largest_image_rect(page)
        if not rect:
            print("Warning: No images found to replace", file=sys.stderr)
            return

    # First, redact any existing content in that area
    page.add_redact_annot(rect, fill=(1, 1, 1))
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE)

    # Insert the new logo
    page.insert_image(rect, filename=logo_path)


def process_pdf(input_path, output_path, overrides, logo_path=None, logo_rect=None):
    """Main processing function."""
    doc = fitz.open(input_path)

    for page_num in range(len(doc)):
        page = doc[page_num]
        page_key = f"page{page_num + 1}"
        page_key_alt = str(page_num + 1)

        # Get overrides for this page (support both "page1" and "1" keys)
        page_overrides = overrides.get(page_key, overrides.get(page_key_alt, {}))
        if not page_overrides:
            # Also check flat format (no page prefix)
            if any(k.startswith("block-") for k in overrides):
                page_overrides = overrides if page_num == 0 else {}
            else:
                continue

        # Extract PDF text blocks
        pdf_blocks = extract_page_blocks(page, page_num + 1)

        # Build canvas blocks from overrides
        canvas_blocks = []
        for block_id, new_text in page_overrides.items():
            # Find matching PDF block by ID or position
            for pb in pdf_blocks:
                if pb["id"] == block_id:
                    canvas_blocks.append({
                        "id": block_id,
                        "new_text": new_text,
                        "x": pb["x"],
                        "y": pb["y"],
                        "width": pb["width"],
                        "height": pb["height"],
                        "bg": "#ffffff",  # default; will be overridden if canvas data available
                        "fg": "#000000",
                    })
                    break

        if canvas_blocks:
            replace_text_on_page(page, [(pb, cb) for pb, cb in zip(
                [pb for pb in pdf_blocks if any(cb["id"] == pb["id"] for cb in canvas_blocks)],
                canvas_blocks
            )], {})

        # Logo replacement
        if logo_path and logo_rect and page_num == 0:
            replace_logo(page, logo_path, logo_rect)

    doc.save(output_path)
    doc.close()
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Structural PDF editor")
    parser.add_argument("--input", required=True, help="Input PDF path")
    parser.add_argument("--output", required=True, help="Output PDF path")
    parser.add_argument("--overrides", required=True, help="JSON file with text overrides")
    parser.add_argument("--logo", help="Logo image path to replace")
    parser.add_argument("--logo-rect", help="Logo rectangle as x,y,w,h")
    args = parser.parse_args()

    with open(args.overrides, "r") as f:
        overrides = json.load(f)

    logo_rect = None
    if args.logo_rect:
        logo_rect = tuple(float(x) for x in args.logo_rect.split(","))

    result = process_pdf(args.input, args.output, overrides, args.logo, logo_rect)
    print(json.dumps({"ok": True, "output": result}))


if __name__ == "__main__":
    main()
