import type {
  ComponentKey,
  FacilityUpgradeProject,
  GameDatabase,
  InboxMessage,
  RaceDistancePreset,
  RdProject,
  Team,
} from '../types/telemetry.ts';
import { hydrateTeamPhysics } from './carPhysicsMapper.ts';

export const SEASON_BUDGET_CAP_MILLIONS = 135.0;
export const DAYS_BETWEEN_RACES = 14;
const FIA_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export interface CareerState {
  season: number;
  currentDay: number;
  currentRoundIndex: number;
  playerTeamId: string;
  distancePreset: RaceDistancePreset;
  budgetCapSpentMillions: number;
  activeRdProjects: RdProject[];
  activeFacilityUpgrade: FacilityUpgradeProject | null;
  activeMainSponsorId: string;
  activeSecondarySponsorIds: string[];
  driverPoints: Record<string, number>;
  teamPoints: Record<string, number>;
  driverWins: Record<string, number>;
  reserveUsedInFp1ThisRound: boolean;
  inbox: InboxMessage[];
  db: GameDatabase;
}

export function createInitialCareerState(
  db: GameDatabase,
  playerTeamId: string = 'corsa-rossa',
  distancePreset: RaceDistancePreset = 'SPRINT_25'
): CareerState {
  const clonedDb: GameDatabase = structuredClone(db);
  const playerTeam =
    clonedDb.teams.find((t) => t.id === playerTeamId) ?? clonedDb.teams[0];

  const mainSponsor =
    clonedDb.sponsors.find(
      (s) => s.type === 'MAIN' && s.minTierAllowed >= playerTeam.tier
    ) ?? clonedDb.sponsors[0];
  const secSponsors = clonedDb.sponsors
    .filter((s) => s.type === 'SECONDARY' && s.minTierAllowed >= playerTeam.tier)
    .slice(0, 2);

  const driverPoints: Record<string, number> = {};
  const driverWins: Record<string, number> = {};
  for (const d of clonedDb.drivers) {
    driverPoints[d.id] = 0;
    driverWins[d.id] = 0;
  }

  const teamPoints: Record<string, number> = {};
  for (const t of clonedDb.teams) {
    teamPoints[t.id] = 0;
  }

  return {
    season: 1,
    currentDay: 1,
    currentRoundIndex: 0,
    playerTeamId: playerTeam.id,
    distancePreset,
    budgetCapSpentMillions: 0,
    activeRdProjects: [],
    activeFacilityUpgrade: null,
    activeMainSponsorId: mainSponsor?.id ?? '',
    activeSecondarySponsorIds: secSponsors.map((s) => s.id),
    driverPoints,
    teamPoints,
    driverWins,
    reserveUsedInFp1ThisRound: false,
    inbox: [
      {
        id: 'msg-welcome',
        day: 1,
        season: 1,
        title: `Benvenuto in ${playerTeam.name}`,
        body: `Il Consiglio di Amministrazione ti affida la direzione sportiva per la Stagione 1. Budget disponibile: ${playerTeam.budgetMillions.toFixed(1)} M€. Prossimo GP al Giorno ${DAYS_BETWEEN_RACES}.`,
        category: 'FIA',
        read: false,
      },
    ],
    db: clonedDb,
  };
}

export function getRdProjectQuote(
  team: Team,
  component: ComponentKey,
  focus: 'PERFORMANCE' | 'RELIABILITY'
): {
  costMillions: number;
  durationDays: number;
  expectedGain: number;
  maxSlots: number;
} {
  const currentVal =
    focus === 'PERFORMANCE'
      ? team.components[component].performance
      : team.components[component].reliability;

  const maxSlots = 1 + Math.min(3, team.facilities.factory);
  // Legge dei rendimenti decrescenti sopra quota 65
  const costMillions = Number(
    (1.2 + Math.pow(Math.max(0, currentVal - 65) / 10, 2) * 1.15).toFixed(2)
  );
  const baseDays = Math.max(4, Math.round(8 - team.facilities.factory * 0.6));
  const isAero =
    component === 'frontWing' || component === 'rearWing' || component === 'floor';
  const windTunnelBonus = isAero ? (team.facilities.windTunnel - 1) * 0.45 : 0;
  const diminishingMult = currentVal >= 92 ? 0.55 : currentVal >= 85 ? 0.78 : 1.0;
  const expectedGain = Math.max(
    1,
    Math.round((3.2 + windTunnelBonus) * diminishingMult)
  );

  return { costMillions, durationDays: baseDays, expectedGain, maxSlots };
}

