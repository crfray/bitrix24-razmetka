import hashlib, json
from pathlib import Path
root = Path(__file__).resolve().parent
manifest = json.loads((root / 'MANIFEST.json').read_text(encoding='utf-8'))
errors = []
for name, expected in manifest.items():
    path = root / name
    if not path.is_file():
        errors.append(name + ': missing')
        continue
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            h.update(chunk)
    if h.hexdigest() != expected: errors.append(name + ': changed')
if errors:
    raise SystemExit('\n'.join(errors))
print('PASS: all packaged files match SHA-256 manifest')
