/**
 * Schema migration infrastructure for Stage and Slide data.
 *
 * Each migration function receives the data at version N and returns it
 * at version N+1. Migrations are applied sequentially.
 *
 * Convention:
 *   - schemaVersion absent → treated as version 0
 *   - CURRENT_STAGE_VERSION / CURRENT_SLIDE_VERSION should be bumped
 *     whenever a breaking schema change is introduced
 *   - Add a migration function for each version bump
 */

import type { Stage } from '@/lib/types/stage';
import type { Slide } from '@/lib/types/slides';

// ── Version constants ────────────────────────────────────────────────
export const CURRENT_STAGE_VERSION = 1;
export const CURRENT_SLIDE_VERSION = 1;

// ── Stage migrations ────────────────────────────────────────────────

/** v0 → v1: Add schemaVersion field (no structural changes). */
function migrateStageV0ToV1(stage: Stage): Stage {
  return { ...stage, schemaVersion: 1 };
}

const STAGE_MIGRATIONS: Array<(stage: Stage) => Stage> = [
  /* index 0: v0 → v1 */ migrateStageV0ToV1,
];

/**
 * Apply all pending migrations to a Stage object.
 * Returns the migrated Stage with `schemaVersion === CURRENT_STAGE_VERSION`.
 */
export function migrateStage(stage: Stage): Stage {
  let version = stage.schemaVersion ?? 0;
  let current = stage;

  while (version < CURRENT_STAGE_VERSION) {
    const migration = STAGE_MIGRATIONS[version];
    if (!migration) break;
    current = migration(current);
    version = current.schemaVersion ?? version + 1;
  }

  return current;
}

// ── Slide migrations ────────────────────────────────────────────────

/** v0 → v1: Add schemaVersion field (no structural changes). */
function migrateSlideV0ToV1(slide: Slide): Slide {
  return { ...slide, schemaVersion: 1 };
}

const SLIDE_MIGRATIONS: Array<(slide: Slide) => Slide> = [
  /* index 0: v0 → v1 */ migrateSlideV0ToV1,
];

/**
 * Apply all pending migrations to a Slide object.
 * Returns the migrated Slide with `schemaVersion === CURRENT_SLIDE_VERSION`.
 */
export function migrateSlide(slide: Slide): Slide {
  let version = slide.schemaVersion ?? 0;
  let current = slide;

  while (version < CURRENT_SLIDE_VERSION) {
    const migration = SLIDE_MIGRATIONS[version];
    if (!migration) break;
    current = migration(current);
    version = current.schemaVersion ?? version + 1;
  }

  return current;
}

/**
 * Migrate a Scene's content if it contains a Slide (type === 'slide').
 * Non-slide scenes are returned unchanged.
 */
export function migrateSceneContent<T extends { type: string; canvas?: Slide }>(
  content: T,
): T {
  if (content.type === 'slide' && content.canvas) {
    return { ...content, canvas: migrateSlide(content.canvas) };
  }
  return content;
}
