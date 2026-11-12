# Custom Team Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere al giocatore di creare, personalizzare (nome, nazionalità, livrea esadecimale e stemma SVG) e bilanciare (Tier 1 Top Team fino a Tier 5 Underdog) la propria scuderia direttamente nel Menu Principale di Project Apex, rimpiazzando una scuderia esistente con mercato piloti aperto e seat-swap automatico per preservare la griglia a 10 team e 20 vetture.

**Architecture:** La logica di dominio risiede in `src/engine/customTeamBuilder.ts`, una libreria di funzioni pure che genera le specifiche tecniche/fisiche in base al Tier scelto (`hydrateTeamPhysics`) e applica una transazione atomica su `GameDatabase` per sostituire il team e gestire il seat-swap dei piloti garantendo l'integrità FIA della griglia (`validateCustomDatabase`). L'interfaccia utente è un modal guidato `src/components/teamCreatorModal.tsx` integrato in `src/App.tsx`, corredato da pulsanti per il ripristino del database originale e l'esportazione in `.json`.

**Tech Stack:** TypeScript, React 19, Tailwind CSS, SVG dinamico, Node.js assert/strict test suite.

**Spec:** `docs/superpowers/specs/2026-11-12-custom-team-creator-design.md`

## Global Constraints

- La griglia deve rimanere rigorosamente composta da 10 scuderie e 20 vetture titolari (`PRIMARY` e `SECONDARY`), più 1 collaudatore (`RESERVE`) per ogni scuderia.
- Ogni operazione di sostituzione deve produrre un database valido al 100% secondo `validateCustomDatabase(db)`.
- I valori dei componenti e delle strutture devono rispettare i 5 Tier:
  - Tier 1: Budget 48 M€, Strutture {factory: 3, windTunnel: 3, simulator: 3}, Componenti media 92-95.
  - Tier 2: Budget 40 M€, Strutture {factory: 2, windTunnel: 3, simulator: 2}, Componenti media 88-91.
  - Tier 3: Budget 33 M€, Strutture {factory: 2, windTunnel: 2, simulator: 2}, Componenti media 84-87.
  - Tier 4: Budget 26 M€, Strutture {factory: 1, windTunnel: 2, simulator: 1}, Componenti media 80-83.
  - Tier 5: Budget 20 M€, Strutture {factory: 1, windTunnel: 1, simulator: 1}, Componenti media 75-79.
- Nessuna dipendenza esterna aggiuntiva (zero npm install).

## Review Focus

- **Input con nome vuoto o composto solo da spazi:** Il wizard deve disabilitare il pulsante di conferma e non permettere la creazione di scuderie anonime.
- **Selezione dello stesso pilota per entrambi gli slot (Primary e Secondary):** Il wizard deve invalidare la selezione e impedire la sottomissione evitando un duplicato in griglia.
- **Ingaggio di entrambi i piloti dalla medesima scuderia rivale:** Il seat-swap deve trasferire entrambi i piloti scalzati alla scuderia rivale svuotata, garantendo che quest'ultima abbia esattamente 2 piloti validi.
- **Ingaggio di due piloti da due diverse scuderie rivali:** Il seat-swap deve distribuire 1-a-1 i due piloti scalzati ai due rispettivi team orfani.
- **Riassegnazione collaudatore (Reserve Driver):** La nuova scuderia deve sempre ereditare il collaudatore della scuderia sostituita con ruolo `RESERVE` e `teamId` aggiornato.

---

### Task 1: Core Domain Engine (`src/engine/customTeamBuilder.ts`)

**Files:**
- Create: `src/engine/customTeamBuilder.ts`
- Test: `test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface CustomTeamInput {
    name: string;
    nationality: string;
    colorHex: string;
    accentHex: string;
    tier: 1 | 2 | 3 | 4 | 5;
    replacedTeamId: string;
    primaryDriverId: string;
    secondaryDriverId: string;
  }

  export function getTierPresets(tier: 1 | 2 | 3 | 4 | 5): {
    budgetMillions: number;
    facilities: TeamFacilities;
    components: CarComponents;
  };

  export function buildCustomTeam(input: CustomTeamInput, generatedId?: string): Team;

  export function executeTeamReplacement(
    db: GameDatabase,
    input: CustomTeamInput,
    customTeamId?: string
  ): { updatedDb: GameDatabase; newTeam: Team };

  export function pickRandomDriversForTier(
    drivers: Driver[],
    tier: 1 | 2 | 3 | 4 | 5
  ): [string, string];
  ```

