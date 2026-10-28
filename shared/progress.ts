// Office progression (#210): what both sides need to agree on. The decoration catalogue and its prices, the
// decoration slots every office floor has (layout.ts places them), the achievements, and the views the server's
// ledger (server/ledger.ts) sends to the browser.

/** Where a decoration goes: on a wall, a small spot on the floor, a big spot on the floor, or flat under foot. */
export type DecorKind = 'wall' | 'floor' | 'big' | 'rug';

export type DecorItem = 'plant' | 'beanbag' | 'fig' | 'poster-ship' | 'poster-repo' | 'poster-pr' | 'rug' | 'lights' | 'neon' | 'fishtank' | 'pingpong' | 'arcade';

export interface CatalogueItem {
  id: DecorItem;
  name: string;
  icon: string;
  kind: DecorKind;
  /** Coins for the first one; each one the floor already owns makes the next a little dearer (priceOf). */
  price: number;
  blurb: string;
}

export const CATALOGUE: readonly CatalogueItem[] = [
  { id: 'plant', name: 'Planta en maceta', icon: '🪴', kind: 'floor', price: 20, blurb: 'Un rincón más alegre con un poco de verde.' },
  { id: 'beanbag', name: 'Puf', icon: '🛋️', kind: 'floor', price: 35, blurb: 'Para pensar mucho, en horizontal.' },
  { id: 'fig', name: 'Ficus', icon: '🌳', kind: 'floor', price: 45, blurb: 'Grande, brillante y un poco teatral.' },
  { id: 'poster-ship', name: 'Póster «¡Lánzalo!»', icon: '🚀', kind: 'wall', price: 25, blurb: 'Motivación enmarcada.' },
  { id: 'poster-repo', name: 'Póster del repo', icon: '🖼️', kind: 'wall', price: 30, blurb: "El repo de la planta, enmarcado." },
  { id: 'poster-pr', name: 'Póster de la primera PR', icon: '📜', kind: 'wall', price: 40, blurb: "La primera PR fusionada de la planta, enmarcada para la posteridad." },
  { id: 'rug', name: 'Alfombra', icon: '🟧', kind: 'rug', price: 30, blurb: "Una alfombra del color de la planta." },
  { id: 'lights', name: 'Guirnalda de luces', icon: '💡', kind: 'wall', price: 50, blurb: 'Pequeñas bombillas cálidas a lo largo de una pared.' },
  { id: 'neon', name: 'Cartel de neón', icon: '🌈', kind: 'wall', price: 80, blurb: "El nombre de la planta en tubos luminosos." },
  { id: 'fishtank', name: 'Pecera', icon: '🐠', kind: 'big', price: 120, blurb: 'Unos peces de dibujos dando vueltas.' },
  { id: 'pingpong', name: 'Mesa de ping-pong', icon: '🏓', kind: 'big', price: 150, blurb: "Una mesa de decoración." },
  { id: 'arcade', name: 'Máquina recreativa', icon: '🕹️', kind: 'big', price: 200, blurb: "Una máquina retro de decoración." },
];

export const catalogueItem = (id: string): CatalogueItem | undefined => CATALOGUE.find((c) => c.id === id);
export const isDecorItem = (id: unknown): id is DecorItem => typeof id === 'string' && CATALOGUE.some((c) => c.id === id);

/** What the next `item` costs on a floor that already owns `owned` of them: a quarter more for each, rounded to 5. */
export function priceOf(item: DecorItem, owned = 0): number {
  const base = catalogueItem(item)?.price ?? 0;
  return Math.round((base * (1 + 0.25 * Math.max(0, owned))) / 5) * 5;
}

/**
 * Every office floor's decoration slots: a few per zone. Their positions are in client/src/world/layout.ts
 * (DECOR_SLOT_AT), kept clear of desks, walkways, the whiteboard and the elevator.
 */
export const DECOR_SLOTS: readonly { id: string; kind: DecorKind }[] = [
  { id: 'w-west', kind: 'wall' },
  { id: 'w-south-w', kind: 'wall' },
  { id: 'w-south-e', kind: 'wall' },
  { id: 'w-north-e', kind: 'wall' },
  { id: 'w-kitchen', kind: 'wall' },
  { id: 'f-ne', kind: 'floor' },
  { id: 'f-se', kind: 'floor' },
  { id: 'f-sw', kind: 'floor' },
  { id: 'f-west', kind: 'floor' },
  { id: 'b-west', kind: 'big' },
  { id: 'b-lounge', kind: 'big' },
  { id: 'b-south', kind: 'big' },
  { id: 'r-lounge', kind: 'rug' },
  { id: 'r-entry', kind: 'rug' },
];

