export const EVENT_THEMES = [
  { id: "ethereum", name: "Ethereum", group: "blockchain", note: "Iridescent facets", mark: "Ξ", icon: "/landing/icons/eth.svg" },
  { id: "bitcoin", name: "Bitcoin", group: "blockchain", note: "Warm copper grain", mark: "₿", icon: "/landing/icons/btc.svg" },
  { id: "base", name: "Base", group: "blockchain", note: "Electric blue layers", mark: "BASE" },
  { id: "near", name: "NEAR", group: "blockchain", note: "Coral and deep ink", mark: "NEAR", icon: "/landing/icons/near.svg" },
  { id: "solana", name: "Solana", group: "blockchain", note: "Neon signal bands", mark: "SOL", icon: "/landing/icons/sol.svg" },
  { id: "paradise", name: "Paradise", group: "paradise", note: "Bali, islands & coworking", mark: "BALI" },
  { id: "claude", name: "Claude", group: "ai", note: "Warm paper and ember", mark: "claude" },
  { id: "codex", name: "Codex", group: "ai", note: "Blue-violet code paths", mark: "CODEX" },
  { id: "cursor", name: "Cursor", group: "ai", note: "Quiet editor dark", mark: "cursor" },
  { id: "grok", name: "Grok", group: "ai", note: "Black, silver & orbit", mark: "GROK" },
  { id: "hermes", name: "Hermes", group: "ai", note: "Classic gold & deep navy", mark: "HERMES" },
] as const;

export type EventThemeId = (typeof EVENT_THEMES)[number]["id"];
export interface EventVisualConfig {
  themeId: EventThemeId;
  seed: number;
}

export interface ResolvedEventVisual {
  config: EventVisualConfig;
  theme: (typeof EVENT_THEMES)[number];
  backgroundAsset: string | null;
  backgroundPosition: string;
  backgroundSize: string;
  coverAsset: string | null;
  coverPosition: string;
  coverSize: string;
  texture: string;
  colors: [string, string, string];
  fontFamily: string;
  font: number;
  layout: (typeof LAYOUTS)[number];
  variant: number;
}

const PARADISE_BACKGROUNDS = [
  "/event-themes/paradise/penida-kelingking.jpg",
  "/event-themes/paradise/gili-islands.jpg",
  "/event-themes/paradise/ubud-rice-fields.jpg",
  "/event-themes/paradise/canggu-nomad.jpg",
  "/event-themes/paradise/canggu-surf.jpg",
  "/event-themes/paradise/canggu-coworking.png",
] as const;
const AI_TEXTURE_SHEET = "/event-themes/ai/ai-brand-panels.png";
const AI_PANEL_POSITION: Partial<Record<EventThemeId, string>> = {
  claude: "0% center",
  codex: "25% center",
  cursor: "50% center",
  grok: "75% center",
  hermes: "100% center",
};

const PALETTES: Record<EventThemeId, [string, string, string][]> = {
  ethereum: [["#171735", "#6959d9", "#8ce4de"], ["#172b42", "#536ad0", "#d8b8ff"], ["#32204a", "#ab79d6", "#89daca"]],
  bitcoin: [["#2b190c", "#f7931a", "#ffd783"], ["#381b10", "#d36a16", "#ffe5ad"], ["#271d18", "#b66d3a", "#f4b158"]],
  base: [["#061e47", "#165dff", "#8cc8ff"], ["#102b70", "#3875ff", "#b5dbff"], ["#071936", "#2861dd", "#74e4ff"]],
  near: [["#231526", "#ee5b42", "#ffba92"], ["#311c2a", "#c7474b", "#f7a891"], ["#172333", "#ee7458", "#ffc68a"]],
  solana: [["#10132b", "#9945ff", "#14f195"], ["#17172e", "#6d55d8", "#5ee5c4"], ["#102c36", "#28b6a2", "#b7f35e"]],
  paradise: [["#063d48", "#2da894", "#e9d2a4"], ["#104554", "#56b7c5", "#ffbb7a"], ["#2b3e33", "#6c9d67", "#edd49d"]],
  claude: [["#38221b", "#da7147", "#f7ce9f"], ["#38251f", "#bf624b", "#f4d9ad"], ["#3b2923", "#e58b58", "#ffd598"]],
  codex: [["#151735", "#6257db", "#a9c7ff"], ["#172449", "#4a73e8", "#d6aaff"], ["#20183d", "#8162e8", "#83d7ff"]],
  cursor: [["#111316", "#6d7787", "#d3e1f4"], ["#171922", "#6574a3", "#d1d8e8"], ["#151719", "#4e7772", "#d2e9db"]],
  grok: [["#090b0e", "#8a98a8", "#eff4f9"], ["#17191e", "#778499", "#fff3d7"], ["#111316", "#596979", "#d4e5f4"]],
  hermes: [["#17130b", "#b47b18", "#ffd94f"], ["#20180c", "#cb8d25", "#ffe3a0"], ["#171b11", "#a28d36", "#d5ee69"]],
};