- [ ] **Step 1: Write failing tests in `test.ts` for custom team generation, tier presets, and seat-swap logic**

```typescript
// Test: buildCustomTeam generates a valid hydrated Team for each Tier (1-5)
for (let t = 1; t <= 5; t++) {
  const team = buildCustomTeam({
    name: `Test Team T${t}`,
    nationality: 'Italia',
    colorHex: '#FF0000',
    accentHex: '#FFFFFF',
    tier: t as 1 | 2 | 3 | 4 | 5,
    replacedTeamId: 'corsa-rossa',
    primaryDriverId: 'alberto-bianchi',
    secondaryDriverId: 'marco-conti',
  });
  assert.equal(team.tier, t);
  assert.ok(team.power >= 70 && team.power <= 100);
  assert.ok(team.overallReliability >= 70 && team.overallReliability <= 100);
}

// Test: executeTeamReplacement preserves 10 teams, 20 titulares, 10 reserves, and passes validateCustomDatabase
const baseDb = DEFAULT_DB;
const replaced = executeTeamReplacement(baseDb, {
  name: 'Apex Trident',
  nationality: 'Italia',
  colorHex: '#10B981',
  accentHex: '#000000',
  tier: 3,
  replacedTeamId: 'corsa-rossa',
  primaryDriverId: 'free-agent-1', // Assuming a free agent
  secondaryDriverId: 'alberto-bianchi',
});
assert.equal(replaced.updatedDb.teams.length, 10);
assert.equal(replaced.updatedDb.teams.some(t => t.id === 'corsa-rossa'), false);
assert.equal(replaced.updatedDb.teams.some(t => t.id === replaced.newTeam.id), true);
assert.equal(validateCustomDatabase(replaced.updatedDb).valid, true);

// Test seat-swap when poaching from rival team
const rivalDriver = baseDb.drivers.find(d => d.teamId === 'silberpfeil' && d.role === 'PRIMARY')!;
const swapResult = executeTeamReplacement(baseDb, {
  name: 'Scuderia Swap',
  nationality: 'Francia',
  colorHex: '#3B82F6',
  accentHex: '#FBBF24',
  tier: 1,
  replacedTeamId: 'corsa-rossa',
  primaryDriverId: rivalDriver.id,
  secondaryDriverId: 'free-agent-1',
});
const silberDrivers = swapResult.updatedDb.drivers.filter(d => d.teamId === 'silberpfeil' && (d.role === 'PRIMARY' || d.role === 'SECONDARY'));
assert.equal(silberDrivers.length, 2, 'Silberpfeil must retain 2 titular drivers via seat-swap');
assert.equal(validateCustomDatabase(swapResult.updatedDb).valid, true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test.ts`  
Expected: FAIL with "Cannot find module './src/engine/customTeamBuilder.ts'" or "buildCustomTeam is not a function"

- [ ] **Step 3: Implement `src/engine/customTeamBuilder.ts`**

Implement:
- `getTierPresets(tier)`: returns calibrated budget, facilities, and components.
- `buildCustomTeam(input, generatedId)`: calls `hydrateTeamPhysics` from `carPhysicsMapper.ts`.
- `executeTeamReplacement(db, input)`:
  - Deep-clones `db`.
  - Replaces team in `teams` array at the exact index or replaces the item.
  - Finds titular drivers of `replacedTeamId`.
  - Transfers `RESERVE` driver of `replacedTeamId` to `newTeam.id`.
  - For `primaryDriverId` and `secondaryDriverId`: assigns them to `newTeam.id` as `PRIMARY` and `SECONDARY`.
  - For any original team of the selected drivers (if not the custom team or free agent): replaces their vacant seats with the displaced titular drivers of `replacedTeamId`.
  - Any remaining displaced drivers become `FREE_AGENT` (`teamId: null`).
  - Calls `validateCustomDatabase(updatedDb)` and returns `{ updatedDb, newTeam }`.
- `pickRandomDriversForTier(drivers, tier)`: selects two distinct drivers whose pace/overall aligns with the target tier.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test.ts`  
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/engine/customTeamBuilder.ts test.ts
git commit -m "feat: add custom team builder engine with tier presets and seat-swap logic"
```

---

### Task 2: Team Creator Modal Component (`src/components/teamCreatorModal.tsx`)

