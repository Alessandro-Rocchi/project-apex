# Project Apex — Motorsport Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Project Apex open-wheel motorsport management game (10 fictional teams, 30 drivers, 12 original tracks, 3-session Race Weekend with continuous segment simulation, dynamic weather/Safety Car, and multi-season HQ Career mode) with Pit Wall OS aesthetics and procedural Web Audio.

**Architecture:** Pure TypeScript simulation engines (`src/engine/*`) shared between the React 19 UI and Node CLI test/Monte Carlo runner (`test.ts`), backed by a zero-dependency reactive store (`useSyncExternalStore` in `src/store/gameStore.ts`) persisting to `LocalStorage` and `.json` file import/export.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Tailwind CSS 3, HTML5 Canvas 2D, Web Audio API, Node `assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-10-project-apex-motorsport-manager-design.md`

## Global Constraints

- **Zero External NPM Dependencies Added:** Keep `package.json` runtime dependencies strictly to `react` and `react-dom`.
- **100% IP-Safe & Original Circuits:** No real-world team, driver, circuit, city, or corner names (`Monza`, `Monaco`, `Silverstone`, `Spa`, `Suzuka`, `Interlagos`, `Biassono`, `Parabolica`, `Ascari`, `Roggia`, `Lesmo`, `Serraglio`) in `defaultDb.ts` or `public/data/default_db.json`.
- **Tabular Telemetry Typography:** Every dynamic number (lap times, gaps, percentages, temperatures, budgets) uses `JetBrains Mono` and `font-variant-numeric: tabular-nums`.
- **Node Test Compatibility:** `npm test` (`node test.ts`) must execute cleanly in Node without browser globals (`window`, `document`, `AudioContext`, `localStorage`).
- **Budget Cap & Diminishing Returns:** Seasonal R&D cap fixed at `135.0` M€; R&D component values clamp to `[0, 100]`.

## Review Focus

1. **Malformed or partial Custom DB JSON import:** Uploading an invalid `.json` file in `MainMenuHub` must return a structured validation error via `validateCustomDatabase(raw)` and leave the active database untouched instead of throwing an unhandled runtime exception.
2. **Wet race mandatory compound rule:** When a car uses `INTER` or `WET` tyres at any point during a race (or the race starts wet), the 2-dry-compound disqualification (`isDisqualified`) rule must be waived at the checkered flag.
3. **Mid-race calendar advance guard:** Calling `advanceCareerDays(state, days)` when a Grand Prix weekend is N days away (`N < days`) must stop exactly on the race weekend day rather than skipping past the Grand Prix.
4. **R&D Budget Cap and Parallel Slot limits:** Attempting to start an R&D project when `budgetCapSpent + cost > 135.0`, `budget < cost`, or `activeProjects.length >= maxSlots` must return the unchanged state with an explanatory reason.
5. **Teammate Double-Stack Pit Collision & Team Orders:** Requesting `SWAP_POSITIONS` when the player's second car is retired, in the pit lane, or more than `2.5s` behind must be safely ignored until both cars are on track within `2.5s`.

---

### Task 1: Tipi Dati, Database IP-Safe (10 Scuderie, 30 Piloti, 12 Circuiti Originali, Sponsor) & Mapper Fisico

**Files:**
- Modify: `src/types/telemetry.ts`
- Create: `src/types/career.ts`
- Create: `src/engine/carPhysicsMapper.ts`
- Create: `src/data/defaultDb.ts`
- Create: `public/data/default_db.json`
- Modify: `test.ts`

