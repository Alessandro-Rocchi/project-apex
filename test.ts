import assert from 'node:assert/strict';
import { DEFAULT_DB } from './src/data/defaultDb.ts';
import { deriveCarPhysics, validateCustomDatabase } from './src/engine/carPhysicsMapper.ts';

// Task 1 Tests: 10 teams, >=30 drivers, 12 tracks, zero forbidden real-world circuit/corner references
assert.equal(DEFAULT_DB.teams.length, 10);
assert.ok(DEFAULT_DB.drivers.length >= 30);
assert.equal(DEFAULT_DB.tracks.length, 12);

const serializedDb = JSON.stringify(DEFAULT_DB).toLowerCase();
for (const forbidden of [
  'monza',
  'monaco',
  'silverstone',
  'suzuka',
  'interlagos',
  'biassono',
  'parabolica',
  'ascari',
  'roggia',
  'lesmo',
  'serraglio',
]) {
  assert.equal(
    serializedDb.includes(forbidden),
    false,
    `Forbidden real-world reference found: ${forbidden}`
  );
}

// Verify 6 R&D components -> 4 physics attributes & front wing damage penalty
const basePhys = deriveCarPhysics(
  {
    powerUnit: { performance: 90, reliability: 92 },
    frontWing: { performance: 80, reliability: 88 },
    rearWing: { performance: 85, reliability: 90 },
    floor: { performance: 88, reliability: 86 },
    suspension: { performance: 84, reliability: 91 },
    brakes: { performance: 82, reliability: 93 },
  },
  0
);
assert.equal(basePhys.power, 90);
assert.equal(basePhys.aeroEfficiency, Math.round(80 * 0.4 + 85 * 0.6));
assert.equal(basePhys.downforce, Math.round(88 * 0.5 + 85 * 0.3 + 80 * 0.2));
assert.equal(basePhys.mechanicalGrip, Math.round(84 * 0.6 + 82 * 0.4));

const damagedPhys = deriveCarPhysics(
  {
    powerUnit: { performance: 90, reliability: 92 },
    frontWing: { performance: 80, reliability: 88 },
    rearWing: { performance: 85, reliability: 90 },
    floor: { performance: 88, reliability: 86 },
    suspension: { performance: 84, reliability: 91 },
    brakes: { performance: 82, reliability: 93 },
  },
  100
);
assert.ok(damagedPhys.downforce < basePhys.downforce);
assert.ok(damagedPhys.aeroEfficiency < basePhys.aeroEfficiency);

// Verify custom DB validation rejects invalid JSON structure
assert.equal(validateCustomDatabase({ teams: [] }).valid, false);
assert.equal(validateCustomDatabase(DEFAULT_DB).valid, true);

// Task 2 Tests: Race distance scaling, wet weather rules, wing damage repair, team orders, sectors, and Safety Car
import {
  createInitialRaceState,
  getScaledTrackLaps,
  stepRaceSimulation,
} from './src/engine/raceEngine.ts';
import { evaluateAiPitStrategy } from './src/engine/aiStrategist.ts';

const track0 = DEFAULT_DB.tracks[0];
const scaled25 = getScaledTrackLaps(track0, 'SPRINT_25');
const scaled100 = getScaledTrackLaps(track0, 'FULL_100');
assert.ok(scaled25.totalLaps < scaled100.totalLaps);
assert.ok(scaled25.wearScale > scaled100.wearScale);

// Wet race waives 2-dry-compound rule and starts on wet tyres
let wetSim = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
  track: track0,
  distancePreset: 'SPRINT_25',
  initialWeather: 'HEAVY_RAIN',
});
assert.equal(wetSim.cars.length, 20);
assert.ok(wetSim.trackWaterLevel >= 0.6);

