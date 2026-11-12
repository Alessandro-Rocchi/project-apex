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

// Full Safety Car trigger test (on-track hazard >= 0.65 threshold)
incidentSim.raceTimeSec = 2.6;
const car1 = incidentSim.cars.find((c) => c.driverNumber === 1);
assert.ok(car1);
car1.distanceOnLapMeters = track0.lengthMeters - 1;
car1.totalDistanceMeters = track0.lengthMeters - 1;
const steppedScIncident = stepRaceSimulation(incidentSim, track0, minRelTeams, DEFAULT_DB.drivers, 0.1, 'corsa-rossa');
assert.equal(steppedScIncident.raceControl, 'SAFETY_CAR');
assert.equal(steppedScIncident.safetyCarLapsRemaining, 2);
assert.ok(steppedScIncident.radioLog.some((m) => m.includes('SAFETY CAR')));


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

// Fix 1 (Reviewer Critical): Zero negative distance step on Green -> VSC transition
const closeCarSim = {
  ...vscSim,
  cars: vscSim.cars.map((c, i) =>
    i === 0
      ? { ...c, distanceOnLapMeters: 1000, totalDistanceMeters: 1000 }
      : i === 1
      ? { ...c, distanceOnLapMeters: 999.5, totalDistanceMeters: 999.5 }
      : c
  ),
};
const steppedCloseSim = stepRaceSimulation(
  closeCarSim,
  track0,
  DEFAULT_DB.teams,
  DEFAULT_DB.drivers,
  0.1,
  'corsa-rossa'
);
const car1Delta = steppedCloseSim.cars[1].totalDistanceMeters - 999.5;
assert.ok(
  car1Delta >= 0,
  `Car distance step must never be negative on VSC, got ${car1Delta}`
);

// Fix 2 (Reviewer Important): Tyre wear (0.35x) and fuel burn (0.40x) reductions under VSC
const greenSim = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
  track: track0,
  distancePreset: 'SPRINT_25',
});
greenSim.raceControl = 'GREEN';
const steppedGreen = stepRaceSimulation(greenSim, track0, DEFAULT_DB.teams, DEFAULT_DB.drivers, 1.0, 'corsa-rossa');
const steppedVscRun = stepRaceSimulation(vscSim, track0, DEFAULT_DB.teams, DEFAULT_DB.drivers, 1.0, 'corsa-rossa');

const greenWear = greenSim.cars[0].tyreWear - steppedGreen.cars[0].tyreWear;
const vscWear = vscSim.cars[0].tyreWear - steppedVscRun.cars[0].tyreWear;
assert.ok(Math.abs(vscWear - greenWear * 0.35) < 1e-4, `Expected VSC wear ~0.35x green, got ${vscWear / greenWear}`);

const greenFuel = greenSim.cars[0].fuelKg - steppedGreen.cars[0].fuelKg;
const vscFuel = vscSim.cars[0].fuelKg - steppedVscRun.cars[0].fuelKg;
assert.ok(Math.abs(vscFuel - greenFuel * 0.40) < 1e-4, `Expected VSC fuel ~0.40x green, got ${vscFuel / greenFuel}`);

// ==========================================
// Custom Team Creator (Task 1 Engine Tests)
// ==========================================
import {
  buildCustomTeam,
  executeTeamReplacement,
  getTierPresets,
  pickRandomDriversForTier,
} from './src/engine/customTeamBuilder.ts';

// 1. getTierPresets tests for all 5 tiers
const presetT1 = getTierPresets(1);
assert.equal(presetT1.budgetMillions, 48.0);
assert.deepEqual(presetT1.facilities, { factory: 3, windTunnel: 3, simulator: 3 });
assert.equal(presetT1.components.powerUnit.performance, 93);
assert.equal(presetT1.components.powerUnit.reliability, 91);

const presetT2 = getTierPresets(2);
assert.equal(presetT2.budgetMillions, 40.0);
assert.deepEqual(presetT2.facilities, { factory: 2, windTunnel: 3, simulator: 2 });
assert.equal(presetT2.components.frontWing.performance, 89);
assert.equal(presetT2.components.frontWing.reliability, 90);

const presetT3 = getTierPresets(3);
assert.equal(presetT3.budgetMillions, 33.0);
assert.deepEqual(presetT3.facilities, { factory: 2, windTunnel: 2, simulator: 2 });
assert.equal(presetT3.components.rearWing.performance, 85);
assert.equal(presetT3.components.rearWing.reliability, 89);

