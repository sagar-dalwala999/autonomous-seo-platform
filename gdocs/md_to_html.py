#!/usr/bin/env python3
"""Markdown -> print-styled HTML (house palette) for Chrome --print-to-pdf."""
from __future__ import annotations

import html
import re
import sys

INLINE = re.compile(r"(\*\*.+?\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\(https?://[^)]+\))")


def preprocess(raw):
    """Join markdown soft-wrapped continuation lines into logical lines."""
    out = []
    fence = False
    for line in raw:
        s = line.strip()
        if s.startswith("```"):
            fence = not fence
            out.append(line)
            continue
        if fence:
            out.append(line)
            continue
        block = (not s) or s.startswith(("#", "|", ">")) or s == "---" \
            or re.match(r"^\s*[-*]\s+", line) or re.match(r"^\s*\d+\.\s+", line)
        if not block and out:
            ps = out[-1].strip()
            prev_block_end = (not ps) or ps.startswith(("#", "|", ">", "```")) or ps == "---"
            if not prev_block_end:
                out[-1] = out[-1].rstrip() + " " + s
                continue
        out.append(line)
    return out
LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)]+)\)")
URL = re.compile(r"(https?://\S+)")
HNUM = re.compile(r"^(\d+(?:\.\d+)*)[.)]?\s+(.*)$")

CSS = """
@page { size: A4; margin: 17mm 15mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #374151;
       line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; }
.title { color: #1E3A8A; font-size: 24pt; font-weight: bold; margin: 0 0 2pt 0; }
.subtitle { color: #DC2626; font-size: 11pt; font-weight: bold; letter-spacing: .4px;
            text-transform: uppercase; margin: 0 0 4pt 0; }
.tagline { color: #6B7280; font-size: 9.5pt; font-style: italic; border-bottom: 2.5px solid #1E3A8A;
           padding-bottom: 8pt; margin: 0 0 14pt 0; }
h2 { font-size: 14pt; color: #1E3A8A; border-bottom: 1.5px solid #DBEAFE; padding-bottom: 3pt;
     margin: 20pt 0 6pt 0; page-break-after: avoid; }
h2 .num, h3 .num { color: #DC2626; margin-right: 8pt; }
h3 { font-size: 12pt; color: #1E3A8A; margin: 13pt 0 4pt 0; page-break-after: avoid; }
h4 { font-size: 11pt; color: #111827; margin: 10pt 0 4pt 0; page-break-after: avoid; }
p { margin: 0 0 6pt 0; }
p > strong:first-child, li > strong:first-child { color: #1E3A8A; }
strong { color: #111827; }
a { color: #1D4ED8; text-decoration: underline; word-break: break-all; }
ul, ol { margin: 2pt 0 8pt 0; padding-left: 22pt; }
li { margin: 0 0 3pt 0; }
li.sub { list-style: none; margin-left: 14pt; }
li.sub::before { content: "\\2013\\00a0\\00a0"; color: #6B7280; }
code { font-family: Consolas, monospace; font-size: 9pt; color: #111827;
       background: #F3F4F6; padding: 0 2px; border-radius: 2px; }
pre { font-family: Consolas, monospace; font-size: 8pt; line-height: 1.25; color: #111827;
      background: #F3F4F6; border: 1px solid #D9DEE7; padding: 8pt 10pt; margin: 4pt 0 10pt 0;
      white-space: pre; overflow: hidden; page-break-inside: avoid; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 10pt 0; font-size: 9pt; }
th { background: #1E3A8A; color: #fff; font-weight: bold; text-align: left; }
th, td { border: 1px solid #D9DEE7; padding: 4pt 6pt; vertical-align: top; }
tr:nth-child(odd) > td { background: #F3F6FB; }
td:first-child { font-weight: bold; color: #111827; }
tr { page-break-inside: avoid; }
blockquote { background: #DBEAFE; color: #111827; margin: 6pt 0 10pt 0; padding: 8pt 12pt;
             border: none; page-break-inside: avoid; }
p.src { font-size: 8.5pt; color: #6B7280; margin: 0 0 1.5pt 0; }
p.src b { color: #6B7280; }
hr { border: none; margin: 4pt 0; }
"""


def esc(t):
    return html.escape(t, quote=False)


def inline(text):
    out = []
    for tok in INLINE.split(text):
        if not tok:
            continue
        if tok.startswith("**") and tok.endswith("**") and len(tok) > 4:
            out.append("<strong>" + esc(tok[2:-2]) + "</strong>")
        elif tok.startswith("*") and tok.endswith("*") and len(tok) > 2 and not tok.startswith("**"):
            out.append("<em>" + esc(tok[1:-1]) + "</em>")
        elif tok.startswith("`") and tok.endswith("`") and len(tok) > 2:
            out.append("<code>" + esc(tok[1:-1]) + "</code>")
        else:
            m = LINK.fullmatch(tok)
            if m:
                out.append('<a href="' + html.escape(m.group(2)) + '">' + esc(m.group(1)) + "</a>")
            else:
                out.append(esc(tok))
    return "".join(out)