**Interfaces:**
- Consumes: none (foundational types and data)
- Produces:
  - `src/types/telemetry.ts`:
    - `TyreCompound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTER' | 'WET'`
    - `PaceMode = 1 | 2 | 3 | 4 | 5`
    - `FuelMode = 'LIFT_COAST' | 'STANDARD' | 'RICH'`
    - `ErsMode = 'HARVEST' | 'NEUTRAL' | 'DEPLOY' | 'OVERTAKE'`
    - `TeamOrderMode = 'NONE' | 'HOLD_POSITION' | 'SWAP_POSITIONS'`
    - `RaceDistancePreset = 'SPRINT_25' | 'STANDARD_50' | 'FULL_100'`
    - `WeatherCondition = 'DRY' | 'LIGHT_RAIN' | 'HEAVY_RAIN'`
    - `RaceControlStatus = 'GREEN' | 'YELLOW' | 'SAFETY_CAR'`
    - `SectorColor = 'PURPLE' | 'GREEN' | 'YELLOW' | 'NONE'`
    - `ComponentKey = 'powerUnit' | 'frontWing' | 'rearWing' | 'floor' | 'suspension' | 'brakes'`
    - `ComponentSpec { performance: number; reliability: number }`
    - `CarComponents = Record<ComponentKey, ComponentSpec>`
    - `Team { id: string; name: string; nationality: string; colorHex: string; accentHex: string; tier: 1 | 2 | 3 | 4 | 5; budgetMillions: number; components: CarComponents; facilities: { factory: number; windTunnel: number; simulator: number }; power: number; downforce: number; mechanicalGrip: number; aeroEfficiency: number; overallReliability: number }`
    - `Driver { id: string; code: string; name: string; nationality: string; teamId: string | null; role: 'PRIMARY' | 'SECONDARY' | 'RESERVE' | 'FREE_AGENT'; number: number; age: number; pace: number; consistency: number; smoothness: number; overtaking: number; defense: number; wetSkill: number; salaryPerRaceMillions: number; contractYearsLeft: number; buyoutMillions: number }`
    - `TrackData { id: string; grandPrixName: string; name: string; region: string; totalLaps: number; lengthMeters: number; pitLaneTimeLossSec: number; drsDetectionMeters: number; baseRainChance: number; ambientTempCelsius: number; idealSetup: [number, number, number, number, number]; segments: TrackSegment[]; path2D: TrackPoint2D[] }`
    - `CarRaceState` (includes `paceMode: PaceMode`, `teamOrder: TeamOrderMode`, `frontWingDamage: number`, `repairDamageOnStop: boolean`, `isRetired: boolean`, `retirementReason: string | null`, `stopsCompleted: number`, `bestLapTimeSec: number | null`, `sectorTimesSec: [number | null, number | null, number | null]`, `bestSectorTimesSec: [number | null, number | null, number | null]`, `sectorColors: [SectorColor, SectorColor, SectorColor]`, `lapHistory: number[]`, `positionHistory: number[]`)
  - `src/types/career.ts`:
    - `SponsorDeal { id: string; name: string; type: 'MAIN' | 'SECONDARY'; basePayoutPerRaceMillions: number; objectiveDescription: string; objectiveType: 'FINISH_TOP_10' | 'REACH_Q3' | 'BOTH_FINISH' | 'PODIUM' | 'FASTEST_LAP' | 'TOP_6'; bonusMillions: number }`
    - `RdProject { id: string; component: ComponentKey; focus: 'PERFORMANCE' | 'RELIABILITY'; gainAmount: number; daysRemaining: number; totalDays: number; costMillions: number }`
    - `FacilityUpgradeProject { facility: 'factory' | 'windTunnel' | 'simulator'; targetLevel: number; daysRemaining: number; costMillions: number }`
    - `InboxMessage { id: string; day: number; season: number; title: string; body: string; category: 'RD' | 'FINANCE' | 'CONTRACT' | 'RACE' | 'FIA'; read: boolean }`
    - `GameDatabase { version: string; seriesName: string; teams: Team[]; drivers: Driver[]; tracks: TrackData[]; sponsors: SponsorDeal[] }`
  - `src/engine/carPhysicsMapper.ts`:
    - `deriveCarPhysics(components: CarComponents, frontWingDamage?: number): { power: number; aeroEfficiency: number; downforce: number; mechanicalGrip: number; overallReliability: number }`
    - `hydrateTeamPhysics(team: Omit<Team, 'power' | 'downforce' | 'mechanicalGrip' | 'aeroEfficiency' | 'overallReliability'>): Team`
    - `validateCustomDatabase(raw: unknown): { valid: boolean; error?: string; db?: GameDatabase }`
  - `src/data/defaultDb.ts`:
    - `DEFAULT_DB: GameDatabase`

- [x] **Step 1: Write failing tests in `test.ts` for `deriveCarPhysics`, `DEFAULT_DB` IP-safety, and `validateCustomDatabase`**