const presetT4 = getTierPresets(4);
assert.equal(presetT4.budgetMillions, 26.0);
assert.deepEqual(presetT4.facilities, { factory: 1, windTunnel: 2, simulator: 1 });
assert.equal(presetT4.components.floor.performance, 81);
assert.equal(presetT4.components.floor.reliability, 87);

const presetT5 = getTierPresets(5);
assert.equal(presetT5.budgetMillions, 20.0);
assert.deepEqual(presetT5.facilities, { factory: 1, windTunnel: 1, simulator: 1 });
assert.equal(presetT5.components.suspension.performance, 77);
assert.equal(presetT5.components.suspension.reliability, 85);

// 2. buildCustomTeam tests across tiers & id slug generation
const customT1 = buildCustomTeam({
  name: 'Apex Speed GP',
  nationality: 'Italia',
  colorHex: '#FF0000',
  accentHex: '#00FF00',
  tier: 1,
  replacedTeamId: 'corsa-rossa',
  primaryDriverId: 'drv-korsakov',
  secondaryDriverId: 'drv-almeida',
});
assert.equal(customT1.id, 'custom-apex-speed-gp');
assert.equal(customT1.name, 'Apex Speed GP');
assert.equal(customT1.tier, 1);
assert.equal(customT1.budgetMillions, 48.0);
assert.equal(customT1.power, 93);
assert.equal(customT1.downforce, 93);
assert.equal(customT1.overallReliability, 91);

const customWithExplicitId = buildCustomTeam(
  {
    name: 'Custom Team',
    nationality: 'Svizzera',
    colorHex: '#123456',
    accentHex: '#654321',
    tier: 3,
    replacedTeamId: 'nordic-volt',
    primaryDriverId: 'drv-korsakov',
    secondaryDriverId: 'drv-almeida',
  },
  'my-custom-id'
);
assert.equal(customWithExplicitId.id, 'my-custom-id');
assert.equal(customWithExplicitId.power, 85);

// Fallback slug test for punctuation-only name
const customFallback = buildCustomTeam({
  name: '---',
  nationality: 'Monaco',
  colorHex: '#000000',
  accentHex: '#FFFFFF',
  tier: 5,
  replacedTeamId: 'nordic-volt',
  primaryDriverId: 'drv-korsakov',
  secondaryDriverId: 'drv-almeida',
});
assert.equal(customFallback.id, 'custom-team');

// 3. pickRandomDriversForTier tests
const [t1D1, t1D2] = pickRandomDriversForTier(DEFAULT_DB.drivers, 1);
assert.notEqual(t1D1, t1D2);
const drv1Obj = DEFAULT_DB.drivers.find((d) => d.id === t1D1)!;
const drv2Obj = DEFAULT_DB.drivers.find((d) => d.id === t1D2)!;
assert.ok(drv1Obj.pace >= 90);
assert.ok(drv2Obj.pace >= 90);

const [t5D1, t5D2] = pickRandomDriversForTier(DEFAULT_DB.drivers, 5);
assert.notEqual(t5D1, t5D2);
const drvT5Obj1 = DEFAULT_DB.drivers.find((d) => d.id === t5D1)!;
const drvT5Obj2 = DEFAULT_DB.drivers.find((d) => d.id === t5D2)!;
assert.ok(drvT5Obj1.pace <= 80);
assert.ok(drvT5Obj2.pace <= 80);

// 4. executeTeamReplacement with Free Agent drivers
const freeAgentReplacement = executeTeamReplacement(DEFAULT_DB, {
  name: 'Modena Corse',
  nationality: 'Italia',
  colorHex: '#EE1111',
  accentHex: '#FFDD00',
  tier: 2,
  replacedTeamId: 'corsa-rossa',
  primaryDriverId: 'drv-korsakov',
  secondaryDriverId: 'drv-almeida',
});

// Teams verification
assert.equal(freeAgentReplacement.updatedDb.teams.length, DEFAULT_DB.teams.length);
assert.equal(
  freeAgentReplacement.updatedDb.teams.some((t) => t.id === 'corsa-rossa'),
  false
);
const createdTeam = freeAgentReplacement.updatedDb.teams.find((t) => t.id === 'custom-modena-corse');
assert.ok(createdTeam);
assert.equal(createdTeam.id, freeAgentReplacement.newTeam.id);

