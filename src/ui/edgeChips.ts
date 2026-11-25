import type { Bounds } from '../core/layout';
import type { Cam, Sides } from './camera';

export const CHIP_WIDTH = 300;
export const CHIP_HEIGHT = 30;
const COLUMN_GAP = 6;

const TOP_ROW = 92 + COLUMN_GAP + CHIP_HEIGHT / 2;
/** The switcher in voice.tsx sits 46px up on desktop, 188px up from 761–1100px,
 * and 98px up on narrower screens. Its 36px height exceeds the canvas tabs' 78px reach. */
function bottomControlReach(width: number) {
  return (width <= 760 ? 98 : width <= 1100 ? 188 : 46) + 36;
}


export type Keepout = { x: number; y: number; w: number; h: number };

/** Screen positions for off-screen card pointers. Card IDs give ties a lasting order; `avoid` is kept uncovered. */
export function edgeChipPositions(targets: { id: string; b: Bounds }[], cam: Cam, side: Sides, width: number, height: number, avoid?: Keepout) {
  const top = TOP_ROW, bottom = height - bottomControlReach(width) - COLUMN_GAP - CHIP_HEIGHT / 2;
  
  if (bottom < top) return [];
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
    const columns: number[] = [];
    for (let column = 0; column <= candidates.length; column++) {
      const nextX = chip.x + column * step;
      if (nextX < left || nextX + chipWidth > right) break;
      columns.push(nextX);
    }
    
    if (avoid) {
      const beside = chip.cx >= right ? avoid.x - COLUMN_GAP - chipWidth : avoid.x + avoid.w + COLUMN_GAP;
      if (beside >= left && beside + chipWidth <= right && !columns.includes(beside)) columns.push(beside);
    }
    const covering = (nextX: number, y: number) => !!avoid && nextX < avoid.x + avoid.w + COLUMN_GAP && nextX + chipWidth > avoid.x - COLUMN_GAP && y + CHIP_HEIGHT / 2 > avoid.y - COLUMN_GAP && y - CHIP_HEIGHT / 2 < avoid.y + avoid.h + COLUMN_GAP;
    for (const nextX of columns) {
      const peers = placed.filter((p) => nextX < p.x + chipWidth + COLUMN_GAP && nextX + chipWidth + COLUMN_GAP > p.x);
      const covers = (y: number) => covering(nextX, y);
      const around = avoid ? [avoid.y - COLUMN_GAP - CHIP_HEIGHT / 2, avoid.y + avoid.h + COLUMN_GAP + CHIP_HEIGHT / 2] : [];
      const choices = [chip.wantedY, ...around, ...peers.flatMap((p) => [p.y - CHIP_HEIGHT, p.y + CHIP_HEIGHT])]
        .filter((candidate) => candidate >= top && candidate <= bottom)
        .sort((a, b) => Math.abs(a - chip.wantedY) - Math.abs(b - chip.wantedY) || b - a);
      const free = choices.find((candidate) => !covers(candidate) && peers.every((p) => Math.abs(candidate - p.y) >= CHIP_HEIGHT));
      if (free !== undefined) { x = nextX; y = free; break; }
    }
    
    y ??= [chip.wantedY, ...(avoid ? [avoid.y - COLUMN_GAP - CHIP_HEIGHT / 2, avoid.y + avoid.h + COLUMN_GAP + CHIP_HEIGHT / 2] : [])]
      .filter((candidate) => candidate >= top && candidate <= bottom && !covering(chip.x, candidate))[0] ?? chip.wantedY;
    const anchorX = chip.cx >= right ? right : chip.cx <= left ? left : Math.max(left, Math.min(right, chip.cx));
    const angle = Math.atan2(chip.cy - y, chip.cx - anchorX) * 180 / Math.PI;
    placed.push({ id: chip.id, x, y, angle });
  }
  return placed;
}
