import type {
  Driver,
  Team,
  TrackData,
  TyreCompound,
  WeatherCondition,
} from '../types/telemetry.ts';
import { deriveCarPhysics } from './carPhysicsMapper.ts';

export type QualifyingStage = 'Q1' | 'Q2' | 'Q3' | 'FINISHED';
export type ExitTimingOption = 'EARLY' | 'MID' | 'LATE';

export interface QualifyingDriverOrder {
  driverId: string;
  compound: TyreCompound;
  exitTiming: ExitTimingOption;
}

export interface QualifyingDriverResult {
  driverId: string;
  driverCode: string;
  driverName: string;
  driverNumber: number;
  teamId: string;
  teamName: string;
  teamColor: string;
  position: number;
  q1TimeSec: number | null;
  q2TimeSec: number | null;
  q3TimeSec: number | null;
  activeTimeSec: number | null;
  compound: TyreCompound;
  eliminatedIn: 'Q1' | 'Q2' | null;
}

export interface QualifyingSessionState {
  stage: QualifyingStage;
  weather: WeatherCondition;
  trackWaterLevel: number;
  results: QualifyingDriverResult[];
}

const DRY_TYRE_DELTA: Record<TyreCompound, number> = {
  SOFT: 0.0,
  MEDIUM: 0.55,
  HARD: 1.15,
  INTER: 3.2,
  WET: 5.8,
};

function computeReferenceTrackTimeSec(track: TrackData): number {
  let totalSec = 0;
  for (const seg of track.segments) {
    const len = Math.max(1, seg.endMeter - seg.startMeter);
    totalSec += len / Math.max(20, seg.referenceSpeedMs);
  }
  return totalSec;
}

export function createQualifyingSession(
  teams: Team[],
  drivers: Driver[],
  weather: WeatherCondition = 'DRY'
): QualifyingSessionState {
  const activeDrivers =
    drivers.filter((d) => d.role === 'PRIMARY' || d.role === 'SECONDARY').length > 0
      ? drivers.filter((d) => d.role === 'PRIMARY' || d.role === 'SECONDARY')
      : drivers;

  const trackWaterLevel =
    weather === 'HEAVY_RAIN' ? 0.72 : weather === 'LIGHT_RAIN' ? 0.35 : 0.0;
  const defaultCompound: TyreCompound =
    weather === 'HEAVY_RAIN' ? 'WET' : weather === 'LIGHT_RAIN' ? 'INTER' : 'SOFT';

  const results: QualifyingDriverResult[] = activeDrivers.map((d, idx) => {
    const team = teams.find((t) => t.id === d.teamId) ?? teams[0];
    return {
      driverId: d.id,
      driverCode: d.code,
      driverName: d.name,
      driverNumber: d.number,
      teamId: team.id,
      teamName: team.name,
      teamColor: team.colorHex,
      position: idx + 1,
      q1TimeSec: null,
      q2TimeSec: null,
      q3TimeSec: null,
      activeTimeSec: null,
      compound: defaultCompound,
      eliminatedIn: null,
    };
  });

  return {
    stage: 'Q1',
    weather,
    trackWaterLevel,
    results,
  };
}