// Drivers verification
const modenaD1 = freeAgentReplacement.updatedDb.drivers.find((d) => d.id === 'drv-korsakov')!;
const modenaD2 = freeAgentReplacement.updatedDb.drivers.find((d) => d.id === 'drv-almeida')!;
assert.equal(modenaD1.teamId, 'custom-modena-corse');
assert.equal(modenaD1.role, 'PRIMARY');
assert.equal(modenaD2.teamId, 'custom-modena-corse');
assert.equal(modenaD2.role, 'SECONDARY');

// Reserve from replaced team reassigned to custom team
const modenaReserve = freeAgentReplacement.updatedDb.drivers.find((d) => d.id === 'drv-bellini')!;
assert.equal(modenaReserve.teamId, 'custom-modena-corse');
assert.equal(modenaReserve.role, 'RESERVE');

// Displaced titular drivers are now free agents
const displacedValenti = freeAgentReplacement.updatedDb.drivers.find((d) => d.id === 'drv-valenti')!;
const displacedMoretti = freeAgentReplacement.updatedDb.drivers.find((d) => d.id === 'drv-moretti')!;
assert.equal(displacedValenti.teamId, null);
assert.equal(displacedValenti.role, 'FREE_AGENT');
assert.equal(displacedMoretti.teamId, null);
assert.equal(displacedMoretti.role, 'FREE_AGENT');

// DB validity check
assert.equal(validateCustomDatabase(freeAgentReplacement.updatedDb).valid, true);

// 5. executeTeamReplacement with seat-swap from rival team (poaching Silberpfeil primary)
const rivalSwapReplacement = executeTeamReplacement(DEFAULT_DB, {
  name: 'Apex Stars',
  nationality: 'Germania',
  colorHex: '#0055AA',
  accentHex: '#FFFFFF',
  tier: 1,
  replacedTeamId: 'corsa-rossa',
  primaryDriverId: 'drv-richter', // Silberpfeil primary
  secondaryDriverId: 'drv-korsakov', // Free agent
});

// Richter now drives for Apex Stars as PRIMARY
const richter = rivalSwapReplacement.updatedDb.drivers.find((d) => d.id === 'drv-richter')!;
assert.equal(richter.teamId, 'custom-apex-stars');
assert.equal(richter.role, 'PRIMARY');

// Silberpfeil retained 2 titular drivers: Brandt remains SECONDARY, displaced Valenti took PRIMARY seat
const silberDrivers = rivalSwapReplacement.updatedDb.drivers.filter((d) => d.teamId === 'silberpfeil');
assert.equal(silberDrivers.length, 3); // PRIMARY + SECONDARY + RESERVE
const silberPrimary = silberDrivers.find((d) => d.role === 'PRIMARY')!;
assert.equal(silberPrimary.id, 'drv-valenti'); // Displaced titular Valenti took the vacant seat
const silberSecondary = silberDrivers.find((d) => d.role === 'SECONDARY')!;
assert.equal(silberSecondary.id, 'drv-brandt');

// Other displaced driver (Moretti) is now FREE_AGENT
const morettiAfterSwap = rivalSwapReplacement.updatedDb.drivers.find((d) => d.id === 'drv-moretti')!;
assert.equal(morettiAfterSwap.teamId, null);
assert.equal(morettiAfterSwap.role, 'FREE_AGENT');

// DB validity check
assert.equal(validateCustomDatabase(rivalSwapReplacement.updatedDb).valid, true);

// 6. executeTeamReplacement with TWO rival drivers poached (Silberpfeil & Apex Tauron)
const doubleSwapReplacement = executeTeamReplacement(DEFAULT_DB, {
  name: 'Super Team',
  nationality: 'Francia',
  colorHex: '#333333',
  accentHex: '#EEEEEE',
  tier: 1,
  replacedTeamId: 'corsa-rossa',
  primaryDriverId: 'drv-richter', // Silberpfeil primary
  secondaryDriverId: 'drv-vanderberg', // Apex Tauron primary
});

const displaced1 = doubleSwapReplacement.updatedDb.drivers.find((d) => d.id === 'drv-valenti')!;
const displaced2 = doubleSwapReplacement.updatedDb.drivers.find((d) => d.id === 'drv-moretti')!;
assert.equal(displaced1.teamId, 'silberpfeil');
assert.equal(displaced1.role, 'PRIMARY');
assert.equal(displaced2.teamId, 'apex-tauron');
assert.equal(displaced2.role, 'PRIMARY');

