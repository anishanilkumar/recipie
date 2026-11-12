"""Just enough NATS, standard library only: publish, and wait for a subject.

NATS's client protocol is plain text: INFO from the server, CONNECT {...}, then
PUB <subject> <n>\\r\\n<payload>, SUB <subject> <sid>, and MSG lines coming back;
PING must be answered with PONG. Only empty "something changed" pings
travel this way (print.queued, pantry.changed); content stays on the HTTPS API.
A copy of the one in grocy_inventory (and downloads_viewer).

Neither class ever raises to its caller: a broken connection is retried in the
background, and the callers keep their own slow polling as the safety net.
"""

import json
import os
import socket
import sys
import threading
import time

NAME = os.environ.get("NATS_CLIENT_NAME", "recipie")


def _login(url, user, password_file):
    host, port = url.split("://", 1)[-1].rsplit(":", 1)
    connect = {"verbose": False, "pedantic": False, "name": NAME, "lang": "python", "version": "1"}
    if password_file:
        with open(password_file) as f:
            connect.update(user=user, **{"pass": f.read().strip()})
    s = socket.create_connection((host, int(port)), timeout=10)
    f = s.makefile("rwb")
    if not f.readline().startswith(b"INFO "):
        s.close()
        raise ConnectionError("not a NATS server")
    f.write(b"CONNECT " + json.dumps(connect).encode() + b"\r\nPING\r\n")
    f.flush()
    line = f.readline()
    if not line.startswith(b"PONG"):
        s.close()
        raise ConnectionError((line or b"closed").decode().strip())
    return s, f


class Announcer:
    """Publish an empty message on `subject` after `poke()`, at most once a second."""

    def __init__(self, url, subject, user="", password_file=""):
        self.url, self.subject, self.user, self.password_file = url, subject, user, password_file
        self._poked = threading.Event()
        if url and subject:
            threading.Thread(target=self._run, daemon=True).start()

    def poke(self):
        self._poked.set()

    def _run(self):
        conn = None
        while True:
            self._poked.wait()
            self._poked.clear()
            try:
                if conn is None:
                    conn = _login(self.url, self.user, self.password_file)
                s, f = conn
                f.write(f"PUB {self.subject} 0\r\n\r\n".encode())
                f.flush()
            except OSError as e:
                print(f"NATS: {e}", file=sys.stderr, flush=True)
                if conn:
                    conn[0].close()
                conn = None
                self._poked.set()   # try again in a moment
                time.sleep(5)
                continue
            time.sleep(1)


class Waiter:
    """Listen on `subject`; `wait(seconds)` returns early when a message arrives."""

    def __init__(self, url, subject, user="", password_file=""):
        self.url, self.subject, self.user, self.password_file = url, subject, user, password_file
        self._woken = threading.Event()
        self.connected = False
        if url and subject:
            threading.Thread(target=self._run, daemon=True).start()

    def wait(self, seconds):
        woken = self._woken.wait(seconds)
        self._woken.clear()
        return woken

    def _run(self):
        while True:
            try:
                s, f = _login(self.url, self.user, self.password_file)
                s.settimeout(None)
                f.write(f"SUB {self.subject} 1\r\n".encode())
                f.flush()
                self.connected = True
                while True:
                    line = f.readline()
                    if not line:
                        raise ConnectionError("closed by the server")
                    if line.startswith(b"MSG "):
                        n = int(line.split()[-1])
                        f.read(n + 2)
                        self._woken.set()
                    elif line.startswith(b"PING"):
                        f.write(b"PONG\r\n")
                        f.flush()
                    elif line.startswith(b"-ERR"):
                        raise ConnectionError(line.decode().strip())
            except OSError as e:
                if self.connected:
                    print(f"NATS: {e}; reconnecting", file=sys.stderr, flush=True)
                self.connected = False
                self._woken.set()   # look once now, in case something was missed
                time.sleep(5)


def from_env(kind, subject, prefix="RECIPIE"):
    """An Announcer or Waiter from <prefix>_NATS_URL / _NATS_USER / _NATS_PASSWORD_FILE (off when unset)."""
    cls = Announcer if kind == "announce" else Waiter
    return cls(os.environ.get(f"{prefix}_NATS_URL", ""), subject,
               os.environ.get(f"{prefix}_NATS_USER", ""), os.environ.get(f"{prefix}_NATS_PASSWORD_FILE", ""))
