export interface CombatConfig {
  durationMs: number;
  heroTalentId: string;
  seed: number;
  specializationId: string;
}

export interface CombatEngineInfo {
  id: string;
  name: string;
  version: string;
  supportedSpecializationIds: readonly string[];
}

export type CastResult =
  | { status: 'executed' }
  | { status: 'queued'; executeAtMs: number }
  | { status: 'rejected'; reason: string };

export interface CombatResourceState {
  current: number;
  gained?: number;
  max: number;
  overflowed?: number;
  segments?: readonly number[];
}

export interface CombatAuraState {
  spellId: number;
  name: string;
  stacks: number;
  maxStacks?: number;
  remainingMs: number;
}

export interface CombatChargeState {
  current: number;
  max: number;
}

export interface CombatAbilityMetadata {
  id: string;
  spellId: number;
  name: string;
  description: string;
  resourceCosts: Readonly<Record<string, number>>;
}

export interface CombatMetadata {
  abilities: readonly CombatAbilityMetadata[];
}

export interface CombatState {
  timeMs: number;
  damage: { total: number; dps: number };
  resources: Record<string, CombatResourceState>;
  gcdRemainingMs: number;
  buffs: Record<string, CombatAuraState>;
  debuffs: Record<string, CombatAuraState>;
  dots: Record<string, number>;
  refreshableDots?: Record<string, boolean>;
  cooldowns: Record<string, number>;
  charges: Record<string, CombatChargeState>;
  resourceAffordability?: Readonly<Record<string, boolean>>;
  abilityReadiness?: Readonly<Record<string, boolean>>;
}
