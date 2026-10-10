import type { StoryRenderMetadata } from '../engine/types.js';
import type { SupportedImageMimeType } from '../engine/provider-types.js';

export interface StoryCharacter { id: string; identity: string }
export interface StoryScene { hour: number; presentCast: string[]; state: string; action: string }
export interface DailyStory {
  schemaVersion: 1;
  id: string;
  date: string;
  timezone: string;
  artworkHash: string;
  title: string;
  premise: string;
  trailer: string;
  cast: StoryCharacter[];
  scenes: StoryScene[];
  ending: string;
  createdAt: string;
}
export interface StoryExpectation {
  date: string;
  artworkHash: string;
  hours: readonly number[];
  timezone?: string;
  id?: string;
  createdAt?: string;
}
export interface ImageSnapshot { path: string; sha256: string; mimeType: SupportedImageMimeType }
export interface ContinuitySnapshot extends ImageSnapshot { renderId: string; sceneHour: number }
export interface ReadyStory { story: DailyStory; original: ImageSnapshot }
export interface StoryReferences { original: ImageSnapshot; previous?: ContinuitySnapshot }
export interface StoryFailure { date: string; error: string; failedAt: string }
/** Same authoritative provenance shape as committed Render sidecars. */
export type StoryRenderProvenance = StoryRenderMetadata;
