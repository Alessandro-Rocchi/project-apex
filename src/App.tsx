import { useEffect, useRef, useState } from 'react';
import HqView from './components/hqView';
import SetupGarage from './components/setupGarage';
import TeamCreatorModal from './components/teamCreatorModal';
import TrackCanvas from './components/trackCanvas';
import { DEFAULT_DB } from './data/defaultDb';
import { validateCustomDatabase } from './engine/carPhysicsMapper';
import { executeTeamReplacement, type CustomTeamInput } from './engine/customTeamBuilder';
import {
  applyRaceWeekendResults,
  createInitialCareerState,
  runReserveDriverFp1,
  type CareerState,
} from './engine/hqSimulator';
import {
  createQualifyingSession,
  runFullQualifyingAuto,
  runQualifyingStage,
  type ExitTimingOption,
  type QualifyingDriverOrder,
  type QualifyingSessionState,
} from './engine/qualifyingEngine';
import {
  createInitialRaceState,
  getCurrentSegment,
  getScaledTrackLaps,
  stepRaceSimulation,
  type PreRaceCarConfig,
  type RaceSimulationSnapshot,
} from './engine/raceEngine';
import type {
  CarRaceState,
  ErsMode,
  FuelMode,
  PaceMode,
  RaceDistancePreset,
  SectorColor,
  TeamOrderMode,
  TyreCompound,
  WeatherCondition,
} from './types/telemetry';
import { soundEffects } from './utils/soundEffects';

type AppView =
  | 'MAIN_MENU'
  | 'HQ'
  | 'PRACTICE_GARAGE'
  | 'QUALIFYING'
  | 'RACE_WEEKEND'
  | 'POST_RACE';

const SAVE_STORAGE_KEY = 'project_apex_career_save_v1';

const TYRE_BADGE_STYLE: Record<TyreCompound, string> = {
  SOFT: 'border-[#EF4444] text-white bg-[#EF4444]/20',
  MEDIUM: 'border-[#FACC15] text-white bg-[#FACC15]/20',
  HARD: 'border-[#F8FAFC] text-slate-200 bg-white/10',
  INTER: 'border-[#22C55E] text-emerald-200 bg-[#22C55E]/20',
  WET: 'border-[#3B82F6] text-sky-200 bg-[#3B82F6]/20',
};

const SECTOR_BADGE_STYLE: Record<SectorColor, string> = {
  PURPLE: 'bg-[#581C87] text-[#F3E8FF] border-[#A855F7]',
  GREEN: 'bg-[#14532D] text-[#DCFCE7] border-[#22C55E]',
  YELLOW: 'bg-amber-950/60 text-amber-300 border-amber-600/50',
  NONE: 'bg-slate-900 text-slate-500 border-slate-800',
};