```typescript
import assert from 'node:assert/strict';
import { DEFAULT_DB } from './src/data/defaultDb.ts';
import { deriveCarPhysics, validateCustomDatabase } from './src/engine/carPhysicsMapper.ts';

// 1. Verify 10 teams, >=30 drivers, 12 tracks, and zero forbidden real-world circuit/corner references
assert.equal(DEFAULT_DB.teams.length, 10);
assert.ok(DEFAULT_DB.drivers.length >= 30);
assert.equal(DEFAULT_DB.tracks.length, 12);

const serializedDb = JSON.stringify(DEFAULT_DB).toLowerCase();
for (const forbidden of ['monza', 'monaco', 'silverstone', 'suzuka', 'interlagos', 'biassono', 'parabolica', 'ascari', 'roggia', 'lesmo', 'serraglio']) {
  assert.equal(serializedDb.includes(forbidden), false, `Forbidden real-world reference found: ${forbidden}`);
}

// 2. Verify 6 R&D components -> 4 physics attributes & front wing damage penalty
const basePhys = deriveCarPhysics({
  powerUnit: { performance: 90, reliability: 92 },
  frontWing: { performance: 80, reliability: 88 },
  rearWing: { performance: 85, reliability: 90 },
  floor: { performance: 88, reliability: 86 },
  suspension: { performance: 84, reliability: 91 },
  brakes: { performance: 82, reliability: 93 },
}, 0);
assert.equal(basePhys.power, 90);
assert.equal(basePhys.aeroEfficiency, Math.round(80 * 0.4 + 85 * 0.6));
assert.equal(basePhys.downforce, Math.round(88 * 0.5 + 85 * 0.3 + 80 * 0.2));
assert.equal(basePhys.mechanicalGrip, Math.round(84 * 0.6 + 82 * 0.4));

const damagedPhys = deriveCarPhysics({
  powerUnit: { performance: 90, reliability: 92 },
  frontWing: { performance: 80, reliability: 88 },
  rearWing: { performance: 85, reliability: 90 },
  floor: { performance: 88, reliability: 86 },
  suspension: { performance: 84, reliability: 91 },
  brakes: { performance: 82, reliability: 93 },
}, 100);
assert.ok(damagedPhys.downforce < basePhys.downforce);
assert.ok(damagedPhys.aeroEfficiency < basePhys.aeroEfficiency);

// 3. Verify custom DB validation rejects invalid JSON structure
assert.equal(validateCustomDatabase({ teams: [] }).valid, false);
assert.equal(validateCustomDatabase(DEFAULT_DB).valid, true);
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with module not found `./src/data/defaultDb.ts`

- [x] **Step 3: Implement `src/types/telemetry.ts`, `src/types/career.ts`, `src/engine/carPhysicsMapper.ts`, `src/data/defaultDb.ts`, and `public/data/default_db.json`**

In `deriveCarPhysics(components, frontWingDamage = 0)`:
- Apply `damageFactor = 1 - Math.min(100, Math.max(0, frontWingDamage)) * 0.0018` (up to $-18\%$ at $100\%$ wing damage) to `aeroEfficiency` and `downforce`.
- Compute `overallReliability` as `Math.round(pu.reliability * 0.30 + floor.reliability * 0.16 + suspension.reliability * 0.16 + brakes.reliability * 0.14 + frontWing.reliability * 0.12 + rearWing.reliability * 0.12)`.
- Populate `DEFAULT_DB` with the 10 teams from Spec §5.2, 20 primary/secondary drivers + 10 reserve/free-agent drivers, the 12 original circuits from Spec §5.3 (each with closed `path2D` starting and ending at the same point and 6–9 segments), and 8 sponsor deals. Write `public/data/default_db.json` with the exact JSON serialization of `DEFAULT_DB`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

---

### Task 2: Motore di Gara Evoluto (20 Auto, Passo 1–5, Meteo, Safety Car, Danni Ala, Settori FIA, Team Orders, Selettore Distanza) & IA Strategica

**Files:**
- Create: `src/engine/aiStrategist.ts`
- Create: `src/engine/raceEngine.ts`
- Modify: `src/sim/raceEngine.ts`
- Modify: `test.ts`

**Interfaces:**
- Consumes: `Team`, `Driver`, `TrackData`, `CarRaceState`, `PaceMode`, `TyreCompound`, `RaceDistancePreset`, `WeatherCondition`, `RaceControlStatus` from `src/types/telemetry.ts`; `deriveCarPhysics` from `src/engine/carPhysicsMapper.ts`
- Produces:
  - `src/engine/raceEngine.ts`:
    - `PreRaceCarConfig { carId: string; driverId?: string; gridPosition?: number; setupConfidence: number; startCompound: TyreCompound; fuelKg: number; brokeParcFerme: boolean }`
    - `RaceSimulationSnapshot { raceTimeSec: number; currentLap: number; totalLaps: number; distancePreset: RaceDistancePreset; weather: WeatherCondition; trackWaterLevel: number; weatherForecast: WeatherCondition[]; raceControl: RaceControlStatus; safetyCarLapsRemaining: number; bestLapTimeSec: number | null; bestLapDriverCode: string | null; overallBestSectors: [number | null, number | null, number | null]; isFinished: boolean; cars: CarRaceState[]; radioLog: string[] }`
    - `getScaledTrackLaps(track: TrackData, preset: RaceDistancePreset): { totalLaps: number; wearScale: number; fuelScale: number; defaultFuelKg: number }`
    - `createInitialRaceState(teams: Team[], drivers: Driver[], configs?: PreRaceCarConfig[], options?: { track?: TrackData; distancePreset?: RaceDistancePreset; playerTeamId?: string; initialWeather?: WeatherCondition }): RaceSimulationSnapshot`
    - `stepRaceSimulation(prev: RaceSimulationSnapshot, track: TrackData, teams: Team[], drivers: Driver[], dtSec?: number, playerTeamId?: string): RaceSimulationSnapshot`
    - `getCurrentSegment(track: TrackData, distanceMeters: number): TrackSegment`
  - `src/engine/aiStrategist.ts`:
    - `evaluateAiPitStrategy(car: CarRaceState, snapshot: RaceSimulationSnapshot, track: TrackData, remainingLaps: number): { requestPit: boolean; compound: TyreCompound; repairDamage: boolean; targetPace: PaceMode; targetErs: ErsMode }`

- [x] **Step 1: Write failing tests in `test.ts` for race distance scaling, wet weather rules, wing damage repair, team orders, sectors, and Safety Car**

```typescript
import { createInitialRaceState, getScaledTrackLaps, stepRaceSimulation } from './src/engine/raceEngine.ts';

