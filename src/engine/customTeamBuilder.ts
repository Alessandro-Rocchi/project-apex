import type { CarComponents, Driver, GameDatabase, Team, TeamFacilities } from '../types/telemetry.ts';
import { hydrateTeamPhysics } from './carPhysicsMapper.ts';

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

function createComponents(performance: number, reliability: number): CarComponents {
  return {
    powerUnit: { performance, reliability },
    frontWing: { performance, reliability },
    rearWing: { performance, reliability },
    floor: { performance, reliability },
    suspension: { performance, reliability },
    brakes: { performance, reliability },
  };
}

const TIER_PRESETS: Record<
  1 | 2 | 3 | 4 | 5,
  { budgetMillions: number; facilities: TeamFacilities; components: CarComponents }
> = {
  1: {
    budgetMillions: 48.0,
    facilities: { factory: 3, windTunnel: 3, simulator: 3 },
    components: createComponents(93, 91),
  },
  2: {
    budgetMillions: 40.0,
    facilities: { factory: 2, windTunnel: 3, simulator: 2 },
    components: createComponents(89, 90),
  },
  3: {
    budgetMillions: 33.0,
    facilities: { factory: 2, windTunnel: 2, simulator: 2 },
    components: createComponents(85, 89),
  },
  4: {
    budgetMillions: 26.0,
    facilities: { factory: 1, windTunnel: 2, simulator: 1 },
    components: createComponents(81, 87),
  },
  5: {
    budgetMillions: 20.0,
    facilities: { factory: 1, windTunnel: 1, simulator: 1 },
    components: createComponents(77, 85),
  },
};

export function getTierPresets(tier: 1 | 2 | 3 | 4 | 5): {
  budgetMillions: number;
  facilities: TeamFacilities;
  components: CarComponents;
} {
  return TIER_PRESETS[tier] ?? TIER_PRESETS[3];
}

export function buildCustomTeam(input: CustomTeamInput, generatedId?: string): Team {
  const cleanSlug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const id = generatedId || (cleanSlug ? `custom-${cleanSlug}` : 'custom-team');

  const preset = getTierPresets(input.tier);
  return hydrateTeamPhysics({
    id,
    name: input.name,
    nationality: input.nationality,
    colorHex: input.colorHex,
    accentHex: input.accentHex,
    tier: input.tier,
    budgetMillions: preset.budgetMillions,
    facilities: preset.facilities,
    components: preset.components,
  });
}

