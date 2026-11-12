import { INITIAL_TRACKS } from '../data/defaultDb.ts';
import type {
  CarRaceState,
  Driver,
  ErsMode,
  FuelMode,
  PaceMode,
  RaceControlStatus,
  RaceDistancePreset,
  SectorColor,
  Team,
  TrackData,
  TrackSegment,
  TyreCompound,
  WeatherCondition,
} from '../types/telemetry.ts';
import { evaluateAiPitStrategy } from './aiStrategist.ts';
import { deriveCarPhysics } from './carPhysicsMapper.ts';

export interface PreRaceCarConfig {
  carId: string;
  driverId?: string;
  gridPosition?: number;
  setupConfidence: number;
  startCompound: TyreCompound;
  fuelKg: number;
  brokeParcFerme: boolean;
}

export interface RaceSimulationSnapshot {
  raceTimeSec: number;
  currentLap: number;
  totalLaps: number;
  distancePreset: RaceDistancePreset;
  weather: WeatherCondition;
  trackWaterLevel: number; // 0.00 (asciutto) -> 1.00 (allagato 5mm)
  raceControl: RaceControlStatus;
  safetyCarLapsRemaining: number;
  vscLapsRemaining: number;
  bestLapTimeSec: number | null;
  bestLapDriverCode: string | null;
  overallBestSectors: [number | null, number | null, number | null];
  isFinished: boolean;
  cars: CarRaceState[];
  radioLog: string[];
}

interface TyreCompoundSpec {
  gripBonus: number;
  baseWearPerSec: number;
  optTempMin: number;
  optTempMax: number;
  heatRate: number;
}

const TYRE_SPECS: Record<TyreCompound, TyreCompoundSpec> = {
  SOFT: { gripBonus: 0.028, baseWearPerSec: 0.00050, optTempMin: 90, optTempMax: 110, heatRate: 1.3 },
  MEDIUM: { gripBonus: 0.015, baseWearPerSec: 0.00034, optTempMin: 85, optTempMax: 105, heatRate: 1.0 },
  HARD: { gripBonus: 0.004, baseWearPerSec: 0.00024, optTempMin: 80, optTempMax: 100, heatRate: 0.8 },
  INTER: { gripBonus: 0.008, baseWearPerSec: 0.00036, optTempMin: 65, optTempMax: 90, heatRate: 1.1 },
  WET: { gripBonus: -0.006, baseWearPerSec: 0.00030, optTempMin: 55, optTempMax: 80, heatRate: 0.9 },
};

const PACE_MODIFIERS: Record<
  PaceMode,
  { speedMod: number; wearMult: number; tempTargetOffset: number; errorRiskMult: number }
> = {
  1: { speedMod: -0.015, wearMult: 0.65, tempTargetOffset: -10, errorRiskMult: 0.35 },
  2: { speedMod: -0.007, wearMult: 0.82, tempTargetOffset: -5, errorRiskMult: 0.65 },
  3: { speedMod: 0.000, wearMult: 1.00, tempTargetOffset: 0, errorRiskMult: 1.00 },
  4: { speedMod: 0.008, wearMult: 1.22, tempTargetOffset: +6, errorRiskMult: 1.35 },
  5: { speedMod: 0.015, wearMult: 1.48, tempTargetOffset: +11, errorRiskMult: 1.85 },
};

const FUEL_MODIFIERS: Record<FuelMode, { speedMod: number; burnRateKgPerSec: number }> = {
  LIFT_COAST: { speedMod: -0.009, burnRateKgPerSec: 0.0052 },
  STANDARD: { speedMod: 0.000, burnRateKgPerSec: 0.0068 },
  RICH: { speedMod: 0.007, burnRateKgPerSec: 0.0085 },
};

const ERS_MODIFIERS: Record<ErsMode, { speedBonusMs: number; batteryDeltaPerSec: number }> = {
  HARVEST: { speedBonusMs: -1.1, batteryDeltaPerSec: +1.8 },
  NEUTRAL: { speedBonusMs: 0.0, batteryDeltaPerSec: +0.15 },
  DEPLOY: { speedBonusMs: +1.4, batteryDeltaPerSec: -1.4 },
  OVERTAKE: { speedBonusMs: +2.9, batteryDeltaPerSec: -3.0 },
};

export function getScaledTrackLaps(
  track: TrackData,
  preset: RaceDistancePreset = 'SPRINT_25'
): {
  totalLaps: number;
  wearScale: number;
  fuelScale: number;
  defaultFuelKg: number;
} {
  const baseLaps = track.totalLaps > 20 ? track.totalLaps : 56;
  if (preset === 'SPRINT_25') {
    const totalLaps = track.totalLaps <= 20 ? track.totalLaps : Math.max(14, Math.round(baseLaps * 0.27));
    return {
      totalLaps,
      wearScale: 3.4,
      fuelScale: 3.4,
      defaultFuelKg: 28.0,
    };
  }
  if (preset === 'STANDARD_50') {
    const totalLaps = Math.max(24, Math.round(baseLaps * 0.5));
    return {
      totalLaps,
      wearScale: 1.8,
      fuelScale: 1.8,
      defaultFuelKg: 54.0,
    };
  }
  return {
    totalLaps: baseLaps,
    wearScale: 1.0,
    fuelScale: 1.0,
    defaultFuelKg: 105.0,
  };
}