const track0 = DEFAULT_DB.tracks[0];
const scaled25 = getScaledTrackLaps(track0, 'SPRINT_25');
const scaled100 = getScaledTrackLaps(track0, 'FULL_100');
assert.ok(scaled25.totalLaps < scaled100.totalLaps);
assert.ok(scaled25.wearScale > scaled100.wearScale);

// Wet race waives 2-dry-compound rule and AI mounts INTER/WET
let wetSim = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
  track: track0,
  distancePreset: 'SPRINT_25',
  playerTeamId: 'corsa-rossa',
  initialWeather: 'HEAVY_RAIN',
});
assert.equal(wetSim.cars.length, 20);
assert.ok(wetSim.trackWaterLevel >= 0.6);

// Wing damage repair adds pit stop time and resets frontWingDamage to 0
wetSim.cars[0].frontWingDamage = 55;
wetSim.cars[0].repairDamageOnStop = true;
wetSim.cars[0].pitBoxRequested = true;
wetSim.cars[0].nextTyreCompound = 'WET';
wetSim.cars[0].distanceOnLapMeters = track0.lengthMeters - 5;
wetSim = stepRaceSimulation(wetSim, track0, DEFAULT_DB.teams, DEFAULT_DB.drivers, 0.5, 'corsa-rossa');
assert.equal(wetSim.cars.find((c) => c.carId === wetSim.cars[0].carId)?.isInPitLane, true);

// Team orders: SWAP_POSITIONS swaps two adjacent player teammates within 2.5s
let orderSim = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
  track: track0,
  distancePreset: 'SPRINT_25',
  playerTeamId: 'corsa-rossa',
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with module `./src/engine/raceEngine.ts` not found

- [x] **Step 3: Implement `src/engine/aiStrategist.ts`, `src/engine/raceEngine.ts`, and re-export from `src/sim/raceEngine.ts`**

Key rules in `raceEngine.ts`:
- Filter active race grid to drivers with `role === 'PRIMARY' || role === 'SECONDARY'` (20 cars).
- `PACE_MODIFIERS` for `1 | 2 | 3 | 4 | 5`:
  - `1`: `{ speedMod: -0.016, wearMult: 0.65, tempTargetOffset: -10, errorRiskMult: 0.4 }`
  - `2`: `{ speedMod: -0.008, wearMult: 0.82, tempTargetOffset: -5, errorRiskMult: 0.7 }`
  - `3`: `{ speedMod: 0.000, wearMult: 1.00, tempTargetOffset: 0, errorRiskMult: 1.0 }`
  - `4`: `{ speedMod: +0.008, wearMult: 1.22, tempTargetOffset: +6, errorRiskMult: 1.35 }`
  - `5`: `{ speedMod: +0.015, wearMult: 1.50, tempTargetOffset: +12, errorRiskMult: 1.85 }`
- Wet physics:
  - Slicks (`S`/`M`/`H`) suffer grip loss `trackWaterLevel * 0.18 * (1 - driver.wetSkill * 0.0035)` when `trackWaterLevel > 0.15`.
  - `INTER` is optimal in `trackWaterLevel` `[0.18, 0.62]`; `WET` is optimal in `[0.55, 1.00]`; both overheat and wear $2.2\times$ faster if `trackWaterLevel < 0.10`.
- Pit Stop:
  - When `car.isInPitLane` completes, if `car.repairDamageOnStop && car.frontWingDamage > 0`, reset `car.frontWingDamage = 0`. When entering pit lane, add `+4.5`s to `pitStopTimerSec` if `repairDamageOnStop && frontWingDamage > 0`. Under `SAFETY_CAR`, pit lane time loss is reduced by $35\%$.
- Mandatory compound rule: waived if any car has used `'INTER'` or `'WET'` or `snapshot.trackWaterLevel > 0.15`.
- Sectors: track boundary crossings at $\frac{1}{3} L$, $\frac{2}{3} L$, and $L$, updating `sectorTimesSec`, `bestSectorTimesSec`, `overallBestSectors`, and `sectorColors` (`PURPLE` / `GREEN` / `YELLOW`).

- [x] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

---

### Task 3: Motore Qualifiche Q1 / Q2 / Q3 & Benchmark Monte Carlo

**Files:**
- Create: `src/engine/qualifyingEngine.ts`
- Create: `src/engine/simBenchmark.ts`
- Modify: `test.ts`

