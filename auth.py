"""SQLite users and revocable sessions; no public registration or default password."""
import argparse
from contextlib import contextmanager
import getpass
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import sqlite3
import time

ITERATIONS = 600_000
SESSION_SECONDS = 8 * 60 * 60
LOGIN_WINDOW = 15 * 60


def database_path():
    return os.environ.get("RAZMETKA_AUTH_DB") or str(Path(__file__).resolve().parent / ".auth" / "users.sqlite3")


def token_hash(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class AuthStore:
    def __init__(self, path=None):
        self.path = str(path or database_path())
        Path(self.path).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        # Create private before SQLite opens it (including on concurrent startup).
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(self.path, 0o600)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY, salt BLOB NOT NULL,
                    password_hash BLOB NOT NULL, active INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY, username TEXT NOT NULL
                        REFERENCES users(username) ON DELETE CASCADE,
                    scope TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS login_limits (
                    key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL
                );
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def set_password(self, username, password):
        username = username.strip()
        if not username or len(username) > 80 or any(c.isspace() or ord(c) < 32 for c in username):
            raise ValueError("Логин: 1–80 символов без пробелов и управляющих символов")
        if not 12 <= len(password) <= 256:
            raise ValueError("Пароль: от 12 до 256 символов")
        salt = secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
        with self.connection() as db:
            db.execute("INSERT INTO users VALUES (?, ?, ?, 1) ON CONFLICT(username) DO UPDATE SET salt=excluded.salt, password_hash=excluded.password_hash, active=1", (username, salt, digest))
            db.execute("DELETE FROM sessions WHERE username=?", (username,))

    def disable(self, username):
        with self.connection() as db:
            db.execute("UPDATE users SET active=0 WHERE username=?", (username,))
            db.execute("DELETE FROM sessions WHERE username=?", (username,))

    def login(self, username, password, client_ip, scope):
        """Return (session, retry_after); reserve attempts before expensive hashing."""
        now = int(time.time())
        keys = [(token_hash("user:" + username), 10), (token_hash("ip:" + client_ip), 60)]
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM login_limits WHERE expires<=?", (now,))
            for key, limit in keys:
                row = db.execute("SELECT * FROM login_limits WHERE key=?", (key,)).fetchone()
                if row and row["attempts"] >= limit:
                    return None, max(1, row["expires"] - now)
            for key, _ in keys:
                db.execute("INSERT INTO login_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1", (key, now + LOGIN_WINDOW))
            user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        salt = user["salt"] if user else b"razmetka-dummy-salt"
        expected = user["password_hash"] if user else bytes(32)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
        valid = hmac.compare_digest(digest, expected)
        if not valid or not user or not user["active"]:
            return None, 0
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            # Password reset or disable during hashing must not mint a valid session.
            current = db.execute("SELECT * FROM users WHERE username=? AND active=1", (username,)).fetchone()
            if not current or not hmac.compare_digest(current["password_hash"], expected):
                return None, 0
            db.execute("DELETE FROM sessions WHERE expires<=?", (now,))
            db.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", (token_hash(token), username, scope, csrf, now + SESSION_SECONDS))
            db.execute("DELETE FROM login_limits WHERE key=?", (keys[0][0],))
        return {"token": token, "csrf": csrf, "username": username}, 0

    def session(self, token, scope):
        if not token or len(token) > 128:
            return None
        with self.connection() as db:
            row = db.execute("SELECT s.username, s.csrf FROM sessions s JOIN users u USING(username) WHERE token_hash=? AND scope=? AND expires>? AND u.active=1", (token_hash(token), scope, int(time.time()))).fetchone()
        return dict(row) if row else None

    def logout(self, token):
        with self.connection() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(token),))


def main():
    parser = argparse.ArgumentParser(description="Учётные записи редакторов Разметки")
    parser.add_argument("command", choices=["set-password", "disable", "list"])
    parser.add_argument("username", nargs="?")
    args = parser.parse_args()
    if args.command != "list" and not args.username:
        parser.error("нужен логин")
    store = AuthStore()
    if args.command == "set-password":
        password = getpass.getpass("Пароль (минимум 12 символов): ")
        if password != getpass.getpass("Повторите пароль: "):
            parser.error("пароли не совпадают")
        try:
            store.set_password(args.username, password)
        except ValueError as error:
            parser.error(str(error))
        print("Учётная запись сохранена; прежние сессии отозваны.")
    elif args.command == "disable":
        store.disable(args.username)
        print("Учётная запись отключена; сессии отозваны.")
    else:
        with store.connection() as db:
            for row in db.execute("SELECT username, active FROM users ORDER BY username"):
                print(row["username"], "active" if row["active"] else "disabled")


if __name__ == "__main__":
    main()
