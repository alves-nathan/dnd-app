import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ActiveEffect, Character, CharacterProgressionAuditEntry, CharacterProgressionOperation, CharacterProgressionTransactionKind, ResourcePool, RestType, SpellSlotLevel, SpellSlotPool, TurnRotation } from '../types';
import { createEmptyCharacter } from '../data/mockData';
import { characterStorage } from '../storage/characterStorage';
import { CHARACTER_STORE_VERSION, ensureCharacterCollections, migrateCharacterStoreState } from '../storage/characterMigrations';
import {
  adjustResource,
  applyRest as applyResourceRest,
  checkRotationResources,
  normalizeResource,
  spendRotationResources as spendOnlyRotationResources
} from '../rules-engine/resources/resourceManager';
import {
  adjustSpellSlot,
  applySpellSlotRest,
  checkRotationSpellSlots,
  normalizeSpellSlotPool,
  spellSlotPoolKey,
  spendRotationSpellSlots
} from '../rules-engine/resources/spellSlotManager';
import { restoreHitDiceOnRest } from '../characters/hitDiceRules';
import { checkRotationAmmunition, spendRotationAmmunition } from '../characters/ammunitionRules';
import {
  advanceGazeOfTwoMindsTurn,
  breakOneWithShadowsForRotation,
  restoreGiftOfProtectorsOnRest
} from '../characters/warlockSpecializedInvocations';
import {
  CharacterProgressionCommitResult,
  CharacterProgressionDraft,
  characterProgressionFingerprint,
  commitProgressionDraft,
  createProgressionDraft,
  rollbackProgressionAudit,
  updateProgressionDraft as updateProgressionDraftState
} from '../characters/progressionTransaction';
import {
  acknowledgeRecoveredProgressionDraft,
  emptyProgressionRecoverySummary,
  reconcileProgressionRecovery as reconcileProgressionRecoveryState,
  type CharacterProgressionRecoverySummary
} from '../characters/progressionRecovery';
import type { CharacterCompatibilityRemediationPlan, CompatibilityRemediationPreview } from '../characters/compatibilityRemediation';
import {
  acknowledgeCompatibilityRemediationRecovery as acknowledgeCompatibilityRemediationRecoveryState,
  clearCompatibilityRemediationRecoveryForCharacter,
  emptyCompatibilityRemediationRecoverySummary,
  reconcileCompatibilityRemediationRecovery as reconcileCompatibilityRemediationRecoveryState,
  type CompatibilityRemediationQuarantineEntry,
  type CompatibilityRemediationRecoverySummary
} from '../characters/compatibilityRemediationRecovery';
import {
  addActiveEffectToCharacter,
  advanceActiveEffects,
  clearConcentration as clearCharacterConcentration,
  normalizeActiveEffect,
  removeActiveEffectFromCharacter
} from '../rules-engine/effects/activeEffects';