**Interfaces:**
- Consumes: `Team`, `Driver`, `TrackData`, `TyreCompound`, `WeatherCondition` from `src/types/telemetry.ts`
- Produces:
  - `src/engine/qualifyingEngine.ts`:
    - `QualifyingStage = 'Q1' | 'Q2' | 'Q3' | 'FINISHED'`
    - `ExitTimingOption = 'EARLY' | 'MID' | 'LATE'`
    - `QualifyingDriverOrder { driverId: string; compound: TyreCompound; exitTiming: ExitTimingOption; pushLevel: 'SAFE' | 'MAX_ATTACK' }`
    - `QualifyingDriverResult { driverId: string; driverCode: string; driverName: string; teamId: string; teamColor: string; position: number; q1TimeSec: number | null; q2TimeSec: number | null; q3TimeSec: number | null; activeTimeSec: number | null; compound: TyreCompound; eliminatedIn: 'Q1' | 'Q2' | null; hadTrafficOrYellow: boolean }`
    - `QualifyingSessionState { stage: QualifyingStage; weather: WeatherCondition; trackWaterLevel: number; results: QualifyingDriverResult[]; logs: string[] }`
    - `createQualifyingSession(teams: Team[], drivers: Driver[], track: TrackData, weather?: WeatherCondition): QualifyingSessionState`
    - `runQualifyingStage(state: QualifyingSessionState, teams: Team[], drivers: Driver[], track: TrackData, setupConfidences: Record<string, number>, playerOrders?: Record<string, QualifyingDriverOrder>): QualifyingSessionState`
    - `runFullQualifyingAuto(state: QualifyingSessionState, teams: Team[], drivers: Driver[], track: TrackData, setupConfidences: Record<string, number>): QualifyingSessionState`
  - `src/engine/simBenchmark.ts`:
    - `BenchmarkReport { racesSimulated: number; avgPitStopsPerCar: number; avgWinnerGapToLastSec: number; tier1WinShare: number }`
    - `runMonteCarloBenchmark(numRaces?: number): BenchmarkReport`

- [x] **Step 1: Write failing tests in `test.ts` for Q1/Q2/Q3 elimination and Monte Carlo benchmark**

