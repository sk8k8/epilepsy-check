"""Create a potentially hazardous, non-autoplay test video. Never preview it."""
from pathlib import Path
import subprocess

WIDTH, HEIGHT, FPS, SECONDS = 160, 90, 60, 24
OUTPUT = Path('fixtures/POTENTIAL_TRIGGER_ALL_FEATURES_DO_NOT_PLAY.webm')
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

pixel_count = WIDTH * HEIGHT
GRAY = bytes((128, 128, 128)) * pixel_count
BLACK = bytes((0, 0, 0)) * pixel_count
WHITE = bytes((255, 255, 255)) * pixel_count
RED = bytes((255, 0, 0)) * pixel_count
STRIPES = bytes(channel for _y in range(HEIGHT) for x in range(WIDTH)
                for channel in ((255, 255, 255) if (x // 8) % 2 else (0, 0, 0)))

process = subprocess.Popen([
    'ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
    '-video_size', f'{WIDTH}x{HEIGHT}', '-framerate', str(FPS), '-i', '-',
    '-an', '-c:v', 'libvpx-vp9', '-lossless', '1', '-pix_fmt', 'yuv420p', str(OUTPUT),
], stdin=subprocess.PIPE)

for frame in range(FPS * SECONDS):
    if FPS <= frame < 3 * FPS:  # 1–3 s: 5 brightness cycles/s
        image = WHITE if ((frame - FPS) // 6) % 2 else BLACK
    elif 6 * FPS <= frame < 8 * FPS:  # 6–8 s: 5 saturated-red cycles/s
        image = RED if ((frame - 6 * FPS) // 6) % 2 else BLACK
    elif 12 * FPS <= frame < 17 * FPS:  # 12–17 s: 2.5 brightness cycles/s
        image = WHITE if ((frame - 12 * FPS) // 12) % 2 else BLACK
    elif 21 * FPS <= frame < 23 * FPS:  # 21–23 s: persistent spatial stripes
        image = STRIPES
    else:
        image = GRAY
    process.stdin.write(image)
process.stdin.close()
if process.wait() != 0:
    raise SystemExit('ffmpeg encoding failed')
print(OUTPUT)
