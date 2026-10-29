#!/usr/bin/env python3
"""Render the report's Markdown subset to a standalone, offline HTML document.
Supports headings, paragraphs, fenced code, tables, ordered/unordered lists,
inline code, strong emphasis and links. No third-party packages are required.
"""
from pathlib import Path
import html
import re
import unicodedata

ROOT = Path(__file__).resolve().parent.parent
source = (ROOT / 'REPORT.md').read_text(encoding='utf-8')
lines = source.splitlines()


def slug(text):
    value = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')


def inline(text):
    pattern = r'`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)'
    output, end = [], 0
    for match in re.finditer(pattern, text):
        output.append(html.escape(text[end:match.start()]))
        code, strong, label, url = match.groups()
        if code is not None:
            output.append('<code>' + html.escape(code) + '</code>')
        elif strong is not None:
            output.append('<strong>' + inline(strong) + '</strong>')
        elif re.match(r'^(https?://|[\w./#-])', url):
            output.append('<a href="' + html.escape(url, quote=True) + '">' + inline(label) + '</a>')
        else:
            output.append(html.escape(label))
        end = match.end()
    output.append(html.escape(text[end:]))
    return ''.join(output)


flow = '''<figure class="flow" aria-labelledby="flow-caption">
<figcaption id="flow-caption">Một request đi qua hệ thống như thế nào?</figcaption>
<ol><li><span>01</span><div><b>JWT middleware</b><small>Xác minh token → lấy user ID</small></div></li>
<li><span>02</span><div><b>Business service</b><small>Tải user, task và project từ SQLite</small></div></li>
<li><span>03</span><div><b>Policy theo phiên bản</b><small>Membership → role/action → assignee/status → tenant</small></div></li>
<li><span>04</span><div><b>Thực thi quyết định</b><small>Deny: 403 · Allow: đọc/ghi và trả kết quả</small></div></li></ol>
</figure>'''
headings = []
content = []
i = 0
while i < len(lines):
    line = lines[i]
    if not line.strip():
        i += 1
        continue
    if line.startswith('# '):
        title = line[2:]
        i += 1
        continue
    if line.startswith('```'):
        lang = line[3:].strip()
        block = []
        i += 1
        while i < len(lines) and not lines[i].startswith('```'):
            block.append(lines[i])
            i += 1
        content.append('<div class="code-block"><div class="code-label">' + html.escape(lang or 'code') + '</div><pre><code>' + html.escape('\n'.join(block)) + '</code></pre></div>')
        i += 1
        continue
    heading = re.match(r'^(#{2,6}) (.+)$', line)
    if heading:
        level, label = len(heading[1]), heading[2]
        anchor = slug(label)
        if level == 2:
            if headings:
                content.append('</section>')
            headings.append((label, anchor))
            content.append('<section class="report-section" aria-labelledby="' + anchor + '">')
        content.append(f'<h{level} id="{anchor}">{inline(label)}</h{level}>')
        if label.startswith('3. '):
            content.append(flow)
        i += 1
        continue
    if line.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|$', lines[i + 1]):
        cells = lambda value: [cell.strip() for cell in value.strip().strip('|').split('|')]
        header = cells(line)
        rows = []
        i += 2
        while i < len(lines) and lines[i].startswith('|'):
            rows.append(cells(lines[i]))
            i += 1
        output = ['<div class="table-wrap" role="region" aria-label="Bảng đối chiếu" tabindex="0"><table><thead><tr>']
        output += ['<th scope="col">' + inline(cell) + '</th>' for cell in header]
        output.append('</tr></thead><tbody>')
        for row in rows:
            if len(row) != len(header):
                raise ValueError('Table cell count mismatch: ' + str(row))
            output.append('<tr>' + ''.join('<td>' + inline(cell) + '</td>' for cell in row) + '</tr>')
        output.append('</tbody></table></div>')
        content.append(''.join(output))
        continue
    bullet = re.match(r'^(- |\d+\. )(.+)$', line)
    if bullet:
        ordered = not line.startswith('- ')
        tag = 'ol' if ordered else 'ul'
        items = []
        while i < len(lines):
            item = re.match(r'^(\d+\. |\- )(.+)$', lines[i])
            if not item or (not lines[i].startswith('- ')) != ordered:
                break
            items.append('<li>' + inline(item[2]) + '</li>')
            i += 1
        content.append('<' + tag + '>' + ''.join(items) + '</' + tag + '>')
        continue
    paragraph = [line]
    i += 1
    while i < len(lines) and lines[i].strip() and not re.match(r'^(#|```|\||- |\d+\. )', lines[i]):
        paragraph.append(lines[i])
        i += 1
    content.append('<p>' + inline(' '.join(paragraph)) + '</p>')
if headings:
    content.append('</section>')

