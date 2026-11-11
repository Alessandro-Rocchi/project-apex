import type { CarComponents, GameDatabase, Team } from '../types/telemetry.ts';

export function deriveCarPhysics(
  components: CarComponents,
  frontWingDamage: number = 0
): {
  power: number;
  aeroEfficiency: number;
  downforce: number;
  mechanicalGrip: number;
  overallReliability: number;
} {
  const clampedDamage = Math.min(100, Math.max(0, frontWingDamage));
  // Fino a -18% di carico ed efficienza aerodinamica se l'ala anteriore è al 100% di danno
  const damageFactor = 1 - clampedDamage * 0.0018;

  const rawPower = components.powerUnit.performance;
  const rawAeroEff =
    components.frontWing.performance * 0.4 + components.rearWing.performance * 0.6;
  const rawDownforce =
    components.floor.performance * 0.5 +
    components.rearWing.performance * 0.3 +
    components.frontWing.performance * 0.2;
  const rawMechGrip =
    components.suspension.performance * 0.6 + components.brakes.performance * 0.4;

  const overallReliability = Math.round(
    components.powerUnit.reliability * 0.3 +
      components.floor.reliability * 0.16 +
      components.suspension.reliability * 0.16 +
      components.brakes.reliability * 0.14 +
      components.frontWing.reliability * 0.12 +
      components.rearWing.reliability * 0.12
  );

  return {
    power: Math.round(rawPower),
    aeroEfficiency: Math.round(rawAeroEff * damageFactor),
    downforce: Math.round(rawDownforce * damageFactor),
    mechanicalGrip: Math.round(rawMechGrip),
    overallReliability: Math.min(100, Math.max(1, overallReliability)),
  };
}

export function hydrateTeamPhysics(
  team: Omit<
    Team,
    'power' | 'downforce' | 'mechanicalGrip' | 'aeroEfficiency' | 'overallReliability'
  >
): Team {
  const phys = deriveCarPhysics(team.components, 0);
  return {
    ...team,
    ...phys,
  };
}

export function validateCustomDatabase(raw: unknown): {
  valid: boolean;
  error?: string;
  db?: GameDatabase;
} {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Il file JSON non contiene un oggetto valido.' };
  }
  const candidate = raw as Partial<GameDatabase>;
  if (!Array.isArray(candidate.teams) || candidate.teams.length < 2) {
    return {
      valid: false,
      error: 'Database non valido: servono almeno 2 scuderie in "teams".',
    };
  }
  if (!Array.isArray(candidate.drivers) || candidate.drivers.length < 4) {
    return {
      valid: false,
      error: 'Database non valido: servono almeno 4 piloti in "drivers".',
    };
  }
  if (!Array.isArray(candidate.tracks) || candidate.tracks.length < 1) {
    return {
      valid: false,
      error: 'Database non valido: serve almeno 1 circuito in "tracks".',
    };
  }

  for (const t of candidate.teams) {
    if (!t.id || !t.name || !t.colorHex || !t.components) {
      return {
        valid: false,
        error: `Scuderia incompleta nel JSON (id/name/colorHex/components mancanti): ${JSON.stringify(t?.id ?? 'unknown')}`,
      };
    }
  }

  for (const d of candidate.drivers) {
    if (!d.id || !d.code || !d.name || typeof d.pace !== 'number') {
      return {
        valid: false,
        error: `Pilota incompleto nel JSON: ${JSON.stringify(d?.id ?? 'unknown')}`,
      };
    }
  }

  for (const tr of candidate.tracks) {
    if (
      !tr.id ||
      !tr.name ||
      !Array.isArray(tr.segments) ||
      tr.segments.length === 0 ||
      !Array.isArray(tr.path2D) ||
      tr.path2D.length < 4
    ) {
      return {
        valid: false,
        error: `Circuito incompleto nel JSON: ${JSON.stringify(tr?.id ?? 'unknown')}`,
      };
    }
  }

  const hydratedTeams: Team[] = candidate.teams.map((t) => hydrateTeamPhysics(t));

  return {
    valid: true,
    db: {
      version: candidate.version ?? '1.0.0-custom',
      seriesName: candidate.seriesName ?? 'World Grand Prix Series (Custom)',
      teams: hydratedTeams,
      drivers: candidate.drivers,
      tracks: candidate.tracks,
      sponsors: Array.isArray(candidate.sponsors) ? candidate.sponsors : [],
    },
  };
}
