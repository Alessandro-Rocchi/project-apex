import { useEffect, useRef } from 'react';
import type { RaceSimulationSnapshot } from '../engine/raceEngine';
import type { TrackData, TyreCompound } from '../types/telemetry';
import { generateTrackSplinePolyline, sampleClosedCatmullRom } from '../utils/spline2D';

interface TrackCanvasProps {
  track: TrackData;
  snapshot: RaceSimulationSnapshot;
  playerTeamId?: string;
}

const TYRE_RING_COLORS: Record<TyreCompound, string> = {
  SOFT: '#EF4444',
  MEDIUM: '#FACC15',
  HARD: '#F8FAFC',
  INTER: '#22C55E',
  WET: '#3B82F6',
};

export default function TrackCanvas({
  track,
  snapshot,
  playerTeamId = 'corsa-rossa',
}: TrackCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const poly = generateTrackSplinePolyline(track, width, height, 150);
    if (poly.length < 2) return;

    // Livello 0: Bussola Meteo / Acqua in alto a destra
    ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
    ctx.strokeStyle = 'rgba(55, 65, 81, 0.6)';
    ctx.lineWidth = 1;
    ctx.fillRect(width - 172, 10, 160, 42);
    ctx.strokeRect(width - 172, 10, 160, 42);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText(`METEO: ${snapshot.weather}`, width - 162, 26);
    ctx.fillStyle = snapshot.trackWaterLevel > 0.15 ? '#38bdf8' : '#10b981';
    ctx.fillText(
      `ACQUA: ${(snapshot.trackWaterLevel * 5.0).toFixed(1)} mm (${track.ambientTempCelsius}°C)`,
      width - 162,
      42
    );

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const drawClosedSpline = () => {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(poly[i].x, poly[i].y);
      }
      ctx.closePath();
    };

    // Livello 1: Ombra ed Esterno Pista (Bordo)
    drawClosedSpline();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 22;
    ctx.stroke();

    // Cordolo bianco/grigio sottile
    drawClosedSpline();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 17;
    ctx.stroke();

    // Livello 2: Zone DRS (linea parallela esterna verde brillante)
    for (const seg of track.segments) {
      if (!seg.isDrsZone) continue;
      ctx.beginPath();
      const steps = 18;
      for (let s = 0; s <= steps; s++) {
        const d = seg.startMeter + ((seg.endMeter - seg.startMeter) * s) / steps;
        const pt = sampleClosedCatmullRom(track, d, width, height);
        const ox = pt.x + pt.nx * 11;
        const oy = pt.y + pt.ny * 11;
        if (s === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
      }
      ctx.strokeStyle = '#22C55E';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Livello 3: Nastro d'Asfalto (vira al blu-ardesia se bagnato) + Pit Lane
    drawClosedSpline();
    ctx.strokeStyle = snapshot.trackWaterLevel > 0.2 ? '#1E293B' : '#334155';
    ctx.lineWidth = 14;
    ctx.stroke();

    // Linea tratteggiata centrale
    drawClosedSpline();
    ctx.strokeStyle = snapshot.trackWaterLevel > 0.2 ? '#38bdf844' : '#64748b55';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Pit Lane (corsia interna parallela a cavallo del traguardo)
    ctx.beginPath();
    for (let s = -12; s <= 16; s++) {
      const d = (s / 16) * 420;
      const pt = sampleClosedCatmullRom(track, d, width, height);
      const px = pt.x - pt.nx * 12;
      const py = pt.y - pt.ny * 12;
      if (s === -12) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Tacche Settori S1, S2, S3
    for (const [idx, frac] of [
      ['S1', 1 / 3],
      ['S2', 2 / 3],
    ] as const) {
      const pt = sampleClosedCatmullRom(track, track.lengthMeters * frac, width, height);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pt.x - pt.nx * 9, pt.y - pt.ny * 9);
      ctx.lineTo(pt.x + pt.nx * 9, pt.y + pt.ny * 9);
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillText(idx, pt.x + pt.nx * 13 - 6, pt.y + pt.ny * 13 + 3);
    }

    // Livello 4: Linea del Traguardo a scacchi
    const startPt = sampleClosedCatmullRom(track, 0, width, height);
    ctx.strokeStyle = '#F8FAFC';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(startPt.x - startPt.nx * 10, startPt.y - startPt.ny * 10);
    ctx.lineTo(startPt.x + startPt.nx * 10, startPt.y + startPt.ny * 10);
    ctx.stroke();

    // Livello 5: Token Vetture (dall'ultima alla prima così il leader è in primo piano)
    for (const car of [...snapshot.cars].reverse()) {
      if (car.isRetired) continue;
      const pos = sampleClosedCatmullRom(track, car.distanceOnLapMeters, width, height);

      let lateralOffset = 0;
      if (car.isSideBySide) lateralOffset = 7.5;
      if (car.isInPitLane) lateralOffset = -12;

      const drawX = pos.x + pos.nx * lateralOffset;
      const drawY = pos.y + pos.ny * lateralOffset;
      const isPlayer = car.teamId === playerTeamId;

      ctx.save();
      if (isPlayer) {
        ctx.shadowColor = '#F59E0B';
        ctx.shadowBlur = 11;
      }

      // Alone DRS
      if (car.isDrsActive) {
        ctx.beginPath();
        ctx.arc(drawX, drawY, 12.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 197, 94, 0.32)';
        ctx.fill();
      }

      // Cerchio Scuderia (r = 8.5px) + Anello Colore Mescola (2px)
      ctx.beginPath();
      ctx.arc(drawX, drawY, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = car.teamColor;
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = TYRE_RING_COLORS[car.tyreCompound] ?? '#ffffff';
      ctx.stroke();
      ctx.restore();

      // T-Cam gialla sul bordo superiore per la seconda guida del team
      if (car.isSecondaryDriver) {
        ctx.beginPath();
        ctx.arc(drawX, drawY - 8.5, 2.3, 0, Math.PI * 2);
        ctx.fillStyle = '#FACC15';
        ctx.fill();
      }

      // 3 Lettere del pilota al centro del token
      ctx.fillStyle = car.teamColor.toUpperCase() === '#F8FAFC' ? '#090D16' : '#FFFFFF';
      ctx.font = 'bold 7.5px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(car.driverCode.slice(0, 3), drawX, drawY + 0.5);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }, [track, snapshot, playerTeamId]);

  return (
    <div className="bg-[#111827] border border-slate-700/40 rounded p-3">
      <div className="flex flex-wrap justify-between items-center mb-2 text-[11px] text-slate-400 gap-2">
        <span className="font-semibold uppercase tracking-wider text-slate-200">
          RADAR TATTICO GPS // {track.name}
        </span>
        <div className="flex flex-wrap items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 inline-block" />
            Tuo Team
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border-2 border-[#EF4444] inline-block" />S
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border-2 border-[#FACC15] inline-block" />M
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border-2 border-[#F8FAFC] inline-block" />H
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border-2 border-[#22C55E] inline-block" />I
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border-2 border-[#3B82F6] inline-block" />W
          </span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={800}
        height={350}
        className="w-full h-auto rounded border border-slate-800 bg-[#090D16] bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px]"
      />
    </div>
  );
}
