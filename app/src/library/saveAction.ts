import type { ItemType } from './types';

export type SaveDecision =
    | { kind: 'create'; type: ItemType }
    | { kind: 'update' };

export function resolveSave(
    loaded: { type: ItemType } | null,
    action: ItemType,
): SaveDecision {
    if (loaded !== null && loaded.type === action) {
        return { kind: 'update' };
    }
    return { kind: 'create', type: action };
}