// Validate all teams have exactly 2 titular drivers
for (const team of doubleSwapReplacement.updatedDb.teams) {
  const titular = doubleSwapReplacement.updatedDb.drivers.filter(
    (d) => d.teamId === team.id && (d.role === 'PRIMARY' || d.role === 'SECONDARY')
  );
  assert.equal(titular.length, 2, `Team ${team.id} must have 2 titular drivers`);
}
assert.equal(validateCustomDatabase(doubleSwapReplacement.updatedDb).valid, true);

// 7. Defensive validation test: Duplicate driver IDs rejected
assert.throws(
  () =>
    executeTeamReplacement(DEFAULT_DB, {
      name: 'Duplicate Drivers GP',
      nationality: 'Italia',
      colorHex: '#123456',
      accentHex: '#654321',
      tier: 3,
      replacedTeamId: 'corsa-rossa',
      primaryDriverId: 'drv-valenti',
      secondaryDriverId: 'drv-valenti',
    }),
  /Primary and Secondary drivers must be distinct/
);

// 8. Prevent Team ID Collisions test
const collidingDb = {
  ...DEFAULT_DB,
  teams: [
    ...DEFAULT_DB.teams,
    {
      ...DEFAULT_DB.teams[0],
      id: 'custom-duplicate-team',
      name: 'Duplicate Team',
    },
  ],
};
const collisionResult = executeTeamReplacement(collidingDb, {
  name: 'Duplicate Team',
  nationality: 'Italia',
  colorHex: '#123456',
  accentHex: '#654321',
  tier: 3,
  replacedTeamId: 'corsa-rossa',
  primaryDriverId: 'drv-korsakov',
  secondaryDriverId: 'drv-almeida',
});
assert.notEqual(collisionResult.newTeam.id, 'custom-duplicate-team');
assert.ok(collisionResult.newTeam.id.startsWith('custom-duplicate-team-'));

// 9. Double seat-swap from the SAME rival team (poaching both Silberpfeil primary & secondary)
const sameTeamDoubleSwap = executeTeamReplacement(DEFAULT_DB, {
  name: 'Apex Dual Poach',
  nationality: 'Germania',
  colorHex: '#003366',
  accentHex: '#FFCC00',
  tier: 1,
  replacedTeamId: 'corsa-rossa',
  primaryDriverId: 'drv-richter', // Silberpfeil PRIMARY
  secondaryDriverId: 'drv-brandt', // Silberpfeil SECONDARY
});

// Silberpfeil has 3 drivers: 2 titulars (displaced Valenti as PRIMARY, displaced Moretti as SECONDARY) and 1 reserve
const silberAfterDoubleSwap = sameTeamDoubleSwap.updatedDb.drivers.filter(
  (d) => d.teamId === 'silberpfeil'
);
assert.equal(silberAfterDoubleSwap.length, 3);
const silberP1 = silberAfterDoubleSwap.find((d) => d.role === 'PRIMARY')!;
const silberP2 = silberAfterDoubleSwap.find((d) => d.role === 'SECONDARY')!;
const silberRes = silberAfterDoubleSwap.find((d) => d.role === 'RESERVE')!;
assert.equal(silberP1.id, 'drv-valenti');
assert.equal(silberP2.id, 'drv-moretti');
assert.equal(silberRes.id, 'drv-weber');

// Custom team has Richter (PRIMARY), Brandt (SECONDARY), and Bellini (RESERVE)
const newTeamDrivers = sameTeamDoubleSwap.updatedDb.drivers.filter(
  (d) => d.teamId === sameTeamDoubleSwap.newTeam.id
);
assert.equal(newTeamDrivers.length, 3);
assert.equal(newTeamDrivers.find((d) => d.role === 'PRIMARY')?.id, 'drv-richter');
assert.equal(newTeamDrivers.find((d) => d.role === 'SECONDARY')?.id, 'drv-brandt');
assert.equal(newTeamDrivers.find((d) => d.role === 'RESERVE')?.id, 'drv-bellini');
assert.equal(validateCustomDatabase(sameTeamDoubleSwap.updatedDb).valid, true);

// 10. Reserve promotion edge case: selecting replaced team's reserve driver as titular
const reservePromotionReplacement = executeTeamReplacement(DEFAULT_DB, {
  name: 'Apex Promoted Reserve',
  nationality: 'Italia',
  colorHex: '#CC0000',
  accentHex: '#FFFFFF',
  tier: 2,
  replacedTeamId: 'corsa-rossa',
  primaryDriverId: 'drv-bellini', // Corsa Rossa RESERVE promoted to PRIMARY
  secondaryDriverId: 'drv-korsakov', // Free agent
});

