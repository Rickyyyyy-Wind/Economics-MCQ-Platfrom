#!/usr/bin/env python3
"""
Crop-first CIE Economics MCQ extractor.

This prototype deliberately avoids reconstructing question layouts from OCR/text.
It uses PDF text geometry only to find question-number anchors, then renders one
complete PDF crop per question.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

import fitz  # PyMuPDF


QUESTION_COUNT = 30
DIGIT_GLYPH_MAP = {chr(0x13 + i): str(i) for i in range(10)}


@dataclass
class Anchor:
    question_num: int
    page_index: int
    x0: float
    y0: float
    x1: float
    y1: float
    raw: str


@dataclass
class OptionMarker:
    letter: str
    page_index: int
    x0: float
    y0: float
    x1: float
    y1: float
    raw: str


@dataclass
class CropRecord:
    id: str
    paperId: str
    questionNum: int
    sourcePdf: str
    sourceMarkScheme: str
    page: int
    bboxPdf: list[float]
    stemType: str
    stemImage: str
    options: dict[str, str]
    answer: str | None
    chapters: list[int]
    explanation: str
    validation: dict


def paper_id_from_qp(path: Path) -> str:
    match = re.match(r"9708_([smw])(\d{2})_qp_(\d{2})\.pdf$", path.name, re.I)
    if not match:
        raise ValueError(f"Cannot derive paper id from {path.name}")

    session_code, year_suffix, paper_num = match.groups()
    session = {"s": "SJ", "m": "MJ", "w": "ON"}[session_code.lower()]
    return f"20{year_suffix}_{session}_P{paper_num}"


def parse_mark_scheme(path: Path) -> dict[int, str]:
    answers: dict[int, str] = {}
    doc = fitz.open(path)
    try:
        for page in doc:
            text = page.get_text("text")
            for match in re.finditer(r"^\s*(\d{1,2})\s+([ABCD])\s+\d", text, re.M):
                q_num = int(match.group(1))
                if 1 <= q_num <= QUESTION_COUNT:
                    answers[q_num] = match.group(2)
    finally:
        doc.close()
    return answers


def decode_question_prefix(text: str) -> int | None:
    stripped = text.lstrip(" \t\r\n")
    match = re.match(r"(\d{1,2})(?:\D|$)", stripped)
    if match:
        value = int(match.group(1))
        return value if 1 <= value <= QUESTION_COUNT else None

    digits = []
    for char in stripped:
        if char in DIGIT_GLYPH_MAP:
            digits.append(DIGIT_GLYPH_MAP[char])
            continue
        break

    if not digits:
        return None

    value = int("".join(digits))
    return value if 1 <= value <= QUESTION_COUNT else None


def decode_option_prefix(text: str) -> str | None:
    stripped = text.lstrip(" \t\r\n")
    if not stripped:
        return None

    first = stripped[0]
    if first in "ABCD":
        return first

    encoded = {"$": "A", "%": "B", "&": "C", "'": "D"}
    return encoded.get(first)


def line_text(line: dict) -> str:
    return "".join(span.get("text", "") for span in line.get("spans", []))


def detect_question_anchors(page: fitz.Page, page_index: int) -> list[Anchor]:
    anchors: list[Anchor] = []
    page_height = page.rect.height

    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue

        for line in block.get("lines", []):
            x0, y0, x1, y1 = line["bbox"]
            if not (68 <= x0 <= 80 and 42 <= y0 <= page_height - 55):
                continue

            raw = line_text(line)
            q_num = decode_question_prefix(raw)
            if q_num is None:
                continue

            anchors.append(
                Anchor(
                    question_num=q_num,
                    page_index=page_index,
                    x0=x0,
                    y0=y0,
                    x1=x1,
                    y1=y1,
                    raw=raw[:40],
                )
            )

    anchors.sort(key=lambda a: (a.y0, a.x0))

    deduped: list[Anchor] = []
    for anchor in anchors:
        if deduped and anchor.question_num == deduped[-1].question_num and abs(anchor.y0 - deduped[-1].y0) < 2:
            continue
        deduped.append(anchor)

    return deduped


def detect_option_markers(page: fitz.Page, page_index: int) -> list[OptionMarker]:
    markers: list[OptionMarker] = []
    page_height = page.rect.height

    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue

        for line in block.get("lines", []):
            x0, y0, x1, y1 = line["bbox"]
            if not (86 <= x0 <= 125 and 42 <= y0 <= page_height - 45):
                continue

            raw = line_text(line)
            if x1 - x0 > 24:
                continue

            letter = decode_option_prefix(raw)
            if letter is None:
                continue

            markers.append(
                OptionMarker(
                    letter=letter,
                    page_index=page_index,
                    x0=x0,
                    y0=y0,
                    x1=x1,
                    y1=y1,
                    raw=raw[:40],
                )
            )

    markers.sort(key=lambda m: (m.y0, m.x0, m.letter))
    return markers


def build_crop_rects(doc: fitz.Document) -> tuple[dict[int, tuple[int, fitz.Rect]], list[str]]:
    all_anchors: list[Anchor] = []
    warnings: list[str] = []

    for page_index in range(doc.page_count):
        all_anchors.extend(detect_question_anchors(doc[page_index], page_index))

    all_anchors.sort(key=lambda a: (a.page_index, a.y0, a.x0))

    by_question: dict[int, Anchor] = {}
    cursor: tuple[int, float] = (-1, -1.0)
    for q_num in range(1, QUESTION_COUNT + 1):
        candidates = [
            anchor
            for anchor in all_anchors
            if anchor.question_num == q_num
            and (anchor.page_index, anchor.y0) > cursor
        ]
        if not candidates:
            continue

        selected = candidates[0]
        by_question[q_num] = selected
        cursor = (selected.page_index, selected.y0)

    ignored = [
        anchor
        for anchor in all_anchors
        if by_question.get(anchor.question_num) is not anchor
    ]
    if ignored:
        warnings.append(f"Ignored {len(ignored)} non-sequential question-number candidate(s)")

    missing = [q for q in range(1, QUESTION_COUNT + 1) if q not in by_question]
    if missing:
        warnings.append("Missing question anchors: " + ", ".join(f"Q{q:02d}" for q in missing))

    ordered = [by_question[q] for q in range(1, QUESTION_COUNT + 1) if q in by_question]
    rects: dict[int, tuple[int, fitz.Rect]] = {}

    for index, anchor in enumerate(ordered):
        page = doc[anchor.page_index]
        next_anchor = ordered[index + 1] if index + 1 < len(ordered) else None

        y0 = max(0, anchor.y0 - 8)
        if next_anchor and next_anchor.page_index == anchor.page_index:
            y1 = max(y0 + 24, next_anchor.y0 - 9)
        else:
            y1 = page.rect.height - 58

        rect = fitz.Rect(58, y0, page.rect.width - 58, min(page.rect.height, y1))
        content_bottom = find_content_bottom(page, rect)
        if content_bottom is not None:
            rect.y1 = max(rect.y0 + 32, min(rect.y1, content_bottom + 12))
        rects[anchor.question_num] = (anchor.page_index, rect)

    return rects, warnings


def intersects(a: fitz.Rect, b: fitz.Rect) -> bool:
    return not (a.x1 <= b.x0 or a.x0 >= b.x1 or a.y1 <= b.y0 or a.y0 >= b.y1)


def find_content_bottom(page: fitz.Page, crop_rect: fitz.Rect) -> float | None:
    boxes: list[fitz.Rect] = []

    for block in page.get_text("dict").get("blocks", []):
        bbox = fitz.Rect(block["bbox"])
        if intersects(crop_rect, bbox):
            boxes.append(bbox)

    for drawing in page.get_drawings():
        bbox = drawing.get("rect")
        if bbox and intersects(crop_rect, bbox):
            boxes.append(bbox)

    if not boxes:
        return None

    boxes.sort(key=lambda box: (box.y0, box.x0))
    bottom = max(crop_rect.y0, boxes[0].y1)
    for box in boxes[1:]:
        gap = box.y0 - bottom
        if gap > 96 and bottom > crop_rect.y0 + 50:
            break
        bottom = max(bottom, box.y1)

    return bottom


def render_crop(page: fitz.Page, rect: fitz.Rect, out_path: Path, zoom: float) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=rect, alpha=False)
    pix.save(out_path)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def point_in_rect(x: float, y: float, rect: fitz.Rect, edge_tolerance: float = 0.5) -> bool:
    return (
        rect.x0 - edge_tolerance <= x <= rect.x1 + edge_tolerance
        and rect.y0 - edge_tolerance <= y <= rect.y1 + edge_tolerance
    )


def validate_records(records: list[CropRecord], output_root: Path, doc: fitz.Document | None = None) -> dict:
    failures: list[str] = []
    warnings: list[str] = []
    hashes: dict[str, list[str]] = {}
    paths: set[str] = set()

    if len(records) != QUESTION_COUNT:
        failures.append(f"Expected {QUESTION_COUNT} records, found {len(records)}")

    seen_questions = {record.questionNum for record in records}
    missing = [q for q in range(1, QUESTION_COUNT + 1) if q not in seen_questions]
    if missing:
        failures.append("Missing records: " + ", ".join(f"Q{q:02d}" for q in missing))

    anchors_by_page: dict[int, list[Anchor]] = {}
    options_by_page: dict[int, list[OptionMarker]] = {}
    if doc is not None:
        for page_index in range(doc.page_count):
            anchors_by_page[page_index] = detect_question_anchors(doc[page_index], page_index)
            options_by_page[page_index] = detect_option_markers(doc[page_index], page_index)

    records_by_page: dict[int, list[tuple[CropRecord, fitz.Rect]]] = {}

    for record in records:
        rel = record.stemImage
        if rel in paths:
            failures.append(f"Image path reused: {rel}")
        paths.add(rel)

        image_path = output_root / rel
        if not image_path.exists():
            failures.append(f"Missing image file for {record.id}: {rel}")
            continue

        digest = sha256(image_path)
        hashes.setdefault(digest, []).append(record.id)

        with fitz.open(image_path) as img_doc:
            page = img_doc[0]
            width, height = page.rect.width, page.rect.height
            if height < 120:
                failures.append(f"{record.id} crop appears too small: {width:.0f}x{height:.0f}")
            if height > 1700:
                failures.append(f"{record.id} crop appears too large: {width:.0f}x{height:.0f}")

        if doc is not None:
            page_index = record.page - 1
            rect = fitz.Rect(record.bboxPdf)
            records_by_page.setdefault(page_index, []).append((record, rect))

            crop_anchors = [
                anchor
                for anchor in anchors_by_page.get(page_index, [])
                if point_in_rect(anchor.x0, anchor.y0, rect)
            ]
            anchor_nums = [anchor.question_num for anchor in crop_anchors]
            if anchor_nums != [record.questionNum]:
                failures.append(
                    f"{record.id} contains question-number anchors {anchor_nums}; expected only Q{record.questionNum:02d}"
                )

            crop_options = [
                marker
                for marker in options_by_page.get(page_index, [])
                if point_in_rect(marker.x0, marker.y0, rect)
            ]
            counts = {letter: 0 for letter in "ABCD"}
            for marker in crop_options:
                counts[marker.letter] += 1

            repeated = {letter: count for letter, count in counts.items() if count > 1}
            if repeated:
                warnings.append(f"{record.id} contains repeated isolated answer-choice-like markers: {repeated}")

            complete_groups = min(counts.values())
            if complete_groups > 1:
                failures.append(f"{record.id} appears to contain {complete_groups} complete answer-choice groups")

            if rect.height > doc[page_index].rect.height * 0.72:
                failures.append(f"{record.id} crop is likely too tall: {rect.height:.1f} PDF points")
            elif rect.height > doc[page_index].rect.height * 0.62:
                warnings.append(f"{record.id} crop is unusually tall: {rect.height:.1f} PDF points")

    for ids in hashes.values():
        if len(ids) > 1:
            failures.append("Duplicate image content: " + ", ".join(ids))

    if doc is not None:
        for page_index, page_records in records_by_page.items():
            page_records.sort(key=lambda item: item[1].y0)
            for (left_record, left_rect), (right_record, right_rect) in zip(page_records, page_records[1:]):
                if left_rect.y1 > right_rect.y0:
                    failures.append(
                        f"{left_record.id} overlaps {right_record.id} on page {page_index + 1}: "
                        f"{left_rect.y1:.1f} > {right_rect.y0:.1f}"
                    )

    status = "ok"
    if failures:
        status = "failed"
    elif warnings:
        status = "warnings"
    return {
        "status": status,
        "failures": failures,
        "warnings": warnings,
        "questionCount": len(records),
        "uniqueImages": len(paths),
    }


def extract_paper(qp_path: Path, ms_path: Path, output_root: Path, zoom: float) -> dict:
    paper_id = paper_id_from_qp(qp_path)
    answers = parse_mark_scheme(ms_path)
    records: list[CropRecord] = []

    doc = fitz.open(qp_path)
    try:
        rects, detector_warnings = build_crop_rects(doc)

        for q_num in range(1, QUESTION_COUNT + 1):
            if q_num not in rects:
                continue

            page_index, rect = rects[q_num]
            rel_image = Path("images") / "questions" / paper_id / f"{paper_id}_Q{q_num:02d}.png"
            abs_image = output_root / rel_image
            render_crop(doc[page_index], rect, abs_image, zoom)

            record = CropRecord(
                id=f"{paper_id}_Q{q_num:02d}",
                paperId=paper_id,
                questionNum=q_num,
                sourcePdf=qp_path.name,
                sourceMarkScheme=ms_path.name,
                page=page_index + 1,
                bboxPdf=[round(rect.x0, 2), round(rect.y0, 2), round(rect.x1, 2), round(rect.y1, 2)],
                stemType="image",
                stemImage=rel_image.as_posix(),
                options={"A": "A", "B": "B", "C": "C", "D": "D"},
                answer=answers.get(q_num),
                chapters=[],
                explanation="",
                validation={"status": "unchecked", "warnings": []},
            )
            records.append(record)

        validation = validate_records(records, output_root, doc)
    finally:
        doc.close()

    validation["notes"] = detector_warnings
    if validation["failures"]:
        validation["status"] = "failed"
    elif validation["warnings"]:
        validation["status"] = "warnings"
    else:
        validation["status"] = "ok"

    return {
        "paper": {
            "id": paper_id,
            "sourcePdf": qp_path.name,
            "sourceMarkScheme": ms_path.name,
            "questionCount": len(records),
            "questions": [record.id for record in records],
        },
        "questions": [asdict(record) for record in records],
        "validation": validation,
    }


def find_pairs(root: Path) -> list[tuple[Path, Path]]:
    pairs = []
    for qp_path in sorted(root.glob("9708_*_qp_*.pdf")):
        ms_path = qp_path.with_name(qp_path.name.replace("_qp_", "_ms_"))
        if ms_path.exists():
            pairs.append((qp_path, ms_path))
    return pairs


def write_outputs(payloads: Iterable[dict], output_root: Path) -> None:
    payloads = list(payloads)
    data_dir = output_root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    questions = []
    papers = {}
    validations = {}

    for payload in payloads:
        paper = payload["paper"]
        questions.extend(payload["questions"])
        papers[paper["id"]] = paper
        validations[paper["id"]] = payload["validation"]

    bundle = {
        "questions": questions,
        "papers": papers,
        "validations": validations,
        "totalQuestions": len(questions),
    }

    (data_dir / "questions.crop.json").write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    (data_dir / "validation-report.json").write_text(json.dumps(validations, indent=2), encoding="utf-8")
    (data_dir / "questions.crop.js").write_text(
        "// Generated by crop_questions.py\n"
        f"const QUESTION_DATA = {json.dumps(questions, indent=2)};\n\n"
        f"const PAPER_INDEX = {json.dumps(papers, indent=2)};\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate one PDF-rendered crop per MCQ question.")
    parser.add_argument("--root", default=".", help="Project root containing QP/MS PDFs.")
    parser.add_argument("--paper", help="Specific QP PDF filename to process.")
    parser.add_argument("--all", action="store_true", help="Process every QP/MS pair.")
    parser.add_argument("--output", default="output/crop_first", help="Output root for generated crops/data.")
    parser.add_argument("--zoom", type=float, default=3.0, help="Render zoom factor.")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    output_root = Path(args.output).resolve()

    if args.paper:
        qp_path = root / args.paper
        ms_path = qp_path.with_name(qp_path.name.replace("_qp_", "_ms_"))
        pairs = [(qp_path, ms_path)]
    else:
        pairs = find_pairs(root)
        if not args.all:
            pairs = pairs[:1]

    payloads = []
    for qp_path, ms_path in pairs:
        if not qp_path.exists():
            raise FileNotFoundError(qp_path)
        if not ms_path.exists():
            raise FileNotFoundError(ms_path)

        payload = extract_paper(qp_path, ms_path, output_root, args.zoom)
        payloads.append(payload)
        status = payload["validation"]["status"]
        warnings = len(payload["validation"]["warnings"])
        print(f"{payload['paper']['id']}: {payload['paper']['questionCount']} crops, {status}, {warnings} warning(s)")

    write_outputs(payloads, output_root)
    print(f"Wrote crop-first output to {output_root}")


if __name__ == "__main__":
    main()
