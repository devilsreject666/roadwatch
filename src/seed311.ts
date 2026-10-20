/**
 * Denver 311 pothole reports, Oct 2025 - Sep 2026 (public record).
 * One-shot seed so the map shows real pins on first launch.
 * Row format: [id, lat, lon, reportMonth(YYYY-MM), summary, address, neighborhood]
 * Data split into parts (push-size limits); generated - do not edit by hand.
 */
export type Seed311Row = [string, number, number, string, string, string | null, string | null];
import { PART1 } from './seed311/part1';
import { PART2 } from './seed311/part2';
import { PART3 } from './seed311/part3';
import { PART4 } from './seed311/part4';
export const SEED_311: Seed311Row[] = [...PART1, ...PART2, ...PART3, ...PART4] as Seed311Row[];
export const SEED_311_COUNT = 1932;
