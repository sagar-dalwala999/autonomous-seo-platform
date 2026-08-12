#!/usr/bin/env python3
"""Convert all planning docs to styled docx and upload as native Google Docs.

Idempotent: Drive folder id and per-doc ids persist in ids/*.json, so re-runs
PATCH the same Docs (stable links). Prints one URL per doc + the folder URL.
"""
from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

from styled_doc import Doc, upload_or_update, _access_token
from md_to_styled import convert

ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "docs"
OUT = ROOT / "gdocs" / "out"
IDS = ROOT / "gdocs" / "ids"
FOLDER_NAME = "Autonomous SEO Platform - Planning Package"

DOCS = [
    ("01-requirements-analysis.md", "01 - Requirements Analysis - Autonomous SEO Platform"),
    ("02-feasibility.md", "02 - Feasibility - Autonomous SEO Platform"),
    ("03-architecture.md", "03 - Architecture - Autonomous SEO Platform"),
    ("04-technology-comparison.md", "04 - Technology Comparison - Autonomous SEO Platform"),
    ("05-api-research.md", "05 - API Research - Autonomous SEO Platform"),
    ("06-risk-assessment.md", "06 - Risk Assessment - Autonomous SEO Platform"),
    ("07-mvp-development-plan.md", "07 - MVP Development Plan - Autonomous SEO Platform"),
]


def drive_folder(token):
    f = IDS / "folder.json"
    if f.exists():
        return json.loads(f.read_text())["folder_id"]
    body = json.dumps({"name": FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"}).encode()
    req = urllib.request.Request(
        "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        fid = json.loads(r.read())["id"]
    f.write_text(json.dumps({"folder_id": fid}))
    return fid


def build_one(md_name, title, folder_id):
    md = DOCS_DIR / md_name
    out = OUT / (md.stem + ".docx")
    convert(str(md), str(out))
    sidecar = IDS / (md.stem + "-doc.json")
    if sidecar.exists():
        doc_id = json.loads(sidecar.read_text())["doc_id"]
        url = upload_or_update(str(out), doc_id=doc_id)
    else:
        url = upload_or_update(str(out), title=title, folder_id=folder_id)
        doc_id = re.search(r"/document/d/([^/]+)/", url).group(1)
        sidecar.write_text(json.dumps({"doc_id": doc_id, "url": url}))
    return url


def build_cover(urls, folder_id):
    d = Doc()
    d.title("Autonomous SEO Optimization Platform",
            "PLANNING PACKAGE - FEASIBILITY, ARCHITECTURE & MVP PLAN",
            "Seven documents answering: how far can SEO be automated safely, and how to build it.")
    d.rich([("What this package is:  ", True, d.BLUE_DK),
            ("the complete pre-implementation study the problem statement asks for - requirements decomposition, "
             "a feasibility verdict with the four-bucket automation matrix, the full system architecture, "
             "justified technology selections, external-API research, a risk register, and the MVP development "
             "plan including specifications for all eight proofs-of-concept. No code was written; every "
             "recommendation is backed by cited primary sources verified against vendor documentation.", False, d.BODY)])
    d.callout("The headline answer:", d.AMBER, "FEF3E2",
              "The Platform is feasible with boundaries - and the boundaries are the product. The entire analysis "
              "side plus ~14 mechanical fix types can run fully autonomously; ~26 ranking-sensitive change types "
              "run machine-generated but human-gated behind one pre-validated approval; a hard deny-list "
              "(robots.txt, mass redirects, page deletion, mass canonicals) stays human-controlled permanently, "
              "because a single bad write there costs months of recovery.")
    d.heading("1", "Reading order")
    for idx, (name, url) in enumerate(urls, start=1):
        d.bullet([("Doc %02d:  " % idx, True, d.RED), ("LINK", name, url)])
    d.heading("2", "How the package was produced")
    d.bullet([("Evidence first: ", True, d.BLUE_DK),
              ("14 parallel research lanes, every load-bearing number verified against current vendor "
               "documentation and cited (300+ sources across the package).", False, d.BODY)])
    d.bullet([("Adversarial review: ", True, d.BLUE_DK),
              ("every document was independently reviewed against the problem statement by a critic briefed to "
               "fail it, fixed, then swept for cross-document consistency.", False, d.BODY)])
    d.bullet([("Traceability: ", True, d.BLUE_DK),
              ("Doc 01 numbers every requirement (FR/NFR); Docs 02-07 trace their statements back to those IDs "
               "so nothing in the problem statement is silently dropped.", False, d.BODY)])
    d.footer("Planning package - prepared August 2026.")
    out = OUT / "00-package-overview.docx"
    d.save(str(out))
    sidecar = IDS / "00-package-overview-doc.json"
    if sidecar.exists():
        doc_id = json.loads(sidecar.read_text())["doc_id"]
        url = upload_or_update(str(out), doc_id=doc_id)
    else:
        url = upload_or_update(str(out), title="00 - Package Overview - Autonomous SEO Platform", folder_id=folder_id)
        doc_id = re.search(r"/document/d/([^/]+)/", url).group(1)
        sidecar.write_text(json.dumps({"doc_id": doc_id, "url": url}))
    return url


def main():
    OUT.mkdir(exist_ok=True)
    IDS.mkdir(exist_ok=True)
    token = _access_token()
    folder_id = drive_folder(token)
    results = []
    for md_name, title in DOCS:
        url = build_one(md_name, title, folder_id)
        results.append((title, url))
        print(f"{md_name} -> {url}", flush=True)
    cover = build_cover(results, folder_id)
    print(f"cover -> {cover}", flush=True)
    print(f"folder -> https://drive.google.com/drive/folders/{folder_id}", flush=True)


if __name__ == "__main__":
    main()