export function startRdProject(
  state: CareerState,
  component: ComponentKey,
  focus: 'PERFORMANCE' | 'RELIABILITY'
): { state: CareerState; ok: boolean; error?: string } {
  const next = structuredClone(state);
  const team = next.db.teams.find((t) => t.id === next.playerTeamId)!;
  const quote = getRdProjectQuote(team, component, focus);

  if (next.activeRdProjects.length >= quote.maxSlots) {
    return {
      state,
      ok: false,
      error: `Slot Fabbrica pieni (${quote.maxSlots}/${quote.maxSlots}). Potenzia la Fabbrica o attendi il completamento.`,
    };
  }
  if (next.budgetCapSpentMillions + quote.costMillions > SEASON_BUDGET_CAP_MILLIONS) {
    return {
      state,
      ok: false,
      error: `Superamento Budget Cap FIA (${SEASON_BUDGET_CAP_MILLIONS} M€)!`,
    };
  }
  if (team.budgetMillions < quote.costMillions) {
    return {
      state,
      ok: false,
      error: `Fondi insufficienti (${team.budgetMillions.toFixed(1)} M€ disponibili).`,
    };
  }

  team.budgetMillions = Number((team.budgetMillions - quote.costMillions).toFixed(2));
  next.budgetCapSpentMillions = Number(
    (next.budgetCapSpentMillions + quote.costMillions).toFixed(2)
  );
  next.activeRdProjects.push({
    id: `rd-${next.season}-${next.currentDay}-${component}-${focus}-${next.activeRdProjects.length}`,
    component,
    focus,
    gainAmount: quote.expectedGain,
    daysRemaining: quote.durationDays,
    totalDays: quote.durationDays,
    costMillions: quote.costMillions,
  });

  return { state: next, ok: true };
}

export function startFacilityUpgrade(
  state: CareerState,
  facility: 'factory' | 'windTunnel' | 'simulator'
): { state: CareerState; ok: boolean; error?: string } {
  const next = structuredClone(state);
  const team = next.db.teams.find((t) => t.id === next.playerTeamId)!;
  const currentLvl = team.facilities[facility];

  if (next.activeFacilityUpgrade) {
    return { state, ok: false, error: 'Cantiere HQ già impegnato in un potenziamento.' };
  }
  if (currentLvl >= 5) {
    return { state, ok: false, error: 'Struttura già al Livello Massimo (5/5).' };
  }

  const costMillions = Number((currentLvl * 6.5).toFixed(1));
  const durationDays = 10 + currentLvl * 2;
  if (team.budgetMillions < costMillions) {
    return { state, ok: false, error: `Budget insufficiente (richiesti ${costMillions} M€).` };
  }

  team.budgetMillions = Number((team.budgetMillions - costMillions).toFixed(2));
  next.activeFacilityUpgrade = {
    facility,
    targetLevel: currentLvl + 1,
    daysRemaining: durationDays,
    totalDays: durationDays,
    costMillions,
  };
  return { state: next, ok: true };
}

