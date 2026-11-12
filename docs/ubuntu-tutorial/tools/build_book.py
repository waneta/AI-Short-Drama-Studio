#!/usr/bin/env python3
"""Build the offline book. Requires Python Markdown (pip install Markdown)."""
from pathlib import Path
from html import escape
import re
import json
import markdown

ROOT = Path(__file__).resolve().parents[1]

def main():
    chapters = json.loads((ROOT/'chapters.json').read_text())
    files = [ROOT/'README.md', *(ROOT/'chapters'/name for name in chapters), ROOT/'VALIDATION.md', ROOT/'SOURCES.md']
    ids = {p.resolve(): 'start' if p.name == 'README.md' else p.stem for p in files}
    nav, sections = [], []
    for p in files:
        title = p.read_text().splitlines()[0].removeprefix('# ')
        key = ids[p.resolve()]
        body = markdown.markdown(p.read_text(), extensions=['tables','fenced_code','sane_lists'])
        def link(m):
            url=m.group(2)
            if re.match(r'^(https?:|#|data:)',url): return m.group(0)
            path,sep,fragment=url.partition('#')
            target=(p.parent/path).resolve()
            if target in ids:
                return f'{m.group(1)}="#{ids[target]}"'
            try: target_url=target.relative_to(ROOT).as_posix()
            except ValueError: return m.group(0)
            return f'{m.group(1)}="{target_url}{sep}{fragment}"'
        body=re.sub(r'(href|src)="([^"]+)"',link,body)
        nav.append(f'<a href="#{key}">{escape(title)}</a>')
        sections.append(f'<section id="{key}">{body}</section>')
    html='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>剧流 Studio · 从云端到本地的 AI 漫剧实操</title><link rel="stylesheet" href="assets/book.css"></head><body><a class="skip" href="#start">跳到正文</a><header><strong>剧流 Studio</strong><span>从云端到本地的 AI 漫剧实操 · 2026.10</span><a href="README.md">Markdown 原稿</a></header><div class="layout"><aside><p class="eyebrow">DeepSeek · 百炼 · ComfyUI</p><h2>读一章，做一步。</h2><nav aria-label="章节目录">'''+''.join(nav)+'''</nav><p class="note">14 章实操 · 4 个故事 · 28 个镜头<br>静态教程，可离线阅读</p></aside><main>'''+''.join(sections)+'''<footer>剧流 Studio 0.1.16 · 本地兼容分支 · 生成能力和验证范围以记录为准。</footer></main></div></body></html>'''
    (ROOT/'index.html').write_text(html)
    print(f'Built {len(files)} sections')

if __name__=='__main__': main()
