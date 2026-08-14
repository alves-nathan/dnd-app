import type { CharacterAction, SpellAction, TacticalAreaShape, TacticalAreaTemplate } from '../../types';

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asNumber = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
const asString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

const distanceFeet = (value: unknown, declaredUnit?: string): number | undefined => {
  const direct = asNumber(value);
  const text = asString(value)?.toLowerCase();
  const parsed = direct ?? (text?.match(/-?\d+(?:\.\d+)?/)?.[0] ? Number(text.match(/-?\d+(?:\.\d+)?/)![0]) : undefined);
  if (parsed === undefined || !Number.isFinite(parsed)) return undefined;
  const unit = text?.includes('mile') ? 'mile' : declaredUnit?.toLowerCase();
  return Math.max(0, parsed * (unit === 'mile' || unit === 'miles' ? 5280 : 1));
};

const normalizeShape = (value?: string): TacticalAreaShape | undefined => {
  const normalized = value?.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!normalized) return undefined;
  if (normalized === 'line') return 'line';
  if (normalized === 'cone') return 'cone';
  if (normalized === 'cube') return 'cube';
  if (normalized === 'sphere' || normalized === 'radius') return 'sphere';
  if (normalized === 'cylinder') return 'cylinder';
  if (normalized === 'emanation' || normalized === 'aura') return 'emanation';
  if (normalized === 'square') return 'square';
  return 'custom';
};

const normalizeOrigin = (value?: string): TacticalAreaTemplate['origin'] | undefined => {
  const normalized = value?.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!normalized) return undefined;
  if (['caster', 'self', 'actor', 'origin'].includes(normalized)) return 'actor';
  if (['target', 'hittarget', 'creature'].includes(normalized)) return 'target';
  if (['point', 'space', 'chosenpoint'].includes(normalized)) return 'point';
  return undefined;
};

export const normalizeTacticalAreaTemplate = (raw: unknown, description?: string): TacticalAreaTemplate | undefined => {
  if (typeof raw === 'string' && raw.trim()) return { shape: 'custom', description: raw.trim() };
  const record = asRecord(raw);
  if (!Object.keys(record).length) return undefined;
  const directShape = normalizeShape(asString(record.shape) ?? asString(record.type));
  const declaredUnit = asString(record.unit) ?? 'ft';
  const emanationRadius = distanceFeet(record.emanationRadius, declaredUnit);
  const shapeOptions = Array.isArray(record.shapeOptions) ? record.shapeOptions.map(asRecord).filter((entry) => Object.keys(entry).length) : [];
  const shape = directShape ?? (emanationRadius !== undefined ? 'emanation' : shapeOptions.length ? 'custom' : undefined);
  if (!shape) return undefined;
  const size = distanceFeet(record.size ?? record.side, declaredUnit);
  const optionDescription = shapeOptions.length
    ? `Opções: ${shapeOptions.map((option) => {
      const optionShape = asString(option.shape) ?? 'área';
      const values = [
        asNumber(option.length) !== undefined ? `${asNumber(option.length)} ft comprimento` : undefined,
        asNumber(option.radius) !== undefined ? `${asNumber(option.radius)} ft raio` : undefined,
        asNumber(option.diameter) !== undefined ? `${asNumber(option.diameter)} ft diâmetro` : undefined,
        asNumber(option.height) !== undefined ? `${asNumber(option.height)} ft altura` : undefined,
        asString(option.panelSize)
      ].filter(Boolean);
      return `${optionShape}${values.length ? ` (${values.join(', ')})` : ''}`;
    }).join(' ou ')}`
    : undefined;
  const template: TacticalAreaTemplate = {
    shape,
    sizeFeet: size,
    radiusFeet: distanceFeet(record.radius, declaredUnit) ?? emanationRadius,
    lengthFeet: distanceFeet(record.length, declaredUnit),
    widthFeet: distanceFeet(record.width, declaredUnit),
    heightFeet: distanceFeet(record.height, declaredUnit),
    origin: normalizeOrigin(asString(record.origin) ?? asString(record.center)),
    description: description ?? asString(record.description) ?? optionDescription
  };
  if (shape === 'emanation' && !template.origin) template.origin = 'actor';
  return template;
};

export const describeTacticalAreaTemplate = (area?: TacticalAreaTemplate): string | undefined => {
  if (!area) return undefined;
  const feet = (value?: number): string | undefined => value === undefined ? undefined : `${value} ft`;
  const dimension = area.shape === 'line'
    ? [feet(area.lengthFeet ?? area.sizeFeet), area.widthFeet !== undefined ? `${area.widthFeet} ft de largura` : undefined].filter(Boolean).join(' × ')
    : area.shape === 'sphere' || area.shape === 'emanation'
      ? `raio ${feet(area.radiusFeet ?? area.sizeFeet) ?? '?'}`
      : area.shape === 'cylinder'
        ? [`raio ${feet(area.radiusFeet ?? area.sizeFeet) ?? '?'}`, area.heightFeet !== undefined ? `altura ${feet(area.heightFeet)}` : undefined].filter(Boolean).join(' · ')
        : feet(area.sizeFeet);
  const shapeLabels: Record<TacticalAreaShape, string> = {
    line: 'Linha', cone: 'Cone', cube: 'Cubo', sphere: 'Esfera', cylinder: 'Cilindro', emanation: 'Emanação', square: 'Quadrado', custom: 'Área'
  };
  const origin = area.origin === 'actor' ? 'a partir do personagem' : area.origin === 'target' ? 'centrada no alvo' : area.origin === 'point' ? 'em ponto escolhido' : undefined;
  return [shapeLabels[area.shape], dimension, origin, area.description].filter(Boolean).join(' · ');
};

export const tacticalActionSupportsMultipleTargets = (action: CharacterAction): boolean => {
  if (action.type === 'attack') return action.mastery?.property === 'cleave';
  return Boolean(action.area) || Math.max(action.targets ?? 1, action.attacksCount ?? 1) > 1;
};

export const tacticalActionTargetLimit = (action: CharacterAction): number | undefined => {
  if (action.type === 'attack') return action.mastery?.property === 'cleave' ? 2 : 1;
  if (action.area) return undefined;
  return Math.max(1, action.targets ?? 1, action.attacksCount ?? 1);
};

export const toggleTacticalTargetId = (current: string[], targetId: string, limit?: number): string[] => {
  if (current.includes(targetId)) return current.filter((id) => id !== targetId);
  if (limit !== undefined && current.length >= limit) return current;
  return [...current, targetId];
};

export const spellSaveSuccessDamage = (value?: string): SpellAction['saveSuccessDamage'] => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.startsWith('half')) return 'half';
  if (normalized === 'none') return 'none';
  return undefined;
};
