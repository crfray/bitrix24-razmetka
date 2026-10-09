"""One-time import to Docker volumes; never replace existing runtime data."""
import os
from pathlib import Path
import shutil

UID = GID = 10001
MAPPINGS = [(Path('/seed') / name, Path('/data') / name)
            for name in ('project', 'tasks', 'task-chats')]


def main():
    # Validate all destinations before starting any copy.
    for source, target in MAPPINGS:
        if (target / '.initialized').is_file():
            continue
        if not (source / 'events').is_dir() or not (source / 'dictionaries.json').is_file():
            raise SystemExit('Missing source data: ' + str(source))
        if any(target.iterdir()):
            raise SystemExit('Non-empty volume without .initialized; inspect before import: ' + str(target))
        if any(p.is_symlink() for p in source.rglob('*')):
            raise SystemExit('Source contains symbolic links; inspect before import: ' + str(source))

    for source, target in MAPPINGS:
        marker = target / '.initialized'
        if marker.is_file():
            print('Kept existing data:', target)
            continue
        shutil.copytree(source, target, dirs_exist_ok=True)
        for path in [target, *target.rglob('*')]:
            os.chown(path, UID, GID)
            path.chmod(0o750 if path.is_dir() else 0o640)
        marker.write_text('Initial data imported; subsequent starts keep this volume.\n')
        os.chown(marker, UID, GID)
        marker.chmod(0o640)
        print('Imported initial data:', target)

    auth = Path('/data/auth')
    os.chown(auth, UID, GID)
    auth.chmod(0o700)
    print('Auth directory ready; create an editor interactively with auth.py.')


if __name__ == '__main__':
    main()