**Files:**
- Create: `src/components/teamCreatorModal.tsx`
- Modify: `src/App.tsx` (interface alignment only or test mount)

**Interfaces:**
- Consumes: `CustomTeamInput`, `getTierPresets`, `pickRandomDriversForTier`, `deriveCarPhysics` from `src/engine/customTeamBuilder.ts` and `src/engine/carPhysicsMapper.ts`.
- Produces:
  ```typescript
  export interface TeamCreatorModalProps {
    isOpen: boolean;
    currentDb: GameDatabase;
    onClose: () => void;
    onConfirm: (input: CustomTeamInput) => void;
  }
  export default function TeamCreatorModal(props: TeamCreatorModalProps): React.JSX.Element | null;
  ```

- [ ] **Step 1: Write component structure with form state and validation**

Create `src/components/teamCreatorModal.tsx`:
- Render nothing if `!isOpen`.
- Modal overlay with dark backdrop (`bg-black/80 backdrop-blur-sm`).
- Modal card container with Pit Wall OS theme (`bg-[#111827] border border-slate-700 rounded-lg p-6`).
- **Section 1: Identità & Livrea:**
  - Input `Nome Scuderia` (default: "Scuderia Apex", trim checks for whitespace).
  - Select/input `Nazionalità` (Italia, Regno Unito, Germania, Francia, Austria, USA, Giappone, ecc.).
  - Color pickers for `colorHex` (default: `#2563EB`) and `accentHex` (default: `#F59E0B`).
  - SVG preview with polygon shield:
    ```svg
    <svg width="48" height="54" viewBox="0 0 28 32">
      <polygon points="14,1 27,7 24,24 14,31 4,24 1,7" fill={colorHex} stroke={accentHex} strokeWidth="2" />
    </svg>
    ```
- **Section 2: Team da Sostituire & Tier:**
  - Dropdown listing all 10 teams in `currentDb.teams` (name + tier).
  - Tier selector buttons (1, 2, 3, 4, 5) with descriptive badges ("Top Team", "Midfield Alto", "Midfield", "Midfield Basso", "Underdog").
  - Dynamic preview box displaying: Budget (€M), Strutture HQ (Fabbrica, Galleria, Simulatore), e telemetria stimata (PWR, AERO, Grip, Affidabilità).
- **Section 3: Line-up Piloti:**
  - Dropdowns for `Pilota 1` and `Pilota 2` listing all drivers with nationality flag/code, Pace score, and current team.
  - Button `🎲 Assegna Casuali` invoking `pickRandomDriversForTier(currentDb.drivers, tier)`.
  - Error indicator if `primaryDriverId === secondaryDriverId` or `name.trim() === ''`.
- **Footer Controls:**
  - `Annulla` (calls `onClose`).
  - `🏁 FONDA LA TUA SCUDERIA` (disabled if invalid, calls `onConfirm(input)`).

- [ ] **Step 2: Verify component compiles with type check**

