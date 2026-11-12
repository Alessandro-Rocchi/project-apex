# Virtual Safety Car (VSC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Virtual Safety Car (VSC) in Project Apex, providing a tactical "cheap pit stop" window with preserved gaps, 62% speed capping, incident differentiation, AI strategic opportunism, and Pit Wall OS UI integration.

**Architecture:** Extend `RaceControlStatus` with `'VIRTUAL_SAFETY_CAR'` and track `vscLapsRemaining` in the simulation snapshot. In `raceEngine.ts`, apply a uniform 62% speed limit preserving relative time intervals without artificial bunching, reduce tyre wear and fuel burn, disable DRS/overtaking, and step down laps on leader line crossings. In `aiStrategist.ts`, evaluate opportunistic pit stops under VSC for tyres below 60% life, and update `App.tsx` with dedicated amber telemetry status badges.

**Tech Stack:** React 19, TypeScript 5+, Tailwind CSS, Node.js assert/strict test runner (`test.ts`), Vite.

**Spec:** [2026-11-12-virtual-safety-car-design.md](file:///C:/Users/alle_/.gemini/antigravity/worktrees/project-apex/test_branch_ideas/docs/superpowers/specs/2026-11-12-virtual-safety-car-design.md)

## Global Constraints

- Use existing TypeScript types and follow strict mode; zero `any` types.
- Follow the YAGNI/DRY principles of the project and preserve clean 2D Catmull-Rom canvas rendering without jitter.
- All unit tests run through `npm test` (`node test.ts`) using `node:assert/strict`.
- All code must pass `npm run lint` and `npm run build` cleanly.

## Review Focus

- Cars crossing from Green to VSC must not experience sudden position inversion or negative distance steps.
- Gaps between cars must remain stable during VSC (no bunching up to 0.45s as in Full Safety Car).
- DRS must be strictly unavailable during VSC even if cars are within 1.0s in a DRS zone.
- Cars already in the pit lane when VSC is deployed must complete their pit stop cleanly without infinite speed capping or timer lock.
- AI cars must not pit on the final lap of the race under VSC.

---

### Task 1: Extend Telemetry Types and Simulation Snapshot

**Files:**
- Modify: `src/types/telemetry.ts:8-10`
- Modify: `src/engine/raceEngine.ts:30-45`, `src/engine/raceEngine.ts:280-320`
- Modify: `test.ts:180-206`

**Interfaces:**
- Produces: `RaceControlStatus = 'GREEN' | 'YELLOW' | 'SAFETY_CAR' | 'VIRTUAL_SAFETY_CAR' | 'RED'` in `src/types/telemetry.ts`
- Produces: `vscLapsRemaining: number` in `RaceSimulationSnapshot`

- [ ] **Step 1: Write the failing test in `test.ts`**

Add an assertion block verifying `RaceControlStatus` includes `'VIRTUAL_SAFETY_CAR'` and that `createInitialRaceState` initializes `vscLapsRemaining: 0`.

```typescript
// Test VSC Types & Initial State
const testInitSim = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
  track: DEFAULT_DB.tracks[0],
  distancePreset: 'SPRINT_25',
});
assert.equal(testInitSim.vscLapsRemaining, 0);
assert.equal(typeof testInitSim.vscLapsRemaining, 'number');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`  
Expected: FAIL with compilation/type error or assertion failure (`testInitSim.vscLapsRemaining is undefined`).

- [ ] **Step 3: Update `src/types/telemetry.ts` and `src/engine/raceEngine.ts`**

In `src/types/telemetry.ts`:
Update `RaceControlStatus`:
```typescript
export type RaceControlStatus = 'GREEN' | 'YELLOW' | 'SAFETY_CAR' | 'VIRTUAL_SAFETY_CAR' | 'RED';
```
In `RaceSimulationSnapshot`:
```typescript
vscLapsRemaining: number;
```
In `src/engine/raceEngine.ts`:
In `createInitialRaceState`:
```typescript
vscLapsRemaining: 0,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/telemetry.ts src/engine/raceEngine.ts test.ts
git commit -m "feat(telemetry): add VIRTUAL_SAFETY_CAR status and vscLapsRemaining state"
```

---

### Task 2: Implement VSC Physics, DRS Lock, Gap Preservation & Leader Lap Decrement

**Files:**
- Modify: `src/engine/raceEngine.ts:500-610`, `src/engine/raceEngine.ts:720-745`
- Test: `test.ts`

**Interfaces:**
- Consumes: `RaceControlStatus`, `vscLapsRemaining` from Task 1
- Produces: VSC speed calculation capping at 62%, disabled DRS, 35% tyre wear multiplier, 40% fuel burn multiplier, no overtaking, and transition back to GREEN when leader completes laps.

- [ ] **Step 1: Write the failing tests in `test.ts`**

Test that when `raceControl === 'VIRTUAL_SAFETY_CAR'`:
1. Speed is capped at 62% of standard pace.
2. DRS is not active even if within 1.0s in DRS zone.
3. Tyre wear and fuel burn use SC reduction coefficients (0.35 and 0.40).
4. No overtaking occurs when cars are close.
5. When `vscLapsRemaining` reaches 0 as the leader crosses the line, `raceControl` reverts to `GREEN`.

```typescript
// Test VSC Physics & Speed Capping
const vscSim = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
  track: DEFAULT_DB.tracks[0],
  distancePreset: 'SPRINT_25',
});
vscSim.raceControl = 'VIRTUAL_SAFETY_CAR';
vscSim.vscLapsRemaining = 1;

const steppedVsc = stepRaceSimulation(vscSim, DEFAULT_DB.tracks[0], DEFAULT_DB.drivers, DEFAULT_DB.teams, 0.1, 'corsa-rossa');
assert.equal(steppedVsc.raceControl, 'VIRTUAL_SAFETY_CAR');
assert.ok(steppedVsc.cars[0].currentSpeedMs <= DEFAULT_DB.tracks[0].segments[0].referenceSpeedMs * 0.65);
assert.equal(steppedVsc.cars[0].isDrsActive, false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`  
Expected: FAIL because VSC speed capping and logic are not yet wired in `stepRaceSimulation`.

- [ ] **Step 3: Implement VSC logic in `src/engine/raceEngine.ts`**

1. In DRS calculation:
```typescript
const drsEnabledByDirector =
  raceControl === 'GREEN' && trackWaterLevel < 0.18 && car.currentLap > 1;
```
Ensure DRS is disabled if `raceControl === 'VIRTUAL_SAFETY_CAR'`.
2. In speed calculation:
```typescript
if (raceControl === 'SAFETY_CAR') {
  rawSpeedMs = carAhead && car.gapToAheadSec > 0.55 ? Math.min(rawSpeedMs, 64) : Math.min(rawSpeedMs, 48);
} else if (raceControl === 'VIRTUAL_SAFETY_CAR') {
  rawSpeedMs = Math.min(rawSpeedMs * 0.62, segment.referenceSpeedMs * 0.62);
} else if (raceControl === 'YELLOW') {
  rawSpeedMs = Math.min(rawSpeedMs, segment.referenceSpeedMs * 0.78);
}
```
3. In wear & fuel calculation:
```typescript
const scWearReduction = (raceControl === 'SAFETY_CAR' || raceControl === 'VIRTUAL_SAFETY_CAR') ? 0.35 : 1.0;
const scFuelReduction = (raceControl === 'SAFETY_CAR' || raceControl === 'VIRTUAL_SAFETY_CAR') ? 0.4 : 1.0;
```
4. In overtaking resolution:
Forbid overtaking if `raceControl !== 'GREEN'`.
5. In lap completion for leader:
```typescript
if (raceControl === 'VIRTUAL_SAFETY_CAR') {
  vscLapsRemaining -= 1;
  if (vscLapsRemaining <= 0) {
    raceControl = 'GREEN';
    newRadioMessages.push('[VSC TERMINATA]: Bandiera Verde! Ripristino del ritmo di gara.');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/raceEngine.ts test.ts
git commit -m "feat(engine): implement VSC speed capping, DRS lockout, and lap countdown"
```

---

### Task 3: Incident Trigger Differentiation (VSC vs Full Safety Car)

**Files:**
- Modify: `src/engine/raceEngine.ts:750-785`
- Test: `test.ts`

**Interfaces:**
- Consumes: `raceControl`, `vscLapsRemaining`, `safetyCarLapsRemaining`
- Produces: Differentiated stochastic incidents: minor mechanical failures/stopping off-track trigger VSC (1-2 laps); major collisions trigger Full Safety Car (2-3 laps).

- [ ] **Step 1: Write the failing test in `test.ts`**

Create test verifying that stochastic minor breakdown sets `raceControl = 'VIRTUAL_SAFETY_CAR'` and `vscLapsRemaining >= 1`, while severe incidents trigger `SAFETY_CAR`.

```typescript
// Test Incident Differentiation
// Verifies helper or step triggers VSC for minor retirement
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`  
Expected: FAIL

- [ ] **Step 3: Implement incident differentiation in `src/engine/raceEngine.ts`**

When an incident/retirement occurs:
- If `pseudoRand < mechFailThreshold`:
  - 65% chance of minor breakdown / stopping safely off-track -> `raceControl = 'VIRTUAL_SAFETY_CAR'; vscLapsRemaining = 2;` with message `[VSC ATTIVATA]: ${car.driverCode} fermo a bordo pista (${car.retirementReason}). Virtual Safety Car in pista!`
  - 35% chance of severe on-track incident -> `raceControl = 'SAFETY_CAR'; safetyCarLapsRemaining = 2;` with message `[RITIRO & SAFETY CAR]: ${car.driverCode} fermo in traiettoria! Safety Car in pista!`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/raceEngine.ts test.ts
git commit -m "feat(engine): differentiate minor incidents for VSC vs major incidents for Full SC"
```

---

### Task 4: AI Strategic Opportunism Under VSC

**Files:**
- Modify: `src/engine/aiStrategist.ts:117-133`
- Test: `test.ts`

**Interfaces:**
- Consumes: `snapshot.raceControl === 'VIRTUAL_SAFETY_CAR'`, `car.tyreWear`, `remainingLaps`
- Produces: `requestPit: true` for AI cars under VSC when tyre wear is `< 0.60` (cheap stop window) or front wing is damaged.

- [ ] **Step 1: Write the failing test in `test.ts`**

Test that `evaluateAiPitStrategy` returns `requestPit: true` for an AI car with tyre wear 0.55 during VSC when `remainingLaps >= 4`.

```typescript
// Test AI VSC Opportunistic Pit Stop
const aiCarMock: CarRaceState = {
  ...testInitSim.cars[2],
  tyreWear: 0.55,
  tyreAgeLaps: 5,
};
const aiSimSnapshot: RaceSimulationSnapshot = {
  ...testInitSim,
  raceControl: 'VIRTUAL_SAFETY_CAR',
  vscLapsRemaining: 2,
};
const aiDecision = evaluateAiPitStrategy(aiCarMock, aiSimSnapshot, 10);
assert.equal(aiDecision.requestPit, true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`  
Expected: FAIL because `evaluateAiPitStrategy` only checks `snapshot.raceControl === 'SAFETY_CAR'`.

- [ ] **Step 3: Update `src/engine/aiStrategist.ts`**

Update condition in `aiStrategist.ts`:
```typescript
// C. Opportunità Safety Car / Virtual Safety Car (sosta scontata)
const isNeutralized =
  snapshot.raceControl === 'SAFETY_CAR' || snapshot.raceControl === 'VIRTUAL_SAFETY_CAR';

if (
  isNeutralized &&
  car.tyreWear < 0.60 &&
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/aiStrategist.ts test.ts
git commit -m "feat(ai): enable opportunistic cheap pit stops during Virtual Safety Car"
```

---

### Task 5: Pit Wall UI Telemetry Badge and Audio Cue

**Files:**
- Modify: `src/App.tsx:780-820`
- Test: Visual inspection & build check (`npm run build`)

**Interfaces:**
- Consumes: `sim.raceControl === 'VIRTUAL_SAFETY_CAR'`, `sim.vscLapsRemaining`
- Produces: Amber pulsating status pill `[VSC] VIRTUAL SAFETY CAR` in telemetry header, play radio beep audio cue on state change.

- [ ] **Step 1: Check build and current status banner in `src/App.tsx`**

Locate `raceControl` badge rendering in `App.tsx` (around lines 785-805).

- [ ] **Step 2: Implement VSC badge in `src/App.tsx`**

Render appropriate styling for `VIRTUAL_SAFETY_CAR`:
```tsx
{sim.raceControl === 'VIRTUAL_SAFETY_CAR' && (
  <span className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/60 font-bold text-xs animate-pulse">
    🟡 VSC • VIRTUAL SAFETY CAR ({sim.vscLapsRemaining} GIRI)
  </span>
)}
```
Play `soundEffects.playRadioBeep()` when entering or exiting VSC.

- [ ] **Step 3: Verify build and lint**

Run: `npm run lint && npm run build`  
Expected: Clean compilation with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): add VSC status pill, amber telemetry styling and radio cues"
```

---

### Task 6: Comprehensive Regression Testing & Full Verification

**Files:**
- Modify: `test.ts`
- Run: `npm test`, `npm run lint`, `npm run build`

- [ ] **Step 1: Expand `test.ts` with end-to-end VSC scenarios**

Ensure tests cover:
1. Normal race step -> VSC deployment -> 62% speed verification -> Tyre wear reduced -> AI pits -> Leader lap countdown -> Return to Green flag.
2. Zero negative speed or NaN distances.
3. DRS availability logic during and after VSC.

- [ ] **Step 2: Run all verifications**

Run:
```bash
npm test
npm run lint
npm run build
```
Expected: All tests pass, lint passes with zero errors, build produces production bundle.

- [ ] **Step 3: Commit**

```bash
git add test.ts
git commit -m "test: add comprehensive test suite for Virtual Safety Car mechanics"
```