export function executeTeamReplacement(
  db: GameDatabase,
  input: CustomTeamInput,
  customTeamId?: string
): { updatedDb: GameDatabase; newTeam: Team } {
  if (input.primaryDriverId === input.secondaryDriverId) {
    throw new Error('Primary and Secondary drivers must be distinct.');
  }

  // Generate / resolve custom team ID with collision check
  const cleanSlug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  let resolvedId = customTeamId || (cleanSlug ? `custom-${cleanSlug}` : 'custom-team');

  // Verify that the generated team id is not already used by another team in db.teams (excluding replacedTeamId)
  if (db.teams.some((t) => t.id === resolvedId && t.id !== input.replacedTeamId)) {
    resolvedId = `${resolvedId}-${Date.now().toString(36)}`;
    while (db.teams.some((t) => t.id === resolvedId && t.id !== input.replacedTeamId)) {
      resolvedId = `${resolvedId}-${Math.random().toString(36).slice(2, 6)}`;
    }
  }

  const updatedDb = structuredClone(db);
  const newTeam = buildCustomTeam(input, resolvedId);

  // Replaces the team whose id === input.replacedTeamId with newTeam in teams
  const teamIdx = updatedDb.teams.findIndex((t) => t.id === input.replacedTeamId);
  if (teamIdx >= 0) {
    updatedDb.teams[teamIdx] = newTeam;
  } else {
    updatedDb.teams.push(newTeam);
  }

  // Displaced reserve driver reassigned to newTeam.id as RESERVE
  for (const d of updatedDb.drivers) {
    if (d.teamId === input.replacedTeamId && d.role === 'RESERVE') {
      d.teamId = newTeam.id;
      d.role = 'RESERVE';
    }
  }

  // Displaced titular drivers gathered into available replacement queue
  const displacedTitularQueue = updatedDb.drivers.filter(
    (d) =>
      d.teamId === input.replacedTeamId &&
      (d.role === 'PRIMARY' || d.role === 'SECONDARY') &&
      d.id !== input.primaryDriverId &&
      d.id !== input.secondaryDriverId
  );

  // Selected drivers
  const selectedDrivers: Array<{ id: string; role: 'PRIMARY' | 'SECONDARY' }> = [
    { id: input.primaryDriverId, role: 'PRIMARY' },
    { id: input.secondaryDriverId, role: 'SECONDARY' },
  ];

  for (const sel of selectedDrivers) {
    const driver = updatedDb.drivers.find((d) => d.id === sel.id);
    if (!driver) continue;

    const prevTeamId = driver.teamId;
    const prevRole = driver.role;

    if (
      prevTeamId &&
      prevTeamId !== input.replacedTeamId &&
      (prevRole === 'PRIMARY' || prevRole === 'SECONDARY')
    ) {
      const displacedDriver = displacedTitularQueue.shift();
      if (displacedDriver) {
        displacedDriver.teamId = prevTeamId;
        displacedDriver.role = prevRole;
      }
    }

    driver.teamId = newTeam.id;
    driver.role = sel.role;
  }

  // If replaced team's reserve driver was promoted to titular seat, newTeam may have no RESERVE.
  // In that case, preserve a reserve driver by assigning one displaced titular driver as RESERVE.
  const hasReserve = updatedDb.drivers.some(
    (d) => d.teamId === newTeam.id && d.role === 'RESERVE'
  );
  if (!hasReserve && displacedTitularQueue.length > 0) {
    const reserveCandidate = displacedTitularQueue.shift();
    if (reserveCandidate) {
      reserveCandidate.teamId = newTeam.id;
      reserveCandidate.role = 'RESERVE';
    }
  }

  // Any remaining displaced titular drivers become free agents
  for (const d of displacedTitularQueue) {
    d.teamId = null;
    d.role = 'FREE_AGENT';
  }

  return { updatedDb, newTeam };
}

interface TierPaceRange {
  min: number;
  max: number;
  target: number;
}

const TIER_PACE_RANGES: Record<1 | 2 | 3 | 4 | 5, TierPaceRange> = {
  1: { min: 90, max: 100, target: 94 },
  2: { min: 86, max: 91, target: 88.5 },
  3: { min: 82, max: 87, target: 84.5 },
  4: { min: 78, max: 83, target: 80.5 },
  5: { min: 0, max: 80, target: 76 },
};

export function pickRandomDriversForTier(
  drivers: Driver[],
  tier: 1 | 2 | 3 | 4 | 5
): [string, string] {
  if (drivers.length === 0) return ['', ''];
  if (drivers.length === 1) return [drivers[0].id, drivers[0].id];

  const range = TIER_PACE_RANGES[tier];
  const inRange = drivers.filter((d) => d.pace >= range.min && d.pace <= range.max);

  if (inRange.length >= 2) {
    const idx1 = Math.floor(Math.random() * inRange.length);
    let idx2 = Math.floor(Math.random() * (inRange.length - 1));
    if (idx2 >= idx1) idx2++;
    return [inRange[idx1].id, inRange[idx2].id];
  }

  // Not enough drivers in range: sort by distance to bracket
  const sorted = [...drivers].sort((a, b) => {
    const distA =
      a.pace < range.min ? range.min - a.pace : a.pace > range.max ? a.pace - range.max : 0;
    const distB =
      b.pace < range.min ? range.min - b.pace : b.pace > range.max ? b.pace - range.max : 0;
    return distA - distB;
  });

  const first = sorted[0];
  const second = sorted.find((d) => d.id !== first.id) || sorted[1];
  return [first.id, second.id];
}
