import React, { useEffect, useMemo, useState } from 'react';
import type { Driver, GameDatabase } from '../types/telemetry';
import { deriveCarPhysics } from '../engine/carPhysicsMapper';
import {
  TIER_PRESETS,
  pickRandomDriversForTier,
  type CustomTeamInput,
} from '../engine/customTeamBuilder';
import { soundEffects } from '../utils/soundEffects';

export interface TeamCreatorModalProps {
  currentDb: GameDatabase;
  onClose: () => void;
  onConfirm: (input: CustomTeamInput) => void;
}

const MOTORSPORT_NATIONS = [
  'Italia',
  'Regno Unito',
  'Germania',
  'Francia',
  'Austria',
  'USA',
  'Giappone',
  'Spagna',
  'Svizzera',
  'Paesi Bassi',
  'Canada',
  'Australia',
  'Brasile',
  'Monaco',
  'Messico',
  'Belgio',
  'Danimarca',
  'Finlandia',
  'Svezia',
  'Argentina',
];

const TIER_OPTIONS: Array<{ tier: 1 | 2 | 3 | 4 | 5; desc: string }> = [
  { tier: 1, desc: 'Top Team' },
  { tier: 2, desc: 'Midfield Alto' },
  { tier: 3, desc: 'Midfield' },
  { tier: 4, desc: 'Midfield Basso' },
  { tier: 5, desc: 'Underdog' },
];

