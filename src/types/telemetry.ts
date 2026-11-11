export type TrackSegmentType = 'STRAIGHT' | 'CORNER_SLOW' | 'CORNER_FAST';
export type TyreCompound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTER' | 'WET';
export type PaceMode = 1 | 2 | 3 | 4 | 5;
export type FuelMode = 'LIFT_COAST' | 'STANDARD' | 'RICH';
export type ErsMode = 'HARVEST' | 'NEUTRAL' | 'DEPLOY' | 'OVERTAKE';
export type TeamOrderMode = 'NONE' | 'HOLD_POSITION' | 'SWAP_POSITIONS';
export type RaceDistancePreset = 'SPRINT_25' | 'STANDARD_50' | 'FULL_100';
export type WeatherCondition = 'DRY' | 'LIGHT_RAIN' | 'HEAVY_RAIN';
export type RaceControlStatus = 'GREEN' | 'YELLOW' | 'SAFETY_CAR';
export type SectorColor = 'PURPLE' | 'GREEN' | 'YELLOW' | 'NONE';

export type ComponentKey =
  | 'powerUnit'
  | 'frontWing'
  | 'rearWing'
  | 'floor'
  | 'suspension'
  | 'brakes';

export interface ComponentSpec {
  performance: number; // 0 - 100
  reliability: number; // 0 - 100
}

export type CarComponents = Record<ComponentKey, ComponentSpec>;

export interface TeamFacilities {
  factory: number;    // 1 - 5 (Slot R&D paralleli e velocità produzione)
  windTunnel: number; // 1 - 5 (Bonus guadagno R&D aerodinamico)
  simulator: number;  // 1 - 5 (Riduzione incertezza setup FP1 e crescita piloti)
}

export interface TrackSegment {
  name: string;
  startMeter: number;
  endMeter: number;
  type: TrackSegmentType;
  referenceSpeedMs: number;
  abrasionFactor: number;
  overtakeDifficulty: number;
  isDrsZone: boolean;
}

export interface TrackPoint2D {
  distanceMeters: number;
  x: number;
  y: number;
}

export interface TrackData {
  id: string;
  grandPrixName: string;
  name: string;
  region: string;
  totalLaps: number;
  lengthMeters: number;
  pitLaneTimeLossSec: number;
  drsDetectionMeters: number;
  baseRainChance: number;
  ambientTempCelsius: number;
  idealSetup: [number, number, number, number, number];
  segments: TrackSegment[];
  path2D: TrackPoint2D[];
}

export interface Team {
  id: string;
  name: string;
  nationality: string;
  colorHex: string;
  accentHex: string;
  tier: 1 | 2 | 3 | 4 | 5;
  budgetMillions: number;
  components: CarComponents;
  facilities: TeamFacilities;
  power: number;
  downforce: number;
  mechanicalGrip: number;
  aeroEfficiency: number;
  overallReliability: number;
}

export type DriverRole = 'PRIMARY' | 'SECONDARY' | 'RESERVE' | 'FREE_AGENT';

export interface Driver {
  id: string;
  code: string;
  name: string;
  nationality: string;
  teamId: string | null;
  role: DriverRole;
  number: number;
  age: number;
  pace: number;
  consistency: number;
  smoothness: number;
  overtaking: number;
  defense: number;
  wetSkill: number;
  salaryPerRaceMillions: number;
  contractYearsLeft: number;
  buyoutMillions: number;
}

export interface CarRaceState {
  carId: string;
  driverId: string;
  driverCode: string;
  driverName: string;
  driverNumber: number;
  isSecondaryDriver: boolean;
  teamId: string;
  teamName: string;
  teamColor: string;
  teamAccent: string;
  position: number;

  currentLap: number;
  distanceOnLapMeters: number;
  totalDistanceMeters: number;
  currentSpeedMs: number;
  gapToLeaderSec: number;
  gapToAheadSec: number;
  lastLapTimeSec: number | null;
  bestLapTimeSec: number | null;
  currentLapStartTimeSec: number;

  currentSectorIndex: 0 | 1 | 2;
  sectorStartTimeSec: number;
  sectorTimesSec: [number | null, number | null, number | null];
  bestSectorTimesSec: [number | null, number | null, number | null];
  sectorColors: [SectorColor, SectorColor, SectorColor];

  tyreCompound: TyreCompound;
  tyreWear: number;
  tyreAgeLaps: number;
  tyreTempCelsius: number;
  usedDryCompounds: TyreCompound[];
  usedWetCompounds: boolean;
  isDisqualified: boolean;

  frontWingDamage: number;
  repairDamageOnStop: boolean;
  isRetired: boolean;
  retirementReason: string | null;

  fuelKg: number;
  ersBatteryPercent: number;
  isDrsActive: boolean;
  hasDrsAvailable: boolean;
  isSideBySide: boolean;
  isInPitLane: boolean;
  pitStopTimerSec: number;
  stopsCompleted: number;

  paceMode: PaceMode;
  fuelMode: FuelMode;
  ersMode: ErsMode;
  teamOrder: TeamOrderMode;
  pitBoxRequested: boolean;
  nextTyreCompound: TyreCompound;
  setupConfidence: number;

  lapHistory: number[];
  positionHistory: number[];
}

export type SponsorObjectiveType =
  | 'FINISH_TOP_10'
  | 'REACH_Q3'
  | 'BOTH_FINISH'
  | 'PODIUM'
  | 'FASTEST_LAP'
  | 'TOP_6';

export interface SponsorDeal {
  id: string;
  name: string;
  tagline: string;
  type: 'MAIN' | 'SECONDARY';
  minTierAllowed: 1 | 2 | 3 | 4 | 5;
  basePayoutPerRaceMillions: number;
  objectiveDescription: string;
  objectiveType: SponsorObjectiveType;
  bonusMillions: number;
}

export interface RdProject {
  id: string;
  component: ComponentKey;
  focus: 'PERFORMANCE' | 'RELIABILITY';
  gainAmount: number;
  daysRemaining: number;
  totalDays: number;
  costMillions: number;
}

export interface FacilityUpgradeProject {
  facility: 'factory' | 'windTunnel' | 'simulator';
  targetLevel: number;
  daysRemaining: number;
  totalDays: number;
  costMillions: number;
}

export interface InboxMessage {
  id: string;
  day: number;
  season: number;
  title: string;
  body: string;
  category: 'RD' | 'FINANCE' | 'CONTRACT' | 'RACE' | 'FIA';
  read: boolean;
}

export interface GameDatabase {
  version: string;
  seriesName: string;
  teams: Team[];
  drivers: Driver[];
  tracks: TrackData[];
  sponsors: SponsorDeal[];
}
