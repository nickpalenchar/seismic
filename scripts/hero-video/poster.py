"""The site's poster for the hero video: its first frame, slightly dimmed. The play button over it
was a real button on the old site's page, not part of the picture.

    uv run --with pillow python scripts/hero-video/poster.py ~/demos/seismic-hero/demo.mp4 site/img/hero-poster.jpg
"""

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

video, out = sys.argv[1], sys.argv[2]
with tempfile.TemporaryDirectory() as tmp:
    frame = Path(tmp) / "frame.png"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "0.6", "-i", video, "-frames:v", "1", str(frame)], check=True)
    im = Image.open(frame).convert("RGBA")
dim = Image.new("RGBA", im.size, (28, 27, 25, 18))
poster = Image.alpha_composite(im, dim)
poster.convert("RGB").save(out, quality=82, optimize=True, progressive=True)