// Wing damage repair adds pit stop time and resets frontWingDamage to 0
const targetCarId = wetSim.cars[0].carId;
wetSim.cars[0].frontWingDamage = 55;
wetSim.cars[0].repairDamageOnStop = true;
wetSim.cars[0].pitBoxRequested = true;
wetSim.cars[0].nextTyreCompound = 'WET';
wetSim.cars[0].distanceOnLapMeters = track0.lengthMeters - 5;
wetSim = stepRaceSimulation(wetSim, track0, DEFAULT_DB.teams, DEFAULT_DB.drivers, 0.5, 'corsa-rossa');
const pittedCar = wetSim.cars.find((c) => c.carId === targetCarId)!;
assert.equal(pittedCar.isInPitLane, true);
assert.ok(pittedCar.pitStopTimerSec > track0.pitLaneTimeLossSec);

// Team orders: SWAP_POSITIONS swaps two adjacent player teammates within 2.5s
let orderSim = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
  track: track0,
  distancePreset: 'SPRINT_25',
});
const pCars = orderSim.cars.filter((c) => c.teamId === 'corsa-rossa');
pCars[0].totalDistanceMeters = 1500;
pCars[0].distanceOnLapMeters = 1500;
pCars[1].totalDistanceMeters = 1485;
pCars[1].distanceOnLapMeters = 1485;
pCars[1].teamOrder = 'SWAP_POSITIONS';
orderSim = stepRaceSimulation(orderSim, track0, DEFAULT_DB.teams, DEFAULT_DB.drivers, 0.2, 'corsa-rossa');
const afterFirst = orderSim.cars.find((c) => c.carId === pCars[1].carId)!;
const afterSecond = orderSim.cars.find((c) => c.carId === pCars[0].carId)!;
assert.ok(afterFirst.position < afterSecond.position);

// Task 3 Tests: Qualifying Q1/Q2/Q3 elimination
import {
  createQualifyingSession,
  runFullQualifyingAuto,
  runQualifyingStage,
} from './src/engine/qualifyingEngine.ts';

let quali = createQualifyingSession(DEFAULT_DB.teams, DEFAULT_DB.drivers, 'DRY');
assert.equal(quali.stage, 'Q1');
quali = runQualifyingStage(quali, DEFAULT_DB.teams, DEFAULT_DB.drivers, track0, {});
assert.equal(quali.stage, 'Q2');
assert.equal(quali.results.filter((r) => r.eliminatedIn === 'Q1').length, 5);

quali = runFullQualifyingAuto(quali, DEFAULT_DB.teams, DEFAULT_DB.drivers, track0, {});
assert.equal(quali.stage, 'FINISHED');
assert.equal(quali.results.filter((r) => r.eliminatedIn === 'Q2').length, 5);
assert.equal(quali.results.filter((r) => r.q3TimeSec !== null).length, 10);

// Task 4 Tests: HQ Simulator (R&D, Budget Cap, Daily Calendar, Reserve FP1, Multi-Season) & Spline 2D
import {
  advanceCareerDays,
  applyRaceWeekendResults,
  createInitialCareerState,
  finalizeSeasonAndStartNext,
  getRdProjectQuote,
  runReserveDriverFp1,
  startRdProject,
} from './src/engine/hqSimulator.ts';
import { generateTrackSplinePolyline, sampleClosedCatmullRom } from './src/utils/spline2D.ts';

let career = createInitialCareerState(DEFAULT_DB, 'corsa-rossa', 'SPRINT_25');
const quote1 = getRdProjectQuote(career.db.teams[0], 'frontWing', 'PERFORMANCE');
assert.ok(quote1.costMillions > 0 && quote1.expectedGain >= 2);

const resRd = startRdProject(career, 'frontWing', 'PERFORMANCE');
assert.equal(resRd.ok, true);
career = resRd.state;
assert.equal(career.activeRdProjects.length, 1);

// Budget cap guard test
const overCapCareer = { ...career, budgetCapSpentMillions: 134.8 };
assert.equal(startRdProject(overCapCareer, 'powerUnit', 'PERFORMANCE').ok, false);

// Calendar stops on race weekend (day 14) even if asked to advance 30 days
const adv = advanceCareerDays(career, 30);
assert.equal(adv.reachedRaceWeekend, true);
assert.equal(adv.state.currentDay, 14);
assert.equal(adv.state.activeRdProjects.length, 0);

// Reserve driver in FP1 grants XP and sets round flag
const fp1State = runReserveDriverFp1(adv.state);
assert.equal(fp1State.reserveUsedInFp1ThisRound, true);