export const slotKind = (id: string): DecorKind | undefined => DECOR_SLOTS.find((s) => s.id === id)?.kind;
export const slotsOfKind = (kind: DecorKind) => DECOR_SLOTS.filter((s) => s.kind === kind).length;

// ---------- coins ----------

/** What a merge earns its floor: a base, and bonuses for a clean run. Nothing is ever taken away. */
export const COINS = { merge: 10, firstQa: 5, greenCi: 5, streak: 10 } as const;
/** A floor's merge counts towards a streak bonus when it is the third (or more) within this long. */
export const STREAK_WINDOW_MS = 60 * 60_000;
export const STREAK_MERGES = 3;

// ---------- achievements ----------

export type AchievementId =
  | 'first-merge'
  | 'hat-trick'
  | 'ten-a-day'
  | 'clean-day'
  | 'night-owl'
  | 'full-house'
  | 'comeback'
  | 'coffee-addict'
  | 'perfect-five'
  | 'quarter-century'
  | 'century'
  | 'interior-designer'
  | 'fully-furnished';

export interface AchievementDef {
  id: AchievementId;
  name: string;
  icon: string;
  /** What it takes, as the trophy's plaque says it. */
  blurb: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-merge', name: 'Primer merge', icon: '🎉', blurb: 'La primera PR fusionada desde que se lleva la cuenta' },
  { id: 'hat-trick', name: 'Triplete', icon: '⚡', blurb: 'Tres merges en una planta en una hora' },
  { id: 'ten-a-day', name: 'Diez en un día', icon: '🔟', blurb: 'Diez merges en un día' },
  { id: 'clean-day', name: 'Día impecable', icon: '✨', blurb: 'Cinco o más merges en un día sin suspender ninguna ronda de QA' },
  { id: 'night-owl', name: 'Búho nocturno', icon: '🦉', blurb: 'Un merge entre medianoche y las cinco de la mañana' },
  { id: 'full-house', name: 'Pleno', icon: '🏠', blurb: 'Toda una planta trabajando a la vez (cuatro o más personas)' },
  { id: 'comeback', name: 'Remontada', icon: '🔁', blurb: 'Una PR que te necesitaba ha acabado fusionada' },
  { id: 'coffee-addict', name: 'Cafetero', icon: '☕', blurb: 'Has bebido diez cafés' },
  { id: 'perfect-five', name: 'Cinco perfectos', icon: '💎', blurb: 'Cinco merges seguidos sin suspender ninguna ronda de QA ni ningún check' },
  { id: 'quarter-century', name: 'Un cuarto de siglo', icon: '🥈', blurb: '25 PRs fusionadas' },
  { id: 'century', name: 'Centenario', icon: '🥇', blurb: '100 PRs fusionadas' },
  { id: 'interior-designer', name: 'Interiorista', icon: '🪴', blurb: 'La primera decoración colocada' },
  { id: 'fully-furnished', name: 'Totalmente amueblada', icon: '🛋️', blurb: 'Todos los huecos de decoración de una planta ocupados' },
];

export const achievementDef = (id: string) => ACHIEVEMENTS.find((a) => a.id === id);

/** Coffees the player drinks before the coffee addict trophy. */
export const COFFEE_ADDICT = 10;

// ---------- views ----------

export interface FloorProgressView {
  coins: number;
  /** Coins earned on this floor, ever. */
  earned: number;
  merges: number;
  /** Decorations bought for the floor, placed or in its decor box. */
  owned: Partial<Record<DecorItem, number>>;
  /** Slot id -> what stands there. */
  placed: Record<string, DecorItem>;
  /** The first PR merged on the floor while the ledger watched: the "first PR" poster shows it. */
  firstPr: { n: number; title: string } | null;
}

export interface AchievementView {
  id: AchievementId;
  at: number;
  /** What earned it, e.g. "PR #12 on demo-co/pixel-todo". */
  detail: string;
}

export interface ProgressView {
  /** By repo id, for the connected floors. */
  floors: Record<string, FloorProgressView>;
  achievements: AchievementView[];
  coffees: number;
  merges: number;
}

/** A merge's coins, sent as it happens for the coin burst and the pling. */
export interface RewardView {
  repoId: string;
  prNumber: number;
  /** The PR's author, whose desk the coins burst over (null: over the whiteboard). */
  agentId: string | null;
  coins: number;
  reasons: string[];
}

/** How many decorations of `item` a floor has in its decor box (bought and not placed). */
export function stored(floor: Pick<FloorProgressView, 'owned' | 'placed'>, item: DecorItem) {
  const placed = Object.values(floor.placed).filter((p) => p === item).length;
  return Math.max(0, (floor.owned[item] ?? 0) - placed);
}