Run: `npm run build`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/teamCreatorModal.tsx
git commit -m "feat: add TeamCreatorModal wizard component with live livery preview and validation"
```

---

### Task 3: Integration into App.tsx (Main Menu, Modding, & Career State)

**Files:**
- Modify: `src/App.tsx`
- Test: `test.ts`

**Interfaces:**
- Consumes: `TeamCreatorModal` from `src/components/teamCreatorModal.tsx`, `executeTeamReplacement` from `src/engine/customTeamBuilder.ts`.

- [ ] **Step 1: Write integration tests in `test.ts` for full lifecycle**

```typescript
// Test full creation lifecycle in CareerState
const initialCareer = createInitialCareerState(DEFAULT_DB, 'corsa-rossa', 'SPRINT_25');
const { updatedDb, newTeam } = executeTeamReplacement(initialCareer.db, {
  name: 'Phoenix Racing',
  nationality: 'Italia',
  colorHex: '#E11D48',
  accentHex: '#FBBF24',
  tier: 2,
  replacedTeamId: 'corsa-rossa',
  primaryDriverId: initialCareer.db.drivers[0].id,
  secondaryDriverId: initialCareer.db.drivers[1].id,
});
const nextCareer = createInitialCareerState(updatedDb, newTeam.id, initialCareer.distancePreset);
assert.equal(nextCareer.playerTeamId, newTeam.id);
assert.equal(nextCareer.season, 1);
assert.equal(nextCareer.currentDay, 1);
assert.equal(nextCareer.currentRoundIndex, 0);
assert.equal(nextCareer.db.teams.length, 10);
// Ensure sponsor deals assigned correctly matching Tier 2
assert.ok(nextCareer.sponsorDeals.main !== null);
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node test.ts`  
Expected: PASS

- [ ] **Step 3: Update `src/App.tsx` with modal trigger and database management buttons**

1. Import `TeamCreatorModal` and `executeTeamReplacement`.
2. Add state `isTeamCreatorOpen: boolean` (default `false`).
3. In `MAIN_MENU` header (above team selection grid):
   - Add button `🛠️ FONDA LA TUA SCUDERIA` styled with emerald/amber accent to open modal.
4. Implement `handleConfirmCreateCustomTeam(input: CustomTeamInput)`:
   - Call `executeTeamReplacement(career.db, input)`.
   - Call `createInitialCareerState(updatedDb, newTeam.id, career.distancePreset)`.
   - Call `updateAndSaveCareer(freshCareer)`.
   - Trigger `soundEffects.playCheckeredFlag()`.
   - Set status message: `setModStatusMsg(`Scuderia "${newTeam.name}" fondata con successo! Nuova carriera avviata.`)`.
   - Close modal.
5. In Section 3 ("Modding IP-Safe & Caricamento Salvataggi"):
   - Add button `🔄 RIPRISTINA DATABASE PREDEFINITO`:
     - Shows confirmation: `window.confirm('Sei sicuro di voler ripristinare il database predefinito? La scuderia personalizzata verrà rimossa e la carriera azzerata.')`.
     - Replaces with `createInitialCareerState(DEFAULT_DB, 'corsa-rossa', career.distancePreset)` and saves.
   - Add button `💾 ESPORTA DATABASE (.JSON)`:
     - Downloads `career.db` directly as a `.json` file (`project-apex-database.json`) compatible with `📂 CARICA DATABASE CUSTOM (.JSON)`.
6. Mount `<TeamCreatorModal isOpen={isTeamCreatorOpen} currentDb={career.db} onClose={() => setIsTeamCreatorOpen(false)} onConfirm={handleConfirmCreateCustomTeam} />`.

- [ ] **Step 4: Verify full test suite, lint, and build pass**

Run: `npm test && npm run lint && npm run build`  
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx test.ts
git commit -m "feat: integrate Custom Team Creator, default DB reset, and database export in App.tsx"
```

---

### Task 4: Comprehensive End-to-End Simulation Tests

**Files:**
- Modify: `test.ts`

**Interfaces:**
- Consumes: Qualifying and race simulation engines with a custom team on the grid.

- [ ] **Step 1: Add end-to-end simulation tests in `test.ts`**

```typescript
// Test qualifying and race simulation with custom team
const customCreation = executeTeamReplacement(DEFAULT_DB, {
  name: 'Apex Hyperion',
  nationality: 'Italia',
  colorHex: '#6366F1',
  accentHex: '#10B981',
  tier: 1,
  replacedTeamId: 'lumiere-equipe',
  primaryDriverId: DEFAULT_DB.drivers[0].id,
  secondaryDriverId: DEFAULT_DB.drivers[2].id,
});
const customDb = customCreation.updatedDb;

// Test Qualifying
const qualiSession = createQualifyingSession(customDb.teams, customDb.drivers, 'DRY');
const autoQuali = runFullQualifyingAuto(qualiSession, customDb.teams, customDb.drivers);
assert.equal(autoQuali.isCompleted, true);
assert.equal(autoQuali.results.length, 20);

// Test Race Engine step
const track = customDb.tracks[0];
const raceState = createInitialRaceState(customDb.teams, customDb.drivers, [], {
  track,
  distancePreset: 'SPRINT_25',
  initialWeather: 'DRY',
});
assert.equal(raceState.cars.length, 20);
const stepped = stepRaceSimulation(raceState, track, customDb.teams, customDb.drivers, 0.5, customCreation.newTeam.id);
assert.equal(stepped.cars.length, 20);
assert.ok(stepped.cars.some(c => c.teamId === customCreation.newTeam.id));
```

- [ ] **Step 2: Run test suite**

Run: `node test.ts`  
Expected: PASS

- [ ] **Step 3: Run linter and build check**

Run: `npm run lint && npm run build`  
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add test.ts
git commit -m "test: add qualifying and race simulation tests for custom team on grid"
```