export function advanceCareerDays(
  state: CareerState,
  days: number
): { state: CareerState; reachedRaceWeekend: boolean } {
  const next = structuredClone(state);
  const team = next.db.teams.find((t) => t.id === next.playerTeamId)!;
  const nextRaceDay = (next.currentRoundIndex + 1) * DAYS_BETWEEN_RACES;
  const targetDay = Math.min(next.currentDay + Math.max(1, days), nextRaceDay);

  while (next.currentDay < targetDay) {
    next.currentDay += 1;

    // Avanzamento progetti R&D
    const remainingProjects: RdProject[] = [];
    for (const proj of next.activeRdProjects) {
      proj.daysRemaining -= 1;
      if (proj.daysRemaining <= 0) {
        const spec = team.components[proj.component];
        if (proj.focus === 'PERFORMANCE') {
          spec.performance = Math.min(100, spec.performance + proj.gainAmount);
        } else {
          spec.reliability = Math.min(100, spec.reliability + proj.gainAmount);
        }
        Object.assign(team, hydrateTeamPhysics(team));
        next.inbox.unshift({
          id: `msg-rd-${next.currentDay}-${proj.id}`,
          day: next.currentDay,
          season: next.season,
          title: `Aggiornamento ${proj.component.toUpperCase()} Completato`,
          body: `Il reparto R&D ha installato il nuovo pacchetto (${proj.focus} +${proj.gainAmount}).`,
          category: 'RD',
          read: false,
        });
      } else {
        remainingProjects.push(proj);
      }
    }
    next.activeRdProjects = remainingProjects;

    // Avanzamento upgrade Strutture HQ
    if (next.activeFacilityUpgrade) {
      next.activeFacilityUpgrade.daysRemaining -= 1;
      if (next.activeFacilityUpgrade.daysRemaining <= 0) {
        const fac = next.activeFacilityUpgrade.facility;
        team.facilities[fac] = next.activeFacilityUpgrade.targetLevel;
        next.inbox.unshift({
          id: `msg-fac-${next.currentDay}-${fac}`,
          day: next.currentDay,
          season: next.season,
          title: `Struttura ${fac.toUpperCase()} al Livello ${team.facilities[fac]}`,
          body: `I lavori di ampliamento del Quartier Generale sono terminati con successo.`,
          category: 'RD',
          read: false,
        });
        next.activeFacilityUpgrade = null;
      }
    }
  }

  return {
    state: next,
    reachedRaceWeekend: next.currentDay >= nextRaceDay,
  };
}

export function runReserveDriverFp1(state: CareerState): {
  state: CareerState;
  setupRadiusBonus: number;
} {
  const next = structuredClone(state);
  const team = next.db.teams.find((t) => t.id === next.playerTeamId)!;
  const reserve = next.db.drivers.find(
    (d) => d.teamId === next.playerTeamId && d.role === 'RESERVE'
  );

  if (reserve && !next.reserveUsedInFp1ThisRound) {
    reserve.pace = Math.min(99, reserve.pace + 1);
    reserve.consistency = Math.min(99, reserve.consistency + 1);
    reserve.smoothness = Math.min(99, reserve.smoothness + 1);
    next.reserveUsedInFp1ThisRound = true;
  }

  const setupRadiusBonus = 2 + Math.floor(team.facilities.simulator * 0.8);
  return { state: next, setupRadiusBonus };
}

export function signDriverToPlayerTeam(
  state: CareerState,
  candidateDriverId: string,
  targetRole: 'PRIMARY' | 'SECONDARY' | 'RESERVE'
): { state: CareerState; ok: boolean; error?: string } {
  const next = structuredClone(state);
  const team = next.db.teams.find((t) => t.id === next.playerTeamId)!;
  const candidate = next.db.drivers.find((d) => d.id === candidateDriverId);
  if (!candidate) return { state, ok: false, error: 'Pilota non trovato.' };

  const buyoutCost =
    candidate.teamId && candidate.teamId !== next.playerTeamId
      ? candidate.buyoutMillions
      : 0;
  if (team.budgetMillions < buyoutCost) {
    return {
      state,
      ok: false,
      error: `Budget insufficiente per pagare la clausola di buyout (${buyoutCost.toFixed(1)} M€).`,
    };
  }

  const outgoing = next.db.drivers.find(
    (d) => d.teamId === next.playerTeamId && d.role === targetRole
  );
  team.budgetMillions = Number((team.budgetMillions - buyoutCost).toFixed(2));

  if (outgoing) {
    // Se il candidato veniva da un'altra scuderia, scambiamo i sedili per mantenere la griglia a 20 auto
    outgoing.teamId = candidate.teamId;
    outgoing.role = candidate.teamId ? candidate.role : 'FREE_AGENT';
  }

  candidate.teamId = next.playerTeamId;
  candidate.role = targetRole;
  candidate.contractYearsLeft = 2;

  next.inbox.unshift({
    id: `msg-sign-${next.currentDay}-${candidate.id}`,
    day: next.currentDay,
    season: next.season,
    title: `Ufficiale: ${candidate.name} ingaggiato (${targetRole})`,
    body: `Contratto biennale firmato con ${team.name}.`,
    category: 'CONTRACT',
    read: false,
  });

  return { state: next, ok: true };
}