export interface CharacterStore {
  characters: Character[];
  progressionDrafts: Record<string, CharacterProgressionDraft>;
  progressionRecovery: CharacterProgressionRecoverySummary;
  compatibilityRemediationPlans: Record<string, CharacterCompatibilityRemediationPlan>;
  compatibilityRemediationRecovery: CompatibilityRemediationRecoverySummary;
  compatibilityRemediationQuarantine: Record<string, CompatibilityRemediationQuarantineEntry>;
  addCharacter: (name?: string) => Character;
  updateCharacter: (id: string, updater: (character: Character) => Character) => void;
  beginProgressionTransaction: (characterId: string, workingCharacter: Character, options?: {
    replaceExisting?: boolean;
    kind?: CharacterProgressionTransactionKind;
    targetCatalogSnapshotId?: string;
    migrationApproved?: boolean;
    operations?: CharacterProgressionOperation[];
  }) => CharacterProgressionDraft | undefined;
  updateProgressionDraft: (characterId: string, updater: (character: Character) => Character, operation?: CharacterProgressionOperation) => void;
  reconcileProgressionRecovery: (error?: unknown) => CharacterProgressionRecoverySummary;
  acknowledgeProgressionRecovery: (characterId: string) => boolean;
  dismissProgressionRecoveryIssue: (issueId: string) => boolean;
  discardProgressionTransaction: (characterId: string) => boolean;
  commitProgressionTransaction: (characterId: string) => CharacterProgressionCommitResult | undefined;
  rollbackProgressionTransaction: (characterId: string, transactionId: string) => CharacterProgressionAuditEntry | undefined;
  saveCompatibilityRemediationPlan: (plan: CharacterCompatibilityRemediationPlan) => void;
  reconcileCompatibilityRemediationRecovery: (currentCatalogSnapshotId?: string, markRecovered?: boolean) => CompatibilityRemediationRecoverySummary;
  acknowledgeCompatibilityRemediationPlan: (characterId: string) => boolean;
  dismissCompatibilityRemediationQuarantine: (quarantineId: string) => boolean;
  discardCompatibilityRemediationPlan: (characterId: string) => boolean;
  commitCompatibilityRemediationPlan: (characterId: string, preview: CompatibilityRemediationPreview) => CharacterProgressionCommitResult | undefined;
  removeCharacter: (id: string) => void;
  addRotation: (characterId: string, rotation: TurnRotation) => void;
  setCharacters: (characters: Character[]) => void;
  addResource: (characterId: string, resource: ResourcePool) => void;
  updateResource: (characterId: string, resourceId: string, updater: (resource: ResourcePool) => ResourcePool) => void;
  removeResource: (characterId: string, resourceId: string) => void;
  spendResource: (characterId: string, resourceId: string, amount?: number, reason?: string) => void;
  recoverResource: (characterId: string, resourceId: string, amount?: number, reason?: string) => void;
  addOrUpdateSpellSlot: (characterId: string, slot: SpellSlotPool) => void;
  updateSpellSlot: (characterId: string, slotLevel: SpellSlotLevel, updater: (slot: SpellSlotPool) => SpellSlotPool, selector?: Pick<SpellSlotPool, 'poolKind' | 'sourceClassId'>) => void;
  removeSpellSlot: (characterId: string, slotLevel: SpellSlotLevel, selector?: Pick<SpellSlotPool, 'poolKind' | 'sourceClassId'>) => void;
  spendSpellSlot: (characterId: string, slotLevel: SpellSlotLevel, amount?: number, reason?: string, selector?: Pick<SpellSlotPool, 'poolKind' | 'sourceClassId'>) => void;
  recoverSpellSlot: (characterId: string, slotLevel: SpellSlotLevel, amount?: number, reason?: string, selector?: Pick<SpellSlotPool, 'poolKind' | 'sourceClassId'>) => void;
  spendRotationResources: (characterId: string, rotationId: string) => void;
  addActiveEffect: (characterId: string, effect: ActiveEffect) => void;
  updateActiveEffect: (characterId: string, effectId: string, updater: (effect: ActiveEffect) => ActiveEffect) => void;
  removeActiveEffect: (characterId: string, effectId: string, reason?: string) => void;
  advanceEffects: (characterId: string, restType: RestType) => void;
  clearConcentration: (characterId: string, reason?: string) => void;
  applyRest: (characterId: string, restType: RestType) => void;
}