// Verify newTeam still has 1 reserve driver and 2 titular drivers
const promoTeamDrivers = reservePromotionReplacement.updatedDb.drivers.filter(
  (d) => d.teamId === reservePromotionReplacement.newTeam.id
);
const promoPrimary = promoTeamDrivers.filter((d) => d.role === 'PRIMARY');
const promoSecondary = promoTeamDrivers.filter((d) => d.role === 'SECONDARY');
const promoReserve = promoTeamDrivers.filter((d) => d.role === 'RESERVE');

assert.equal(promoPrimary.length, 1);
assert.equal(promoPrimary[0].id, 'drv-bellini');
assert.equal(promoSecondary.length, 1);
assert.equal(promoSecondary[0].id, 'drv-korsakov');
assert.equal(promoReserve.length, 1);
assert.equal(promoReserve[0].id, 'drv-valenti'); // Displaced titular preserved as RESERVE
assert.equal(promoTeamDrivers.length, 3);

// The other displaced titular (Moretti) becomes a free agent
const morettiAfterPromo = reservePromotionReplacement.updatedDb.drivers.find(
  (d) => d.id === 'drv-moretti'
)!;
assert.equal(morettiAfterPromo.teamId, null);
assert.equal(morettiAfterPromo.role, 'FREE_AGENT');
assert.equal(validateCustomDatabase(reservePromotionReplacement.updatedDb).valid, true);

// Task 3: Integration Tests (Custom Team Career Initialization, Sponsor Assignment, Modding Export/Reset)
const customCreation = executeTeamReplacement(DEFAULT_DB, {
  name: 'Scuderia Futura',
  nationality: 'Italia',
  colorHex: '#00AA88',
  accentHex: '#FFFF00',
  tier: 2,
  replacedTeamId: 'modena-veloce',
  primaryDriverId: 'drv-belli',
  secondaryDriverId: 'drv-korsakov',
});

const customCareer = createInitialCareerState(
  customCreation.updatedDb,
  customCreation.newTeam.id,
  'STANDARD_50'
);

// Full creation and career initialization verification
assert.equal(customCareer.playerTeamId, customCreation.newTeam.id);
assert.equal(customCareer.season, 1);
assert.equal(customCareer.currentDay, 1);
assert.equal(customCareer.currentRoundIndex, 0);
assert.equal(customCareer.distancePreset, 'STANDARD_50');
assert.equal(customCareer.activeRdProjects.length, 0);
assert.equal(customCareer.budgetCapSpentMillions, 0);

// Sponsor properly assigned based on tier
const mainSponsor = customCareer.db.sponsors.find((s) => s.id === customCareer.activeMainSponsorId)!;
assert.ok(mainSponsor, 'Main sponsor must be assigned');
assert.equal(mainSponsor.type, 'MAIN');
assert.ok(
  mainSponsor.minTierAllowed >= customCreation.newTeam.tier,
  `Main sponsor minTierAllowed (${mainSponsor.minTierAllowed}) must be >= team tier (${customCreation.newTeam.tier})`
);

assert.ok(customCareer.activeSecondarySponsorIds.length > 0, 'Secondary sponsors must be assigned');
for (const secId of customCareer.activeSecondarySponsorIds) {
  const secSponsor = customCareer.db.sponsors.find((s) => s.id === secId)!;
  assert.ok(secSponsor, `Secondary sponsor ${secId} must exist`);
  assert.equal(secSponsor.type, 'SECONDARY');
  assert.ok(
    secSponsor.minTierAllowed >= customCreation.newTeam.tier,
    `Secondary sponsor minTierAllowed (${secSponsor.minTierAllowed}) must be >= team tier (${customCreation.newTeam.tier})`
  );
}

// Verification with Underdog Tier 5 team
const tier5Creation = executeTeamReplacement(DEFAULT_DB, {
  name: 'Backmarker Racing',
  nationality: 'Regno Unito',
  colorHex: '#111111',
  accentHex: '#555555',
  tier: 5,
  replacedTeamId: 'nordic-glory',
  primaryDriverId: 'drv-novak',
  secondaryDriverId: 'drv-alvarez',
});

