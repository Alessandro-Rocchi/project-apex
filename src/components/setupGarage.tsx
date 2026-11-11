import { useState } from 'react';
import { INITIAL_DRIVERS } from '../data/defaultDb';
import { getScaledTrackLaps, type PreRaceCarConfig } from '../engine/raceEngine';
import type {
  Driver,
  RaceDistancePreset,
  TrackData,
  TyreCompound,
} from '../types/telemetry';
import { soundEffects } from '../utils/soundEffects';

interface SetupGarageProps {
  track: TrackData;
  playerTeamId?: string;
  drivers?: Driver[];
  distancePreset?: RaceDistancePreset;
  simulatorLevel?: number;
  reserveUsedInFp1?: boolean;
  onRunReserveFp1?: () => void;
  onStartRaceWeekend: (configs: PreRaceCarConfig[]) => void;
}

interface DriverGarageState {
  carId: string;
  driverId: string;
  driverCode: string;
  driverName: string;
  number: number;
  sliders: [number, number, number, number, number];
  stintsCompleted: number;
  startCompound: TyreCompound;
  fuelKg: number;
  isParcFermeLocked: boolean;
  brokeParcFerme: boolean;
}

const PARAMETER_META = [
  {
    name: '1. Incidenza Ala Anteriore',
    lowLabel: '0 (Scarica / Alta V-Max)',
    highLabel: '100 (Carica / Inserimento)',
    weight: 0.25,
    lowMsg: 'Sottosterzo marcato in ingresso curva: serve più ala anteriore.',
    highMsg: 'Troppo drag sul dritto e avantreno puntato: scarica l’ala anteriore.',
  },
  {
    name: '2. Incidenza Ala Posteriore',
    lowLabel: '0 (Minimo Drag)',
    highLabel: '100 (Massima Trazione)',
    weight: 0.25,
    lowMsg: 'Il retrotreno scivola in trazione: alza l’ala posteriore.',
    highMsg: 'Velocità di punta penalizzata sul rettilineo: riduci l’ala posteriore.',
  },
  {
    name: '3. Rigidezza Sospensioni',
    lowLabel: '0 (Morbide sui Cordoli)',
    highLabel: '100 (Rigide / Reattive)',
    weight: 0.2,
    lowMsg: 'Auto pigra nei cambi di direzione rapidi: irrigidisci le sospensioni.',
    highMsg: 'Saltellamento eccessivo sui cordoli: ammorbidisci le sospensioni.',
  },
  {
    name: '4. Altezza da Terra (Ride Height)',
    lowLabel: '0 (Rasoterra / Effetto Suolo)',
    highLabel: '100 (Alta / Sicura sui Dossi)',
    weight: 0.15,
    lowMsg: 'Contatto del fondo ad alta velocità (porpoising): alza la vettura.',
    highMsg: 'Perdita di carico dal fondo nei curvoni: abbassa l’altezza da terra.',
  },
  {
    name: '5. Ripartizione Frenata (Brake Bias)',
    lowLabel: '0 (Spostata al Posteriore)',
    highLabel: '100 (Spostata all’Anteriore)',
    weight: 0.15,
    lowMsg: 'Bloccaggio al retrotreno in staccata: sposta i freni in avanti.',
    highMsg: 'Bloccaggio anteriore in ingresso: arretra la ripartizione frenata.',
  },
];

function computeSetupConfidence(
  sliders: [number, number, number, number, number],
  ideal: [number, number, number, number, number]
): number {
  let weightedError = 0;
  for (let i = 0; i < 5; i++) {
    const diff = Math.abs(sliders[i] - ideal[i]);
    weightedError += diff * PARAMETER_META[i].weight;
  }
  return Math.max(0, Math.min(100, Math.round(100 - weightedError * 1.35)));
}