export const useCharacterStore = create<CharacterStore>()(
  persist(
    (set, get) => ({
      characters: [],
      progressionDrafts: {},
      progressionRecovery: emptyProgressionRecoverySummary(),
      compatibilityRemediationPlans: {},
      compatibilityRemediationRecovery: emptyCompatibilityRemediationRecoverySummary(),
      compatibilityRemediationQuarantine: {},
      addCharacter: (name?: string) => {
        const character = ensureCharacterCollections(createEmptyCharacter(name));
        set({ characters: [...get().characters, character] });
        return character;
      },
      updateCharacter: (id, updater) => {
        set({ characters: get().characters.map((character) => (character.id === id ? ensureCharacterCollections(updater(ensureCharacterCollections(character))) : character)) });
      },
      beginProgressionTransaction: (characterId, workingCharacter, options) => {
        const existing = get().progressionDrafts[characterId];
        if (existing && !options?.replaceExisting) return existing;
        const character = get().characters.find((entry) => entry.id === characterId);
        if (!character) return undefined;
        const draft = createProgressionDraft({
          character: ensureCharacterCollections(character),
          workingCharacter: ensureCharacterCollections(workingCharacter),
          kind: options?.kind ?? 'combined',
          targetCatalogSnapshotId: options?.targetCatalogSnapshotId,
          migrationApproved: options?.migrationApproved,
          operations: options?.operations
        });
        set({
          progressionDrafts: { ...get().progressionDrafts, [characterId]: draft },
          progressionRecovery: {
            ...get().progressionRecovery,
            recoverableCharacterIds: get().progressionRecovery.recoverableCharacterIds.filter((id) => id !== characterId),
            conflictedCharacterIds: get().progressionRecovery.conflictedCharacterIds.filter((id) => id !== characterId)
          }
        });
        return draft;
      },
      reconcileProgressionRecovery: (error) => {
        if (error) {
          const summary: CharacterProgressionRecoverySummary = {
            hydrated: true,
            reconciledAt: new Date().toISOString(),
            recoverableCharacterIds: [],
            conflictedCharacterIds: [],
            issues: [],
            error: error instanceof Error ? error.message : String(error)
          };
          set({ progressionRecovery: summary });
          return summary;
        }
        const result = reconcileProgressionRecoveryState(
          get().characters,
          get().progressionDrafts as unknown as Record<string, unknown>,
          get().progressionRecovery.issues
        );
        set({ progressionDrafts: result.drafts, progressionRecovery: result.summary });
        return result.summary;
      },
      acknowledgeProgressionRecovery: (characterId) => {
        const draft = get().progressionDrafts[characterId];
        if (!draft || draft.recovery.status !== 'recoverable') return false;
        const next = acknowledgeRecoveredProgressionDraft(draft);
        set({
          progressionDrafts: { ...get().progressionDrafts, [characterId]: next },
          progressionRecovery: {
            ...get().progressionRecovery,
            recoverableCharacterIds: get().progressionRecovery.recoverableCharacterIds.filter((id) => id !== characterId)
          }
        });
        return true;
      },
      dismissProgressionRecoveryIssue: (issueId) => {
        const issues = get().progressionRecovery.issues;
        if (!issues.some((issue) => issue.id === issueId)) return false;
        set({ progressionRecovery: { ...get().progressionRecovery, issues: issues.filter((issue) => issue.id !== issueId) } });
        return true;
      },
      updateProgressionDraft: (characterId, updater, operation) => {
        const draft = get().progressionDrafts[characterId];
        if (!draft || draft.recovery.status !== 'active') return;
        const nextDraft = updateProgressionDraftState(draft, (character) => ensureCharacterCollections(updater(ensureCharacterCollections(character))), operation);
        set({ progressionDrafts: { ...get().progressionDrafts, [characterId]: nextDraft } });
      },
      discardProgressionTransaction: (characterId) => {
        if (!get().progressionDrafts[characterId]) return false;
        const { [characterId]: _removed, ...rest } = get().progressionDrafts;
        set({
          progressionDrafts: rest,
          progressionRecovery: {
            ...get().progressionRecovery,
            recoverableCharacterIds: get().progressionRecovery.recoverableCharacterIds.filter((id) => id !== characterId),
            conflictedCharacterIds: get().progressionRecovery.conflictedCharacterIds.filter((id) => id !== characterId)
          }
        });
        return true;
      },
      commitProgressionTransaction: (characterId) => {
        let output: CharacterProgressionCommitResult | undefined;
        set((state) => {
          const draft = state.progressionDrafts[characterId];
          const current = state.characters.find((entry) => entry.id === characterId);
          if (!draft || !current) return state;
          output = commitProgressionDraft(ensureCharacterCollections(current), draft);
          if (!output.ok) {
            return {
              ...state,
              progressionDrafts: {
                ...state.progressionDrafts,
                [characterId]: output.preview.draft
              }
            };
          }
          const { [characterId]: _removed, ...rest } = state.progressionDrafts;
          return {
            ...state,
            characters: state.characters.map((entry) => entry.id === characterId ? ensureCharacterCollections(output!.character) : entry),
            progressionDrafts: rest
          };
        });
        return output;
      },
      rollbackProgressionTransaction: (characterId, transactionId) => {
        let audit: CharacterProgressionAuditEntry | undefined;
        set((state) => {
          const current = state.characters.find((entry) => entry.id === characterId);
          const history = current?.progressionTransactions ?? [];
          const rolledBackIds = new Set(history.filter((entry) => entry.status === 'rolledBack').map((entry) => entry.rolledBackTransactionId).filter(Boolean));
          const latestCommitted = [...history].reverse().find((entry) => entry.status === 'committed' && !rolledBackIds.has(entry.transactionId));
          const target = latestCommitted?.transactionId === transactionId ? latestCommitted : undefined;
          if (!current || !target || state.progressionDrafts[characterId] || state.compatibilityRemediationPlans[characterId]) return state;
          if (characterProgressionFingerprint(current) !== characterProgressionFingerprint(target.after as Character)) return state;
          const result = rollbackProgressionAudit(ensureCharacterCollections(current), target);
          audit = result.auditEntry;
          return {
            ...state,
            characters: state.characters.map((entry) => entry.id === characterId ? ensureCharacterCollections(result.character) : entry)
          };
        });
        return audit;
      },
      saveCompatibilityRemediationPlan: (plan) => {
        set({
          compatibilityRemediationPlans: { ...get().compatibilityRemediationPlans, [plan.characterId]: plan },
          compatibilityRemediationRecovery: clearCompatibilityRemediationRecoveryForCharacter(get().compatibilityRemediationRecovery, plan.characterId)
        });
      },
      reconcileCompatibilityRemediationRecovery: (currentCatalogSnapshotId, markRecovered = false) => {
        const state = get();
        const result = reconcileCompatibilityRemediationRecoveryState({
          characters: state.characters,
          plans: state.compatibilityRemediationPlans,
          quarantine: state.compatibilityRemediationQuarantine,
          previousSummary: state.compatibilityRemediationRecovery,
          currentCatalogSnapshotId,
          markRecovered
        });
        set({
          compatibilityRemediationPlans: result.plans,
          compatibilityRemediationQuarantine: result.quarantine,
          compatibilityRemediationRecovery: result.summary
        });
        return result.summary;
      },
      acknowledgeCompatibilityRemediationPlan: (characterId) => {
        const state = get();
        if (!state.compatibilityRemediationPlans[characterId]) return false;
        if (state.compatibilityRemediationRecovery.conflictedCharacterIds.includes(characterId)) return false;
        if (state.compatibilityRemediationRecovery.staleCatalogCharacterIds.includes(characterId)) return false;
        if (!state.compatibilityRemediationRecovery.pendingAcknowledgementCharacterIds.includes(characterId)) return true;
        set({ compatibilityRemediationRecovery: acknowledgeCompatibilityRemediationRecoveryState(state.compatibilityRemediationRecovery, characterId) });
        return true;
      },
      dismissCompatibilityRemediationQuarantine: (quarantineId) => {
        const state = get();
        const removed = state.compatibilityRemediationQuarantine[quarantineId];
        if (!removed) return false;
        const { [quarantineId]: _removed, ...rest } = state.compatibilityRemediationQuarantine;
        set({
          compatibilityRemediationQuarantine: rest,
          compatibilityRemediationRecovery: {
            ...state.compatibilityRemediationRecovery,
            quarantinedPlanIds: state.compatibilityRemediationRecovery.quarantinedPlanIds.filter((id) => id !== quarantineId),
            issues: state.compatibilityRemediationRecovery.issues.filter((issue) => {
              if (issue.id === quarantineId) return false;
              if (removed.planId && issue.planId === removed.planId) return false;
              return !(removed.reason === 'invalid' && issue.status === 'invalid' && issue.characterId === removed.characterId);
            })
          }
        });
        return true;
      },
      discardCompatibilityRemediationPlan: (characterId) => {
        if (!get().compatibilityRemediationPlans[characterId]) return false;
        const { [characterId]: _removed, ...rest } = get().compatibilityRemediationPlans;
        set({
          compatibilityRemediationPlans: rest,
          compatibilityRemediationRecovery: clearCompatibilityRemediationRecoveryForCharacter(get().compatibilityRemediationRecovery, characterId)
        });
        return true;
      },
      commitCompatibilityRemediationPlan: (characterId, preview) => {
        let output: CharacterProgressionCommitResult | undefined;
        set((state) => {
          const current = state.characters.find((entry) => entry.id === characterId);
          const persistedPlan = state.compatibilityRemediationPlans[characterId];
          if (!current || !persistedPlan || !preview.ok || preview.plan.id !== persistedPlan.id) return state;
          if (state.compatibilityRemediationRecovery.pendingAcknowledgementCharacterIds.includes(characterId)) return state;
          if (state.compatibilityRemediationRecovery.conflictedCharacterIds.includes(characterId)) return state;
          if (state.compatibilityRemediationRecovery.staleCatalogCharacterIds.includes(characterId)) return state;
          if (characterProgressionFingerprint(current) !== persistedPlan.baseFingerprint) return state;
          const draft = createProgressionDraft({
            character: ensureCharacterCollections(current),
            workingCharacter: ensureCharacterCollections(preview.projectedCharacter),
            kind: 'compatibilityRemediation',
            targetCatalogSnapshotId: preview.plan.targetCatalogSnapshotId,
            migrationApproved: true,
            operations: preview.operations
          });
          output = commitProgressionDraft(ensureCharacterCollections(current), draft);
          if (!output.ok) return state;
          const { [characterId]: _removedPlan, ...remainingPlans } = state.compatibilityRemediationPlans;
          return {
            ...state,
            characters: state.characters.map((entry) => entry.id === characterId ? ensureCharacterCollections(output!.character) : entry),
            compatibilityRemediationPlans: remainingPlans,
            compatibilityRemediationRecovery: clearCompatibilityRemediationRecoveryForCharacter(state.compatibilityRemediationRecovery, characterId)
          };
        });
        return output;
      },
      removeCharacter: (id) => {
        set((state) => {
          const { [id]: _removedDraft, ...progressionDrafts } = state.progressionDrafts;
          const { [id]: _removedPlan, ...compatibilityRemediationPlans } = state.compatibilityRemediationPlans;
          const compatibilityRemediationQuarantine = Object.fromEntries(
            Object.entries(state.compatibilityRemediationQuarantine).filter(([, entry]) => entry.characterId !== id)
          );
          const remainingQuarantineIds = new Set(Object.keys(compatibilityRemediationQuarantine));
          const compatibilityRecovery = clearCompatibilityRemediationRecoveryForCharacter(state.compatibilityRemediationRecovery, id);
          return {
            ...state,
            characters: state.characters.filter((character) => character.id !== id),
            progressionDrafts,
            compatibilityRemediationPlans,
            compatibilityRemediationQuarantine,
            compatibilityRemediationRecovery: {
              ...compatibilityRecovery,
              quarantinedPlanIds: compatibilityRecovery.quarantinedPlanIds.filter((quarantineId) => remainingQuarantineIds.has(quarantineId)),
              issues: compatibilityRecovery.issues.filter((entry) => entry.characterId !== id)
            },
            progressionRecovery: {
              ...state.progressionRecovery,
              recoverableCharacterIds: state.progressionRecovery.recoverableCharacterIds.filter((characterId) => characterId !== id),
              conflictedCharacterIds: state.progressionRecovery.conflictedCharacterIds.filter((characterId) => characterId !== id),
              issues: state.progressionRecovery.issues.filter((entry) => entry.characterId !== id)
            }
          };
        });
      },
      addRotation: (characterId, rotation) => {
        get().updateCharacter(characterId, (character) => ({ ...character, rotations: [...character.rotations, rotation] }));
      },
      setCharacters: (characters) => {
        const normalized = characters.map(ensureCharacterCollections);
        const ids = new Set(normalized.map((character) => character.id));
        const retainedDrafts = Object.fromEntries(Object.entries(get().progressionDrafts).filter(([characterId]) => ids.has(characterId)));
        const retainedRemediationPlans = Object.fromEntries(Object.entries(get().compatibilityRemediationPlans).filter(([characterId]) => ids.has(characterId)));
        const recovery = reconcileProgressionRecoveryState(normalized, retainedDrafts, []);
        const remediationRecovery = reconcileCompatibilityRemediationRecoveryState({
          characters: normalized,
          plans: retainedRemediationPlans,
          quarantine: get().compatibilityRemediationQuarantine,
          previousSummary: get().compatibilityRemediationRecovery,
          currentCatalogSnapshotId: get().compatibilityRemediationRecovery.currentCatalogSnapshotId
        });
        set({
          characters: normalized,
          progressionDrafts: recovery.drafts,
          compatibilityRemediationPlans: remediationRecovery.plans,
          compatibilityRemediationRecovery: remediationRecovery.summary,
          compatibilityRemediationQuarantine: remediationRecovery.quarantine,
          progressionRecovery: recovery.summary
        });
      },
      addResource: (characterId, resource) => {
        get().updateCharacter(characterId, (character) => ({
          ...character,
          resources: [...character.resources, normalizeResource(resource)]
        }));
      },
      updateResource: (characterId, resourceId, updater) => {
        get().updateCharacter(characterId, (character) => ({
          ...character,
          resources: character.resources.map((resource) => (resource.id === resourceId ? normalizeResource(updater(resource)) : resource))
        }));
      },
      removeResource: (characterId, resourceId) => {
        get().updateCharacter(characterId, (character) => ({
          ...character,
          resources: character.resources.filter((resource) => resource.id !== resourceId)
        }));
      },
      spendResource: (characterId, resourceId, amount = 1, reason = 'Gasto manual') => {
        get().updateCharacter(characterId, (character) => adjustResource({ character, resourceId, delta: -Math.abs(amount), reason }).character);
      },
      recoverResource: (characterId, resourceId, amount = 1, reason = 'Recuperação manual') => {
        get().updateCharacter(characterId, (character) => adjustResource({ character, resourceId, delta: Math.abs(amount), reason }).character);
      },
      addOrUpdateSpellSlot: (characterId, slot) => {
        get().updateCharacter(characterId, (character) => {
          const normalized = normalizeSpellSlotPool(slot);
          const key = spellSlotPoolKey(normalized);
          const existing = character.spellSlots.some((entry) => spellSlotPoolKey(normalizeSpellSlotPool(entry)) === key);
          return {
            ...character,
            spellSlots: existing
              ? character.spellSlots.map((entry) => spellSlotPoolKey(normalizeSpellSlotPool(entry)) === key ? normalized : entry)
              : [...character.spellSlots, normalized].sort((left, right) => left.level - right.level || spellSlotPoolKey(left).localeCompare(spellSlotPoolKey(right)))
          };
        });
      },
      updateSpellSlot: (characterId, slotLevel, updater, selector) => {
        get().updateCharacter(characterId, (character) => {
          let updated = false;
          return {
            ...character,
            spellSlots: character.spellSlots.map((slot) => {
              const matches = slot.level === slotLevel && (!selector?.poolKind || (slot.poolKind ?? 'manual') === selector.poolKind) && (!selector?.sourceClassId || slot.sourceClassId === selector.sourceClassId);
              if (!matches || updated) return slot;
              updated = true;
              return normalizeSpellSlotPool(updater(slot));
            })
          };
        });
      },
      removeSpellSlot: (characterId, slotLevel, selector) => {
        get().updateCharacter(characterId, (character) => {
          let removed = false;
          return {
            ...character,
            spellSlots: character.spellSlots.filter((slot) => {
              const matches = slot.level === slotLevel && (!selector?.poolKind || (slot.poolKind ?? 'manual') === selector.poolKind) && (!selector?.sourceClassId || slot.sourceClassId === selector.sourceClassId);
              if (!matches || removed) return true;
              removed = true;
              return false;
            })
          };
        });
      },
      spendSpellSlot: (characterId, slotLevel, amount = 1, reason = 'Gasto manual de slot', selector) => {
        get().updateCharacter(characterId, (character) => adjustSpellSlot({ character, slotLevel, delta: -Math.abs(amount), reason, poolKind: selector?.poolKind, sourceClassId: selector?.sourceClassId }).character);
      },
      recoverSpellSlot: (characterId, slotLevel, amount = 1, reason = 'Recuperação manual de slot', selector) => {
        get().updateCharacter(characterId, (character) => adjustSpellSlot({ character, slotLevel, delta: Math.abs(amount), reason, poolKind: selector?.poolKind, sourceClassId: selector?.sourceClassId }).character);
      },
      spendRotationResources: (characterId, rotationId) => {
        get().updateCharacter(characterId, (character) => {
          const rotation = character.rotations.find((item) => item.id === rotationId);
          if (!rotation) return character;
          const resourceAvailability = checkRotationResources(rotation, character);
          const slotAvailability = checkRotationSpellSlots(rotation, character);
          const ammunitionAvailability = checkRotationAmmunition(rotation, character);
          if (!resourceAvailability.ok || !slotAvailability.ok || !ammunitionAvailability.ok) return character;
          const resourceResult = spendOnlyRotationResources(character, rotation);
          const slotResult = spendRotationSpellSlots(resourceResult.character, rotation).character;
          const ammunitionResult = spendRotationAmmunition(slotResult, rotation);
          return breakOneWithShadowsForRotation(ammunitionResult, rotation);
        });
      },
      addActiveEffect: (characterId, effect) => {
        get().updateCharacter(characterId, (character) => addActiveEffectToCharacter(character, effect));
      },
      updateActiveEffect: (characterId, effectId, updater) => {
        get().updateCharacter(characterId, (character) => ({
          ...character,
          activeEffects: character.activeEffects.map((effect) => (effect.id === effectId ? normalizeActiveEffect(updater(effect)) : effect))
        }));
      },
      removeActiveEffect: (characterId, effectId, reason = 'Efeito removido manualmente') => {
        get().updateCharacter(characterId, (character) => removeActiveEffectFromCharacter(character, effectId, reason));
      },
      advanceEffects: (characterId, restType) => {
        get().updateCharacter(characterId, (character) => advanceActiveEffects(character, restType));
      },
      clearConcentration: (characterId, reason = 'Concentração encerrada manualmente') => {
        get().updateCharacter(characterId, (character) => clearCharacterConcentration(character, reason));
      },
      applyRest: (characterId, restType) => {
        get().updateCharacter(characterId, (character) => {
          const afterGiftRecovery = restoreGiftOfProtectorsOnRest(character, restType);
          const afterResources = applyResourceRest(afterGiftRecovery, restType).character;
          const afterSlots = applySpellSlotRest(afterResources, restType).character;
          const afterHitDice = restoreHitDiceOnRest(afterSlots, restType);
          const afterEffects = advanceActiveEffects(afterHitDice, restType);
          return restType === 'turnStart' ? advanceGazeOfTwoMindsTurn(afterEffects) : afterEffects;
        });
      }
    }),
    {
      name: 'dnd-combat-math-characters',
      storage: createJSONStorage(() => characterStorage),
      version: CHARACTER_STORE_VERSION,
      migrate: (persisted, version) => migrateCharacterStoreState(persisted, version),
      onRehydrateStorage: () => (state, error) => {
        state?.reconcileProgressionRecovery(error);
        state?.reconcileCompatibilityRemediationRecovery(undefined, true);
      }
    }
  )
);