const tier5Career = createInitialCareerState(
  tier5Creation.updatedDb,
  tier5Creation.newTeam.id,
  'FULL_100'
);

assert.equal(tier5Career.playerTeamId, tier5Creation.newTeam.id);
assert.equal(tier5Career.season, 1);
assert.equal(tier5Career.currentDay, 1);
assert.equal(tier5Career.currentRoundIndex, 0);
assert.equal(tier5Career.distancePreset, 'FULL_100');

const t5MainSponsor = tier5Career.db.sponsors.find((s) => s.id === tier5Career.activeMainSponsorId)!;
assert.ok(t5MainSponsor, 'Tier 5 main sponsor must be assigned');
assert.ok(t5MainSponsor.minTierAllowed >= 5);

for (const secId of tier5Career.activeSecondarySponsorIds) {
  const secSponsor = tier5Career.db.sponsors.find((s) => s.id === secId)!;
  assert.ok(secSponsor);
  assert.ok(secSponsor.minTierAllowed >= 5);
}

// Verification of Default DB reset lifecycle
const resetCareer = createInitialCareerState(DEFAULT_DB, 'corsa-rossa', tier5Career.distancePreset);
assert.equal(resetCareer.playerTeamId, 'corsa-rossa');
assert.equal(resetCareer.db.teams.length, 10);
assert.ok(resetCareer.db.teams.some((t) => t.id === 'corsa-rossa'));
assert.ok(!resetCareer.db.teams.some((t) => t.id === 'custom-backmarker-racing'));
assert.ok(!resetCareer.db.teams.some((t) => t.id === 'custom-scuderia-futura'));
assert.equal(resetCareer.season, 1);
assert.equal(resetCareer.currentDay, 1);
assert.equal(resetCareer.currentRoundIndex, 0);

// Task 4: Comprehensive End-to-End Simulation Tests (Custom Team in Qualifying & Race Engines)
const customSimReplacement = executeTeamReplacement(DEFAULT_DB, {
  name: 'Apex Hyperion',
  nationality: 'Francia',
  colorHex: '#10B981',
  accentHex: '#F59E0B',
  tier: 1,
  replacedTeamId: 'lumiere-equipe',
  primaryDriverId: DEFAULT_DB.drivers[0].id,
  secondaryDriverId: DEFAULT_DB.drivers[2].id,
});

const customDb = customSimReplacement.updatedDb;
const newTeam = customSimReplacement.newTeam;

// 1. Qualifying Session
const qualiSession = createQualifyingSession(customDb.teams, customDb.drivers, 'DRY');
const autoQuali = runFullQualifyingAuto(qualiSession, customDb.teams, customDb.drivers);
assert.equal(autoQuali.isCompleted, true);
assert.equal(autoQuali.stage, 'FINISHED');
assert.equal(autoQuali.results.length, 20);

// Assert custom team drivers are present in qualifying results
const customQualiResults = autoQuali.results.filter((r) => r.teamId === newTeam.id);
assert.equal(customQualiResults.length, 2);
assert.ok(customQualiResults.some((r) => r.driverId === DEFAULT_DB.drivers[0].id));
assert.ok(customQualiResults.some((r) => r.driverId === DEFAULT_DB.drivers[2].id));

// 2. Race Simulation
const track = customDb.tracks[0];
const race = createInitialRaceState(customDb.teams, customDb.drivers, [], {
  track,
  distancePreset: 'SPRINT_25',
  initialWeather: 'DRY',
});
assert.equal(race.cars.length, 20);

// Assert custom team cars exist on the race grid
const customRaceGridCars = race.cars.filter((c) => c.teamId === newTeam.id);
assert.equal(customRaceGridCars.length, 2);

// Step race simulation for multiple ticks
let currentSim = race;
for (let i = 0; i < 50; i++) {
  currentSim = stepRaceSimulation(
    currentSim,
    track,
    customDb.teams,
    customDb.drivers,
    0.1,
    newTeam.id
  );
}
assert.equal(currentSim.cars.length, 20);
assert.ok(currentSim.elapsedTimeSec > 0);

// Assert custom team cars operate normally
const customSteppedCars = currentSim.cars.filter((c) => c.teamId === newTeam.id);
assert.equal(customSteppedCars.length, 2);
assert.ok(customSteppedCars.every((c) => c.currentSpeedMs > 0));
assert.ok(customSteppedCars.every((c) => c.totalDistanceMeters > 0));