const TEXTURES: Record<EventThemeId, string[]> = {
  ethereum: [
    "repeating-linear-gradient(135deg, #ffffff18 0 1px, transparent 1px 18px), repeating-linear-gradient(45deg, #c5b5ff12 0 1px, transparent 1px 24px)",
    "radial-gradient(ellipse at 80% 20%, #ffffff30 0 1px, transparent 2px), repeating-radial-gradient(ellipse at 50% 50%, #d4c8ff19 0 1px, transparent 2px 24px)",
    "linear-gradient(30deg, transparent 48%, #ffffff20 49% 50%, transparent 51%), linear-gradient(150deg, transparent 48%, #b5f4e51c 49% 50%, transparent 51%)",
  ],
  bitcoin: [
    "repeating-linear-gradient(0deg, #ffd7831c 0 1px, transparent 1px 17px), repeating-linear-gradient(90deg, #ffd78312 0 1px, transparent 1px 17px)",
    "radial-gradient(circle at 25% 22%, #ffd78324 0 2px, transparent 3px), radial-gradient(circle at 75% 72%, #ffd78318 0 1px, transparent 2px)",
    "repeating-linear-gradient(35deg, transparent 0 24px, #ffc05d19 24px 26px, transparent 26px 48px)",
  ],
  base: [
    "repeating-linear-gradient(120deg, #d5eaff1c 0 2px, transparent 2px 22px)",
    "radial-gradient(ellipse at 20% 80%, #8dc9ff40 0 1px, transparent 2px), repeating-linear-gradient(0deg, #75b8ff14 0 1px, transparent 1px 20px)",
    "linear-gradient(90deg, transparent 48%, #c6e6ff25 49% 50%, transparent 51%), linear-gradient(0deg, transparent 48%, #c6e6ff18 49% 50%, transparent 51%)",
  ],
  near: [
    "repeating-linear-gradient(155deg, transparent 0 18px, #ffc2a329 19px 20px, transparent 21px 38px)",
    "radial-gradient(ellipse at 76% 25%, #ffb08a35 0 1px, transparent 2px), repeating-linear-gradient(45deg, #f68b7114 0 1px, transparent 1px 20px)",
    "linear-gradient(25deg, transparent 46%, #ff987b22 47% 48%, transparent 49%), linear-gradient(155deg, transparent 46%, #ffcf9e20 47% 48%, transparent 49%)",
  ],
  solana: [
    "repeating-linear-gradient(0deg, #8cf8d91e 0 2px, transparent 2px 13px)",
    "repeating-linear-gradient(175deg, #a0f7de1a 0 3px, transparent 3px 19px), repeating-linear-gradient(5deg, transparent 0 27px, #be87ff20 28px 30px)",
    "linear-gradient(115deg, transparent 30%, #57e6c21c 31% 32%, transparent 33% 65%, #bd7aff1c 66% 67%, transparent 68%)",
  ],
  paradise: ["linear-gradient(135deg, #d4fff226, transparent 60%)", "radial-gradient(ellipse at 80% 15%, #fff1d932, transparent 50%)", "linear-gradient(25deg, #053d3533, transparent 65%)"],
  claude: [
    "radial-gradient(circle at 76% 28%, #ffc79b34 0 1px, transparent 2px), repeating-linear-gradient(25deg, #ffd7b019 0 1px, transparent 1px 24px)",
    "repeating-linear-gradient(0deg, #f3bd8b16 0 1px, transparent 1px 21px)",
    "radial-gradient(ellipse at 20% 15%, #ffb78130, transparent 55%), repeating-linear-gradient(145deg, transparent 0 28px, #ffdda219 29px 30px)",
  ],
  codex: [
    "linear-gradient(35deg, transparent 48%, #c4b2ff22 49% 50%, transparent 51%), linear-gradient(145deg, transparent 48%, #9fcaff20 49% 50%, transparent 51%)",
    "repeating-linear-gradient(0deg, #c4b2ff16 0 1px, transparent 1px 22px), repeating-linear-gradient(90deg, #9fcaff12 0 1px, transparent 1px 22px)",
    "radial-gradient(circle at 18% 22%, #cdb8ff38 0 1px, transparent 2px), repeating-linear-gradient(135deg, transparent 0 20px, #9dc9ff1b 21px 22px)",
  ],
  cursor: [
    "linear-gradient(#dce7f212 1px, transparent 1px), linear-gradient(90deg, #dce7f212 1px, transparent 1px)",
    "repeating-linear-gradient(0deg, #e4ecfa12 0 1px, transparent 1px 26px), radial-gradient(ellipse at 75% 25%, #8794b529, transparent 50%)",
    "repeating-linear-gradient(135deg, transparent 0 22px, #becce119 23px 24px)",
  ],
  grok: [
    "radial-gradient(circle at 50% 50%, #f1f5fa3a 0 1px, transparent 2px), repeating-radial-gradient(circle at 50% 50%, #d2dbe917 0 1px, transparent 2px 26px)",
    "linear-gradient(45deg, transparent 49%, #e7edf323 49.5% 50.5%, transparent 51%), linear-gradient(135deg, transparent 49%, #e7edf319 49.5% 50.5%, transparent 51%)",
    "radial-gradient(ellipse at 50% 0%, #e0e8f022, transparent 60%), repeating-linear-gradient(90deg, #d6e2f012 0 1px, transparent 1px 33px)",
  ],
  hermes: [
    "radial-gradient(circle at 75% 23%, #ffdf6330 0 1px, transparent 2px), repeating-linear-gradient(45deg, #f1bd4b16 0 1px, transparent 1px 23px)",
    "linear-gradient(120deg, transparent 47%, #ffcf4c25 48% 49%, transparent 50%), linear-gradient(60deg, transparent 47%, #a8df6c19 48% 49%, transparent 50%)",
    "radial-gradient(ellipse at 25% 80%, #e8b64a32, transparent 50%), repeating-radial-gradient(ellipse at 65% 20%, #ffe19b13 0 1px, transparent 2px 22px)",
  ],
};

