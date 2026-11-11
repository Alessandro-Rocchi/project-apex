import { useState } from 'react';
import {
  DAYS_BETWEEN_RACES,
  SEASON_BUDGET_CAP_MILLIONS,
  advanceCareerDays,
  finalizeSeasonAndStartNext,
  getRdProjectQuote,
   signDriverToPlayerTeam,
  startFacilityUpgrade,
  startRdProject,
  type CareerState,
} from '../engine/hqSimulator';
import type { ComponentKey } from '../types/telemetry';
import { soundEffects } from '../utils/soundEffects';

interface HqViewProps {
  career: CareerState;
  onUpdateCareer: (next: CareerState) => void;
  onEnterRaceWeekend: () => void;
}

type HqTab = 'RD' | 'FACILITIES' | 'DRIVERS' | 'FINANCE' | 'STANDINGS';

const COMPONENT_LABELS: Record<ComponentKey, string> = {
  powerUnit: '1. Power Unit (Motore & Ibrido)',
  frontWing: '2. Ala Anteriore',
  rearWing: '3. Ala Posteriore',
  floor: '4. Fondo & Effetto Suolo',
  suspension: '5. Sospensioni & Cinematica',
  brakes: '6. Impianto Frenante',
};

export default function HqView({
  career,
  onUpdateCareer,
  onEnterRaceWeekend,
}: HqViewProps) {
  const [tab, setTab] = useState<HqTab>('RD');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const playerTeam =
    career.db.teams.find((t) => t.id === career.playerTeamId) ?? career.db.teams[0];
  const seasonFinished = career.currentRoundIndex >= career.db.tracks.length;
  const nextTrack =
    career.db.tracks[Math.min(career.currentRoundIndex, career.db.tracks.length - 1)];
  const nextRaceDay = (career.currentRoundIndex + 1) * DAYS_BETWEEN_RACES;
  const isRaceDay = !seasonFinished && career.currentDay >= nextRaceDay;

  const handleAdvance = (days: number) => {
    setErrorBanner(null);
    soundEffects.playTacticalClick();
    const res = advanceCareerDays(career, days);
    onUpdateCareer(res.state);
  };

  const handleStartRd = (comp: ComponentKey, focus: 'PERFORMANCE' | 'RELIABILITY') => {
    const res = startRdProject(career, comp, focus);
    if (!res.ok) {
      setErrorBanner(res.error ?? 'Impossibile avviare progetto R&D.');
      return;
    }
    setErrorBanner(null);
    soundEffects.playTacticalClick();
    onUpdateCareer(res.state);
  };

  const handleUpgradeFacility = (fac: 'factory' | 'windTunnel' | 'simulator') => {
    const res = startFacilityUpgrade(career, fac);
    if (!res.ok) {
      setErrorBanner(res.error ?? 'Impossibile potenziare la struttura.');
      return;
    }
    setErrorBanner(null);
    soundEffects.playTacticalClick();
    onUpdateCareer(res.state);
  };

  const handleSignDriver = (
    driverId: string,
    role: 'PRIMARY' | 'SECONDARY' | 'RESERVE'
  ) => {
    const res = signDriverToPlayerTeam(career, driverId, role);
    if (!res.ok) {
      setErrorBanner(res.error ?? 'Impossibile completare il contratto.');
      return;
    }
    setErrorBanner(null);
    soundEffects.playRadioBeep();
    onUpdateCareer(res.state);
  };

  const toggleSecondarySponsor = (spId: string) => {
    soundEffects.playTacticalClick();
    const exists = career.activeSecondarySponsorIds.includes(spId);
    const nextIds = exists
      ? career.activeSecondarySponsorIds.filter((id) => id !== spId)
      : [...career.activeSecondarySponsorIds, spId].slice(-2);
    onUpdateCareer({ ...career, activeSecondarySponsorIds: nextIds });
  };

  const maxSlots = 1 + Math.min(3, playerTeam.facilities.factory);
  const teamDrivers = career.db.drivers.filter((d) => d.teamId === playerTeam.id);

  return (
    <div className="space-y-4">
      {/* Barra Superiore Calendario Giornaliero & Controllo Stagione */}
      <div className="bg-[#111827] border border-slate-700/40 rounded p-4 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div
            className="w-3.5 h-11 rounded-sm"
            style={{
              backgroundColor: playerTeam.colorHex,
              borderLeft: `3px solid ${playerTeam.accentHex}`,
            }}
          />
          <div>
            <div className="text-[11px] uppercase tracking-widest text-amber-400 font-bold">
              QUARTIER GENERALE // STAGIONE {career.season} — GIORNO {career.currentDay}
            </div>
            <h2 className="text-base font-bold text-white">
              {playerTeam.name} (Tier {playerTeam.tier}) — Budget:{' '}
              <span className="text-emerald-400 telemetry-number">
                {playerTeam.budgetMillions.toFixed(2)} M€
              </span>{' '}
              — Cap R&D:{' '}
              <span className="text-sky-400 telemetry-number">
                {career.budgetCapSpentMillions.toFixed(1)} / {SEASON_BUDGET_CAP_MILLIONS} M€
              </span>
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {seasonFinished ? (
            <button
              onClick={() => {
                soundEffects.playCheckeredFlag();
                onUpdateCareer(finalizeSeasonAndStartNext(career));
              }}
              className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs cursor-pointer"
            >
              🏆 CONCLUDI STAGIONE {career.season} & INCASSA PREMI COSTRUTTORI →
            </button>
          ) : isRaceDay ? (
            <button
              onClick={() => {
                soundEffects.playRadioBeep();
                onEnterRaceWeekend();
              }}
              className="px-5 py-2.5 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs tracking-wider cursor-pointer animate-pulse"
            >
              🏁 INIZIA WEEKEND GP #{career.currentRoundIndex + 1}:{' '}
              {nextTrack.grandPrixName.toUpperCase()} →
            </button>
          ) : (
            <>
              <span className="text-xs text-slate-400 mr-2 telemetry-number">
                Prossimo GP ({nextTrack.grandPrixName}): tra{' '}
                <strong className="text-white">{nextRaceDay - career.currentDay}g</strong> (Giorno{' '}
                {nextRaceDay})
              </span>
              <button
                onClick={() => handleAdvance(1)}
                className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold text-xs cursor-pointer"
              >
                +1 GIORNO
              </button>
              <button
                onClick={() => handleAdvance(DAYS_BETWEEN_RACES)}
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs cursor-pointer"
              >
                AVANZA AL GP ({nextRaceDay - career.currentDay}g) ⏩
              </button>
            </>
          )}
        </div>
      </div>

      {errorBanner && (
        <div className="bg-red-900/30 border border-red-500 text-red-200 px-4 py-2.5 rounded text-xs flex justify-between items-center">
          <span>⚠️ {errorBanner}</span>
          <button
            onClick={() => setErrorBanner(null)}
            className="text-red-300 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Navigazione 5 Dipartimenti HQ */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {(
          [
            ['RD', '🔧 1. Ingegneria & R&D (6 Reparti)'],
            ['FACILITIES', '🏭 2. Strutture HQ'],
            ['DRIVERS', ' helmet 3. Mercato Piloti & Collaudatore'],
            ['FINANCE', '💼 4. Finanze & Sponsor'],
            ['STANDINGS', '🏆 5. Classifiche & Calendario 12 GP'],
          ] as [HqTab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              soundEffects.playTacticalClick();
              setTab(key);
            }}
            className={`px-3.5 py-2 rounded text-xs font-bold cursor-pointer ${
              tab === key
                ? 'bg-amber-500 text-black'
                : 'bg-[#111827] border border-slate-800 text-slate-300 hover:border-slate-600'
            }`}
          >
            {label.replace(' helmet ', '🏎️ ')}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Area Principale Dipartimento (2/3) */}
        <div className="xl:col-span-2 bg-[#111827] border border-slate-700/40 rounded p-4 space-y-4">
          {tab === 'RD' && (
            <>
              <div className="flex flex-wrap justify-between items-center border-b border-slate-800 pb-3 gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase">
                    Reparto Ricerca & Sviluppo Monoposto
                  </h3>
                  <p className="text-xs text-slate-400">
                    I 6 componenti alimentano i 4 indici fisici in pista: Power={playerTeam.power} |
                    AeroEff={playerTeam.aeroEfficiency} | Downforce={playerTeam.downforce} |
                    MechGrip={playerTeam.mechanicalGrip} | Affidabilità={playerTeam.overallReliability}%
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-slate-800 text-amber-400 font-bold text-xs telemetry-number">
                  Slot Fabbrica Attivi: {career.activeRdProjects.length} / {maxSlots}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(Object.keys(COMPONENT_LABELS) as ComponentKey[]).map((compKey) => {
                  const spec = playerTeam.components[compKey];
                  const perfQuote = getRdProjectQuote(playerTeam, compKey, 'PERFORMANCE');
                  const relQuote = getRdProjectQuote(playerTeam, compKey, 'RELIABILITY');
                  return (
                    <div
                      key={compKey}
                      className="bg-[#090D16] border border-slate-800 rounded p-3 space-y-2.5"
                    >
                      <div className="font-bold text-white text-xs">
                        {COMPONENT_LABELS[compKey]}
                      </div>

                      <div className="space-y-1 text-[11px] telemetry-number">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Prestazione:</span>
                          <strong className="text-emerald-400">{spec.performance}/100</strong>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${spec.performance}%` }}
                          />
                        </div>

                        <div className="flex justify-between pt-1">
                          <span className="text-slate-400">Affidabilità:</span>
                          <strong className="text-sky-400">{spec.reliability}/100</strong>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
                          <div
                            className="h-full bg-sky-500"
                            style={{ width: `${spec.reliability}%` }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          onClick={() => handleStartRd(compKey, 'PERFORMANCE')}
                          className="py-1.5 px-2 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 font-bold text-[10px] cursor-pointer telemetry-number"
                        >
                          +PREST (+{perfQuote.expectedGain}) • {perfQuote.costMillions}M€ (
                          {perfQuote.durationDays}g)
                        </button>
                        <button
                          onClick={() => handleStartRd(compKey, 'RELIABILITY')}
                          className="py-1.5 px-2 rounded bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/50 text-sky-300 font-bold text-[10px] cursor-pointer telemetry-number"
                        >
                          +AFFID (+{relQuote.expectedGain}) • {relQuote.costMillions}M€ (
                          {relQuote.durationDays}g)
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {tab === 'FACILITIES' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white uppercase border-b border-slate-800 pb-2">
                Infrastrutture del Quartier Generale (Livello 1 – 5)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(
                  [
                    [
                      'factory',
                      'Fabbrica Compositi',
                      'Determina quanti progetti R&D possono procedere in parallelo (2 -> 4 slot) e riduce i giorni di produzione.',
                    ],
                    [
                      'windTunnel',
                      'Galleria del Vento & CFD',
                      'Aumenta l’efficacia dei nuovi pezzi aerodinamici (Ala Ant, Ala Post, Fondo) a ogni upgrade.',
                    ],
                    [
                      'simulator',
                      'Simulatore Driver-in-Loop',
                      'Riduce l’incertezza iniziale dell’assetto nelle Prove Libere e accelera la crescita dei piloti.',
                    ],
                  ] as const
                ).map(([facKey, title, desc]) => {
                  const lvl = playerTeam.facilities[facKey];
                  const cost = Number((lvl * 6.5).toFixed(1));
                  return (
                    <div
                      key={facKey}
                      className="bg-[#090D16] border border-slate-800 rounded p-4 flex flex-col justify-between space-y-3"
                    >
                      <div>
                        <div className="text-xs font-bold text-white">{title}</div>
                        <div className="text-xl font-bold text-amber-400 my-1 telemetry-number">
                          Livello {lvl} / 5
                        </div>
                        <p className="text-[11px] text-slate-400">{desc}</p>
                      </div>
                      <button
                        onClick={() => handleUpgradeFacility(facKey)}
                        disabled={lvl >= 5 || career.activeFacilityUpgrade !== null}
                        className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs cursor-pointer telemetry-number"
                      >
                        {lvl >= 5
                          ? 'LIVELLO MASSIMO'
                          : `POTENZIA A LIV. ${lvl + 1} (${cost} M€)`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'DRIVERS' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white uppercase border-b border-slate-800 pb-2 mb-3">
                  Line-Up Attuale Scuderia (2 Titolari + 1 Collaudatore)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {teamDrivers.map((d) => (
                    <div
                      key={d.id}
                      className="bg-[#090D16] border border-amber-500/40 rounded p-3 space-y-1.5"
                    >
                      <div className="flex justify-between items-center">
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                          {d.role}
                        </span>
                        <span className="text-xs text-slate-400 telemetry-number">
                          #{d.number} • {d.age} anni
                        </span>
                      </div>
                      <div className="font-bold text-white text-sm">
                        {d.name} ({d.code})
                      </div>
                      <div className="text-[11px] text-slate-300 grid grid-cols-2 gap-1 telemetry-number">
                        <span>Pace: {d.pace}</span>
                        <span>Cons: {d.consistency}</span>
                        <span>Tyre: {d.smoothness}</span>
                        <span>Wet: {d.wetSkill}</span>
                        <span>Ovrtk: {d.overtaking}</span>
                        <span>Def: {d.defense}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800 telemetry-number">
                        Stipendio: {d.salaryPerRaceMillions.toFixed(2)} M€/GP • Contratto:{' '}
                        {d.contractYearsLeft}a
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase text-slate-400 mb-2">
                  Mercato Piloti (Free Agent & Piloti Sotto Contratto Altrui)
                </h3>
                <div className="max-h-72 overflow-y-auto border border-slate-800 rounded">
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead className="bg-[#090D16] text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="p-2">PILOTA</th>
                        <th className="p-2">RUOLO / TEAM</th>
                        <th className="p-2 text-center">PACE / CONS / WET</th>
                        <th className="p-2 text-right">BUYOUT</th>
                        <th className="p-2 text-right">INGAGGIA COME</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {career.db.drivers
                        .filter((d) => d.teamId !== playerTeam.id)
                        .map((d) => (
                          <tr key={d.id} className="hover:bg-slate-800/40">
                            <td className="p-2 font-bold text-white">
                              {d.name} ({d.code})
                            </td>
                            <td className="p-2 text-slate-400">
                              {d.teamId ? d.teamId : 'FREE AGENT'}
                            </td>
                            <td className="p-2 text-center text-emerald-400 telemetry-number">
                              {d.pace} / {d.consistency} / {d.wetSkill}
                            </td>
                            <td className="p-2 text-right text-amber-400 telemetry-number">
                              {d.buyoutMillions.toFixed(1)} M€
                            </td>
                            <td className="p-2 text-right space-x-1">
                              {(['PRIMARY', 'SECONDARY', 'RESERVE'] as const).map((r) => (
                                <button
                                  key={r}
                                  onClick={() => handleSignDriver(d.id, r)}
                                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-amber-500 hover:text-black text-[10px] font-bold cursor-pointer"
                                >
                                  {r.slice(0, 3)}
                                </button>
                              ))}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'FINANCE' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white uppercase border-b border-slate-800 pb-2">
                Sponsor Principale & Obiettivi Secondari Weekend (Max 2 Secondari)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {career.db.sponsors.map((sp) => {
                  const isMain = sp.type === 'MAIN';
                  const isSelected = isMain
                    ? career.activeMainSponsorId === sp.id
                    : career.activeSecondarySponsorIds.includes(sp.id);
                  return (
                    <div
                      key={sp.id}
                      className={`p-3 rounded border space-y-1.5 ${
                        isSelected
                          ? 'bg-emerald-950/25 border-emerald-500'
                          : 'bg-[#090D16] border-slate-800'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-white text-xs">{sp.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-amber-400 font-bold">
                          {sp.type}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">{sp.objectiveDescription}</p>
                      <div className="flex justify-between items-center pt-1 text-[11px] telemetry-number">
                        <span className="text-slate-300">
                          Fisso: <strong>+{sp.basePayoutPerRaceMillions} M€</strong> • Bonus:{' '}
                          <strong className="text-emerald-400">+{sp.bonusMillions} M€</strong>
                        </span>
                        <button
                          onClick={() =>
                            isMain
                              ? onUpdateCareer({ ...career, activeMainSponsorId: sp.id })
                              : toggleSecondarySponsor(sp.id)
                          }
                          className={`px-2.5 py-1 rounded font-bold text-[10px] cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-500 text-black'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {isSelected ? 'ATTIVO' : 'SELEZIONA'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'STANDINGS' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-bold uppercase text-amber-400 mb-2">
                  Classifica Mondiale Costruttori
                </h4>
                <div className="space-y-1 text-xs telemetry-number">
                  {[...career.db.teams]
                    .sort(
                      (a, b) => (career.teamPoints[b.id] ?? 0) - (career.teamPoints[a.id] ?? 0)
                    )
                    .map((t, idx) => (
                      <div
                        key={t.id}
                        className={`flex justify-between p-2 rounded border ${
                          t.id === playerTeam.id
                            ? 'bg-amber-500/15 border-amber-500 text-white font-bold'
                            : 'bg-[#090D16] border-slate-800 text-slate-300'
                        }`}
                      >
                        <span>
                          P{idx + 1}. {t.name}
                        </span>
                        <span className="text-emerald-400">{career.teamPoints[t.id] ?? 0} pt</span>
                      </div>
                    ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase text-amber-400 mb-2">
                  Calendario Stagionale (12 Gran Premi Originali)
                </h4>
                <div className="space-y-1 text-[11px] max-h-80 overflow-y-auto telemetry-number">
                  {career.db.tracks.map((tr, idx) => {
                    const isCurrent = idx === career.currentRoundIndex;
                    const isDone = idx < career.currentRoundIndex;
                    return (
                      <div
                        key={tr.id}
                        className={`p-2 rounded border flex justify-between items-center ${
                          isCurrent
                            ? 'bg-emerald-950/30 border-emerald-500 text-white font-bold'
                            : isDone
                            ? 'bg-[#090D16] border-slate-800/50 text-slate-500'
                            : 'bg-[#090D16] border-slate-800 text-slate-300'
                        }`}
                      >
                        <span>
                          R{idx + 1}. {tr.grandPrixName} — {tr.region}
                        </span>
                        <span>
                          {isDone ? '✓ COMPLETATO' : isCurrent ? 'PROSSIMO GP' : `Giorno ${(idx + 1) * 14}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Colonna Destra (1/3): Progetti in Corso & Inbox Team Principal */}
        <div className="space-y-4">
          <div className="bg-[#111827] border border-slate-700/40 rounded p-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase text-slate-400 border-b border-slate-800 pb-1.5">
              Coda Produzione Fabbrica & Cantiere HQ
            </h3>
            {career.activeRdProjects.length === 0 && !career.activeFacilityUpgrade ? (
              <p className="text-xs text-slate-500">
                Nessun progetto in lavorazione. Avvia uno sviluppo R&D per migliorare la vettura.
              </p>
            ) : (
              <div className="space-y-2 telemetry-number text-xs">
                {career.activeRdProjects.map((p) => (
                  <div
                    key={p.id}
                    className="p-2 rounded bg-[#090D16] border border-slate-800 flex justify-between"
                  >
                    <span className="text-white font-semibold">
                      {p.component.toUpperCase()} ({p.focus.slice(0, 4)} +{p.gainAmount})
                    </span>
                    <span className="text-amber-400 font-bold">-{p.daysRemaining}g</span>
                  </div>
                ))}
                {career.activeFacilityUpgrade && (
                  <div className="p-2 rounded bg-blue-950/30 border border-blue-500/40 flex justify-between">
                    <span className="text-blue-200 font-semibold">
                      Cantiere {career.activeFacilityUpgrade.facility.toUpperCase()} Liv.{' '}
                      {career.activeFacilityUpgrade.targetLevel}
                    </span>
                    <span className="text-blue-300 font-bold">
                      -{career.activeFacilityUpgrade.daysRemaining}g
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-[#111827] border border-slate-700/40 rounded p-4 space-y-2.5">
            <h3 className="text-xs font-bold uppercase text-slate-400 border-b border-slate-800 pb-1.5">
              Inbox Comunicazioni Ufficiali ({career.inbox.length})
            </h3>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {career.inbox.slice(0, 12).map((msg) => (
                <div
                  key={msg.id}
                  className="p-2.5 rounded bg-[#090D16] border border-slate-800 space-y-1"
                >
                  <div className="flex justify-between text-[10px] text-slate-400 telemetry-number">
                    <span className="font-bold text-amber-400">[{msg.category}]</span>
                    <span>
                      Stagione {msg.season} • Giorno {msg.day}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-white">{msg.title}</div>
                  <p className="text-[11px] text-slate-300">{msg.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
