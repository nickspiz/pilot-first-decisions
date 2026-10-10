#!/usr/bin/env python3
"""Rebuild docs/demo.gif by running bench.mjs in fixture mode (no network, no cost).

  python3 docs/render_demo.py        (needs Node 18+ and Pillow: pip install pillow)

docs/demo.tape is the same demo for charmbracelet/vhs.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import termgif as t  # noqa: E402

CMD = ("node bench.mjs --fixture examples/fixture.json \\\n"
       "  --data examples/support-messages.jsonl \\\n"
       "  --questions examples/questions.json \\\n"
       "  --confidence-threshold 0.8 --limit 60 | head -26")


def colour(line):
    if line.startswith("#"):
        return [(line, t.BLUE)]
    if line.startswith(">") or line.startswith("Fixture replay"):
        return [(line, t.YELLOW)]
    return [(line, t.FG)]


def main():
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "demo"
        (work / "examples").mkdir(parents=True)
        for f in ("bench.mjs", "decide.mjs"):
            shutil.copy(ROOT / f, work / f)
        shutil.copytree(ROOT / "lib", work / "lib")
        for f in ("fixture.json", "support-messages.jsonl", "questions.json"):
            shutil.copy(ROOT / "examples" / f, work / "examples" / f)
        (work / "package.json").write_text('{"type":"module"}\n')
        env = {"PATH": os.environ["PATH"], "HOME": tmp}
        r = subprocess.run(CMD.replace("\\\n", " "), shell=True, cwd=work, env=env, capture_output=True, text=True)
    first = r.stderr.split("\n")[0]
    lines = [first] + r.stdout.rstrip("\n").split("\n")
    steps = [("type", CMD), ("outc", [colour(ln) for ln in lines]), ("pause", 3.5)]
    term = t.Term(cols=100, rows=33, size=14, title="demo: pilot-first-decisions")
    term.run(steps, type_chunk=3, type_dt=0.04, line_dt=0.1)
    term.save(HERE / "demo.gif")


if __name__ == "__main__":
    main()