export function getCurrentSegment(track: TrackData, distanceMeters: number): TrackSegment {
  const d = ((distanceMeters % track.lengthMeters) + track.lengthMeters) % track.lengthMeters;
  return track.segments.find((s) => d >= s.startMeter && d <= s.endMeter) ?? track.segments.at(-1)!;
}

function getSectorIndex(distanceOnLapMeters: number, lengthMeters: number): 0 | 1 | 2 {
  const ratio = Math.max(0, distanceOnLapMeters) / Math.max(1, lengthMeters);
  if (ratio < 1 / 3) return 0;
  if (ratio < 2 / 3) return 1;
  return 2;
}

export function createInitialRaceState(
  teams: Team[],
  drivers: Driver[],
  configs: PreRaceCarConfig[] = [],
  options?: {
    track?: TrackData;
    distancePreset?: RaceDistancePreset;
    initialWeather?: WeatherCondition;
  }
): RaceSimulationSnapshot {
  const track = options?.track ?? INITIAL_TRACKS[0];
  const distancePreset = options?.distancePreset ?? 'SPRINT_25';
  const scaled = getScaledTrackLaps(track, distancePreset);
  const weather: WeatherCondition = options?.initialWeather ?? 'DRY';
  const initialWater =
    weather === 'HEAVY_RAIN' ? 0.68 : weather === 'LIGHT_RAIN' ? 0.32 : 0.0;

  // Se ci sono più di 20 piloti (inclusi Reserve/Free Agent), filtriamo i titolari (PRIMARY/SECONDARY)
  const raceDrivers =
    drivers.filter((d) => d.role === 'PRIMARY' || d.role === 'SECONDARY').length > 0
      ? drivers.filter((d) => d.role === 'PRIMARY' || d.role === 'SECONDARY')
      : drivers;

  // Ordiniamo per griglia di partenza se passata in configs, altrimenti ordine array
  const sortedDrivers = [...raceDrivers].sort((a, b) => {
    const cfgA = configs.find((c) => c.carId === `car-${a.number}` || c.driverId === a.id);
    const cfgB = configs.find((c) => c.carId === `car-${b.number}` || c.driverId === b.id);
    const posA = cfgA?.gridPosition ?? 999;
    const posB = cfgB?.gridPosition ?? 999;
    return posA - posB;
  });

  const extraLogs: string[] = [];

  const cars: CarRaceState[] = sortedDrivers.map((drv, index) => {
    const team = teams.find((t) => t.id === drv.teamId) ?? teams[0];
    const carId = `car-${drv.number}`;
    const cfg = configs.find((c) => c.carId === carId || c.driverId === drv.id);

    const defaultCompound: TyreCompound =
      weather === 'HEAVY_RAIN'
        ? 'WET'
        : weather === 'LIGHT_RAIN'
        ? 'INTER'
        : index < 6
        ? 'SOFT'
        : 'MEDIUM';

    const startCompound: TyreCompound = cfg?.startCompound ?? defaultCompound;
    const isWetStart = startCompound === 'INTER' || startCompound === 'WET';
    const startDist = cfg?.brokeParcFerme ? -(sortedDrivers.length * 12 + 40) : -index * 12;

    if (cfg?.brokeParcFerme) {
      extraLogs.push(
        `[FIA STEWARDS]: ${drv.code} parte dalla Pit-Lane per modifica assetto in regime di Parco Chiuso!`
      );
    }

    return {
      carId,
      driverId: drv.id,
      driverCode: drv.code,
      driverName: drv.name,
      driverNumber: drv.number,
      isSecondaryDriver: drv.role === 'SECONDARY',
      teamId: team.id,
      teamName: team.name,
      teamColor: team.colorHex,
      position: index + 1,

      currentLap: 1,
      distanceOnLapMeters: startDist,
      totalDistanceMeters: startDist,
      currentSpeedMs: 0,
      gapToLeaderSec: index * 0.25,
      gapToAheadSec: index === 0 ? 0 : 0.25,
      lastLapTimeSec: null,
      bestLapTimeSec: null,
      currentLapStartTimeSec: 0,

      currentSectorIndex: 0,
      sectorStartTimeSec: 0,
      sectorTimesSec: [null, null, null],
      bestSectorTimesSec: [null, null, null],
      sectorColors: ['NONE', 'NONE', 'NONE'],

      tyreCompound: startCompound,
      tyreWear: 1.0,
      tyreAgeLaps: 0,
      tyreTempCelsius: isWetStart ? 70 : 92,
      usedDryCompounds: isWetStart ? [] : [startCompound],
      usedWetCompounds: isWetStart || initialWater > 0.15,
      isDisqualified: false,

      frontWingDamage: 0,
      repairDamageOnStop: true,
      isRetired: false,
      retirementReason: null,

      fuelKg: cfg?.fuelKg ?? scaled.defaultFuelKg,
      ersBatteryPercent: 100,
      isDrsActive: false,
      hasDrsAvailable: false,
      isSideBySide: false,
      isInPitLane: false,
      pitStopTimerSec: 0,
      stopsCompleted: 0,

      paceMode: 3,
      fuelMode: 'STANDARD',
      ersMode: 'NEUTRAL',
      teamOrder: 'NONE',
      pitBoxRequested: false,
      nextTyreCompound: isWetStart
        ? 'MEDIUM'
        : startCompound === 'SOFT'
        ? 'MEDIUM'
        : 'HARD',
      setupConfidence: cfg?.setupConfidence ?? 92,

      lapHistory: [],
      positionHistory: [index + 1],
    };
  });

  cars.sort((a, b) => b.totalDistanceMeters - a.totalDistanceMeters);
  cars.forEach((c, idx) => {
    c.position = idx + 1;
    c.gapToAheadSec = idx === 0 ? 0 : 0.25;
    c.gapToLeaderSec = idx * 0.25;
  });

  return {
    raceTimeSec: 0,
    currentLap: 1,
    totalLaps: scaled.totalLaps,
    distancePreset,
    weather,
    trackWaterLevel: initialWater,
    raceControl: 'GREEN',
    safetyCarLapsRemaining: 0,
    vscLapsRemaining: 0,
    bestLapTimeSec: null,
    bestLapDriverCode: null,
    overallBestSectors: [null, null, null],
    isFinished: false,
    cars,
    radioLog: [
      ...extraLogs,
      `[DIREZIONE GARA]: Semaforo verde! GP avviato (${scaled.totalLaps} giri, meteo: ${weather}).`,
    ],
  };
}

