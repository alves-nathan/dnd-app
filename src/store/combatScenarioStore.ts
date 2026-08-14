import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CombatScenario, CombatState, TacticalTarget } from '../types';
import { characterStorage } from '../storage/characterStorage';
import { createCombatScenario } from '../rules-engine/turns/compareRotations';
import { createId } from '../utils/id';
import {
  advanceScenarioToNextSourceTurn,
  clearTargetCondition,
  consumeTargetAttack,
  createTacticalTarget,
  normalizeCombatScenario
} from '../rules-engine/turns/tacticalCombat';

interface CombatScenarioStore {
  scenarios: CombatScenario[];
  ensureDefaultScenario: (characterId: string) => CombatScenario;
  addScenario: (params: {
    characterId: string;
    name: string;
    combatState: Partial<CombatState>;
    notes?: string;
    favorite?: boolean;
  }) => CombatScenario;
  updateScenario: (id: string, updater: (scenario: CombatScenario) => CombatScenario) => void;
  removeScenario: (id: string) => void;
  removeCharacterScenarios: (characterId: string) => void;
  setScenarios: (scenarios: CombatScenario[]) => void;
  addTarget: (scenarioId: string, target?: Partial<TacticalTarget>) => TacticalTarget | undefined;
  updateTarget: (scenarioId: string, targetId: string, updater: (target: TacticalTarget) => TacticalTarget) => void;
  removeTarget: (scenarioId: string, targetId: string) => void;
  advanceRound: (scenarioId: string) => void;
  consumeTargetAttack: (scenarioId: string, targetId: string) => void;
  clearTargetCondition: (scenarioId: string, targetId: string, condition: string) => void;
}

const defaultScenarioForCharacter = (characterId: string): CombatScenario =>
  normalizeCombatScenario(createCombatScenario({
    id: createId('scenario'),
    characterId,
    name: 'Alvo padrão',
    favorite: true,
    combatState: {
      rollMode: 'normal',
      targetCount: 1,
      resistanceMultiplier: 1,
      critRange: 20,
      targetAC: 15,
      targetDistanceFeet: 5,
      targetSize: 'Medium',
      cover: 'none',
      lineOfSight: true
    },
    notes: 'Cenário padrão com alvo persistente. Ajuste posição, Speed, cobertura e condições na central tática.'
  }));

const normalizeScenarios = (value: unknown): CombatScenario[] =>
  Array.isArray(value) ? value.map((scenario) => normalizeCombatScenario(scenario as CombatScenario)) : [];

export const useCombatScenarioStore = create<CombatScenarioStore>()(
  persist(
    (set, get) => ({
      scenarios: [],
      ensureDefaultScenario: (characterId) => {
        const existing = get().scenarios.find((scenario) => scenario.characterId === characterId);
        if (existing) return normalizeCombatScenario(existing);
        const scenario = defaultScenarioForCharacter(characterId);
        set({ scenarios: [...get().scenarios, scenario] });
        return scenario;
      },
      addScenario: (params) => {
        const scenario = normalizeCombatScenario(createCombatScenario({
          id: createId('scenario'),
          characterId: params.characterId,
          name: params.name,
          combatState: params.combatState,
          favorite: params.favorite,
          notes: params.notes
        }));
        set({ scenarios: [...get().scenarios, scenario] });
        return scenario;
      },
      updateScenario: (id, updater) => {
        set({
          scenarios: get().scenarios.map((scenario) =>
            scenario.id === id ? normalizeCombatScenario({ ...updater(normalizeCombatScenario(scenario)), updatedAt: new Date().toISOString() }) : scenario
          )
        });
      },
      removeScenario: (id) => {
        set({ scenarios: get().scenarios.filter((scenario) => scenario.id !== id) });
      },
      removeCharacterScenarios: (characterId) => {
        set({ scenarios: get().scenarios.filter((scenario) => scenario.characterId !== characterId) });
      },
      setScenarios: (scenarios) => set({ scenarios: normalizeScenarios(scenarios) }),
      addTarget: (scenarioId, target) => {
        const scenario = get().scenarios.find((entry) => entry.id === scenarioId);
        if (!scenario) return undefined;
        const created = createTacticalTarget(target);
        get().updateScenario(scenarioId, (current) => ({ ...current, targets: [...(current.targets ?? []), created] }));
        return created;
      },
      updateTarget: (scenarioId, targetId, updater) => {
        get().updateScenario(scenarioId, (scenario) => ({
          ...scenario,
          targets: (scenario.targets ?? []).map((target) => target.id === targetId ? createTacticalTarget(updater(target)) : target)
        }));
      },
      removeTarget: (scenarioId, targetId) => {
        get().updateScenario(scenarioId, (scenario) => {
          const targets = (scenario.targets ?? []).filter((target) => target.id !== targetId);
          return { ...scenario, targets: targets.length ? targets : [createTacticalTarget({ name: 'Alvo principal' })] };
        });
      },
      advanceRound: (scenarioId) => {
        get().updateScenario(scenarioId, advanceScenarioToNextSourceTurn);
      },
      consumeTargetAttack: (scenarioId, targetId) => {
        get().updateScenario(scenarioId, (scenario) => consumeTargetAttack(scenario, targetId));
      },
      clearTargetCondition: (scenarioId, targetId, condition) => {
        get().updateScenario(scenarioId, (scenario) => clearTargetCondition(scenario, targetId, condition));
      }
    }),
    {
      name: 'dnd-combat-math-combat-scenarios',
      storage: createJSONStorage(() => characterStorage),
      version: 5,
      migrate: (persisted) => {
        const state = persisted && typeof persisted === 'object' ? persisted as { scenarios?: unknown } : {};
        return { ...state, scenarios: normalizeScenarios(state.scenarios) };
      }
    }
  )
);
