#!/usr/bin/env python3
"""Check local book links and the story kits without calling a model."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import csv
import json
import markdown

ROOT = Path(__file__).resolve().parents[1]

class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.urls = []; self.ids = []
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('href', 'src'): self.urls.append(value)
            if key == 'id': self.ids.append(value)

def check_links(source, html):
    parser = Links(); parser.feed(html)
    assert len(parser.ids) == len(set(parser.ids)), f'Duplicate ids: {source}'
    count = 0
    for url in parser.urls:
        parts = urlsplit(url)
        if parts.scheme or parts.netloc: continue
        target = (source.parent / unquote(parts.path)).resolve() if parts.path else source
        assert target.exists(), f'Broken link in {source}: {url}'
        if target == source and parts.fragment and source.suffix == '.html':
            assert unquote(parts.fragment) in parser.ids, f'Broken anchor: {url}'
        count += 1
    return count

counts = {'markdown_local_links': 0, 'html_local_links': 0, 'cases': 0, 'shots': 0}
for source in ROOT.rglob('*.md'):
    counts['markdown_local_links'] += check_links(source, markdown.markdown(source.read_text(), extensions=['tables', 'fenced_code']))
counts['html_local_links'] = check_links(ROOT/'index.html', (ROOT/'index.html').read_text())
chapters = json.loads((ROOT/'chapters.json').read_text())
assert set(chapters) == {p.name for p in (ROOT/'chapters').glob('*.md')}
project_ids = set()
for case in json.loads((ROOT/'examples/cases.json').read_text()):
    directory = ROOT/'examples'/case['slug']
    for name in ['project.json','story.md','cards.md','storyboard.csv','prompts.md','captions.srt']: assert (directory/name).is_file()
    data = json.loads((directory/'project.json').read_text())
    assert set(data) == {'version', 'projects'}, 'Examples must not contain connection settings'
    project = data['projects'][0]
    assert project['id'] not in project_ids; project_ids.add(project['id'])
    shots = project['shots']; assert len(shots) == case['shots']
    assert sum(s['duration'] for s in shots) == case['duration']
    assert len({s['id'] for s in shots}) == len(shots)
    subjects = {s['id'] for s in project['subjects']}; scenes = {s['id'] for s in project['scenes']}
    for index, shot in enumerate(shots):
        assert shot['index'] == index and shot['sceneId'] in scenes
        assert set(shot['subjectIds']) <= subjects
        assert shot['imagePrompt'] and shot['compiledVideoPrompt'] and shot['status'] == 'draft'
        assert not any(k.endswith('AssetId') for k in shot), 'Draft kits must not refer to missing media'
    with (directory/'storyboard.csv').open() as f:
        rows = list(csv.DictReader(f)); assert len(rows) == len(shots)
        assert all(None not in row for row in rows)
    cues = [b for b in (directory/'captions.srt').read_text().strip().split('\n\n') if b]
    assert len(cues) == sum(bool(s['voiceover']) for s in shots)
    assert project['captionSrt'].strip() == (directory/'captions.srt').read_text().strip()
    counts['cases'] += 1; counts['shots'] += len(shots)
for source in (ROOT/'examples').rglob('*.json'): json.loads(source.read_text())
print(json.dumps(counts, ensure_ascii=False))