export function runQualifyingStage(
  state: QualifyingSessionState,
  teams: Team[],
  drivers: Driver[],
  track: TrackData,
  setupConfidences: Record<string, number>,
  playerOrders: Record<string, QualifyingDriverOrder> = {}
): QualifyingSessionState {
  if (state.stage === 'FINISHED') return state;

  const currentStage = state.stage;
  const baseTrackTime = computeReferenceTrackTimeSec(track);
  const water = state.trackWaterLevel;
  const stageSeed = currentStage === 'Q1' ? 11.3 : currentStage === 'Q2' ? 23.7 : 37.9;

  const updatedResults: QualifyingDriverResult[] = state.results.map((r) => ({ ...r }));

  for (const res of updatedResults) {
    if (res.eliminatedIn !== null) continue;

    const drv = drivers.find((d) => d.id === res.driverId) ?? drivers[0];
    const team = teams.find((t) => t.id === res.teamId) ?? teams[0];
    const phys = deriveCarPhysics(team.components, 0);

    const order = playerOrders[res.driverId];
    const defaultComp: TyreCompound =
      water >= 0.58 ? 'WET' : water >= 0.2 ? 'INTER' : 'SOFT';
    const compound: TyreCompound = order?.compound ?? defaultComp;
    const exitTiming: ExitTimingOption = order?.exitTiming ?? 'MID';

    // Contributo monoposto pesato sui segmenti del circuito
    const carComposite =
      phys.power * 0.30 +
      phys.aeroEfficiency * 0.20 +
      phys.downforce * 0.30 +
      phys.mechanicalGrip * 0.20;
    const carBonusSec = ((carComposite - 75) / 25) * 2.1;

    // Contributo pilota + setup
    const conf =
      setupConfidences[res.driverId] ??
      setupConfidences[`car-${res.driverNumber}`] ??
      90;
    const driverSkill = water >= 0.2 ? drv.pace * 0.6 + drv.wetSkill * 0.4 : drv.pace;
    const driverBonusSec = ((driverSkill - 75) / 25) * 1.15 + ((conf - 80) / 20) * 0.35;

    // Penalità mescola rispetto a condizioni pista
    let tyreDeltaSec: number;
    if (water < 0.2) {
      tyreDeltaSec = DRY_TYRE_DELTA[compound];
    } else if (water < 0.58) {
      tyreDeltaSec = compound === 'INTER' ? 0.0 : compound === 'WET' ? 0.95 : 3.4;
    } else {
      tyreDeltaSec = compound === 'WET' ? 0.0 : compound === 'INTER' ? 1.35 : 6.2;
    }

    // Timing uscita in pista (evoluzione grip vs rischio traffico/bandiera gialla)
    const randVal =
      ((Math.sin(drv.number * stageSeed + baseTrackTime) * 10000) % 1 + 1) % 1;
    let timingDeltaSec: number;
    if (exitTiming === 'EARLY') {
      timingDeltaSec = 0.16; // Pista ancora "verde", ma zero traffico
    } else if (exitTiming === 'MID') {
      timingDeltaSec = 0.05 + (randVal > 0.92 ? 0.28 : 0);
    } else {
      timingDeltaSec = -0.14 + (randVal > 0.83 ? 0.48 : 0); // Massima gommatura pista vs rischio traffico
    }

    // Micro-varianza legata alla consistency
    const pushDeltaSec = -0.12;
    const consistencyNoise =
      (randVal - 0.5) * (100 - (drv.consistency ?? 88)) * 0.012 * 1.35;

    const stageEvolutionSec =
      currentStage === 'Q1' ? 0.35 : currentStage === 'Q2' ? 0.15 : 0.0;

    const finalLapSec = Number(
      (
        baseTrackTime -
        carBonusSec -
        driverBonusSec +
        tyreDeltaSec +
        timingDeltaSec +
        pushDeltaSec +
        stageEvolutionSec +
        consistencyNoise
      ).toFixed(3)
    );

    res.compound = compound;
    res.activeTimeSec = finalLapSec;
    if (currentStage === 'Q1') res.q1TimeSec = finalLapSec;
    if (currentStage === 'Q2') res.q2TimeSec = finalLapSec;
    if (currentStage === 'Q3') res.q3TimeSec = finalLapSec;
  }

  // Ordiniamo i piloti: prima chi è ancora attivo (per activeTimeSec crescente), poi gli eliminati nei turni precedenti
  const activePool = updatedResults
    .filter((r) => r.eliminatedIn === null)
    .sort((a, b) => (a.activeTimeSec ?? 999) - (b.activeTimeSec ?? 999));

  const eliminatedQ2 = updatedResults
    .filter((r) => r.eliminatedIn === 'Q2')
    .sort((a, b) => (a.q2TimeSec ?? 999) - (b.q2TimeSec ?? 999));

  const eliminatedQ1 = updatedResults
    .filter((r) => r.eliminatedIn === 'Q1')
    .sort((a, b) => (a.q1TimeSec ?? 999) - (b.q1TimeSec ?? 999));

  if (currentStage === 'Q1') {
    activePool.forEach((r, idx) => {
      if (idx >= 15) r.eliminatedIn = 'Q1';
    });
  } else if (currentStage === 'Q2') {
    activePool.forEach((r, idx) => {
      if (idx >= 10) r.eliminatedIn = 'Q2';
    });
  }

  const finalOrdered =
    currentStage === 'Q1'
      ? activePool
      : currentStage === 'Q2'
      ? [...activePool, ...eliminatedQ1]
      : [...activePool, ...eliminatedQ2, ...eliminatedQ1];

  finalOrdered.forEach((r, idx) => {
    r.position = idx + 1;
  });

  const nextStage: QualifyingStage =
    currentStage === 'Q1' ? 'Q2' : currentStage === 'Q2' ? 'Q3' : 'FINISHED';

  return {
    ...state,
    stage: nextStage,
    results: finalOrdered,
  };
}

export function runFullQualifyingAuto(
  state: QualifyingSessionState,
  teams: Team[],
  drivers: Driver[],
  track: TrackData,
  setupConfidences: Record<string, number>
): QualifyingSessionState {
  let curr = state;
  while (curr.stage !== 'FINISHED') {
    curr = runQualifyingStage(curr, teams, drivers, track, setupConfidences);
  }
  return curr;
}