const FONTS = [
  '"Arial Narrow", "Helvetica Neue", sans-serif',
  'Georgia, "Times New Roman", serif',
  '"Trebuchet MS", "Helvetica Neue", sans-serif',
  'ui-monospace, SFMono-Regular, Menlo, monospace',
] as const;
const LAYOUTS = ["center", "lower", "offset"] as const;

export const EVENT_FONTS = FONTS;
export const EVENT_LAYOUTS = LAYOUTS;

export function eventPalettes(themeId: EventThemeId): [string, string, string][] {
  return PALETTES[themeId];
}

export function isEventThemeId(value: unknown): value is EventThemeId {
  return typeof value === "string" && EVENT_THEMES.some((theme) => theme.id === value);
}

export function validEventVisual(value: unknown): value is EventVisualConfig {
  if (!value || typeof value !== "object") return false;
  const visual = value as Record<string, unknown>;
  return isEventThemeId(visual.themeId) && Number.isInteger(visual.seed)
    && (visual.seed as number) >= 0 && (visual.seed as number) <= 0xffff_ffff;
}

export function createRandomVisual(themeId: EventThemeId): EventVisualConfig {
  const seed = new Uint32Array(1);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) crypto.getRandomValues(seed);
  else seed[0] = Math.floor(Math.random() * 0x1_0000_0000);
  return { themeId, seed: seed[0] };
}

