import type { BrowserId, BrowserKey } from 'asyar-sdk/contracts';

function toId(key: BrowserKey): BrowserId {
  // The bridge keys by (family, variant); openUrl/searchWeb take a BrowserId.
  // profileId is not part of routing for "open new content" — use 'Default'.
  return { family: key.family, variant: key.variant, profileId: 'Default' };
}

export function resolveOpenTarget(
  setting: string,
  ctx: { mostRecent: BrowserKey | null; paired: BrowserKey[] },
): BrowserId | undefined {
  if (setting === 'most-recent') {
    const pick = ctx.mostRecent ?? ctx.paired[0];
    return pick ? toId(pick) : undefined;
  }
  const match = ctx.paired.find((b) => b.variant === setting);
  return match ? toId(match) : undefined;
}