export default function SetupGarage({
  track,
  playerTeamId = 'corsa-rossa',
  drivers = INITIAL_DRIVERS,
  distancePreset = 'SPRINT_25',
  simulatorLevel = 1,
  reserveUsedInFp1 = false,
  onRunReserveFp1,
  onStartRaceWeekend,
}: SetupGarageProps) {
  const scaled = getScaledTrackLaps(track, distancePreset);
  const reserveDriver = drivers.find(
    (d) => d.teamId === playerTeamId && d.role === 'RESERVE'
  );

  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [garageCars, setGarageCars] = useState<DriverGarageState[]>(() => {
    const teamDrivers = drivers.filter(
      (d) =>
        d.teamId === playerTeamId &&
        (d.role === 'PRIMARY' || d.role === 'SECONDARY')
    );
    const list = teamDrivers.length >= 2 ? teamDrivers : INITIAL_DRIVERS.slice(0, 2);
    return list.map((d, i) => ({
      carId: `car-${d.number}`,
      driverId: d.id,
      driverCode: d.code,
      driverName: d.name,
      number: d.number,
      sliders: i === 0 ? [50, 48, 52, 48, 52] : [46, 44, 55, 45, 54],
      stintsCompleted: 1,
      startCompound: i === 0 ? 'SOFT' : 'MEDIUM',
      fuelKg: scaled.defaultFuelKg,
      isParcFermeLocked: false,
      brokeParcFerme: false,
    }));
  });

  const activeCar = garageCars[selectedIdx] ?? garageCars[0];
  const confidence = computeSetupConfidence(activeCar.sliders, track.idealSetup);

  const windowRadiusByStint = [24, 16, 9, 4, 1];
  const simBonus = Math.max(0, simulatorLevel - 1) + (reserveUsedInFp1 ? 2 : 0);
  const radius = Math.max(
    1,
    windowRadiusByStint[Math.min(4, activeCar.stintsCompleted)] - simBonus
  );

  const updateActiveCar = (patch: Partial<DriverGarageState>) => {
    setGarageCars((prev) =>
      prev.map((c, idx) => (idx === selectedIdx ? { ...c, ...patch } : c))
    );
  };

  const handleSliderChange = (paramIdx: number, value: number) => {
    if (activeCar.isParcFermeLocked) return;
    const nextSliders = [...activeCar.sliders] as [number, number, number, number, number];
    nextSliders[paramIdx] = value;
    updateActiveCar({ sliders: nextSliders });
  };

  const runPracticeStint = () => {
    if (activeCar.stintsCompleted >= 4 || activeCar.isParcFermeLocked) return;
    soundEffects.playTacticalClick();
    updateActiveCar({ stintsCompleted: activeCar.stintsCompleted + 1 });
  };

  const toggleParcFerme = () => {
    soundEffects.playTacticalClick();
    updateActiveCar({
      isParcFermeLocked: !activeCar.isParcFermeLocked,
      brokeParcFerme: activeCar.brokeParcFerme || activeCar.isParcFermeLocked,
    });
  };

  const handleProceed = () => {
    soundEffects.playRadioBeep();
    const configs: PreRaceCarConfig[] = garageCars.map((c) => ({
      carId: c.carId,
      driverId: c.driverId,
      setupConfidence: computeSetupConfidence(c.sliders, track.idealSetup),
      startCompound: c.startCompound,
      fuelKg: c.fuelKg,
      brokeParcFerme: c.brokeParcFerme,
    }));
    onStartRaceWeekend(configs);
  };

  const minFuel = Number((scaled.defaultFuelKg * 0.85).toFixed(1));
  const maxFuel = Number((scaled.defaultFuelKg * 1.1).toFixed(1));

  return (
    <div className="bg-[#111827] border border-slate-700/40 rounded p-5 space-y-5">
      <div className="flex flex-wrap justify-between items-center gap-4 border-b border-slate-800 pb-4">
        <div>
          <span className="text-[11px] uppercase tracking-widest text-amber-400 font-bold">
            PROVE LIBERE FP1–FP3 // SIMULATORE HQ LIV. {simulatorLevel}
          </span>
          <h2 className="text-lg font-bold text-white mt-0.5">
            Telemetria Assetto & Parco Chiuso — {track.grandPrixName} ({track.name})
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {reserveDriver && onRunReserveFp1 && (
            <button
              onClick={() => {
                soundEffects.playRadioBeep();
                onRunReserveFp1();
              }}
              disabled={reserveUsedInFp1}
              className={`px-3 py-2 rounded border text-xs font-bold cursor-pointer ${
                reserveUsedInFp1
                  ? 'bg-emerald-900/30 border-emerald-500/40 text-emerald-300 cursor-default'
                  : 'bg-purple-600/20 border-purple-500 text-purple-200 hover:bg-purple-600/30'
              }`}
            >
              {reserveUsedInFp1
                ? `✓ COLLAUDATORE ${reserveDriver.code} SCHIERATO IN FP1 (+XP & Finestra Precisa)`
                : `SCHIERA COLLAUDATORE ${reserveDriver.code} IN FP1 (+XP & -2 Raggio Setup)`}
            </button>
          )}

          {garageCars.map((car, idx) => {
            const carConf = computeSetupConfidence(car.sliders, track.idealSetup);
            return (
              <button
                key={car.carId}
                onClick={() => setSelectedIdx(idx)}
                className={`px-4 py-2 rounded border text-left cursor-pointer transition ${
                  selectedIdx === idx
                    ? 'bg-amber-500/15 border-amber-500 text-white'
                    : 'bg-[#090D16] border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-bold text-xs telemetry-number">
                  #{car.number} {car.driverCode} ({carConf}%)
                </div>
                <div className="text-[10px] text-slate-400">
                  {car.brokeParcFerme
                    ? '⚠️ PIT-LANE START'
                    : car.isParcFermeLocked
                    ? '🔒 PARCO CHIUSO'
                    : `Stint: ${car.stintsCompleted}/4`}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap justify-between items-center bg-[#090D16] border border-slate-800 p-3 rounded gap-2">
            <div>
              <span className="text-slate-400 text-xs">CONFIDENZA ASSETTO:</span>
              <div className="text-2xl font-bold text-emerald-400 telemetry-number">
                {confidence}%
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={runPracticeStint}
                disabled={activeCar.stintsCompleted >= 4 || activeCar.isParcFermeLocked}
                className={`px-3.5 py-2 rounded font-bold text-xs cursor-pointer ${
                  activeCar.stintsCompleted >= 4 || activeCar.isParcFermeLocked
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                SIMULA STINT 5 GIRI ({activeCar.stintsCompleted}/4)
              </button>

              <button
                onClick={toggleParcFerme}
                className={`px-3.5 py-2 rounded font-bold text-xs cursor-pointer ${
                  activeCar.isParcFermeLocked
                    ? 'bg-amber-500/20 border border-amber-500 text-amber-300'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {activeCar.isParcFermeLocked
                  ? '🔒 SBLOCCA PARCO CHIUSO (Penalità Pit-Lane)'
                  : 'BLOCCA IN PARCO CHIUSO'}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {PARAMETER_META.map((meta, i) => {
              const currentVal = activeCar.sliders[i];
              const idealVal = track.idealSetup[i];
              const minEst = Math.max(0, idealVal - radius);
              const maxEst = Math.min(100, idealVal + radius);
              const diff = currentVal - idealVal;

              let feedbackText = '✅ Bilanciamento ottimale raggiunto in questo reparto.';
              let feedbackColor = 'text-emerald-400';
              if (diff < -radius) {
                feedbackText = `⬆️ ${meta.lowMsg}`;
                feedbackColor = 'text-amber-400';
              } else if (diff > radius) {
                feedbackText = `⬇️ ${meta.highMsg}`;
                feedbackColor = 'text-amber-400';
              }

              return (
                <div
                  key={meta.name}
                  className="bg-[#090D16] border border-slate-800 rounded p-3 space-y-1.5"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white text-xs">{meta.name}</span>
                    <span className="text-xs text-slate-300 telemetry-number">
                      Valore: <strong className="text-white">{currentVal}</strong>{' '}
                      <span className="text-emerald-400 ml-2">
                        [Finestra: {minEst} – {maxEst}]
                      </span>
                    </span>
                  </div>

                  <div className="relative pt-1">
                    <div className="w-full h-2 bg-slate-800 rounded overflow-hidden relative">
                      <div
                        className="h-full bg-emerald-500/40 border-x border-emerald-400 absolute top-0"
                        style={{
                          left: `${minEst}%`,
                          width: `${Math.max(2, maxEst - minEst)}%`,
                        }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      disabled={activeCar.isParcFermeLocked}
                      value={currentVal}
                      onChange={(e) => handleSliderChange(i, Number(e.target.value))}
                      className="w-full mt-1 accent-amber-500 cursor-pointer disabled:opacity-40"
                    />
                  </div>

                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>{meta.lowLabel}</span>
                    <span className={feedbackColor}>{feedbackText}</span>
                    <span>{meta.highLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-[#090D16] border border-slate-800 rounded p-4 space-y-4">
            <h3 className="text-xs font-bold uppercase text-slate-400 border-b border-slate-800 pb-2">
              Strategia Gara — #{activeCar.number} {activeCar.driverName}
            </h3>

            <div>
              <label className="block text-slate-400 text-xs mb-1.5">
                1. MESCOLA DI PARTENZA GARA ({scaled.totalLaps} Giri):
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {(['SOFT', 'MEDIUM', 'HARD', 'INTER', 'WET'] as TyreCompound[]).map((comp) => (
                  <button
                    key={comp}
                    onClick={() => updateActiveCar({ startCompound: comp })}
                    className={`py-2 rounded border font-bold text-[11px] cursor-pointer ${
                      activeCar.startCompound === comp
                        ? 'bg-amber-500 border-amber-300 text-black'
                        : 'bg-[#111827] border-slate-700 text-slate-400'
                    }`}
                  >
                    {comp}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                *Sull’asciutto è obbligatorio usare almeno 2 mescole diverse (pena DSQ). Con pioggia o gomme Inter/Wet l’obbligo decade.
              </p>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1 telemetry-number">
                <span className="text-slate-400">
                  2. CARICO CARBURANTE ({scaled.totalLaps} Giri):
                </span>
                <strong className="text-amber-400">{activeCar.fuelKg.toFixed(1)} kg</strong>
              </div>
              <input
                type="range"
                min={minFuel}
                max={maxFuel}
                step={0.5}
                value={activeCar.fuelKg}
                onChange={(e) => updateActiveCar({ fuelKg: Number(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1 telemetry-number">
                <span>{minFuel} kg (Under-fuel)</span>
                <span>{scaled.defaultFuelKg} kg (Std)</span>
                <span>{maxFuel} kg (Max)</span>
              </div>
            </div>

            <div className="p-3 rounded bg-[#111827] border border-slate-800 space-y-1">
              <div className="text-xs font-bold text-white">
                Stato FIA Parc Fermé:{' '}
                {activeCar.brokeParcFerme ? (
                  <span className="text-red-400">VIOLATO (Partenza Pit-Lane)</span>
                ) : activeCar.isParcFermeLocked ? (
                  <span className="text-emerald-400">BLOCCATO E REGOLARE</span>
                ) : (
                  <span className="text-amber-400">APERTO (Prove Libere)</span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Rischio pioggia circuito: {Math.round(track.baseRainChance * 100)}% — Temp. asfalto: {track.ambientTempCelsius}°C.
              </p>
            </div>
          </div>

          <button
            onClick={handleProceed}
            className="w-full py-3.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs tracking-wider uppercase cursor-pointer shadow-lg"
          >
            CONFERMA ASSETTO & VAI ALLE QUALIFICHE (Q1/Q2/Q3) →
          </button>
        </div>
      </div>
    </div>
  );
}
