import type { Bounds } from '../core/layout';
import type { Cam, Sides } from './camera';

export const CHIP_WIDTH = 300;
export const CHIP_HEIGHT = 30;
const COLUMN_GAP = 6;

/** Screen positions for off-screen card pointers. Card IDs give ties a lasting order. */
export function edgeChipPositions(targets: { id: string; b: Bounds }[], cam: Cam, side: Sides, width: number, height: number) {
  const top = 74, bottom = height - 60;
  const left = side.left + 30, right = width - side.right - 30;
  const chipWidth = Math.min(CHIP_WIDTH, Math.max(0, right - left));
  const candidates = targets.flatMap(({ id, b }) => {
    const cx = cam.x + (b.x + b.w / 2) * cam.s;
    const cy = cam.y + (b.y + b.h / 2) * cam.s;
    if (cx > left && cx < right && cy > 64 && cy < bottom) return [];
    const x = cx >= right ? right - chipWidth : cx <= left ? left : Math.max(left, Math.min(right - chipWidth, cx - chipWidth / 2));
    const edge = cx >= right ? 'right' : cx <= left ? 'left' : cy <= 64 ? 'top' : 'bottom';
    return [{ id, x, wantedY: Math.max(top, Math.min(bottom, cy)), cx, cy, edge }];
  }).sort((a, b) => a.id.localeCompare(b.id));
  // Indicators on a vertical screen edge form one contiguous stack, even when their cards
  // lie at different heights off-screen. Keep the stack near their average direction.
  for (const edge of ['left', 'right']) {
    const group = candidates.filter((chip) => chip.edge === edge);
    if (!group.length) continue;
    const rows = Math.min(group.length, Math.floor((bottom - top) / CHIP_HEIGHT) + 1);
    const mean = group.reduce((sum, chip) => sum + chip.wantedY, 0) / group.length;
    const start = Math.max(top, Math.min(bottom - (rows - 1) * CHIP_HEIGHT, mean));
    group.forEach((chip, index) => { chip.wantedY = start + (index % rows) * CHIP_HEIGHT; });
  }
  const placed: { id: string; x: number; y: number; angle: number }[] = [];
  for (const chip of candidates) {
    const step = chip.cx >= right ? -chipWidth - COLUMN_GAP : chipWidth + COLUMN_GAP;
    let x = chip.x, y: number | undefined;
    for (let column = 0; column <= candidates.length; column++) {
      const nextX = chip.x + column * step;
      if (nextX < left || nextX + chipWidth > right) break;
      const peers = placed.filter((p) => nextX < p.x + chipWidth + COLUMN_GAP && nextX + chipWidth + COLUMN_GAP > p.x);
      const choices = [chip.wantedY, ...peers.flatMap((p) => [p.y - CHIP_HEIGHT, p.y + CHIP_HEIGHT])]
        .filter((candidate) => candidate >= top && candidate <= bottom)
        .sort((a, b) => Math.abs(a - chip.wantedY) - Math.abs(b - chip.wantedY) || b - a);
      const free = choices.find((candidate) => peers.every((p) => Math.abs(candidate - p.y) >= CHIP_HEIGHT));
      if (free !== undefined) { x = nextX; y = free; break; }
    }
    y ??= chip.wantedY;
    const anchorX = chip.cx >= right ? right : chip.cx <= left ? left : Math.max(left, Math.min(right, chip.cx));
    const angle = Math.atan2(chip.cy - y, chip.cx - anchorX) * 180 / Math.PI;
    placed.push({ id: chip.id, x, y, angle });
  }
  return placed;
}