```typescript
import { createQualifyingSession, runFullQualifyingAuto, runQualifyingStage } from './src/engine/qualifyingEngine.ts';
import { runMonteCarloBenchmark } from './src/engine/simBenchmark.ts';

let quali = createQualifyingSession(DEFAULT_DB.teams, DEFAULT_DB.drivers, track0, 'DRY');
assert.equal(quali.stage, 'Q1');
quali = runQualifyingStage(quali, DEFAULT_DB.teams, DEFAULT_DB.drivers, track0, {});
assert.equal(quali.stage, 'Q2');
assert.equal(quali.results.filter((r) => r.eliminatedIn === 'Q1').length, 5);

quali = runFullQualifyingAuto(quali, DEFAULT_DB.teams, DEFAULT_DB.drivers, track0, {});
assert.equal(quali.stage, 'FINISHED');
assert.equal(quali.results.filter((r) => r.eliminatedIn === 'Q2').length, 5);
assert.equal(quali.results.filter((r) => r.q3TimeSec !== null).length, 10);

const bench = runMonteCarloBenchmark(12);
assert.ok(bench.avgPitStopsPerCar >= 0.8 && bench.avgPitStopsPerCar <= 3.2);
assert.ok(bench.tier1WinShare >= 0.25 && bench.tier1WinShare <= 0.95);
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with module `./src/engine/qualifyingEngine.ts` not found

- [x] **Step 3: Implement `src/engine/qualifyingEngine.ts` and `src/engine/simBenchmark.ts`**

In `qualifyingEngine.ts`:
- Base reference lap time derived from `track.segments` (`sum(segLength / segRefSpeed)`), adjusted by `deriveCarPhysics(team.components)` ($0\text{--}3.5\text{s}$), `driver.pace` ($0\text{--}1.5\text{s}$), `setupConfidence` ($0\text{--}0.5\text{s}$), tyre compound (`SOFT` $+0.0\text{s}$, `MEDIUM` $+0.55\text{s}$, `HARD` $+1.15\text{s}$ on dry; `INTER`/`WET` when `trackWaterLevel >= 0.20`), and exit timing (`EARLY`: $+0.18\text{s}$ green track, $0\%$ yellow risk; `MID`: $+0.07\text{s}$, $5\%$ traffic risk; `LATE`: $-0.12\text{s}$ rubbered-in track, $15\%$ yellow/traffic penalty of $+0.45\text{s}$).
- Sort active drivers by current stage time; mark bottom 5 in Q1 as `eliminatedIn: 'Q1'`, next 5 in Q2 as `eliminatedIn: 'Q2'`, and sort top 10 by `q3TimeSec`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

---

### Task 4: Motore Quartier Generale & Carriera Multi-Stagionale (`hqSimulator.ts`) & Store Reattivo (`gameStore.ts`)

**Files:**
- Create: `src/engine/hqSimulator.ts`
- Create: `src/store/gameStore.ts`
- Modify: `test.ts`

**Interfaces:**
- Consumes: `GameDatabase`, `RdProject`, `FacilityUpgradeProject`, `InboxMessage`, `SponsorDeal` from `src/types/career.ts`; `Team`, `Driver`, `ComponentKey`, `RaceDistancePreset` from `src/types/telemetry.ts`
- Produces:
  - `src/engine/hqSimulator.ts`:
    - `SEASON_BUDGET_CAP_MILLIONS = 135.0`
    - `DAYS_BETWEEN_RACES = 14`
    - `CareerState { season: number; currentDay: number; currentRoundIndex: number; playerTeamId: string; distancePreset: RaceDistancePreset; budgetCapSpentMillions: number; activeRdProjects: RdProject[]; activeFacilityUpgrade: FacilityUpgradeProject | null; activeMainSponsorId: string; activeSecondarySponsorIds: string[]; driverPoints: Record<string, number>; teamPoints: Record<string, number>; driverWins: Record<string, number>; reserveUsedInFp1ThisRound: boolean; inbox: InboxMessage[]; db: GameDatabase }`
    - `createInitialCareerState(db: GameDatabase, playerTeamId: string, distancePreset?: RaceDistancePreset): CareerState`
    - `getRdProjectQuote(team: Team, component: ComponentKey, focus: 'PERFORMANCE' | 'RELIABILITY'): { costMillions: number; durationDays: number; expectedGain: number; maxSlots: number }`
    - `startRdProject(state: CareerState, component: ComponentKey, focus: 'PERFORMANCE' | 'RELIABILITY'): { state: CareerState; ok: boolean; error?: string }`
    - `startFacilityUpgrade(state: CareerState, facility: 'factory' | 'windTunnel' | 'simulator'): { state: CareerState; ok: boolean; error?: string }`
    - `advanceCareerDays(state: CareerState, days: number): { state: CareerState; reachedRaceWeekend: boolean }`
    - `runReserveDriverFp1(state: CareerState): { state: CareerState; setupRadiusBonus: number }`
    - `signDriverToPlayerTeam(state: CareerState, candidateDriverId: string, targetRole: 'PRIMARY' | 'SECONDARY' | 'RESERVE'): { state: CareerState; ok: boolean; error?: string }`
    - `applyRaceWeekendResults(state: CareerState, finishingOrderDriverIds: string[], q3DriverIds: string[], fastestLapDriverId: string | null, retiredDriverIds: string[]): CareerState`
    - `finalizeSeasonAndStartNext(state: CareerState): CareerState`
  - `src/store/gameStore.ts`:
    - `AppScreen = 'MAIN_MENU' | 'HQ' | 'WEEKEND_SETUP' | 'WEEKEND_QUALI' | 'WEEKEND_RACE' | 'WEEKEND_POSTRACE'`
    - `useGameStore(): GameStoreSnapshot & GameStoreActions`
    - `exportCareerSaveJson(state: CareerState): string`
    - `importCareerSaveJson(jsonStr: string): { ok: boolean; state?: CareerState; error?: string }`

- [x] **Step 1: Write failing tests in `test.ts` for R&D diminishing returns, Budget Cap enforcement, daily calendar stop on Race Weekend, reserve FP1, and multi-season transition**

```typescript
import {
  advanceCareerDays,
  applyRaceWeekendResults,
  createInitialCareerState,
  finalizeSeasonAndStartNext,
  getRdProjectQuote,
  runReserveDriverFp1,
  startRdProject,
} from './src/engine/hqSimulator.ts';

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
assert.equal(adv.state.activeRdProjects.length, 0); // completed along the way

// Reserve driver in FP1 grants setup radius bonus
const fp1Res = runReserveDriverFp1(adv.state);
assert.ok(fp1Res.setupRadiusBonus >= 2);

// Post-race points & End-of-season transition
const orderIds = career.db.drivers.filter((d) => d.role === 'PRIMARY' || d.role === 'SECONDARY').map((d) => d.id);
let afterRace = applyRaceWeekendResults(fp1Res.state, orderIds, orderIds.slice(0, 10), orderIds[0], []);
assert.equal(afterRace.driverPoints[orderIds[0]], 26); // 25 + 1 fastest lap
const nextSeason = finalizeSeasonAndStartNext(afterRace);
assert.equal(nextSeason.season, 2);
assert.equal(nextSeason.budgetCapSpentMillions, 0);
assert.equal(nextSeason.currentRoundIndex, 0);
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with module `./src/engine/hqSimulator.ts` not found

- [x] **Step 3: Implement `src/engine/hqSimulator.ts` and `src/store/gameStore.ts`**