export default function TeamCreatorModal({
  currentDb,
  onClose,
  onConfirm,
}: TeamCreatorModalProps): React.JSX.Element {
  const lowestTierTeam = useMemo(
    () => [...currentDb.teams].sort((a, b) => b.tier - a.tier)[0],
    [currentDb.teams]
  );
  const initialReplaced = lowestTierTeam?.id ?? currentDb.teams[0]?.id ?? '';
  const [initialD1, initialD2] = useMemo(
    () => pickRandomDriversForTier(currentDb.drivers, 3),
    [currentDb.drivers]
  );

  const [name, setName] = useState('Scuderia Apex');
  const [nationality, setNationality] = useState('Italia');
  const [colorHex, setColorHex] = useState('#059669');
  const [accentHex, setAccentHex] = useState('#FBBF24');
  const [tier, setTier] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [replacedTeamId, setReplacedTeamId] = useState<string>(initialReplaced);
  const [primaryDriverId, setPrimaryDriverId] = useState<string>(initialD1 ?? '');
  const [secondaryDriverId, setSecondaryDriverId] = useState<string>(initialD2 ?? '');

  const safeColorHex = colorHex.startsWith('#') ? colorHex : '#059669';
  const safeAccentHex = accentHex.startsWith('#') ? accentHex : '#FBBF24';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const sortedDrivers = useMemo(
    () => [...currentDb.drivers].sort((a, b) => b.pace - a.pace),
    [currentDb.drivers]
  );

  const getDriverTeamLabel = (driver: Driver): string => {
    if (!driver.teamId || driver.role === 'FREE_AGENT') return 'Free Agent';
    return currentDb.teams.find((t) => t.id === driver.teamId)?.name ?? 'Free Agent';
  };

  const previewPreset = TIER_PRESETS[tier];
  const previewPhysics = useMemo(
    () => deriveCarPhysics(previewPreset.components),
    [previewPreset]
  );

  const handleRandomizeDrivers = () => {
    soundEffects.playTacticalClick();
    const [d1, d2] = pickRandomDriversForTier(currentDb.drivers, tier);
    setPrimaryDriverId(d1);
    setSecondaryDriverId(d2);
  };

  const trimmedName = name.trim();
  const isNameEmpty = trimmedName === '';
  const isDriversIdentical =
    primaryDriverId !== '' &&
    secondaryDriverId !== '' &&
    primaryDriverId === secondaryDriverId;
  const isDriversIncomplete = !primaryDriverId || !secondaryDriverId;
  const isInvalid = isNameEmpty || isDriversIdentical || isDriversIncomplete;

  const warnings: string[] = [];
  if (isNameEmpty) {
    warnings.push('Inserisci un nome valido per la scuderia');
  }
  if (isDriversIdentical) {
    warnings.push('I due piloti titolari devono essere distinti');
  }

  const handleConfirm = () => {
    if (isInvalid) return;
    soundEffects.playRadioBeep();
    onConfirm({
      name: trimmedName,
      nationality,
      colorHex: safeColorHex,
      accentHex: safeAccentHex,
      tier,
      replacedTeamId: replacedTeamId || currentDb.teams[0]?.id || '',
      primaryDriverId,
      secondaryDriverId,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div
        className="bg-[#111827] border border-slate-700/80 rounded-lg max-w-3xl w-full p-6 text-white space-y-5 shadow-2xl my-auto max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-lg font-black tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
              🛠️ FONDA LA TUA SCUDERIA
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Configura identità, livrea, livello prestazionale e piloti per competere nel campionato.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              soundEffects.playTacticalClick();
              onClose();
            }}
            aria-label="Chiudi"
            className="text-slate-400 hover:text-white text-xl p-1 leading-none rounded transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Section 1: Identità & Livrea */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <span>1. Identità & Livrea</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-[#090D16] border border-slate-800 rounded-lg p-3.5">
            <div className="md:col-span-2 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Nome Scuderia
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="es. Scuderia Apex"
                  maxLength={32}
                  className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-400 rounded px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Nazionalità
                  </label>
                  <select
                    value={nationality}
                    onChange={(e) => setNationality(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-400 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    {MOTORSPORT_NATIONS.map((nat) => (
                      <option key={nat} value={nat}>
                        {nat}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['Colore Primario', colorHex, safeColorHex, '#059669', setColorHex],
                      ['Accento', accentHex, safeAccentHex, '#FBBF24', setAccentHex],
                    ] as const
                  ).map(([label, rawHex, safeHex, fallback, setHex]) => (
                    <div key={label}>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        {label}
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={safeHex.length === 7 ? safeHex : fallback}
                          onChange={(e) => setHex(e.target.value)}
                          className="w-8 h-8 rounded border border-slate-700 bg-transparent cursor-pointer p-0"
                        />
                        <input
                          type="text"
                          value={rawHex}
                          onChange={(e) => setHex(e.target.value)}
                          className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] font-mono text-slate-200 uppercase focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Live SVG Preview Box */}
            <div className="flex flex-col items-center justify-center p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-center">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-2 font-semibold">
                Anteprima Scudo
              </div>
              <svg width="40" height="46" viewBox="0 0 28 32" className="drop-shadow-lg">
                <polygon
                  points="14,1 27,7 24,24 14,31 4,24 1,7"
                  fill={safeColorHex}
                  stroke={safeAccentHex}
                  strokeWidth="2"
                />
              </svg>
              <div className="mt-2 font-bold text-xs text-white truncate max-w-[180px]">
                {name.trim() || 'Scuderia Apex'}
              </div>
              <div className="text-[10px] text-slate-400">{nationality}</div>
            </div>
          </div>
        </section>

        {/* Section 2: Scuderia da Rimpiazzare & Tier Prestazionale */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <span>2. Scuderia da Rimpiazzare & Tier Prestazionale</span>
          </h3>

          <div className="bg-[#090D16] border border-slate-800 rounded-lg p-3.5 space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Sostituisci Scuderia (10 Team nel Campionato)
              </label>
              <select
                value={replacedTeamId}
                onChange={(e) => setReplacedTeamId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-400 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none cursor-pointer"
              >
                {currentDb.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (Tier {t.tier} • Budget: {t.budgetMillions.toFixed(0)}M€ • {t.nationality})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">
                La tua scuderia subentrerà nello slot di questo team. Il collaudatore resterà come riserva, mentre i titolari non scelti diventeranno svincolati o prenderanno eventuali sedili vacanti.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                Seleziona Tier Prestazionale
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {TIER_OPTIONS.map((opt) => {
                  const isSelected = tier === opt.tier;
                  return (
                    <button
                      key={opt.tier}
                      type="button"
                      onClick={() => {
                        soundEffects.playTacticalClick();
                        setTier(opt.tier);
                      }}
                      className={`p-2 rounded border text-center transition cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500/20 border-amber-400 text-amber-300 ring-1 ring-amber-400 shadow'
                          : 'bg-slate-900/80 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-bold text-xs text-white">Tier {opt.tier}</div>
                      <div className="text-[10px] text-amber-400 font-semibold">{opt.desc}</div>
                      <div className="text-[10px] text-slate-400 telemetry-number">
                        ~{TIER_PRESETS[opt.tier].budgetMillions}M€
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Telemetry Preview box */}
            <div className="bg-slate-900/90 border border-slate-800 rounded p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between text-xs border-b border-slate-800 pb-2 gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold">
                    Budget Iniziale:
                  </span>
                  <span className="text-emerald-400 font-bold telemetry-number text-sm">
                    {previewPreset.budgetMillions.toFixed(1)} M€
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Strutture HQ:{' '}
                  <span className="text-slate-200 font-semibold">
                    Fabbrica (liv. {previewPreset.facilities.factory}), Galleria (liv.{' '}
                    {previewPreset.facilities.windTunnel}), Simulatore (liv.{' '}
                    {previewPreset.facilities.simulator})
                  </span>
                </div>
              </div>

              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1.5 font-semibold">
                  Telemetria Monoposto Stimata (Car Physics)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  {(
                    [
                      ['PWR (Potenza)', previewPhysics.power, 'text-amber-400'],
                      ['AERO (Carico)', previewPhysics.downforce, 'text-cyan-400'],
                      ['GRIP (Meccanico)', previewPhysics.mechanicalGrip, 'text-emerald-400'],
                      ['AFFIDABILITÀ', `${previewPhysics.overallReliability}%`, 'text-purple-400'],
                    ] as const
                  ).map(([label, value, colorClass]) => (
                    <div key={label} className="bg-[#090D16] p-2 rounded border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase">{label}</div>
                      <div className={`text-sm font-bold telemetry-number ${colorClass}`}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Formazione Piloti */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">
              3. Formazione Piloti
            </h3>
            <button
              type="button"
              onClick={handleRandomizeDrivers}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-amber-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
            >
              <span>🎲</span>
              <span>Assegna Casuali</span>
            </button>
          </div>

          <div className="bg-[#090D16] border border-slate-800 rounded-lg p-3.5 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(
                [
                  ['Pilota 1 (Primary)', primaryDriverId, setPrimaryDriverId],
                  ['Pilota 2 (Secondary)', secondaryDriverId, setSecondaryDriverId],
                ] as const
              ).map(([label, driverId, setDriverId]) => (
                <div key={label}>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    {label}
                  </label>
                  <select
                    value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-400 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none cursor-pointer"
                  >
                    {sortedDrivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        [{d.pace}] {d.name} ({d.nationality}) - {getDriverTeamLabel(d)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Validation & Error banner */}
            {warnings.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {warnings.map((msg, idx) => (
                  <div
                    key={idx}
                    className="bg-red-950/60 border border-red-500/50 text-red-300 text-xs px-3 py-2 rounded flex items-center gap-2"
                  >
                    <span>⚠️</span>
                    <span>{msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={() => {
              soundEffects.playTacticalClick();
              onClose();
            }}
            className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold text-xs cursor-pointer transition"
          >
            Annulla
          </button>
          <button
            type="button"
            disabled={isInvalid}
            onClick={handleConfirm}
            className={`px-5 py-2.5 rounded font-bold text-xs uppercase tracking-wider transition ${
              isInvalid
                ? 'bg-slate-800 border border-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-emerald-500 hover:bg-emerald-400 text-black cursor-pointer shadow-lg shadow-emerald-950/50'
            }`}
          >
            🏁 FONDA SCUDERIA
          </button>
        </div>
      </div>
    </div>
  );
}
