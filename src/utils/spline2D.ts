import type { TrackData } from '../types/telemetry.ts';

export interface SplineSample {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export function sampleClosedCatmullRom(
  track: TrackData,
  distanceMeters: number,
  width: number,
  height: number
): SplineSample {
  const L = Math.max(1, track.lengthMeters);
  const wrappedDist = ((distanceMeters % L) + L) % L;
  // Rimuoviamo l'ultimo punto se coincide con il primo per chiudere l'anello pulitamente
  const rawPts = track.path2D;
  const ring =
    rawPts.length > 2 &&
    Math.hypot(rawPts[0].x - rawPts.at(-1)!.x, rawPts[0].y - rawPts.at(-1)!.y) < 1e-3
      ? rawPts.slice(0, -1)
      : rawPts;
  const n = ring.length;

  let segIdx = 0;
  let localT = 0;

  for (let i = 0; i < rawPts.length - 1; i++) {
    const a = rawPts[i];
    const b = rawPts[i + 1];
    if (wrappedDist >= a.distanceMeters && wrappedDist <= b.distanceMeters) {
      segIdx = i % n;
      const span = Math.max(1, b.distanceMeters - a.distanceMeters);
      localT = (wrappedDist - a.distanceMeters) / span;
      break;
    }
  }

  const p0 = ring[(segIdx - 1 + n) % n];
  const p1 = ring[segIdx % n];
  const p2 = ring[(segIdx + 1) % n];
  const p3 = ring[(segIdx + 2) % n];

  const x = catmullRom(p0.x, p1.x, p2.x, p3.x, localT) * width;
  const y = catmullRom(p0.y, p1.y, p2.y, p3.y, localT) * height;

  const eps = 0.02;
  const tNext = Math.min(1, localT + eps);
  const tPrev = Math.max(0, localT - eps);
  const dx =
    (catmullRom(p0.x, p1.x, p2.x, p3.x, tNext) -
      catmullRom(p0.x, p1.x, p2.x, p3.x, tPrev)) *
    width;
  const dy =
    (catmullRom(p0.y, p1.y, p2.y, p3.y, tNext) -
      catmullRom(p0.y, p1.y, p2.y, p3.y, tPrev)) *
    height;
  const len = Math.hypot(dx, dy) || 1;

  return { x, y, nx: -dy / len, ny: dx / len };
}

export function generateTrackSplinePolyline(
  track: TrackData,
  width: number,
  height: number,
  samples: number = 140
): SplineSample[] {
  const out: SplineSample[] = [];
  for (let i = 0; i < samples; i++) {
    const dist = (i / samples) * track.lengthMeters;
    out.push(sampleClosedCatmullRom(track, dist, width, height));
  }
  return out;
}
