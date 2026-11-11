import type {
  CarRaceState,
  ErsMode,
  PaceMode,
  TyreCompound,
} from '../types/telemetry.ts';
import type { RaceSimulationSnapshot } from './raceEngine.ts';

export function evaluateAiPitStrategy(
  car: CarRaceState,
  snapshot: RaceSimulationSnapshot,
  remainingLaps: number
): {
  requestPit: boolean;
  compound: TyreCompound;
  repairDamage: boolean;
  targetPace: PaceMode;
  targetErs: ErsMode;
} {
  const water = snapshot.trackWaterLevel;
  const isSlick =
    car.tyreCompound === 'SOFT' ||
    car.tyreCompound === 'MEDIUM' ||
    car.tyreCompound === 'HARD';

  // 1. Gestione passo ed ERS dinamico durante il giro
  let targetPace: PaceMode = 3;
  let targetErs: ErsMode = 'NEUTRAL';

  if (snapshot.raceControl !== 'GREEN') {
    targetPace = 1;
    targetErs = 'HARVEST';
  } else {
    if (car.tyreWear < 0.35) {
      targetPace = 2;
    } else if (car.gapToAheadSec > 0 && car.gapToAheadSec < 1.3 && car.tyreWear > 0.45) {
      targetPace = 4;
    } else if (remainingLaps <= 3 && car.tyreWear > 0.4) {
      targetPace = 5;
    }

    if (car.ersBatteryPercent > 75 && car.gapToAheadSec < 1.5 && car.position > 1) {
      targetErs = 'DEPLOY';
    } else if (car.ersBatteryPercent < 25) {
      targetErs = 'HARVEST';
    }
  }

  // Non fermarsi all'ultimo giro salvo emergenza totale
  if (remainingLaps <= 1) {
    return {
      requestPit: false,
      compound: car.nextTyreCompound,
      repairDamage: false,
      targetPace,
      targetErs,
    };
  }

  // Scelta mescola ideale in base a meteo e giri rimanenti
  const totalLaps = Math.max(10, snapshot.totalLaps);
  const remFraction = remainingLaps / totalLaps;

  let idealDryCompound: TyreCompound = 'HARD';
  if (remFraction <= 0.34) {
    idealDryCompound = 'SOFT';
  } else if (remFraction <= 0.65) {
    idealDryCompound = 'MEDIUM';
  }

  // Garantire l'uso di una seconda mescola d'asciutto diversa se non ha ancora smarcato l'obbligo
  if (car.usedDryCompounds.length === 1 && car.usedDryCompounds[0] === idealDryCompound) {
    idealDryCompound = idealDryCompound === 'MEDIUM' ? 'HARD' : 'MEDIUM';
  }

  // A. Emergenza Meteo: Pista bagnata con gomme da asciutto o viceversa
  if (water >= 0.58 && car.tyreCompound !== 'WET') {
    return {
      requestPit: true,
      compound: 'WET',
      repairDamage: car.frontWingDamage >= 25,
      targetPace,
      targetErs,
    };
  }
  if (water >= 0.22 && water < 0.58 && isSlick) {
    return {
      requestPit: true,
      compound: 'INTER',
      repairDamage: car.frontWingDamage >= 25,
      targetPace,
      targetErs,
    };
  }
  if (water < 0.14 && !isSlick && remainingLaps >= 3) {
    return {
      requestPit: true,
      compound: idealDryCompound,
      repairDamage: car.frontWingDamage >= 25,
      targetPace,
      targetErs,
    };
  }

  // B. Danno grave all'ala anteriore (>45%)
  if (car.frontWingDamage >= 45 && remainingLaps >= 3) {
    const nextComp = water >= 0.58 ? 'WET' : water >= 0.22 ? 'INTER' : idealDryCompound;
    return {
      requestPit: true,
      compound: nextComp,
      repairDamage: true,
      targetPace,
      targetErs,
    };
  }

  // C. Opportunità Safety Car (sosta scontata del 35%)
  if (
    snapshot.raceControl === 'SAFETY_CAR' &&
    car.tyreWear < 0.56 &&
    remainingLaps >= 4 &&
    car.tyreAgeLaps >= 3
  ) {
    const nextComp = water >= 0.58 ? 'WET' : water >= 0.22 ? 'INTER' : idealDryCompound;
    return {
      requestPit: true,
      compound: nextComp,
      repairDamage: car.frontWingDamage >= 20,
      targetPace,
      targetErs,
    };
  }

  // D. Usura gomme standard (< 30% prima del Cliff) o obbligo doppia mescola agli ultimi 2 giri
  const needsMandatoryStop =
    !car.usedWetCompounds &&
    water < 0.15 &&
    car.usedDryCompounds.length < 2 &&
    remainingLaps <= 2;

  if ((car.tyreWear < 0.30 && remainingLaps >= 2) || needsMandatoryStop) {
    const nextComp = water >= 0.58 ? 'WET' : water >= 0.22 ? 'INTER' : idealDryCompound;
    return {
      requestPit: true,
      compound: nextComp,
      repairDamage: car.frontWingDamage >= 20,
      targetPace,
      targetErs,
    };
  }

  return {
    requestPit: false,
    compound: car.nextTyreCompound,
    repairDamage: car.repairDamageOnStop,
    targetPace,
    targetErs,
  };
}