/** A random look of the same theme that visibly differs: another palette, or another photo for Paradise. */
export function shuffleEventVisual(current: EventVisualConfig): EventVisualConfig {
  const before = resolveEventVisual(current);
  const paradise = current.themeId === "paradise";
  let next = createRandomVisual(current.themeId);
  for (;;) {
    const after = resolveEventVisual(next);
    if (paradise ? after.backgroundAsset !== before.backgroundAsset : after.variant !== before.variant) return next;
    next = createRandomVisual(current.themeId);
  }
}

/** Rewrites 4 seed bits so that (seed >>> shift) % modulus equals target. Lower bits may change. */
function withSeedField(seed: number, shift: number, modulus: number, target: number): number {
  for (let bits = 0; bits < 16; bits++) {
    const candidate = ((seed & ~(0xf << shift)) | (bits << shift)) >>> 0;
    if ((candidate >>> shift) % modulus === target) return candidate;
  }
  return seed;
}

/**
 * Color, font and title position all come from the saved seed, so choosing them
 * changes only the seed. Fields are set from the highest bits down, because each
 * field reads every bit above its own.
 */
export function withVisualOptions(config: EventVisualConfig, options: { variant?: number; layout?: number; font?: number }): EventVisualConfig {
  const seed = config.seed >>> 0;
  const font = options.font ?? (seed >>> 12) % FONTS.length;
  const photo = (seed >>> 8) % PARADISE_BACKGROUNDS.length;
  const layout = options.layout ?? (seed >>> 4) % LAYOUTS.length;
  const variant = options.variant ?? seed % 3;
  let next = ((seed & ~(0x3 << 12)) | (font << 12)) >>> 0;
  next = withSeedField(next, 8, PARADISE_BACKGROUNDS.length, photo);
  next = withSeedField(next, 4, LAYOUTS.length, layout);
  next = withSeedField(next, 0, 3, variant);
  return { themeId: config.themeId, seed: next };
}

export function createRandomEventVisual(): EventVisualConfig {
  const seed = new Uint32Array(1);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) crypto.getRandomValues(seed);
  else seed[0] = Math.floor(Math.random() * 0x1_0000_0000);
  const theme = EVENT_THEMES[seed[0] % EVENT_THEMES.length];
  return { themeId: theme.id, seed: (seed[0] ^ 0xa5a5a5a5) >>> 0 };
}

export function fallbackEventVisual(eventId: number, title: string): EventVisualConfig {
  let h = (eventId ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < title.length; i++) h = Math.imul(h ^ title.charCodeAt(i), 0x85ebca6b) >>> 0;
  const theme = EVENT_THEMES[h % EVENT_THEMES.length];
  return { themeId: theme.id, seed: h };
}

export function resolveEventVisual(config: EventVisualConfig): ResolvedEventVisual {
  const safeSeed = config.seed >>> 0;
  const theme = EVENT_THEMES.find((item) => item.id === config.themeId) ?? EVENT_THEMES[0];
  const variant = safeSeed % 3;
  const layout = LAYOUTS[(safeSeed >>> 4) % LAYOUTS.length];
  const aiPanel = AI_PANEL_POSITION[theme.id] ?? null;
  const paradiseImage = theme.id === "paradise" ? PARADISE_BACKGROUNDS[(safeSeed >>> 8) % PARADISE_BACKGROUNDS.length] : null;
  return {
    config: { themeId: theme.id, seed: safeSeed },
    theme,
    backgroundAsset: paradiseImage ?? (aiPanel ? AI_TEXTURE_SHEET : null),
    backgroundPosition: aiPanel ?? "center",
    backgroundSize: aiPanel ? "500% 100%" : "cover",
    coverAsset: aiPanel ? AI_TEXTURE_SHEET : null,
    coverPosition: aiPanel ?? "center",
    coverSize: aiPanel ? "500% 100%" : "cover",
    texture: TEXTURES[theme.id][variant],
    colors: PALETTES[theme.id][variant],
    fontFamily: FONTS[(safeSeed >>> 12) % FONTS.length],
    font: (safeSeed >>> 12) % FONTS.length,
    layout,
    variant,
  };
}