// Post-race points & End-of-season transition
const orderIds = career.db.drivers
  .filter((d) => d.role === 'PRIMARY' || d.role === 'SECONDARY')
  .map((d) => d.id);
const afterRace = applyRaceWeekendResults(
  fp1State,
  orderIds,
  orderIds.slice(0, 10),
  orderIds[0],
  []
);
assert.equal(afterRace.driverPoints[orderIds[0]], 26); // 25 + 1 fastest lap
const nextSeason = finalizeSeasonAndStartNext(afterRace);
assert.equal(nextSeason.season, 2);
assert.equal(nextSeason.budgetCapSpentMillions, 0);
assert.equal(nextSeason.currentRoundIndex, 0);

// Task 5 Tests: Closed Catmull-Rom spline
const pStart = sampleClosedCatmullRom(track0, 0, 800, 400);
const pEnd = sampleClosedCatmullRom(track0, track0.lengthMeters, 800, 400);
assert.ok(Math.hypot(pStart.x - pEnd.x, pStart.y - pEnd.y) < 1e-3);
const poly = generateTrackSplinePolyline(track0, 800, 400, 120);
assert.equal(poly.length, 120);

// Regression Tests: Parc Ferme starts P20 on 20-car grid & 50%/100% fuel scaling
const pfSim = createInitialRaceState(
  DEFAULT_DB.teams,
  DEFAULT_DB.drivers,
  [{ carId: 'car-16', setupConfidence: 95, startCompound: 'SOFT', fuelKg: 28, brokeParcFerme: true }],
  { track: track0, distancePreset: 'SPRINT_25' }
);
assert.equal(pfSim.cars.at(-1)?.carId, 'car-16');

const sim50 = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
  track: track0,
  distancePreset: 'STANDARD_50',
});
assert.equal(sim50.cars[0].fuelKg, 54.0);

// Task 1 (VSC): Type & initial snapshot state
const testInitSim = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
  track: DEFAULT_DB.tracks[0],
  distancePreset: 'SPRINT_25',
});
assert.equal(testInitSim.vscLapsRemaining, 0);
assert.equal(typeof testInitSim.vscLapsRemaining, 'number');
assert.equal(testInitSim.raceControl, 'GREEN');

// Task 2 (VSC): Physics, speed capping, DRS lockout, lap decrement
const vscSim = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
  track: track0,
  distancePreset: 'SPRINT_25',
});
vscSim.raceControl = 'VIRTUAL_SAFETY_CAR';
vscSim.vscLapsRemaining = 2;
vscSim.cars[0].distanceOnLapMeters = 100;
vscSim.cars[0].totalDistanceMeters = 100;
vscSim.cars[1].distanceOnLapMeters = 80;
vscSim.cars[1].totalDistanceMeters = 80;
vscSim.cars[1].gapToAheadSec = 0.5;
vscSim.cars[1].hasDrsAvailable = true;

const steppedVsc = stepRaceSimulation(
  vscSim,
  track0,
  DEFAULT_DB.teams,
  DEFAULT_DB.drivers,
  0.1,
  'corsa-rossa'
);
assert.equal(steppedVsc.raceControl, 'VIRTUAL_SAFETY_CAR');
assert.ok(
  steppedVsc.cars[0].currentSpeedMs <= track0.segments[0].referenceSpeedMs * 0.65,
  `Expected VSC speed <= ${track0.segments[0].referenceSpeedMs * 0.65}, got ${steppedVsc.cars[0].currentSpeedMs}`
);
assert.equal(steppedVsc.cars[1].isDrsActive, false);

// Test VSC lap decrement when leader crosses finish line
const vscLapEndSim = {
  ...steppedVsc,
  vscLapsRemaining: 1,
  cars: steppedVsc.cars.map((c, i) =>
    i === 0
      ? { ...c, distanceOnLapMeters: track0.lengthMeters - 1, totalDistanceMeters: track0.lengthMeters - 1 }
      : c
  ),
};
const steppedVscEnd = stepRaceSimulation(
  vscLapEndSim,
  track0,
  DEFAULT_DB.teams,
  DEFAULT_DB.drivers,
  0.1,
  'corsa-rossa'
);
assert.equal(steppedVscEnd.raceControl, 'GREEN');
assert.equal(steppedVscEnd.vscLapsRemaining, 0);
assert.ok(steppedVscEnd.radioLog.some((m) => m.includes('VSC TERMINATA')));