export function applyRaceWeekendResults(
  state: CareerState,
  finishingOrderDriverIds: string[],
  q3DriverIds: string[],
  fastestLapDriverId: string | null,
  retiredDriverIds: string[]
): CareerState {
  const next = structuredClone(state);
  const playerTeam = next.db.teams.find((t) => t.id === next.playerTeamId)!;
  const retiredSet = new Set(retiredDriverIds);

  // 1. Assegnazione punti FIA Top 10 + 1 punto Giro Veloce (se in Top 10)
  finishingOrderDriverIds.forEach((drvId, idx) => {
    const drv = next.db.drivers.find((d) => d.id === drvId);
    if (!drv || retiredSet.has(drvId)) return;
    if (idx === 0) {
      next.driverWins[drvId] = (next.driverWins[drvId] ?? 0) + 1;
    }
    if (idx < 10) {
      let pts = FIA_POINTS[idx];
      if (fastestLapDriverId === drvId) pts += 1;
      next.driverPoints[drvId] = (next.driverPoints[drvId] ?? 0) + pts;
      if (drv.teamId) {
        next.teamPoints[drv.teamId] = (next.teamPoints[drv.teamId] ?? 0) + pts;
      }
    }
  });

  // 2. Calcolo introiti Sponsor Principale + Sponsor Secondari e stipendi piloti
  const playerDrivers = next.db.drivers.filter(
    (d) =>
      d.teamId === next.playerTeamId &&
      (d.role === 'PRIMARY' || d.role === 'SECONDARY')
  );
  const playerPositions = playerDrivers.map((d) => {
    const posIdx = finishingOrderDriverIds.indexOf(d.id);
    return posIdx === -1 || retiredSet.has(d.id) ? 99 : posIdx + 1;
  });
  const bestPlayerPos = Math.min(99, ...playerPositions);
  const bothFinished = playerDrivers.every((d) => !retiredSet.has(d.id));
  const reachedQ3 = playerDrivers.some((d) => q3DriverIds.includes(d.id));
  const gotFastestLap = playerDrivers.some((d) => d.id === fastestLapDriverId);

  const activeSponsors = next.db.sponsors.filter(
    (s) =>
      s.id === next.activeMainSponsorId ||
      next.activeSecondarySponsorIds.includes(s.id)
  );

  let totalIncome = 0;
  for (const sp of activeSponsors) {
    totalIncome += sp.basePayoutPerRaceMillions;
    const hit =
      (sp.objectiveType === 'PODIUM' && bestPlayerPos <= 3) ||
      (sp.objectiveType === 'TOP_6' && bestPlayerPos <= 6) ||
      (sp.objectiveType === 'FINISH_TOP_10' && bestPlayerPos <= 10) ||
      (sp.objectiveType === 'BOTH_FINISH' && bothFinished) ||
      (sp.objectiveType === 'REACH_Q3' && reachedQ3) ||
      (sp.objectiveType === 'FASTEST_LAP' && gotFastestLap);
    if (hit) totalIncome += sp.bonusMillions;
  }

  const totalSalaries = next.db.drivers
    .filter((d) => d.teamId === next.playerTeamId)
    .reduce((acc, d) => acc + d.salaryPerRaceMillions, 0);

  const netDelta = Number((totalIncome - totalSalaries).toFixed(2));
  playerTeam.budgetMillions = Number(
    (playerTeam.budgetMillions + netDelta).toFixed(2)
  );

  // Evoluzione R&D leggera dei team IA a ogni gara
  for (const t of next.db.teams) {
    if (t.id !== next.playerTeamId && next.currentRoundIndex % 3 === 1) {
      const keys: ComponentKey[] = [
        'powerUnit',
        'frontWing',
        'rearWing',
        'floor',
        'suspension',
        'brakes',
      ];
      const pick = keys[(next.currentRoundIndex + t.tier) % keys.length];
      t.components[pick].performance = Math.min(
        99,
        t.components[pick].performance + 1
      );
      Object.assign(t, hydrateTeamPhysics(t));
    }
  }

  next.inbox.unshift({
    id: `msg-race-${next.season}-${next.currentRoundIndex}`,
    day: next.currentDay,
    season: next.season,
    title: `Bilancio GP #${next.currentRoundIndex + 1}: ${netDelta >= 0 ? '+' : ''}${netDelta.toFixed(2)} M€`,
    body: `Miglior risultato: P${bestPlayerPos === 99 ? 'DNF' : bestPlayerPos}. Incassi sponsor: +${totalIncome.toFixed(2)} M€, Stipendi: -${totalSalaries.toFixed(2)} M€.`,
    category: 'FINANCE',
    read: false,
  });

  next.currentRoundIndex += 1;
  next.reserveUsedInFp1ThisRound = false;
  return next;
}