export function stepRaceSimulation(
  prev: RaceSimulationSnapshot,
  track: TrackData,
  teams: Team[],
  drivers: Driver[],
  dtSec: number = 0.1,
  playerTeamId: string = 'corsa-rossa'
): RaceSimulationSnapshot {
  if (prev.isFinished) return prev;

  const scaled = getScaledTrackLaps(track, prev.distancePreset ?? 'SPRINT_25');
  const totalLaps = prev.totalLaps || scaled.totalLaps;
  const newRaceTimeSec = Number((prev.raceTimeSec + dtSec).toFixed(2));
  const newRadioMessages: string[] = [];

  let weather = prev.weather;
  let trackWaterLevel = prev.trackWaterLevel;
  let raceControl = prev.raceControl;
  let safetyCarLapsRemaining = prev.safetyCarLapsRemaining;
  let vscLapsRemaining = prev.vscLapsRemaining ?? 0;
  let bestLapTimeSec = prev.bestLapTimeSec;
  let bestLapDriverCode = prev.bestLapDriverCode;
  const overallBestSectors: [number | null, number | null, number | null] = [
    ...prev.overallBestSectors,
  ];

  // Evoluzione livello acqua in pista verso il target meteo
  const waterTarget =
    weather === 'HEAVY_RAIN' ? 0.82 : weather === 'LIGHT_RAIN' ? 0.38 : 0.0;
  const waterRate = weather === 'DRY' ? 0.0025 : 0.0042;
  trackWaterLevel = Number(
    Math.max(
      0,
      Math.min(1, trackWaterLevel + Math.sign(waterTarget - trackWaterLevel) * waterRate * dtSec)
    ).toFixed(4)
  );

  const updatedCars: CarRaceState[] = prev.cars.map((c) => ({
    ...c,
    sectorTimesSec: [...c.sectorTimesSec] as [number | null, number | null, number | null],
    bestSectorTimesSec: [...c.bestSectorTimesSec] as [number | null, number | null, number | null],
    sectorColors: [...c.sectorColors] as [SectorColor, SectorColor, SectorColor],
  }));

  // --- ORDINI DI SCUDERIA: SWAP_POSITIONS TRA COMPAGNI DI SQUADRA ---
  for (let i = 1; i < updatedCars.length; i++) {
    const carBehind = updatedCars[i];
    const carAhead = updatedCars[i - 1];
    if (
      !carBehind.isRetired &&
      !carAhead.isRetired &&
      !carBehind.isInPitLane &&
      !carAhead.isInPitLane &&
      carBehind.teamId === carAhead.teamId &&
      (carBehind.teamOrder === 'SWAP_POSITIONS' || carAhead.teamOrder === 'SWAP_POSITIONS')
    ) {
      const distGap = carAhead.totalDistanceMeters - carBehind.totalDistanceMeters;
      if (distGap >= 0 && distGap <= 180) {
        const aheadDist = carAhead.totalDistanceMeters;
        carAhead.totalDistanceMeters = carBehind.totalDistanceMeters;
        carBehind.totalDistanceMeters = aheadDist + 4.0;
        carAhead.distanceOnLapMeters =
          ((carAhead.totalDistanceMeters % track.lengthMeters) + track.lengthMeters) %
          track.lengthMeters;
        carBehind.distanceOnLapMeters =
          ((carBehind.totalDistanceMeters % track.lengthMeters) + track.lengthMeters) %
          track.lengthMeters;
        carBehind.teamOrder = 'NONE';
        carAhead.teamOrder = 'NONE';
        newRadioMessages.push(
          `[TEAM ORDER ${carBehind.driverCode}]: Ordine di scuderia eseguito — ${carBehind.driverCode} passa davanti a ${carAhead.driverCode}.`
        );
      }
    }
  }

  for (let i = 0; i < updatedCars.length; i++) {
    const car = updatedCars[i];
    if (car.isRetired) {
      car.currentSpeedMs = 0;
      car.isDrsActive = false;
      car.isSideBySide = false;
      continue;
    }

    const carAhead =
      i > 0 ? updatedCars.slice(0, i).reverse().find((c) => !c.isRetired) ?? null : null;
    const driver = drivers.find((d) => d.id === car.driverId) ?? drivers[0];
    const team = teams.find((t) => t.id === car.teamId) ?? teams[0];

    // Se la vettura ha finito il carburante, procede a velocità ridotta di sicurezza
    if (car.fuelKg <= 0) {
      car.currentSpeedMs = 15;
      car.distanceOnLapMeters += car.currentSpeedMs * dtSec;
      car.totalDistanceMeters += car.currentSpeedMs * dtSec;
      continue;
    }

    // --- A. GESTIONE SOSTA AI BOX (PIT LANE) ---
    if (car.isInPitLane) {
      car.pitStopTimerSec -= dtSec;
      car.currentSpeedMs = 22.2; // Limitatore Pit-Lane: 80 km/h (22.2 m/s)
      car.isDrsActive = false;
      car.isSideBySide = false;

      if (car.pitStopTimerSec <= 0) {
        const newCompound = car.nextTyreCompound;
        const wasDamaged = car.repairDamageOnStop && car.frontWingDamage > 0;
        car.tyreCompound = newCompound;
        car.tyreWear = 1.0;
        car.tyreAgeLaps = 0;
        car.tyreTempCelsius = newCompound === 'INTER' || newCompound === 'WET' ? 68 : 74;
        if (newCompound === 'INTER' || newCompound === 'WET') {
          car.usedWetCompounds = true;
        } else if (!car.usedDryCompounds.includes(newCompound)) {
          car.usedDryCompounds = [...car.usedDryCompounds, newCompound];
        }
        if (wasDamaged) {
          car.frontWingDamage = 0;
        }
        car.stopsCompleted += 1;
        car.isInPitLane = false;
        car.pitStopTimerSec = 0;
        newRadioMessages.push(
          `[BOX ${car.driverCode}]: Sosta #${car.stopsCompleted} completata. Montata gomma ${newCompound}${
            wasDamaged ? ' + Ala Anteriore sostituita!' : '.'
          }`
        );
      } else {
        car.distanceOnLapMeters += car.currentSpeedMs * dtSec;
        car.totalDistanceMeters += car.currentSpeedMs * dtSec;
        continue;
      }
    }

    // --- B. SEGMENTO CORRENTE E CONTRIBUTO VETTURA/ASSETTO/DANNI ---
    const segment = getCurrentSegment(track, Math.max(0, car.distanceOnLapMeters));
    const effectivePhys = deriveCarPhysics(team.components, car.frontWingDamage);

    let carSegmentBonus: number;
    if (segment.type === 'STRAIGHT') {
      carSegmentBonus =
        (effectivePhys.power * 0.6 + effectivePhys.aeroEfficiency * 0.4 - 85) * 0.0012;
    } else if (segment.type === 'CORNER_SLOW') {
      carSegmentBonus =
        (effectivePhys.mechanicalGrip * 0.7 + effectivePhys.downforce * 0.3 - 85) * 0.0012;
    } else {
      carSegmentBonus =
        (effectivePhys.downforce * 0.75 + effectivePhys.mechanicalGrip * 0.25 - 85) * 0.0012;
    }

    const driverSkillBonus = (driver.pace - 85) * 0.001;
    const setupBonus = (car.setupConfidence - 85) * 0.0005;

    // --- C. TERMODINAMICA, METEO E DEGRADO GOMME ---
    const tyreSpec = TYRE_SPECS[car.tyreCompound];
    const paceKey: PaceMode =
      typeof car.paceMode === 'number' ? car.paceMode : 3;
    const paceSpec = PACE_MODIFIERS[paceKey] ?? PACE_MODIFIERS[3];

    const isCorner = segment.type !== 'STRAIGHT';
    const dirtyAirHeat = carAhead && car.gapToAheadSec < 1.4 && isCorner ? 6.5 : 0;
    const coolingFromWater = trackWaterLevel * 18;
    const segmentBaseTemp = (isCorner ? 98 : 88) - coolingFromWater;
    const targetTemp = segmentBaseTemp + paceSpec.tempTargetOffset + dirtyAirHeat;

    car.tyreTempCelsius +=
      (targetTemp - car.tyreTempCelsius) * 0.06 * tyreSpec.heatRate * dtSec;

    let thermalPenalty = 0;
    let overHeatWearMultiplier = 1.0;
    if (car.tyreTempCelsius < tyreSpec.optTempMin) {
      thermalPenalty = (tyreSpec.optTempMin - car.tyreTempCelsius) * 0.0015;
    } else if (car.tyreTempCelsius > tyreSpec.optTempMax) {
      thermalPenalty = (car.tyreTempCelsius - tyreSpec.optTempMax) * 0.0018;
      overHeatWearMultiplier = 1.65;
    }

    // Penalità/Bonus meteo in base ad acqua in pista e mescola
    const isSlick =
      car.tyreCompound === 'SOFT' ||
      car.tyreCompound === 'MEDIUM' ||
      car.tyreCompound === 'HARD';
    let weatherGripModifier = 0;
    let weatherWearMult = 1.0;

    if (trackWaterLevel > 0.15) {
      car.usedWetCompounds = true;
      const wetSkillFactor = 1 - (driver.wetSkill ?? 85) * 0.0032;
      if (isSlick) {
        weatherGripModifier = -trackWaterLevel * 0.22 * wetSkillFactor;
      } else if (car.tyreCompound === 'INTER') {
        weatherGripModifier =
          trackWaterLevel <= 0.62
            ? 0.018 - Math.abs(trackWaterLevel - 0.38) * 0.04
            : -(trackWaterLevel - 0.62) * 0.14 * wetSkillFactor;
      } else if (car.tyreCompound === 'WET') {
        weatherGripModifier =
          trackWaterLevel >= 0.50
            ? 0.022
            : -(0.50 - trackWaterLevel) * 0.09;
      }
    } else {
      // Pista asciutta con gomme da bagnato -> surriscaldamento e consumo rapido
      if (car.tyreCompound === 'INTER') {
        weatherGripModifier = -0.028;
        weatherWearMult = 2.2;
      } else if (car.tyreCompound === 'WET') {
        weatherGripModifier = -0.055;
        weatherWearMult = 2.6;
      }
    }

    const smoothnessFactor = 1 - (driver.smoothness - 80) * 0.006;
    const scWearReduction = raceControl === 'GREEN' ? 1.0 : 0.35;
    const wearDelta =
      tyreSpec.baseWearPerSec *
      scaled.wearScale *
      segment.abrasionFactor *
      paceSpec.wearMult *
      overHeatWearMultiplier *
      weatherWearMult *
      smoothnessFactor *
      scWearReduction *
      dtSec;

    const prevWear = car.tyreWear;
    car.tyreWear = Math.max(0, car.tyreWear - wearDelta);

    if (prevWear >= 0.25 && car.tyreWear < 0.25) {
      newRadioMessages.push(
        `[RADIO ${car.driverCode}]: "Le gomme sono crollate! Siamo nel Cliff (<25%), non ho più trazione!"`
      );
    }

    const linearWearLoss = (1 - car.tyreWear) * 0.032;
    const cliffLoss = car.tyreWear < 0.25 ? Math.pow(0.25 - car.tyreWear, 2) * 0.45 : 0;
    const netTyreModifier =
      tyreSpec.gripBonus - linearWearLoss - cliffLoss - thermalPenalty + weatherGripModifier;

    // --- D. CARBURANTE ED ERS (IBRIDO) ---
    const fuelSpec = FUEL_MODIFIERS[car.fuelMode];
    const scFuelReduction = raceControl === 'GREEN' ? 1.0 : 0.4;
    car.fuelKg = Math.max(
      0,
      car.fuelKg - fuelSpec.burnRateKgPerSec * scaled.fuelScale * scFuelReduction * dtSec
    );
    const fuelWeightPenalty = (car.fuelKg / scaled.defaultFuelKg) * 0.012;

    let activeErsMode = car.ersMode;
    if (
      (activeErsMode === 'DEPLOY' || activeErsMode === 'OVERTAKE') &&
      car.ersBatteryPercent <= 1
    ) {
      activeErsMode = 'NEUTRAL';
      car.ersMode = 'NEUTRAL';
    }
    const ersSpec = ERS_MODIFIERS[activeErsMode];
    car.ersBatteryPercent = Math.min(
      100,
      Math.max(0, car.ersBatteryPercent + ersSpec.batteryDeltaPerSec * dtSec)
    );

    // --- E. ARIA SPORCA, SCIA E DRS ---
    const prevDistOnLap = car.distanceOnLapMeters;
    let aeroInteractionMs = 0;
    car.isDrsActive = false;
    const drsEnabledByDirector =
      raceControl === 'GREEN' && trackWaterLevel < 0.18 && car.currentLap > 1;

    if (carAhead && !carAhead.isInPitLane && car.gapToAheadSec > 0 && raceControl === 'GREEN') {
      if (segment.type === 'STRAIGHT') {
        if (car.gapToAheadSec <= 1.2) {
          aeroInteractionMs += (1.2 - car.gapToAheadSec) * 1.6;
        }
        if (segment.isDrsZone && car.hasDrsAvailable && drsEnabledByDirector) {
          car.isDrsActive = true;
          aeroInteractionMs += 3.4;
        }
      } else {
        if (car.gapToAheadSec <= 1.5) {
          aeroInteractionMs -= (1.5 - car.gapToAheadSec) * 1.15;
        }
      }
    }

    // --- F. CALCOLO VELOCITÀ ISTANTANEA E REGIME SAFETY CAR / BANDIERA GIALLA ---
    const totalMultiplier =
      1 +
      carSegmentBonus +
      driverSkillBonus +
      setupBonus +
      netTyreModifier +
      paceSpec.speedMod +
      fuelSpec.speedMod -
      fuelWeightPenalty;

    let rawSpeedMs =
      segment.referenceSpeedMs * totalMultiplier + ersSpec.speedBonusMs + aeroInteractionMs;

    if (raceControl === 'SAFETY_CAR') {
      // Dietro la Safety Car il leader viaggia a velocità controllata e il gruppo si compatta a 0.45s
      rawSpeedMs =
        carAhead && car.gapToAheadSec > 0.55
          ? Math.min(rawSpeedMs, 64)
          : Math.min(rawSpeedMs, 48);
    } else if (raceControl === 'VIRTUAL_SAFETY_CAR') {
      rawSpeedMs = Math.min(rawSpeedMs * 0.62, segment.referenceSpeedMs * 0.62);
    } else if (raceControl === 'YELLOW') {
      rawSpeedMs = Math.min(rawSpeedMs, segment.referenceSpeedMs * 0.78);
    }

    car.currentSpeedMs = Math.max(20, rawSpeedMs);

    const stepMeters = car.currentSpeedMs * dtSec;
    car.distanceOnLapMeters += stepMeters;
    car.totalDistanceMeters += stepMeters;

    // --- AGGIORNAMENTO SETTORI CRONOMETRICI FIA (S1, S2, S3) ---
    if (car.distanceOnLapMeters >= 0 && car.distanceOnLapMeters < track.lengthMeters) {
      const newSecIdx = getSectorIndex(car.distanceOnLapMeters, track.lengthMeters);
      if (newSecIdx > car.currentSectorIndex) {
        const finishedSec = car.currentSectorIndex;
        const secTime = Number((newRaceTimeSec - car.sectorStartTimeSec).toFixed(3));
        if (secTime > 5) {
          car.sectorTimesSec[finishedSec] = secTime;
          const prevPersonal = car.bestSectorTimesSec[finishedSec];
          const prevOverall = overallBestSectors[finishedSec];
          if (prevOverall === null || secTime < prevOverall) {
            overallBestSectors[finishedSec] = secTime;
            car.bestSectorTimesSec[finishedSec] = secTime;
            car.sectorColors[finishedSec] = 'PURPLE';
          } else if (prevPersonal === null || secTime < prevPersonal) {
            car.bestSectorTimesSec[finishedSec] = secTime;
            car.sectorColors[finishedSec] = 'GREEN';
          } else {
            car.sectorColors[finishedSec] = 'YELLOW';
          }
        }
        car.currentSectorIndex = newSecIdx;
        car.sectorStartTimeSec = newRaceTimeSec;
      }
    }

    // Verifica passaggio sul DRS Detection Point
    if (
      prevDistOnLap < track.drsDetectionMeters &&
      car.distanceOnLapMeters >= track.drsDetectionMeters
    ) {
      car.hasDrsAvailable =
        carAhead !== null && car.gapToAheadSec <= 1.0 && drsEnabledByDirector;
    }

    // --- G. RISOLUZIONE SORPASSI RUOTA A RUOTA E ORDINI DI SCUDERIA ---
    car.isSideBySide = false;
    if (carAhead && !carAhead.isInPitLane) {
      const distGapMeters = carAhead.totalDistanceMeters - car.totalDistanceMeters;
      if (distGapMeters <= 4.5 && distGapMeters > -2.0) {
        // Se c'è Safety Car, Bandiera Gialla o ordine HOLD_POSITION col compagno, vietato sorpassare
        const holdTeamOrder =
          car.teamId === carAhead.teamId &&
          (car.teamOrder === 'HOLD_POSITION' || carAhead.teamOrder === 'HOLD_POSITION');

        if (raceControl !== 'GREEN' || holdTeamOrder) {
          car.totalDistanceMeters = Math.min(
            car.totalDistanceMeters,
            carAhead.totalDistanceMeters - 3.5
          );
          car.distanceOnLapMeters =
            ((car.totalDistanceMeters % track.lengthMeters) + track.lengthMeters) %
            track.lengthMeters;
          car.currentSpeedMs = carAhead.currentSpeedMs;
        } else {
          car.isSideBySide = true;
          const speedDelta = car.currentSpeedMs - carAhead.currentSpeedMs;
          const driverDefender =
            drivers.find((d) => d.id === carAhead.driverId) ?? drivers[0];
          const skillAdvantage = (driver.overtaking - driverDefender.defense) * 0.04;
          const requiredAdvantage = segment.overtakeDifficulty * 2.2;

          if (
            speedDelta + skillAdvantage < requiredAdvantage &&
            car.totalDistanceMeters >= carAhead.totalDistanceMeters - 2.5
          ) {
            car.totalDistanceMeters = carAhead.totalDistanceMeters - 2.8;
            car.distanceOnLapMeters =
              ((car.totalDistanceMeters % track.lengthMeters) + track.lengthMeters) %
              track.lengthMeters;
            car.currentSpeedMs = carAhead.currentSpeedMs;
          } else if (car.totalDistanceMeters > carAhead.totalDistanceMeters) {
            newRadioMessages.push(
              `[SORPASSO]: ${car.driverCode} supera ${carAhead.driverCode} a ${segment.name}!`
            );
          }
        }
      }
    }

    // --- H. COMPLETAMENTO GIRO, EVENTI DINAMICI, BOX E IA STRATEGICA ---
    if (car.distanceOnLapMeters >= track.lengthMeters) {
      car.distanceOnLapMeters -= track.lengthMeters;

      // Chiusura Settore 3
      const s3Time = Number((newRaceTimeSec - car.sectorStartTimeSec).toFixed(3));
      if (s3Time > 5) {
        car.sectorTimesSec[2] = s3Time;
        const prevPersonal = car.bestSectorTimesSec[2];
        const prevOverall = overallBestSectors[2];
        if (prevOverall === null || s3Time < prevOverall) {
          overallBestSectors[2] = s3Time;
          car.bestSectorTimesSec[2] = s3Time;
          car.sectorColors[2] = 'PURPLE';
        } else if (prevPersonal === null || s3Time < prevPersonal) {
          car.bestSectorTimesSec[2] = s3Time;
          car.sectorColors[2] = 'GREEN';
        } else {
          car.sectorColors[2] = 'YELLOW';
        }
      }
      car.currentSectorIndex = 0;
      car.sectorStartTimeSec = newRaceTimeSec;

      const lapTime = Number((newRaceTimeSec - car.currentLapStartTimeSec).toFixed(3));
      if (car.currentLap >= 1 && lapTime > 25) {
        car.lastLapTimeSec = lapTime;
        car.lapHistory = [...car.lapHistory, lapTime];
        if (car.bestLapTimeSec === null || lapTime < car.bestLapTimeSec) {
          car.bestLapTimeSec = lapTime;
        }
        if (bestLapTimeSec === null || lapTime < bestLapTimeSec) {
          bestLapTimeSec = lapTime;
          bestLapDriverCode = car.driverCode;
        }
      }
      car.currentLapStartTimeSec = newRaceTimeSec;
      car.currentLap += 1;
      car.tyreAgeLaps += 1;
      car.positionHistory = [...car.positionHistory, car.position];

      // Se il leader taglia il traguardo, aggiorniamo contatore Safety Car ed evoluzione meteo
      if (car.position === 1) {
        if (raceControl === 'YELLOW') {
          raceControl = 'GREEN';
          newRadioMessages.push('[DIREZIONE GARA]: Bandiera Verde! Pista libera.');
        } else if (raceControl === 'SAFETY_CAR') {
          safetyCarLapsRemaining -= 1;
          if (safetyCarLapsRemaining <= 0) {
            raceControl = 'GREEN';
            newRadioMessages.push(
              '[SAFETY CAR]: La Safety Car rientra ai box in questo giro! Ripristino Bandiera Verde.'
            );
          }
        } else if (raceControl === 'VIRTUAL_SAFETY_CAR') {
          vscLapsRemaining -= 1;
          if (vscLapsRemaining <= 0) {
            raceControl = 'GREEN';
            newRadioMessages.push(
              '[VSC TERMINATA]: Bandiera Verde! Ripristino del ritmo di gara.'
            );
          }
        }

        // Possibile cambio meteo a metà gara in base a baseRainChance
        if (
          car.currentLap === Math.round(totalLaps * 0.45) &&
          (track.baseRainChance ?? 0.15) >= 0.35 &&
          weather === 'DRY'
        ) {
          const roll = Math.sin(newRaceTimeSec * 13.7) * 0.5 + 0.5;
          if (roll < (track.baseRainChance ?? 0.35)) {
            weather = 'LIGHT_RAIN';
            newRadioMessages.push(
              '[METEO RADAR]: Inizia a piovere sul circuito! L’asfalto si sta bagnando rapidamente.'
            );
          }
        }
      }

      // Controllo stocastico Danni Ala / Guasti Meccanici a fine giro (solo in regime di bandiera verde)
      if (raceControl === 'GREEN' && car.currentLap < totalLaps) {
        const consistency = driver.consistency ?? 88;
        const reliability = effectivePhys.overallReliability ?? 90;
        const pseudoRand =
          ((Math.sin(newRaceTimeSec * 31.7 + car.driverNumber * 7.3) * 10000) % 1 + 1) % 1;

        const mechFailThreshold = (100 - reliability) * 0.00025;
        const driverErrorThreshold =
          mechFailThreshold + (100 - consistency) * 0.00055 * paceSpec.errorRiskMult;

        if (pseudoRand < mechFailThreshold) {
          car.isRetired = true;
          car.retirementReason = 'Guasto Power Unit / Cambio';
          const isOffTrack = (pseudoRand / Math.max(1e-6, mechFailThreshold)) < 0.65;
          if (isOffTrack) {
            raceControl = 'VIRTUAL_SAFETY_CAR';
            vscLapsRemaining = 2;
            newRadioMessages.push(
              `[VSC ATTIVATA]: ${car.driverCode} si ferma a bordo pista (${car.retirementReason}). Virtual Safety Car in pista!`
            );
          } else {
            raceControl = 'SAFETY_CAR';
            safetyCarLapsRemaining = 2;
            newRadioMessages.push(
              `[RITIRO & SAFETY CAR]: ${car.driverCode} si ferma in traiettoria (${car.retirementReason})! Safety Car in pista!`
            );
          }
          continue;
        } else if (pseudoRand < driverErrorThreshold && car.frontWingDamage === 0) {
          car.frontWingDamage = 35;
          newRadioMessages.push(
            `[DANNO ALA ${car.driverCode}]: Contatto sul cordolo! Danno all’ala anteriore (35%), perdita di carico aerodinamico.`
          );
        }
      }

      // Valutazione IA strategica per i team non controllati dal giocatore
      const isPlayerTeam = car.teamId === playerTeamId;
      const remainingLaps = Math.max(0, totalLaps - car.currentLap + 1);
      if (!isPlayerTeam && car.currentLap <= totalLaps) {
        const aiDecision = evaluateAiPitStrategy(car, prev, remainingLaps);
        car.paceMode = aiDecision.targetPace;
        car.ersMode = aiDecision.targetErs;
        if (aiDecision.requestPit) {
          car.pitBoxRequested = true;
          car.nextTyreCompound = aiDecision.compound;
          car.repairDamageOnStop = aiDecision.repairDamage;
        }
      }

      // Ingresso in Pit-Lane sul rettilineo del traguardo
      if (car.pitBoxRequested && car.currentLap <= totalLaps) {
        car.isInPitLane = true;
        car.pitBoxRequested = false;
        const basePitLoss =
          raceControl === 'SAFETY_CAR'
            ? track.pitLaneTimeLossSec * 0.65
            : track.pitLaneTimeLossSec;
        const wingRepairTime =
          car.repairDamageOnStop && car.frontWingDamage > 0 ? 4.5 : 0;
        car.pitStopTimerSec = Number((basePitLoss + wingRepairTime).toFixed(1));
        newRadioMessages.push(
          `[PIT ENTRY]: ${car.driverCode} entra ai box (${car.pitStopTimerSec.toFixed(1)}s stimati).`
        );
      }

      // Controllo Bandiera a Scacchi e Regola Obbligatoria Doppia Mescola (decade se gara bagnata)
      if (
        car.currentLap > totalLaps &&
        !car.usedWetCompounds &&
        trackWaterLevel < 0.15 &&
        car.usedDryCompounds.length < 2
      ) {
        car.isDisqualified = true;
        newRadioMessages.push(
          `[DIREZIONE GARA]: ${car.driverCode} SQUALIFICATO (DSQ) per non aver usato 2 mescole da asciutto!`
        );
      }
    }
  }

  // Ricalcolo Classifica (Auto attive -> Auto ritirate -> Auto squalificate)
  updatedCars.sort((a, b) => {
    if (a.isDisqualified !== b.isDisqualified) return a.isDisqualified ? 1 : -1;
    if (a.isRetired !== b.isRetired) return a.isRetired ? 1 : -1;
    return b.totalDistanceMeters - a.totalDistanceMeters;
  });

  const leaderDist = updatedCars[0]?.totalDistanceMeters ?? 0;
  updatedCars.forEach((car, idx) => {
    car.position = idx + 1;
    if (idx === 0 || car.isRetired) {
      car.gapToAheadSec = 0;
      car.gapToLeaderSec = 0;
    } else {
      const ahead = updatedCars[idx - 1];
      const refSpeed = Math.max(45, car.currentSpeedMs);
      car.gapToAheadSec = Number(
        (Math.max(0, ahead.totalDistanceMeters - car.totalDistanceMeters) / refSpeed).toFixed(3)
      );
      car.gapToLeaderSec = Number(
        (Math.max(0, leaderDist - car.totalDistanceMeters) / refSpeed).toFixed(3)
      );
    }
  });

  const activeCars = updatedCars.filter((c) => !c.isRetired);
  const maxLap = Math.min(
    totalLaps,
    Math.max(1, ...activeCars.map((c) => c.currentLap))
  );
  const isFinished =
    activeCars.length === 0 || activeCars.every((c) => c.currentLap > totalLaps);

  if (isFinished && !prev.isFinished && updatedCars[0]) {
    const leader = updatedCars[0];
    newRadioMessages.push(
      `[BANDIERA A SCACCHI]: Vincitore ${leader.driverName} (${leader.driverCode}) su ${leader.teamName}!`
    );
  }

  return {
    raceTimeSec: newRaceTimeSec,
    currentLap: maxLap,
    totalLaps,
    distancePreset: prev.distancePreset,
    weather,
    trackWaterLevel,
    raceControl,
    safetyCarLapsRemaining,
    vscLapsRemaining,
    bestLapTimeSec,
    bestLapDriverCode,
    overallBestSectors,
    isFinished,
    cars: updatedCars,
    radioLog: [...newRadioMessages, ...prev.radioLog].slice(0, 35),
  };
}