// Task 3 (VSC): Incident differentiation
const minRelTeams = DEFAULT_DB.teams.map((t) => ({
  ...t,
  components: {
    ...t.components,
    powerUnit: { performance: 80, reliability: 1 },
    floor: { performance: 80, reliability: 1 },
    suspension: { performance: 80, reliability: 1 },
    brakes: { performance: 80, reliability: 1 },
    frontWing: { performance: 80, reliability: 1 },
    rearWing: { performance: 80, reliability: 1 },
  },
}));
const incidentSim = createInitialRaceState(minRelTeams, DEFAULT_DB.drivers, [], {
  track: track0,
  distancePreset: 'SPRINT_25',
});
incidentSim.raceTimeSec = 0.5;
const car16 = incidentSim.cars.find((c) => c.driverNumber === 16);
assert.ok(car16);
car16.distanceOnLapMeters = track0.lengthMeters - 1;
car16.totalDistanceMeters = track0.lengthMeters - 1;

const steppedIncident = stepRaceSimulation(incidentSim, track0, minRelTeams, DEFAULT_DB.drivers, 0.1, 'corsa-rossa');
assert.equal(steppedIncident.raceControl, 'VIRTUAL_SAFETY_CAR');
assert.equal(steppedIncident.vscLapsRemaining, 2);
assert.ok(steppedIncident.radioLog.some((m) => m.includes('VSC ATTIVATA')));

// Task 4 (VSC): AI Strategic Opportunism under VSC
const aiCarMock = {
  ...testInitSim.cars[2],
  tyreWear: 0.55,
  tyreAgeLaps: 5,
};
const aiSimSnapshot = {
  ...testInitSim,
  raceControl: 'VIRTUAL_SAFETY_CAR' as const,
  vscLapsRemaining: 2,
};
const aiDecision = evaluateAiPitStrategy(aiCarMock, aiSimSnapshot, 10);
assert.equal(aiDecision.requestPit, true);

// Task 6 (Review Focus): Edge cases
// 1. AI should not pit on the final lap under VSC
const aiFinalLapDecision = evaluateAiPitStrategy(aiCarMock, aiSimSnapshot, 1);
assert.equal(aiFinalLapDecision.requestPit, false);

// 2. Cars in pit lane maintain pit lane speed (22.2 m/s) during VSC
const pitCarSim = {
  ...vscSim,
  cars: vscSim.cars.map((c, i) =>
    i === 0 ? { ...c, isInPitLane: true, pitStopTimerSec: 2.0 } : c
  ),
};
const steppedPitSim = stepRaceSimulation(
  pitCarSim,
  track0,
  DEFAULT_DB.teams,
  DEFAULT_DB.drivers,
  0.1,
  'corsa-rossa'
);
assert.equal(steppedPitSim.cars[0].currentSpeedMs, 22.2);

// 3. Gap preservation without artificial bunching
const gapSim = {
  ...vscSim,
  cars: vscSim.cars.map((c, i) =>
    i === 0
      ? { ...c, distanceOnLapMeters: 500, totalDistanceMeters: 500 }
      : i === 1
      ? { ...c, distanceOnLapMeters: 300, totalDistanceMeters: 300 }
      : c
  ),
};
const steppedGapSim = stepRaceSimulation(
  gapSim,
  track0,
  DEFAULT_DB.teams,
  DEFAULT_DB.drivers,
  0.1,
  'corsa-rossa'
);
const distanceDelta =
  steppedGapSim.cars[0].totalDistanceMeters - steppedGapSim.cars[1].totalDistanceMeters;
assert.ok(
  distanceDelta > 190 && distanceDelta < 210,
  `Distance delta should remain preserved (~200m), got ${distanceDelta}`
);