export function finalizeSeasonAndStartNext(state: CareerState): CareerState {
  const next = structuredClone(state);

  // Classifica Costruttori e distribuzione Premi FIA (da 55 M€ al 1° a 18 M€ al 10°)
  const rankedTeams = [...next.db.teams].sort(
    (a, b) => (next.teamPoints[b.id] ?? 0) - (next.teamPoints[a.id] ?? 0)
  );
  const prizeTable = [55, 48, 42, 36, 32, 28, 25, 22, 20, 18];

  rankedTeams.forEach((t, idx) => {
    const prize = prizeTable[idx] ?? 18;
    t.budgetMillions = Number((t.budgetMillions + prize).toFixed(2));
    // Sviluppo off-season IA
    if (t.id !== next.playerTeamId) {
      for (const k of [
        'powerUnit',
        'frontWing',
        'rearWing',
        'floor',
        'suspension',
        'brakes',
      ] as ComponentKey[]) {
        t.components[k].performance = Math.min(
          98,
          t.components[k].performance + 2
        );
      }
      Object.assign(t, hydrateTeamPhysics(t));
    }
  });

  // Invecchiamento e crescita giovani piloti
  for (const d of next.db.drivers) {
    d.age += 1;
    if (d.age <= 24) {
      d.pace = Math.min(99, d.pace + 1);
      d.consistency = Math.min(99, d.consistency + 1);
    }
    if (d.contractYearsLeft > 1) {
      d.contractYearsLeft -= 1;
    }
    next.driverPoints[d.id] = 0;
    next.driverWins[d.id] = 0;
  }

  for (const t of next.db.teams) {
    next.teamPoints[t.id] = 0;
  }

  const playerRank =
    rankedTeams.findIndex((t) => t.id === next.playerTeamId) + 1;
  const playerPrize = prizeTable[playerRank - 1] ?? 18;

  next.season += 1;
  next.currentDay = 1;
  next.currentRoundIndex = 0;
  next.budgetCapSpentMillions = 0;
  next.reserveUsedInFp1ThisRound = false;
  next.inbox.unshift({
    id: `msg-new-season-${next.season}`,
    day: 1,
    season: next.season,
    title: `Inizia la Stagione ${next.season}! Premio Costruttori P${playerRank}: +${playerPrize} M€`,
    body: `Il Budget Cap FIA di ${SEASON_BUDGET_CAP_MILLIONS} M€ è stato azzerato per il nuovo campionato mondiale.`,
    category: 'FIA',
    read: false,
  });

  return next;
}