export default function App() {
  const [career, setCareer] = useState<CareerState>(() => {
    try {
      const saved = localStorage.getItem(SAVE_STORAGE_KEY);
      if (saved) return JSON.parse(saved) as CareerState;
    } catch {
      // ignore localStorage errors
    }
    return createInitialCareerState(DEFAULT_DB, 'corsa-rossa', 'SPRINT_25');
  });

  const [view, setView] = useState<AppView>('MAIN_MENU');
  const [isQuickWeekend, setIsQuickWeekend] = useState<boolean>(false);
  const [isTeamCreatorOpen, setIsTeamCreatorOpen] = useState<boolean>(false);
  const [quickTrackIdx, setQuickTrackIdx] = useState<number>(0);
  const [quickWeather, setQuickWeather] = useState<WeatherCondition>('DRY');
  const [modStatusMsg, setModStatusMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState<boolean>(false);

  const [preRaceConfigs, setPreRaceConfigs] = useState<PreRaceCarConfig[]>([]);
  const [quali, setQuali] = useState<QualifyingSessionState>(() =>
    createQualifyingSession(DEFAULT_DB.teams, DEFAULT_DB.drivers)
  );
  const [qualiOrders, setQualiOrders] = useState<Record<string, QualifyingDriverOrder>>({});

  const activeTrack = isQuickWeekend
    ? career.db.tracks[quickTrackIdx] ?? career.db.tracks[0]
    : career.db.tracks[
        Math.min(career.currentRoundIndex, career.db.tracks.length - 1)
      ];

  const [sim, setSim] = useState<RaceSimulationSnapshot>(() =>
    createInitialRaceState(career.db.teams, career.db.drivers, [], {
      track: activeTrack,
      distancePreset: career.distancePreset,
    })
  );
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);

  const updateAndSaveCareer = (next: CareerState) => {
    setCareer(next);
    try {
      localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  };

  const running = isRunning && !sim.isFinished && view === 'RACE_WEEKEND';

  useEffect(() => {
    if (!running) return;
    const intervalMs = Math.max(10, Math.round(100 / speedMultiplier));
    const id = setInterval(() => {
      setSim((prev) =>
        stepRaceSimulation(
          prev,
          activeTrack,
          career.db.teams,
          career.db.drivers,
          0.1,
          career.playerTeamId
        )
      );
    }, intervalMs);
    return () => clearInterval(id);
  }, [running, speedMultiplier, activeTrack, career.db.teams, career.db.drivers, career.playerTeamId]);

  const prevRaceControlRef = useRef(sim.raceControl);
  useEffect(() => {
    if (prevRaceControlRef.current !== sim.raceControl) {
      if (
        sim.raceControl === 'VIRTUAL_SAFETY_CAR' ||
        sim.raceControl === 'SAFETY_CAR' ||
        prevRaceControlRef.current === 'VIRTUAL_SAFETY_CAR' ||
        prevRaceControlRef.current === 'SAFETY_CAR'
      ) {
        soundEffects.playRadioBeep();
      }
      prevRaceControlRef.current = sim.raceControl;
    }
  }, [sim.raceControl]);

  const playerTeam =
    career.db.teams.find((t) => t.id === career.playerTeamId) ?? career.db.teams[0];

  const handleSetupDone = (configs: PreRaceCarConfig[]) => {
    setIsRunning(false);
    setPreRaceConfigs(configs);
    const weatherToUse: WeatherCondition = isQuickWeekend
      ? quickWeather
      : Math.random() < activeTrack.baseRainChance
      ? 'LIGHT_RAIN'
      : 'DRY';
    setQuali(
      createQualifyingSession(
        career.db.teams,
        career.db.drivers,
        weatherToUse
      )
    );
    setView('QUALIFYING');
  };

  const launchGrandPrixFromQuali = (finalQuali: QualifyingSessionState) => {
    soundEffects.playRadioBeep();
    const defaultFuelKg = getScaledTrackLaps(activeTrack, career.distancePreset).defaultFuelKg;
    const mergedConfigs: PreRaceCarConfig[] = finalQuali.results.map((r, idx) => {
      const existing = preRaceConfigs.find(
        (c) => c.driverId === r.driverId || c.carId === `car-${r.driverNumber}`
      );
      return {
        carId: `car-${r.driverNumber}`,
        driverId: r.driverId,
        gridPosition: idx + 1,
        setupConfidence: existing?.setupConfidence ?? 92,
        startCompound:
          finalQuali.weather !== 'DRY'
            ? r.compound
            : existing?.startCompound ?? (idx < 6 ? 'SOFT' : 'MEDIUM'),
        fuelKg: existing?.fuelKg ?? defaultFuelKg,
        brokeParcFerme: existing?.brokeParcFerme ?? false,
      };
    });
    setPreRaceConfigs(mergedConfigs);
    setSim(
      createInitialRaceState(career.db.teams, career.db.drivers, mergedConfigs, {
        track: activeTrack,
        distancePreset: career.distancePreset,
        initialWeather: finalQuali.weather,
      })
    );
    setView('RACE_WEEKEND');
  };

  const handleFinishWeekendAndReturn = () => {
    soundEffects.playCheckeredFlag();
    setIsRunning(false);
    if (isQuickWeekend) {
      setView('MAIN_MENU');
      return;
    }
    const orderIds = sim.cars.map((c) => c.driverId);
    const q3Ids = quali.results.slice(0, 10).map((r) => r.driverId);
    const fastestCar = sim.cars.find((c) => c.driverCode === sim.bestLapDriverCode);
    const retiredIds = sim.cars.filter((c) => c.isRetired || c.isDisqualified).map((c) => c.driverId);
    const updated = applyRaceWeekendResults(
      career,
      orderIds,
      q3Ids,
      fastestCar?.driverId ?? null,
      retiredIds
    );
    updateAndSaveCareer(updated);
    setView('HQ');
  };

  const updatePlayerOrder = (
    carId: string,
    patch: Partial<
      Pick<
        CarRaceState,
        | 'paceMode'
        | 'ersMode'
        | 'fuelMode'
        | 'pitBoxRequested'
        | 'nextTyreCompound'
        | 'repairDamageOnStop'
        | 'teamOrder'
      >
    >
  ) => {
    soundEffects.playTacticalClick();
    setSim((s) => ({
      ...s,
      cars: s.cars.map((c) => (c.carId === carId ? { ...c, ...patch } : c)),
    }));
  };

  const handleUploadJsonFile = (
    e: React.ChangeEvent<HTMLInputElement>,
    mode: 'CUSTOM_DB' | 'CAREER_SAVE'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (mode === 'CUSTOM_DB') {
          const v = validateCustomDatabase(parsed);
          if (!v.valid || !v.db) {
            setModStatusMsg(`❌ Errore DB Custom: ${v.error}`);
            return;
          }
          const nextCareer = createInitialCareerState(
            v.db,
            v.db.teams[0].id,
            career.distancePreset
          );
          updateAndSaveCareer(nextCareer);
          setModStatusMsg(
            `✅ Database "${v.db.seriesName}" caricato (${v.db.teams.length} team, ${v.db.tracks.length} piste)!`
          );
        } else {
          if (!parsed.season || !parsed.db || !parsed.playerTeamId) {
            setModStatusMsg('❌ File salvataggio carriera non valido.');
            return;
          }
          updateAndSaveCareer(parsed as CareerState);
          setModStatusMsg(`✅ Salvataggio Stagione ${parsed.season} caricato!`);
          setView('HQ');
        }
      } catch {
        setModStatusMsg('❌ Il file selezionato non è un JSON valido.');
      }
    };
    reader.readAsText(file);
  };

  const exportSaveJson = () => {
    const blob = new Blob([JSON.stringify(career, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-apex-season-${career.season}-day-${career.currentDay}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDatabaseJson = () => {
    const blob = new Blob([JSON.stringify(career.db, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'project-apex-database.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleResetDefaultDatabase = () => {
    const confirmed = window.confirm(
      'Sei sicuro di voler ripristinare il database predefinito? Eventuali scuderie personalizzate verranno rimosse e la carriera azzerata.'
    );
    if (!confirmed) return;
    const freshCareer = createInitialCareerState(
      DEFAULT_DB,
      'corsa-rossa',
      career.distancePreset
    );
    updateAndSaveCareer(freshCareer);
    soundEffects.playTacticalClick();
    setModStatusMsg('Database predefinito ripristinato con successo.');
  };

  const handleConfirmCreateCustomTeam = (input: CustomTeamInput) => {
    const { updatedDb, newTeam } = executeTeamReplacement(career.db, input);
    const freshCareer = createInitialCareerState(
      updatedDb,
      newTeam.id,
      career.distancePreset
    );
    updateAndSaveCareer(freshCareer);
    soundEffects.playCheckeredFlag();
    setModStatusMsg(`Scuderia "${newTeam.name}" fondata con successo! Nuova carriera avviata.`);
    setIsTeamCreatorOpen(false);
  };

  const playerCars = sim.cars.filter((c) => c.teamId === career.playerTeamId);
  const setupConfMap: Record<string, number> = {};
  for (const cfg of preRaceConfigs) {
    setupConfMap[cfg.carId] = cfg.setupConfidence;
    if (cfg.driverId) setupConfMap[cfg.driverId] = cfg.setupConfidence;
  }

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-200 p-3.5 text-xs">
      {/* Top Bar Globale Pit Wall OS */}
      <header className="bg-[#111827] border border-slate-700/40 rounded p-3 mb-3.5 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <span
            className="w-3 h-8 rounded-sm inline-block"
            style={{ backgroundColor: playerTeam.colorHex }}
          />
          <div>
            <h1 className="text-sm font-extrabold text-white tracking-wider uppercase">
              PROJECT APEX // PIT WALL OS ({career.db.seriesName})
            </h1>
            <p className="text-[11px] text-slate-400 telemetry-number">
              Team: <strong className="text-white">{playerTeam.name}</strong> — Circuito:{' '}
              <strong className="text-amber-400">{activeTrack.grandPrixName}</strong> — Distanza:{' '}
              <strong className="text-sky-400">{career.distancePreset}</strong>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              const nextMute = !muted;
              setMuted(nextMute);
              soundEffects.setMuted(nextMute);
            }}
            className="px-2.5 py-1.5 rounded border border-slate-700 bg-[#090D16] text-slate-300 cursor-pointer text-[11px]"
          >
            {muted ? '🔇 AUDIO OFF' : '🔊 AUDIO ON'}
          </button>

          <button
            onClick={exportSaveJson}
            className="px-2.5 py-1.5 rounded border border-slate-700 bg-[#090D16] hover:border-slate-500 text-slate-300 cursor-pointer text-[11px]"
          >
            💾 ESPORTA SALVATAGGIO (.JSON)
          </button>

          {view !== 'MAIN_MENU' && (
            <button
              onClick={() => {
                setIsRunning(false);
                setView('HQ');
              }}
              className="px-3 py-1.5 rounded border border-slate-700 bg-[#090D16] hover:border-amber-500 text-amber-300 font-bold cursor-pointer"
            >
              🏛️ QUARTIER GENERALE
            </button>
          )}

          <button
            onClick={() => {
              setIsRunning(false);
              setView('MAIN_MENU');
            }}
            className="px-3 py-1.5 rounded border border-slate-700 bg-[#090D16] hover:border-slate-500 text-slate-300 cursor-pointer"
          >
            ☰ MENU PRINCIPALE
          </button>
        </div>
      </header>

      {/* 1. SCHERMATA MENU PRINCIPALE & SCELTA SCUDERIA / MODDING */}
      {view === 'MAIN_MENU' && (
        <div className="space-y-4">
          {modStatusMsg && (
            <div className="p-3 rounded bg-slate-900 border border-amber-500/60 text-amber-300 font-semibold">
              {modStatusMsg}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-[#111827] border border-slate-700/40 rounded p-4 space-y-3">
              <div className="flex flex-wrap justify-between items-center border-b border-slate-800 pb-2.5 gap-2">
                <div>
                  <h2 className="text-sm font-bold text-white uppercase">
                    Seleziona la Tua Scuderia (10 Team — Tier 1 Top Team → Tier 5 Backmarker)
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Scegli una scuderia e la distanza gara prima di avviare la Carriera o un Weekend Veloce.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      soundEffects.playRadioBeep();
                      setIsTeamCreatorOpen(true);
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 text-black font-bold px-3 py-1.5 rounded text-xs uppercase cursor-pointer transition"
                  >
                    🛠️ FONDA LA TUA SCUDERIA
                  </button>

                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        ['SPRINT_25', '25% (~15 Giri)'],
                        ['STANDARD_50', '50% (~30 Giri)'],
                        ['FULL_100', '100% (~60 Giri)'],
                      ] as [RaceDistancePreset, string][]
                    ).map(([preset, label]) => (
                      <button
                        key={preset}
                        onClick={() =>
                          updateAndSaveCareer({ ...career, distancePreset: preset })
                        }
                        className={`px-2.5 py-1 rounded border text-[11px] font-bold cursor-pointer ${
                          career.distancePreset === preset
                            ? 'bg-amber-500 border-amber-300 text-black'
                            : 'bg-[#090D16] border-slate-700 text-slate-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {career.db.teams.map((t) => {
                  const selected = career.playerTeamId === t.id;
                  const tDrivers = career.db.drivers
                    .filter(
                      (d) =>
                        d.teamId === t.id &&
                        (d.role === 'PRIMARY' || d.role === 'SECONDARY')
                    )
                    .map((d) => d.code)
                    .join(' / ');
                  return (
                    <div
                      key={t.id}
                      onClick={() => {
                        soundEffects.playTacticalClick();
                        updateAndSaveCareer({ ...career, playerTeamId: t.id });
                      }}
                      className={`p-3 rounded border cursor-pointer transition flex justify-between items-center ${
                        selected
                          ? 'bg-amber-500/15 border-amber-400'
                          : 'bg-[#090D16] border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <svg width="28" height="32" viewBox="0 0 28 32">
                          <polygon
                            points="14,1 27,7 24,24 14,31 4,24 1,7"
                            fill={t.colorHex}
                            stroke={t.accentHex}
                            strokeWidth="2"
                          />
                        </svg>
                        <div>
                          <div className="font-bold text-white text-xs">
                            {t.name}{' '}
                            <span className="text-[10px] text-amber-400">
                              [Tier {t.tier}]
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 telemetry-number">
                            Piloti: {tDrivers} • Budget: {t.budgetMillions.toFixed(0)}M€
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-[10px] text-emerald-400 font-bold telemetry-number">
                        PWR {t.power} / AERO {t.downforce}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Colonna Destra: Avvio Carriera, Weekend Veloce e Caricamento JSON Mod */}
            <div className="space-y-4">
              <div className="bg-[#111827] border border-slate-700/40 rounded p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase text-amber-400 border-b border-slate-800 pb-2">
                  1. Modalità Carriera Manageriale
                </h3>
                <button
                  onClick={() => {
                    soundEffects.playRadioBeep();
                    setIsQuickWeekend(false);
                    setView('HQ');
                  }}
                  className="w-full py-3 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase cursor-pointer"
                >
                  ▶ CONTINUA CARRIERA (Stagione {career.season}, Giorno {career.currentDay})
                </button>
                <button
                  onClick={() => {
                    soundEffects.playRadioBeep();
                    setIsQuickWeekend(false);
                    const fresh = createInitialCareerState(
                      career.db,
                      career.playerTeamId,
                      career.distancePreset
                    );
                    updateAndSaveCareer(fresh);
                    setView('HQ');
                  }}
                  className="w-full py-2.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold text-xs uppercase cursor-pointer"
                >
                  🔄 NUOVA CARRIERA CON {playerTeam.name.toUpperCase()}
                </button>
              </div>

              <div className="bg-[#111827] border border-slate-700/40 rounded p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase text-sky-400 border-b border-slate-800 pb-2">
                  2. Weekend Veloce (Gara Singola su 12 Circuiti)
                </h3>
                <select
                  value={quickTrackIdx}
                  onChange={(e) => setQuickTrackIdx(Number(e.target.value))}
                  className="w-full bg-[#090D16] border border-slate-700 rounded p-2 text-white text-xs"
                >
                  {career.db.tracks.map((tr, i) => (
                    <option key={tr.id} value={i}>
                      {i + 1}. {tr.grandPrixName} — {tr.name}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['DRY', 'LIGHT_RAIN', 'HEAVY_RAIN'] as WeatherCondition[]).map((w) => (
                    <button
                      key={w}
                      onClick={() => setQuickWeather(w)}
                      className={`py-1.5 rounded border text-[10px] font-bold cursor-pointer ${
                        quickWeather === w
                          ? 'bg-sky-600 border-sky-400 text-white'
                          : 'bg-[#090D16] border-slate-700 text-slate-400'
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    soundEffects.playRadioBeep();
                    setIsQuickWeekend(true);
                    setView('PRACTICE_GARAGE');
                  }}
                  className="w-full py-2.5 rounded bg-sky-500 hover:bg-sky-400 text-black font-bold text-xs uppercase cursor-pointer"
                >
                  🏁 AVVIA WEEKEND VELOCE →
                </button>
              </div>

              <div className="bg-[#111827] border border-slate-700/40 rounded p-4 space-y-2.5">
                <h3 className="text-xs font-bold uppercase text-purple-400 border-b border-slate-800 pb-2">
                  3. Modding IP-Safe & Caricamento Salvataggi (.JSON)
                </h3>
                <label className="block w-full py-2 px-3 rounded bg-[#090D16] border border-purple-500/50 hover:border-purple-400 text-purple-200 text-center font-bold cursor-pointer">
                  📂 CARICA DATABASE CUSTOM (.JSON)
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => handleUploadJsonFile(e, 'CUSTOM_DB')}
                    className="hidden"
                  />
                </label>
                <label className="block w-full py-2 px-3 rounded bg-[#090D16] border border-slate-700 hover:border-slate-500 text-slate-300 text-center font-bold cursor-pointer">
                  📥 IMPORTA SALVATAGGIO CARRIERA (.JSON)
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => handleUploadJsonFile(e, 'CAREER_SAVE')}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={exportDatabaseJson}
                  className="block w-full py-2 px-3 rounded bg-[#090D16] border border-purple-500/40 hover:border-purple-400 text-purple-300 hover:text-white text-center font-bold cursor-pointer transition text-xs"
                >
                  💾 ESPORTA DATABASE (.JSON)
                </button>
                <button
                  type="button"
                  onClick={handleResetDefaultDatabase}
                  className="block w-full py-2 px-3 rounded bg-[#090D16] border border-red-500/40 hover:border-red-500 text-red-300 hover:text-red-200 text-center font-bold cursor-pointer transition text-xs"
                >
                  🔄 RIPRISTINA DATABASE PREDEFINITO
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. QUARTIER GENERALE (HQ) */}
      {view === 'HQ' && (
        <HqView
          career={career}
          onUpdateCareer={updateAndSaveCareer}
          onEnterRaceWeekend={() => {
            setIsQuickWeekend(false);
            setView('PRACTICE_GARAGE');
          }}
        />
      )}

      {/* 3. PROVE LIBERE & SETUP GARAGE */}
      {view === 'PRACTICE_GARAGE' && (
        <SetupGarage
          track={activeTrack}
          playerTeamId={career.playerTeamId}
          drivers={career.db.drivers}
          distancePreset={career.distancePreset}
          simulatorLevel={playerTeam.facilities.simulator}
          reserveUsedInFp1={career.reserveUsedInFp1ThisRound}
          onRunReserveFp1={() =>
            updateAndSaveCareer(runReserveDriverFp1(career))
          }
          onStartRaceWeekend={handleSetupDone}
        />
      )}

      {/* 4. QUALIFICHE UFFICIALI Q1 / Q2 / Q3 */}
      {view === 'QUALIFYING' && (
        <div className="bg-[#111827] border border-slate-700/40 rounded p-5 space-y-4">
          <div className="flex flex-wrap justify-between items-center border-b border-slate-800 pb-3 gap-3">
            <div>
              <span className="text-[11px] uppercase tracking-widest text-purple-400 font-bold">
                QUALIFICHE UFFICIALI FIA // STATO: {quali.stage} (METEO: {quali.weather})
              </span>
              <h2 className="text-lg font-bold text-white">
                Griglia di Partenza — {activeTrack.grandPrixName}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {quali.stage !== 'FINISHED' ? (
                <>
                  <button
                    onClick={() => {
                      soundEffects.playTacticalClick();
                      setQuali((q) =>
                        runQualifyingStage(
                          q,
                          career.db.teams,
                          career.db.drivers,
                          activeTrack,
                          setupConfMap,
                          qualiOrders
                        )
                      );
                    }}
                    className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs cursor-pointer"
                  >
                    ▶ DISPUTA SESSIONE {quali.stage}
                  </button>
                  <button
                    onClick={() => {
                      soundEffects.playRadioBeep();
                      setQuali((q) =>
                        runFullQualifyingAuto(
                          q,
                          career.db.teams,
                          career.db.drivers,
                          activeTrack,
                          setupConfMap
                        )
                      );
                    }}
                    className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-bold text-xs cursor-pointer"
                  >
                    ⏩ SIMULA TUTTA LA QUALIFICA
                  </button>
                </>
              ) : (
                <button
                  onClick={() => launchGrandPrixFromQuali(quali)}
                  className="px-5 py-2.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase cursor-pointer"
                >
                  🏁 SCHIERA IN GRIGLIA & AVVIA GRAN PREMIO →
                </button>
              )}
            </div>
          </div>

          {/* Controlli Strategia Giro Secco per i 2 Piloti del Giocatore */}
          {quali.stage !== 'FINISHED' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {quali.results
                .filter((r) => r.teamId === career.playerTeamId && r.eliminatedIn === null)
                .map((r) => {
                  const ord = qualiOrders[r.driverId] ?? {
                    driverId: r.driverId,
                    compound: quali.weather === 'DRY' ? 'SOFT' : 'INTER',
                    exitTiming: 'LATE',
                  };
                  return (
                    <div
                      key={r.driverId}
                      className="p-3 rounded bg-[#090D16] border border-amber-500/40 flex flex-wrap justify-between items-center gap-2"
                    >
                      <div className="font-bold text-white">
                        #{r.driverNumber} {r.driverName} ({r.driverCode})
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <select
                          value={ord.compound}
                          onChange={(e) =>
                            setQualiOrders({
                              ...qualiOrders,
                              [r.driverId]: {
                                ...ord,
                                compound: e.target.value as TyreCompound,
                              },
                            })
                          }
                          className="bg-[#111827] border border-slate-700 rounded px-2 py-1 text-white"
                        >
                          <option value="SOFT">Gomma: SOFT</option>
                          <option value="MEDIUM">Gomma: MEDIUM</option>
                          <option value="INTER">Gomma: INTER</option>
                          <option value="WET">Gomma: WET</option>
                        </select>

                        <select
                          value={ord.exitTiming}
                          onChange={(e) =>
                            setQualiOrders({
                              ...qualiOrders,
                              [r.driverId]: {
                                ...ord,
                                exitTiming: e.target.value as ExitTimingOption,
                              },
                            })
                          }
                          className="bg-[#111827] border border-slate-700 rounded px-2 py-1 text-white"
                        >
                          <option value="EARLY">Uscita: Inizio (Zero Traffico)</option>
                          <option value="MID">Uscita: Metà Sessione</option>
                          <option value="LATE">Uscita: Ultimo Minuto (+Grip / Rischio Gialla)</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Tabella Classifica Q1 / Q2 / Q3 */}
          <div className="overflow-x-auto border border-slate-800 rounded">
            <table className="w-full text-left border-collapse telemetry-number">
              <thead className="bg-[#090D16] text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-2">POS</th>
                  <th className="p-2">PILOTA</th>
                  <th className="p-2">SCUDERIA</th>
                  <th className="p-2 text-right">Q1</th>
                  <th className="p-2 text-right">Q2</th>
                  <th className="p-2 text-right">Q3</th>
                  <th className="p-2 text-center">STATO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {quali.results.map((r) => {
                  const isPlayer = r.teamId === career.playerTeamId;
                  return (
                    <tr
                      key={r.driverId}
                      className={
                        isPlayer
                          ? 'bg-amber-500/12 border-l-4 border-l-amber-400'
                          : ''
                      }
                    >
                      <td className="p-2 font-bold text-white">P{r.position}</td>
                      <td className="p-2 font-bold text-white">
                        <span
                          className="inline-block w-2 h-3 mr-2 rounded-sm"
                          style={{ backgroundColor: r.teamColor }}
                        />
                        {r.driverCode} — {r.driverName}
                      </td>
                      <td className="p-2 text-slate-400">{r.teamName}</td>
                      <td className="p-2 text-right text-slate-300">
                        {r.q1TimeSec ? `${r.q1TimeSec.toFixed(3)}s` : '—'}
                      </td>
                      <td className="p-2 text-right text-slate-300">
                        {r.q2TimeSec ? `${r.q2TimeSec.toFixed(3)}s` : '—'}
                      </td>
                      <td className="p-2 text-right text-purple-300 font-bold">
                        {r.q3TimeSec ? `${r.q3TimeSec.toFixed(3)}s` : '—'}
                      </td>
                      <td className="p-2 text-center text-[10px]">
                        {r.eliminatedIn ? (
                          <span className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300">
                            ELIM {r.eliminatedIn}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300">
                            QUALIFICATO
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. SCHERMATA DI GARA (IL MURETTO BOX - PIT WALL OS) */}
      {view === 'RACE_WEEKEND' && (
        <div className="space-y-3.5">
          {/* Barra Stato Direzione Gara, Giro, Meteo e Velocità */}
          <div className="bg-[#111827] border border-slate-700/40 rounded p-3 flex flex-wrap justify-between items-center gap-3 telemetry-number">
            <div className="flex flex-wrap items-center gap-3">
              <span className="px-2.5 py-1 rounded bg-[#090D16] border border-slate-700 font-bold text-white text-xs">
                GIRO {sim.currentLap} / {sim.totalLaps}
              </span>
              <span
                className={`px-2.5 py-1 rounded font-bold text-xs ${
                  sim.raceControl === 'GREEN'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                    : sim.raceControl === 'SAFETY_CAR'
                    ? 'bg-amber-500 text-black animate-pulse'
                    : sim.raceControl === 'VIRTUAL_SAFETY_CAR'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/60 animate-pulse'
                    : 'bg-yellow-500/30 text-yellow-200 border border-yellow-400'
                }`}
              >
                {sim.raceControl === 'GREEN'
                  ? '🟢 BANDIERA VERDE'
                  : sim.raceControl === 'SAFETY_CAR'
                  ? `🟠 SAFETY CAR IN PISTA (${sim.safetyCarLapsRemaining} GIRI)`
                  : sim.raceControl === 'VIRTUAL_SAFETY_CAR'
                  ? `🟡 VSC • VIRTUAL SAFETY CAR (${sim.vscLapsRemaining} GIRI)`
                  : '🟡 BANDIERA GIALLA'}
              </span>
              <span className="text-slate-300 text-xs">
                METEO: <strong className="text-sky-400">{sim.weather}</strong> (Acqua:{' '}
                {(sim.trackWaterLevel * 5.0).toFixed(1)} mm)
              </span>
              {sim.bestLapTimeSec && (
                <span className="px-2 py-0.5 rounded bg-[#581C87] text-[#F3E8FF] text-[11px] font-bold">
                  ⏱️ GIRO VELOCE: {sim.bestLapDriverCode} ({sim.bestLapTimeSec.toFixed(3)}s)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {!sim.isFinished ? (
                <>
                  <button
                    onClick={() => {
                      soundEffects.playTacticalClick();
                      setIsRunning(!running);
                    }}
                    className={`px-4 py-1.5 rounded font-bold cursor-pointer ${
                      running ? 'bg-amber-500 text-black' : 'bg-emerald-500 text-black'
                    }`}
                  >
                    {running ? '⏸ PAUSA' : '▶ SEMAFORO VERDE'}
                  </button>

                  {[1, 2, 4, 10].map((mult) => (
                    <button
                      key={mult}
                      onClick={() => setSpeedMultiplier(mult)}
                      className={`px-2.5 py-1.5 rounded border cursor-pointer ${
                        speedMultiplier === mult
                          ? 'bg-blue-600 border-blue-400 text-white font-bold'
                          : 'bg-[#090D16] border-slate-700 text-slate-400'
                      }`}
                    >
                      {mult}x
                    </button>
                  ))}
                </>
              ) : (
                <button
                  onClick={() => {
                    soundEffects.playCheckeredFlag();
                    setView('POST_RACE');
                  }}
                  className="px-5 py-2 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs uppercase cursor-pointer animate-bounce"
                >
                  🏁 VAI AL PODIO & TELEMETRIA POST-GARA →
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
            {/* Quadrante Sinistro (7/12): Radar 2D + Comandi Muretto Doppio Pilota */}
            <div className="xl:col-span-6 space-y-3.5">
              <TrackCanvas
                track={activeTrack}
                snapshot={sim}
                playerTeamId={career.playerTeamId}
              />

              {/* Pannelli Comandi Muretto Box per i 2 Piloti del Giocatore */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {playerCars.map((car) => {
                  const wearPct = Math.round(car.tyreWear * 100);
                  const mandatoryOk =
                    car.usedWetCompounds ||
                    sim.trackWaterLevel > 0.15 ||
                    car.usedDryCompounds.length >= 2;
                  return (
                    <div
                      key={car.carId}
                      className="bg-[#111827] border border-amber-500/40 rounded p-3 space-y-2"
                    >
                      <div className="flex justify-between items-center border-b border-slate-800 pb-1.5">
                        <div>
                          <span className="font-bold text-white text-xs">
                            P{car.position} • #{car.driverNumber} {car.driverCode}
                          </span>
                          {car.frontWingDamage > 0 && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-red-600/30 text-red-300 text-[10px] font-bold">
                              ALA DANNEGGIATA -{car.frontWingDamage}%
                            </span>
                          )}
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            car.isRetired
                              ? 'bg-red-600 text-white'
                              : mandatoryOk
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {car.isRetired
                            ? 'RITIRATO'
                            : mandatoryOk
                            ? 'MESCOLE OK'
                            : 'OBBLIGO SOSTA'}
                        </span>
                      </div>

                      <div className="flex justify-between text-[11px] text-slate-300 telemetry-number">
                        <span>
                          Gomma: <strong>{car.tyreCompound}</strong> ({wearPct}% •{' '}
                          {Math.round(car.tyreTempCelsius)}°C)
                        </span>
                        <span>
                          Fuel: <strong>{car.fuelKg.toFixed(1)}kg</strong> • ERS:{' '}
                          <strong className="text-amber-400">
                            {Math.round(car.ersBatteryPercent)}%
                          </strong>
                        </span>
                      </div>

                      {/* Passo di Guida 1 - 5 */}
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-1">
                          PASSO GUIDA (1: Conserva → 5: Attacco):
                        </span>
                        <div className="grid grid-cols-5 gap-1">
                          {([1, 2, 3, 4, 5] as PaceMode[]).map((lvl) => (
                            <button
                              key={lvl}
                              onClick={() => updatePlayerOrder(car.carId, { paceMode: lvl })}
                              className={`py-1 rounded border text-[11px] font-bold cursor-pointer telemetry-number ${
                                car.paceMode === lvl
                                  ? 'bg-amber-500 border-amber-300 text-black'
                                  : 'bg-[#090D16] border-slate-700 text-slate-400'
                              }`}
                            >
                              {lvl}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Carburante & ERS */}
                      <div className="grid grid-cols-3 gap-1 text-[10px]">
                        {(['LIFT_COAST', 'STANDARD', 'RICH'] as FuelMode[]).map((fMode) => (
                          <button
                            key={fMode}
                            onClick={() => updatePlayerOrder(car.carId, { fuelMode: fMode })}
                            className={`py-1 rounded border cursor-pointer ${
                              car.fuelMode === fMode
                                ? 'bg-sky-600 border-sky-400 text-white font-bold'
                                : 'bg-[#090D16] border-slate-700 text-slate-400'
                            }`}
                          >
                            {fMode === 'LIFT_COAST' ? 'LEAN' : fMode}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-4 gap-1 text-[10px]">
                        {(['HARVEST', 'NEUTRAL', 'DEPLOY', 'OVERTAKE'] as ErsMode[]).map(
                          (eMode) => (
                            <button
                              key={eMode}
                              onClick={() => updatePlayerOrder(car.carId, { ersMode: eMode })}
                              className={`py-1 rounded border cursor-pointer ${
                                car.ersMode === eMode
                                  ? 'bg-emerald-500 border-emerald-300 text-black font-bold'
                                  : 'bg-[#090D16] border-slate-700 text-slate-400'
                              }`}
                            >
                              {eMode.slice(0, 4)}
                            </button>
                          )
                        )}
                      </div>

                      {/* Ordini di Scuderia */}
                      <div className="grid grid-cols-3 gap-1 text-[10px]">
                        {(
                          [
                            ['NONE', 'LIBERO'],
                            ['HOLD_POSITION', 'CONGELA POS'],
                            ['SWAP_POSITIONS', 'CEDE POS'],
                          ] as [TeamOrderMode, string][]
                        ).map(([ordKey, label]) => (
                          <button
                            key={ordKey}
                            onClick={() =>
                              updatePlayerOrder(car.carId, { teamOrder: ordKey })
                            }
                            className={`py-1 rounded border cursor-pointer ${
                              car.teamOrder === ordKey
                                ? 'bg-purple-600 border-purple-400 text-white font-bold'
                                : 'bg-[#090D16] border-slate-700 text-slate-400'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* Chiamata Pit Stop + Riparazione Ala */}
                      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-slate-800">
                        <select
                          value={car.nextTyreCompound}
                          onChange={(e) =>
                            updatePlayerOrder(car.carId, {
                              nextTyreCompound: e.target.value as TyreCompound,
                            })
                          }
                          className="bg-[#090D16] border border-slate-700 rounded px-1.5 py-1 text-white text-[11px]"
                        >
                          <option value="SOFT">Box: SOFT (S)</option>
                          <option value="MEDIUM">Box: MEDIUM (M)</option>
                          <option value="HARD">Box: HARD (H)</option>
                          <option value="INTER">Box: INTER (I)</option>
                          <option value="WET">Box: FULL WET (W)</option>
                        </select>

                        <label className="flex items-center gap-1 text-[10px] text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={car.repairDamageOnStop}
                            onChange={(e) =>
                              updatePlayerOrder(car.carId, {
                                repairDamageOnStop: e.target.checked,
                              })
                            }
                          />
                          Ripara Ala
                        </label>

                        <button
                          onClick={() =>
                            updatePlayerOrder(car.carId, {
                              pitBoxRequested: !car.pitBoxRequested,
                            })
                          }
                          className={`px-2.5 py-1 rounded font-bold text-[11px] cursor-pointer ${
                            car.pitBoxRequested
                              ? 'bg-purple-600 text-white'
                              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                          }`}
                        >
                          {car.pitBoxRequested ? 'BOX CONFERMATO' : 'CHIAMA BOX'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quadrante Destro (6/12): Tabella Live Timing 20 Vetture & Team Radio */}
            <div className="xl:col-span-6 space-y-3.5">
              <section className="bg-[#111827] border border-slate-700/40 rounded p-3">
                <div className="flex justify-between items-center mb-2">
                  <h2 className="text-slate-300 font-bold uppercase tracking-wider text-xs">
                    LIVE TIMING FIA // 20 VETTURE & SETTORI CRONOMETRICI
                  </h2>
                  <span className="text-[10px] text-slate-400">
                    Viola = Record Gara • Verde = Miglior Personale
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse telemetry-number text-[11px]">
                    <thead className="text-slate-400 border-b border-slate-800 text-[10px]">
                      <tr>
                        <th className="py-1.5">POS</th>
                        <th className="py-1.5">PILOTA</th>
                        <th className="py-1.5 text-right">INT / GAP</th>
                        <th className="py-1.5 text-center">GOMMA & USURA</th>
                        <th className="py-1.5 text-center">S1 / S2 / S3</th>
                        <th className="py-1.5 text-right">ULTIMO GIRO</th>
                        <th className="py-1.5 text-right">PIT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {sim.cars.map((car) => {
                        const isPlayer = car.teamId === career.playerTeamId;
                        const wearPct = Math.round(car.tyreWear * 100);
                        const seg = getCurrentSegment(
                          activeTrack,
                          Math.max(0, car.distanceOnLapMeters)
                        );
                        return (
                          <tr
                            key={car.carId}
                            className={
                              isPlayer
                                ? 'bg-amber-500/12 border-l-2 border-l-amber-400'
                                : 'hover:bg-slate-800/40'
                            }
                          >
                            <td className="py-1.5 pl-1 font-bold text-white">
                              {car.isDisqualified ? (
                                <span className="text-red-500">DSQ</span>
                              ) : car.isRetired ? (
                                <span className="text-red-400">DNF</span>
                              ) : (
                                `P${car.position}`
                              )}
                            </td>
                            <td className="py-1.5">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-1.5 h-3.5 rounded-sm inline-block"
                                  style={{ backgroundColor: car.teamColor }}
                                />
                                <span className="font-bold text-white tracking-wider">
                                  {car.driverCode}
                                </span>
                                {car.isDrsActive && (
                                  <span className="px-1 bg-emerald-500/20 text-emerald-400 rounded text-[9px] font-bold">
                                    DRS
                                  </span>
                                )}
                                {car.isSideBySide && (
                                  <span className="px-1 bg-amber-500/20 text-amber-300 rounded text-[9px] font-bold">
                                    BATTLE
                                  </span>
                                )}
                                {car.isInPitLane && (
                                  <span className="px-1 bg-purple-500/30 text-purple-200 rounded text-[9px] font-bold">
                                    PIT {car.pitStopTimerSec.toFixed(0)}s
                                  </span>
                                )}
                                {car.frontWingDamage > 0 && (
                                  <span className="px-1 bg-red-500/30 text-red-300 rounded text-[9px]">
                                    DMG
                                  </span>
                                )}
                                <span className="text-[9px] text-slate-500 hidden sm:inline">
                                  {seg.name.slice(0, 12)}
                                </span>
                              </div>
                            </td>
                            <td className="py-1.5 text-right text-slate-300">
                              {car.isRetired
                                ? 'OUT'
                                : car.position === 1
                                ? 'LEADER'
                                : `+${car.gapToAheadSec.toFixed(2)}s`}
                            </td>
                            <td className="py-1.5 text-center">
                              <div className="inline-flex items-center gap-1.5">
                                <span
                                  className={`w-4 h-4 rounded-full border-2 inline-flex items-center justify-center text-[9px] font-bold ${
                                    TYRE_BADGE_STYLE[car.tyreCompound]
                                  }`}
                                >
                                  {car.tyreCompound[0]}
                                </span>
                                <span
                                  className={`font-bold ${
                                    wearPct < 30
                                      ? 'text-red-400 animate-pulse'
                                      : wearPct < 60
                                      ? 'text-amber-400'
                                      : 'text-emerald-400'
                                  }`}
                                >
                                  {wearPct}%
                                </span>
                              </div>
                            </td>
                            <td className="py-1.5 text-center space-x-1">
                              {[0, 1, 2].map((sIdx) => {
                                const col = car.sectorColors[sIdx];
                                const val = car.sectorTimesSec[sIdx];
                                return (
                                  <span
                                    key={sIdx}
                                    className={`px-1 py-0.5 rounded border text-[9px] font-bold ${SECTOR_BADGE_STYLE[col]}`}
                                  >
                                    {val ? val.toFixed(1) : `S${sIdx + 1}`}
                                  </span>
                                );
                              })}
                            </td>
                            <td className="py-1.5 text-right font-semibold text-emerald-400">
                              {car.lastLapTimeSec ? `${car.lastLapTimeSec.toFixed(3)}s` : '—'}
                            </td>
                            <td className="py-1.5 text-right text-slate-400">
                              {car.stopsCompleted}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Feed Team Radio & Direzione Gara */}
              <div className="bg-[#111827] border border-slate-700/40 rounded p-3">
                <h3 className="text-slate-400 font-bold uppercase mb-1.5 text-[11px]">
                  📻 Team Radio & Direzione Gara FIA
                </h3>
                <div className="space-y-1 max-h-36 overflow-y-auto text-[11px] telemetry-number">
                  {sim.radioLog.map((msg, i) => (
                    <div
                      key={i}
                      className="p-1.5 rounded bg-[#090D16] border border-slate-800/80 text-slate-300"
                    >
                      {msg}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. TELEMETRIA POST-GARA, PODIO E CLASSIFICA PUNTI */}
      {view === 'POST_RACE' && (
        <div className="bg-[#111827] border border-slate-700/40 rounded p-5 space-y-5">
          <div className="flex flex-wrap justify-between items-center border-b border-slate-800 pb-4 gap-3">
            <div>
              <span className="text-[11px] uppercase tracking-widest text-amber-400 font-bold">
                BANDIERA A SCACCHI // ANALISI TELEMETRICA POST-GARA
              </span>
              <h2 className="text-lg font-bold text-white">
                Risultati Ufficiali — {activeTrack.grandPrixName}
              </h2>
            </div>
            <button
              onClick={handleFinishWeekendAndReturn}
              className="px-5 py-2.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase cursor-pointer"
            >
              ✓ REGISTRA RISULTATI, INCASSA PREMI SPONSOR & TORNA AL QUARTIER GENERALE →
            </button>
          </div>

          {/* Podio Top 3 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {sim.cars
              .filter((c) => !c.isDisqualified && !c.isRetired)
              .slice(0, 3)
              .map((car, idx) => (
              <div
                key={car.carId}
                className="p-4 rounded bg-[#090D16] border border-amber-500/40 space-y-1"
              >
                <div className="text-xs font-bold text-amber-400">
                  {idx === 0 ? '🥇 1° CLASSIFICATO' : idx === 1 ? '🥈 2° CLASSIFICATO' : '🥉 3° CLASSIFICATO'}
                </div>
                <div className="text-base font-bold text-white">
                  {car.driverName} ({car.driverCode})
                </div>
                <div className="text-xs text-slate-400">{car.teamName}</div>
                <div className="text-[11px] text-emerald-400 telemetry-number">
                  Miglior Giro: {car.bestLapTimeSec ? `${car.bestLapTimeSec.toFixed(3)}s` : '—'} •
                  Soste: {car.stopsCompleted}
                </div>
              </div>
            ))}
          </div>

          {/* Telemetria Storica dei 2 Piloti del Giocatore (Passo Gara & Usura Gomme) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {playerCars.map((car) => (
              <div
                key={car.carId}
                className="p-4 rounded bg-[#090D16] border border-slate-800 space-y-2"
              >
                <div className="font-bold text-white text-xs">
                  Telemetria Giri — #{car.driverNumber} {car.driverName} (P{car.position})
                </div>
                <div className="text-[11px] text-slate-400 telemetry-number">
                  Storico Posizioni: {car.positionHistory.map((p) => `P${p}`).join(' → ')}
                </div>
                <div className="text-[11px] text-emerald-400 telemetry-number">
                  Tempi sul Giro:{' '}
                  {car.lapHistory.length > 0
                    ? car.lapHistory.map((t) => `${t.toFixed(1)}s`).join(' | ')
                    : 'Nessun giro completato'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <TeamCreatorModal
        isOpen={isTeamCreatorOpen}
        currentDb={career.db}
        onClose={() => setIsTeamCreatorOpen(false)}
        onConfirm={handleConfirmCreateCustomTeam}
      />
    </div>
  );
}