css = '''
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#243447;background:#f3f5f8;font-size:15px;line-height:1.75;scroll-behavior:smooth}
*{box-sizing:border-box}body{margin:0}a{color:#235ea2;text-underline-offset:3px}a:hover{color:#143c70}p{margin:12px 0 16px}strong{color:#163d60}
.skip{position:absolute;left:20px;top:-60px;padding:9px 15px;background:white;z-index:5}.skip:focus{top:10px}
.hero{background:#152c48;color:#fff;padding:38px max(24px,calc((100vw - 1320px)/2)) 30px}.eyebrow{color:#a6c8e6;font-size:11px;font-weight:750;letter-spacing:2px}h1{max-width:980px;font-size:clamp(26px,3vw,38px);line-height:1.25;letter-spacing:-.8px;margin:12px 0 14px}.hero p{color:#cfdeeb;max-width:920px;margin-bottom:20px}.hero a{color:#e3effa}
.hero-meta{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:12px}.hero-meta span,.hero-meta a{border:1px solid #54708a;border-radius:6px;padding:5px 10px;text-decoration:none}
.layout{max-width:1368px;margin:auto;padding:28px 24px 44px;display:grid;grid-template-columns:252px minmax(0,1fr);gap:28px;align-items:start}.toc{position:sticky;top:18px;max-height:calc(100dvh - 36px);overflow:auto;background:white;border:1px solid #dce4ed;border-radius:10px;padding:19px 16px}.toc-label{font-size:11px;font-weight:750;letter-spacing:1.8px;color:#6d8095;margin:0 0 12px}.toc a{display:block;font-size:12px;line-height:1.55;padding:8px 9px;margin:2px 0;color:#496078;text-decoration:none;border-left:2px solid transparent;border-radius:3px}.toc a:hover,.toc a.active{background:#edf4fb;border-left-color:#3973ad;color:#174774}.toc .readme{border-top:1px solid #e5ebf2;margin-top:12px;padding-top:14px}
article{min-width:0}.intro{font-size:15px;border:1px solid #dce4ed;border-left:4px solid #4c7eac;border-radius:8px;padding:20px 25px;background:white;margin-bottom:22px}.intro p:last-child{margin-bottom:0}.version-nav{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:20px 0 24px}.version-nav a{background:#eaf1f9;padding:10px 8px;border-radius:6px;font-size:12px;font-weight:700;text-align:center;text-decoration:none}
.report-section{padding:26px 30px;margin-bottom:22px;background:white;border:1px solid #dce4ed;border-radius:10px;min-width:0}.report-section>h2:first-child{margin-top:0}h2{font-size:23px;color:#183d62;line-height:1.4;margin:30px 0 18px;scroll-margin-top:24px;letter-spacing:-.3px}h3{font-size:17px;color:#2f5273;margin:25px 0 12px;line-height:1.5;scroll-margin-top:24px}ul,ol{padding-left:23px}li{margin:7px 0}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.86em;background:#edf2f8;color:#25486b;padding:2px 5px;border-radius:4px;overflow-wrap:anywhere}
.code-block{margin:18px 0 22px;border-radius:8px;overflow:hidden;background:#142539}.code-label{background:#1d344d;color:#abc3db;font:11px ui-monospace,monospace;padding:8px 15px;text-transform:uppercase;letter-spacing:1px}pre{margin:0;padding:17px 18px;overflow-x:auto;line-height:1.7;font-size:12px;tab-size:2}pre code{background:transparent;color:#edf3fa;padding:0;border-radius:0;font-size:inherit;overflow-wrap:normal;white-space:pre}
.table-wrap{max-width:100%;overflow-x:auto;margin:18px 0 22px;border:1px solid #dbe4ee;border-radius:7px}table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.6;min-width:540px}th,td{padding:11px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #e3eaf1}th{background:#edf3f9;color:#3c5570;font-size:11px;font-weight:750}tr:last-child td{border-bottom:0}tbody tr:nth-child(even){background:#fafbfd}td code{font-size:11px}
.flow{margin:20px 0 26px;background:#f1f6fb;border:1px solid #dbe6f2;border-radius:8px;padding:19px}.flow figcaption{font-size:13px;font-weight:750;color:#355a7e;margin-bottom:15px}.flow ol{display:grid;grid-template-columns:1fr 1fr;gap:12px;list-style:none;padding:0;margin:0}.flow li{display:flex;gap:12px;align-items:flex-start;background:white;border:1px solid #dde7f0;border-radius:6px;padding:13px;margin:0}.flow li>span{font-size:11px;font-weight:800;color:#357399;padding-top:3px}.flow b{font-size:12px;color:#28496b}.flow small{display:block;font-size:11px;color:#677b90;line-height:1.6;margin-top:4px}
footer{text-align:center;color:#6f8093;font-size:12px;padding:0 24px 30px}:focus-visible{outline:3px solid #cf9e38;outline-offset:3px}
@media(max-width:1050px){.layout{grid-template-columns:210px minmax(0,1fr);gap:18px}.report-section{padding:23px}.toc{padding:15px 11px}}
@media(max-width:780px){.hero{padding:28px 18px 25px}.layout{display:block;padding:18px 12px 30px}.toc{position:static;max-height:none;margin-bottom:20px;padding:16px}.toc nav{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px}.toc a{font-size:11px}.report-section{padding:21px 18px}h2{font-size:21px}.flow ol{grid-template-columns:1fr}.version-nav{gap:5px}.version-nav a{font-size:11px;padding:10px 4px}.intro{padding:18px}pre{font-size:11px}}
@media(max-width:400px){.toc nav{display:block}}
@media(prefers-reduced-motion:reduce){:root{scroll-behavior:auto}}
@media print{:root{background:white;color:#111;font-size:10pt;line-height:1.55}.hero{background:white;color:#111;padding:0 0 18px;border-bottom:2px solid #294a6c}.hero p,.eyebrow{color:#444}.hero-meta,.toc,.skip,.version-nav{display:none}.layout{display:block;padding:20px 0;margin:0;max-width:none}.report-section{border:0;border-radius:0;padding:0;margin:0 0 24px}h1{font-size:23pt}h2{font-size:17pt;break-after:avoid}h3{font-size:12pt;break-after:avoid}.table-wrap{overflow:visible;border-radius:0}table{min-width:0;font-size:8pt}th,td{padding:7px;overflow-wrap:anywhere}.code-block{background:#f3f5f7;break-inside:avoid}.code-label{background:#e7ecf1;color:#333}pre code{color:#111;white-space:pre-wrap;overflow-wrap:anywhere}.flow{break-inside:avoid}.flow ol{grid-template-columns:1fr 1fr}a{color:#111;text-decoration:underline}footer{padding:10px 0}.intro{border:0;padding:0}}
'''
nav = ''.join('<a href="#' + anchor + '">' + html.escape(label) + '</a>' for label, anchor in headings)
version_sections = [(name, next(anchor for label, anchor in headings if label.startswith(prefix))) for name, prefix in [('Starter','4. '),('V1','5. '),('V2','6. '),('V3','7. '),('V4','8. ')]]
quick = '<nav class="version-nav" aria-label="Đi thẳng đến phiên bản">' + ''.join(f'<a href="#{anchor}">{name}</a>' for name, anchor in version_sections) + '</nav>'
body = '\n'.join(content)
# Keep the introduction separate from numbered sections for clear reading order.
pos = body.index('<section class="report-section"')
body = '<div class="intro">' + body[:pos] + quick + '</div>' + body[pos:]
script = '''
const links = [...document.querySelectorAll('.toc nav a')];
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    links.forEach(link => {
      const active = link.hash === '#' + entry.target.id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
}, {rootMargin: '-5% 0px -75% 0px'});
document.querySelectorAll('h2[id]').forEach(heading => observer.observe(heading));
'''
document = f'''<!doctype html>
<html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>REPORT · Block-6 · Cách hoạt động Starter và V1–V4</title>
<meta name="description" content="Báo cáo kỹ thuật Block-6: middleware JWT, truy vấn membership, RBAC, assignee và status, tenant boundary, code và kịch bản demo.">
<style>{css}</style></head><body>
<a class="skip" href="#report">Bỏ qua mục lục, đọc báo cáo</a>
<header class="hero"><span class="eyebrow">BÁO CÁO KỸ THUẬT · BLOCK 6</span><h1>Hệ thống kiểm quyền hoạt động như thế nào?</h1>
<p>Từ Starter đến V4: theo dõi request, truy vấn SQLite và từng điều kiện được thêm vào policy.</p>
<div class="hero-meta"><span>Express · TypeScript · SQLite · jose</span><span>198 test API/business · 13 test giao diện</span><a href="REPORT.md">Đọc bản Markdown ↗</a></div></header>
<div class="layout"><aside class="toc" aria-label="Mục lục"><p class="toc-label">NỘI DUNG BÁO CÁO</p><nav>{nav}</nav><a class="readme" href="README.md">Hướng dẫn chạy ứng dụng ↗</a></aside>
<article id="report" aria-label="Báo cáo kỹ thuật">{body}</article></div>
<footer>Block-6 · Nội dung từ REPORT.md · Đối chiếu mã nguồn và evidence trong cùng thư mục</footer>
<script>{script}</script></body></html>
'''
(ROOT / 'REPORT.html').write_text(document, encoding='utf-8')
print(f'Rendered REPORT.html: {len(headings)} sections, {len(document.encode("utf-8")):,} bytes.')
