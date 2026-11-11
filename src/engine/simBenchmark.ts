import { DEFAULT_DB } from '../data/defaultDb.ts';
import { createInitialRaceState, stepRaceSimulation } from './raceEngine.ts';

export interface BenchmarkReport {
  racesSimulated: number;
  avgPitStopsPerCar: number;
  avgWinnerGapToLastSec: number;
  tier1WinShare: number;
}

export function runMonteCarloBenchmark(numRaces: number = 10): BenchmarkReport {
  const tier1TeamIds = new Set(
    DEFAULT_DB.teams.filter((t) => t.tier === 1).map((t) => t.id)
  );

  let totalStops = 0;
  let totalCarsCounted = 0;
  let totalSpreadSec = 0;
  let tier1Wins = 0;

  for (let r = 0; r < numRaces; r++) {
    const track = DEFAULT_DB.tracks[r % DEFAULT_DB.tracks.length];
    let sim = createInitialRaceState(DEFAULT_DB.teams, DEFAULT_DB.drivers, [], {
      track,
      distancePreset: 'SPRINT_25',
      playerTeamId: '__benchmark_ai_all__', // Tutte le 20 auto gestite dall'IA per il benchmark
      initialWeather: r % 5 === 4 ? 'LIGHT_RAIN' : 'DRY',
    });

    let guard = 0;
    while (!sim.isFinished && guard < 12000) {
      sim = stepRaceSimulation(
        sim,
        track,
        DEFAULT_DB.teams,
        DEFAULT_DB.drivers,
        0.25,
        '__benchmark_ai_all__'
      );
      guard++;
    }

    const winner = sim.cars[0];
    if (winner && tier1TeamIds.has(winner.teamId)) {
      tier1Wins += 1;
    }

    const activeCars = sim.cars.filter((c) => !c.isRetired);
    for (const c of activeCars) {
      totalStops += c.stopsCompleted;
      totalCarsCounted += 1;
    }

    const lastActive = activeCars.at(-1);
    if (lastActive) {
      totalSpreadSec += lastActive.gapToLeaderSec;
    }
  }

  return {
    racesSimulated: numRaces,
    avgPitStopsPerCar: Number((totalStops / Math.max(1, totalCarsCounted)).toFixed(2)),
    avgWinnerGapToLastSec: Number((totalSpreadSec / Math.max(1, numRaces)).toFixed(1)),
    tier1WinShare: Number((tier1Wins / Math.max(1, numRaces)).toFixed(2)),
  };
}
