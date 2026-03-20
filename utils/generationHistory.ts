import type { GenerationHistoryItem } from '../types';

const STORAGE_KEY = 'making.generationHistory.v1';
const MAX_HISTORY_ITEMS = 36;

export const loadGenerationHistory = (): GenerationHistoryItem[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const saveGenerationHistory = (items: GenerationHistoryItem[]) => {
    // Never throw to UI layer. Quota errors here can unmount the whole React tree.
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        return;
    } catch {
        // Fallback: trim from the tail until storage succeeds.
        let trimmed = [...items];
        while (trimmed.length > 0) {
            trimmed = trimmed.slice(0, -1);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
                return;
            } catch {
                // keep trimming
            }
        }

        // Last resort: clear corrupted/oversized history entry.
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            // swallow all storage failures
        }
    }
};

export const addGenerationHistoryItem = (
    items: GenerationHistoryItem[],
    item: GenerationHistoryItem
): GenerationHistoryItem[] => {
    const itemKey = item.originalDataUrl || item.dataUrl;
    const next = [
        item,
        ...items.filter(existing => (existing.originalDataUrl || existing.dataUrl) !== itemKey),
    ].slice(0, MAX_HISTORY_ITEMS);
    saveGenerationHistory(next);
    return next;
};