def plain(text):
    text = LINK.sub(lambda m: m.group(1), text)
    return text.replace("**", "").replace("`", "").strip()


def hcell(text):
    return inline(text.strip())


def convert(md_path, out_path, doc_label=""):
    raw = preprocess(open(md_path, encoding="utf-8").read().splitlines())
    o = []
    i, n = 0, len(raw)
    seen_title = False
    in_sources = False
    lst = None  # None | 'ul' | 'ol'

    def close_list():
        nonlocal lst
        if lst:
            o.append(f"</{lst}>")
            lst = None

    def open_list(kind):
        nonlocal lst
        if lst != kind:
            close_list()
            o.append(f"<{kind}>")
            lst = kind

    while i < n:
        line = raw[i]
        s = line.strip()

        if s.startswith("```"):
            close_list()
            i += 1
            block = []
            while i < n and not raw[i].strip().startswith("```"):
                block.append(raw[i])
                i += 1
            o.append("<pre>" + esc("\n".join(block)) + "</pre>")
            i += 1
            continue

        if s.startswith("|") and i + 1 < n and re.match(r"^\|[\s:|-]+\|?$", raw[i + 1].strip()):
            close_list()
            headers = [hcell(c) for c in s.strip("|").split("|")]
            i += 2
            rows = []
            while i < n and raw[i].strip().startswith("|"):
                rows.append([hcell(c) for c in raw[i].strip().strip("|").split("|")])
                i += 1
            o.append("<table><tr>" + "".join(f"<th>{h}</th>" for h in headers) + "</tr>")
            for r in rows:
                r = (r + [""] * len(headers))[:len(headers)]
                o.append("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>")
            o.append("</table>")
            continue

        if s.startswith("#### "):
            close_list()
            o.append("<h4>" + inline(s[5:]) + "</h4>")
        elif s.startswith("### "):
            close_list()
            t = plain(s[4:])
            m = HNUM.match(t)
            if m:
                o.append(f'<h3><span class="num">{esc(m.group(1))}</span>{esc(m.group(2))}</h3>')
            else:
                o.append("<h3>" + esc(t) + "</h3>")
        elif s.startswith("## "):
            close_list()
            t = plain(s[3:])
            in_sources = t.lower().startswith("sources")
            m = HNUM.match(t)
            if m:
                o.append(f'<h2><span class="num">{esc(m.group(1))}</span>{esc(m.group(2))}</h2>')
            else:
                o.append("<h2>" + esc(t) + "</h2>")
        elif s.startswith("# ") and not seen_title:
            seen_title = True
            o.append('<p class="title">' + esc(plain(s[2:])) + "</p>")
            j = i + 1
            while j < n and not raw[j].strip():
                j += 1
            if j < n and raw[j].strip().startswith("**") and raw[j].strip().endswith("**"):
                o.append('<p class="subtitle">' + esc(raw[j].strip().strip("*").strip()) + "</p>")
                j += 1
            while j < n and not raw[j].strip():
                j += 1
            tag = []
            while j < n and raw[j].strip() and not raw[j].strip().startswith(("#", "|", ">", "```")) and raw[j].strip() != "---":
                tag.append(plain(raw[j].strip()))
                j += 1
            o.append('<p class="tagline">' + esc(" ".join(tag) if tag else doc_label) + "</p>")
            i = j
            continue
        elif s == "---" or s == "":
            close_list()
        elif s.startswith(">"):
            close_list()
            o.append("<blockquote>" + inline(s.lstrip("> ")) + "</blockquote>")
        elif re.match(r"^\s*[-*]\s+", line):
            indent = len(line) - len(line.lstrip())
            content = re.sub(r"^\s*[-*]\s+", "", line)
            open_list("ul")
            cls = ' class="sub"' if indent >= 2 else ""
            o.append(f"<li{cls}>" + inline(content) + "</li>")
        elif re.match(r"^\s*\d+\.\s+", line):
            content = re.sub(r"^\s*\d+\.\s+", "", line)
            if in_sources:
                close_list()
                num = re.match(r"^\s*(\d+)\.", line).group(1)
                um = URL.search(content)
                if um:
                    url = um.group(1).rstrip(".,)")
                    pre_t = plain(content[:um.start()])
                    post_t = plain(content[um.end():])
                    seg = f'<p class="src"><b>{num}.</b> '
                    if pre_t:
                        seg += esc(pre_t) + " "
                    seg += f'<a href="{html.escape(url)}">{esc(url)}</a>'
                    if post_t:
                        seg += " " + esc(post_t)
                    o.append(seg + "</p>")
                else:
                    o.append(f'<p class="src"><b>{num}.</b> ' + esc(plain(content)) + "</p>")
            else:
                open_list("ol")
                o.append("<li>" + inline(content) + "</li>")
        else:
            close_list()
            o.append("<p>" + inline(s) + "</p>")
        i += 1

    close_list()
    doc = ("<!doctype html><html><head><meta charset='utf-8'><style>" + CSS + "</style></head><body>"
           + "\n".join(o) + "</body></html>")
    open(out_path, "w", encoding="utf-8").write(doc)
    return out_path


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
    print("wrote", sys.argv[2])