In `hqSimulator.ts`:
- `getRdProjectQuote`:
  - `maxSlots = 1 + Math.min(3, team.facilities.factory)` (Level 1 = 2 slots, Level 5 = 4 slots).
  - Diminishing returns: for current stat $S$, `costMillions = Number((1.2 + Math.pow(Math.max(0, S - 65) / 10, 2) * 1.35).toFixed(2))`.
  - Aero components (`frontWing`, `rearWing`, `floor`) gain $+12\%$ per `windTunnel` level above 1.
- `advanceCareerDays`:
  - Each round occurs on day `(currentRoundIndex + 1) * DAYS_BETWEEN_RACES`.
  - Step day-by-day up to `Math.min(currentDay + days, nextRaceDay)`, decrementing `daysRemaining` on `activeRdProjects` and `activeFacilityUpgrade`, applying completed gains via `hydrateTeamPhysics`, and pushing `InboxMessage` items.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

---

### Task 5: Design System "Pit Wall OS", Sintetizzatore Web Audio, Spline 2D Catmull-Rom & Componenti Comuni

**Files:**
- Modify: `index.html`
- Modify: `tailwind.config.js`
- Modify: `src/index.css`
- Create: `src/utils/spline2D.ts`
- Create: `src/utils/soundEffects.ts`
- Create: `src/components/common/TeamBadge.tsx`
- Create: `src/components/common/TopNavigationBar.tsx`
- Create: `src/components/weekend/TrackCanvas.tsx`
- Create: `src-tauri/tauri.conf.json`
- Modify: `test.ts`

**Interfaces:**
- Consumes: `TrackData`, `RaceSimulationSnapshot` from `src/types/telemetry.ts` and `src/engine/raceEngine.ts`
- Produces:
  - `src/utils/spline2D.ts`:
    - `SplineSample { x: number; y: number; nx: number; ny: number }`
    - `sampleClosedCatmullRom(track: TrackData, distanceMeters: number, width: number, height: number): SplineSample`
    - `generateTrackSplinePolyline(track: TrackData, width: number, height: number, samples?: number): SplineSample[]`
  - `src/utils/soundEffects.ts`:
    - `soundEffects: { isMuted(): boolean; setMuted(m: boolean): void; playRadioBeep(): void; playTacticalClick(): void; playAlertSiren(): void; playCheckeredFlag(): void }`
  - `src/components/common/TeamBadge.tsx`: `TeamBadge({ colorHex, accentHex, code, size }: { colorHex: string; accentHex: string; code: string; size?: 'sm' | 'md' | 'lg' })`
  - `src/components/common/TopNavigationBar.tsx`: `TopNavigationBar`
  - `src/components/weekend/TrackCanvas.tsx`: `TrackCanvas({ track, snapshot, playerTeamId }: { track: TrackData; snapshot: RaceSimulationSnapshot; playerTeamId: string })`

- [x] **Step 1: Write failing test in `test.ts` for `sampleClosedCatmullRom` and `generateTrackSplinePolyline`**

```typescript
import { generateTrackSplinePolyline, sampleClosedCatmullRom } from './src/utils/spline2D.ts';

const pStart = sampleClosedCatmullRom(track0, 0, 800, 400);
const pEnd = sampleClosedCatmullRom(track0, track0.lengthMeters, 800, 400);
assert.ok(Math.hypot(pStart.x - pEnd.x, pStart.y - pEnd.y) < 1e-3);
const poly = generateTrackSplinePolyline(track0, 800, 400, 120);
assert.equal(poly.length, 120);
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with module `./src/utils/spline2D.ts` not found

- [x] **Step 3: Implement `spline2D.ts`, `soundEffects.ts`, `TeamBadge.tsx`, `TopNavigationBar.tsx`, `TrackCanvas.tsx` (6-layer Pit Wall OS radar), font imports in `index.html`, and semantic tokens in `tailwind.config.js` / `src/index.css`**

In `TrackCanvas.tsx`:
- Render the 6 layers specified in Art Direction Bible §2.4:
  - Layer 0: Cartographic grid (`40x40px`) + Wind/Weather compass badge.
  - Layer 1: Track shadow/outer curb (`lineWidth = 22px`, `#000000` at 50% opacity).
  - Layer 2: S1/S2/S3 sector ticks + green DRS zone outer lines (`#22C55E`, `lineWidth = 3px`).
  - Layer 3: Asphalt ribbon (`#334155` dry, shifting toward `#1E293B` with glossy wet sheen when `snapshot.trackWaterLevel > 0.15`) + parallel Pit Lane segment (`lineWidth = 6px`, `#475569`).
  - Layer 4: Checkered start/finish line at `distanceMeters = 0`.
  - Layer 5: Car tokens (`r = 9px`, filled with `car.teamColor`, stroked with tyre compound ring color: Soft `#EF4444`, Medium `#FACC15`, Hard `#F8FAFC`, Inter `#22C55E`, Wet `#3B82F6`; yellow T-Cam dot on secondary driver; gold/white outer glow `shadowBlur = 10` on `car.teamId === playerTeamId`).

- [x] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

---

### Task 6: Schermate Weekend di Gara (`SetupGarage.tsx`, `QualifyingView.tsx`, `RacePitWallView.tsx`, `PostRaceTelemetry.tsx`)

**Files:**
- Create: `src/components/weekend/SetupGarage.tsx`
- Create: `src/components/weekend/QualifyingView.tsx`
- Create: `src/components/weekend/RacePitWallView.tsx`
- Create: `src/components/weekend/PostRaceTelemetry.tsx`

**Interfaces:**
- Consumes: `useGameStore` from `src/store/gameStore.ts`, `TrackCanvas` from `src/components/weekend/TrackCanvas.tsx`, `soundEffects` from `src/utils/soundEffects.ts`
- Produces:
  - `SetupGarage`: 5 sliders, Simulator HQ bonus indicator, "Schiera Collaudatore in FP1" toggle button, start compound selector, fuel load slider (scaled to `distancePreset`), and Parc Fermé lock.
  - `QualifyingView`: Interactive Q1 / Q2 / Q3 elimination table with per-driver compound (`S/M/I/W`), exit window (`EARLY`/`MID`/`LATE`), push mode, and instant simulate buttons ("Simula Q1/Q2/Q3" and "Simula Tutta la Qualifica").
  - `RacePitWallView`: 1080p Pit Wall OS layout with top status bar (Lap, Weather & Water mm, Race Control `GREEN`/`YELLOW`/`SAFETY CAR`, speed `1x/2x/4x/10x`), `TrackCanvas`, FIA Live Timing table (Position, Driver + Badges `DRS`/`OVRTK`/`PIT`/`DMG`/`DNF`, Sectors `S1`/`S2`/`S3` colored Purple/Green/Yellow, Tyre Ring + Wear Bar with cliff pulse $<30\%$, Temp °C, ERS/Fuel, Gap/Interval, Last/Best Lap), and dual-driver Pit Wall Controls (Pace `1-5`, Fuel `LIFT_COAST`/`STANDARD`/`RICH`, ERS `HARVEST`/`NEUTRAL`/`DEPLOY`/`OVERTAKE`, Pit Compound `S/M/H/I/W` + `Ripara Danni Ala` checkbox + `CHIAMA BOX`, and Team Orders `LIBERO`/`MANTIENI POS`/`SCAMBIA POS`).
  - `PostRaceTelemetry`: Podium & full classification, Constructor/Driver points awarded, Main + Secondary Sponsor bonus evaluation, and `<canvas>` charts for Lap Position History and Tyre Wear / Lap Time telemetry.

- [x] **Step 1: Implement `SetupGarage.tsx`, `QualifyingView.tsx`, `RacePitWallView.tsx`, and `PostRaceTelemetry.tsx`**
- [x] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors

---

### Task 7: Schermate Quartier Generale (HQ), Hub Menu Iniziale & Integrazione Finale `App.tsx`

**Files:**
- Create: `src/components/menu/MainMenuHub.tsx`
- Create: `src/components/hq/HqDashboard.tsx`
- Create: `src/components/hq/EngineeringRdView.tsx`
- Create: `src/components/hq/FacilitiesView.tsx`
- Create: `src/components/hq/DriversMarketView.tsx`
- Create: `src/components/hq/FinanceSponsorsView.tsx`
- Create: `src/components/hq/StandingsCalendarView.tsx`
- Modify: `src/App.tsx`
- Modify: `test.ts`

**Interfaces:**
- Consumes: `useGameStore`, all HQ and Weekend views
- Produces:
  - `MainMenuHub`: Team selection cards for all 10 teams (showing Tier 1–5, colors, budget, 6 component bars, drivers), Race Distance selector (`25%` / `50%` / `100%`), "Avvia Nuova Carriera", "Weekend Veloce (Scelta Pista e Meteo)", "Carica Salvataggio (.json)", and "Carica Database Custom (.json)" with validation error banner.
  - `HqDashboard`: Daily calendar bar (`+1 Giorno`, `Avanza al Prossimo Evento/GP`, `Vai al Weekend di Gara` when on race day), Inbox notification drawer, and tabs for `Ingegneria R&D`, `Strutture HQ`, `Mercato Piloti`, `Finanze & Sponsor`, and `Classifiche & Calendario 12 GP`.
  - `App.tsx`: Routes cleanly across `MAIN_MENU`, `HQ`, `WEEKEND_SETUP`, `WEEKEND_QUALI`, `WEEKEND_RACE`, and `WEEKEND_POSTRACE`.

- [x] **Step 1: Implement `MainMenuHub.tsx`, the 6 HQ components in `src/components/hq/`, and update `src/App.tsx`**
- [x] **Step 2: Run full test suite and production build verification**

Run: `npm test && npm run build`
Expected: PASS (`test.ts` assertions + Monte Carlo benchmark pass, `tsc && vite build` succeeds with 0 errors)
