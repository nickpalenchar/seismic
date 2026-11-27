




import { useSyncExternalStore } from 'react';
import { chapterAt, type SpotInput } from '../core/types';
import { api } from './api';
import { actCard } from './clients/seismic';
import { scrollBehavior } from './motion';
import { MAX_SIDE } from './shots';

interface Watched {
  cardId: string;
  video: HTMLVideoElement;
  chapters: [number, string][];
  
  demo?: number;
}


export interface Place {
  at: number;
  chapter?: string;
}

let watched: Watched | null = null;

let dismissed: number | null = null;
let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  for (const fn of listeners) fn();
};

/** The card's demo video is the one its words may be about, while it is shown; returns the end of that. */
export function watch(cardId: string, video: HTMLVideoElement, chapters: [number, string][], demo?: number): () => void {
  continueWatching(cardId);
  const w = { cardId, video, chapters, demo };
  watched = w;
  dismissed = null;
  const moved = () => {
    dismissed = null;
    bump();
  };
  const events = ['pause', 'ended', 'loadedmetadata'] as const;
  for (const e of events) video.addEventListener(e, bump);
  video.addEventListener('play', moved);
  video.addEventListener('seeked', moved);
  bump();
  return () => {
    for (const e of events) video.removeEventListener(e, bump);
    video.removeEventListener('play', moved);
    video.removeEventListener('seeked', moved);
    if (watched === w) watched = null;
    bump();
  };
}

/** The open card's demo video, if words on the card may be about a place in it. */
export const videoOf = (cardId: string): HTMLVideoElement | null => (watched?.cardId === cardId ? watched.video : null);

/** Whether the video stands somewhere in the middle: neither before it started nor at its end. */
export const midway = (v: HTMLVideoElement) => v.currentTime > 0 && !v.ended && !(v.duration && v.currentTime >= v.duration - 0.05);

/** The place the owner's words on the card are about: the video stands there, and they did not take it out. */
export function placeOn(cardId: string): Place | null {
  const v = videoOf(cardId);
  if (!v || !v.paused || !midway(v) || dismissed === v.currentTime) return null;
  const at = v.currentTime;
  const chapter = watched!.chapters[chapterAt(watched!.chapters, at)]?.[1];
  return { at, ...(chapter ? { chapter } : {}) };
}

/** The same, live. */
export function usePlace(cardId: string): Place | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return placeOn(cardId);
}

/** The words are not about the place the video stands at (the × beside it). */
export function dismissPlace() {
  if (!watched) return;
  dismissed = watched.video.currentTime;
  bump();
}

/**
 * The frame the video shows now, drawn at once; it is uploaded when `upload` is called (once the
 * words go out), as a screenshot is. Undefined when the frame cannot be drawn.
 */
export function grab(video: HTMLVideoElement): (() => Promise<string | undefined>) | undefined {
  if (!video.videoWidth) return;
  const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  try {
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  } catch {
    return;
  }
  return async () => {
    try {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      return blob ? await api.uploadImage(blob) : undefined;
    } catch {
      return undefined;
    }
  };
}


export interface Taken {
  at: number;
  demo?: number;
  upload?: () => Promise<string | undefined>;
  
  resume: () => void;
}

/** The place of the card's video words said now are about, with its frame; null where there is none. */
export function take(cardId: string): Taken | null {
  const place = placeOn(cardId);
  const w = watched;
  if (!place || !w) return null;
  const { demo, video } = w;
  const upload = grab(video);
  const resume = () => {
    if (watched === w && video.currentTime === place.at) void video.play().catch(() => {});
  };
  return { at: place.at, ...(demo !== undefined ? { demo } : {}), ...(upload ? { upload } : {}), resume };
}

const sending = new Map<string, { count: number; release: boolean }>();

/** A viewer who comes back before a send settles keeps the saved comments queued. */
export function continueWatching(cardId: string): boolean {
  const pending = sending.get(cardId);
  if (!pending) return false;
  pending.release = false;
  return true;
}

/** Hold the end-of-viewing release until the card's in-flight timestamped sends have settled. */
export function beginSpotSend(cardId: string): () => void {
  const pending = sending.get(cardId) ?? { count: 0, release: false };
  sending.set(cardId, pending);
  pending.count++;
  return () => {
    if (--pending.count) return;
    sending.delete(cardId);
    if (pending.release) finishWatching(cardId);
  };
}

/** The viewing session actually ended, independently of which demo version it shows. */
export function finishWatching(cardId: string): void {
  const pending = sending.get(cardId);
  if (pending) pending.release = true;
  else void actCard(cardId, { action: 'release' }).catch(() => {});
}

/** What the server gets of a place taken before: its time, the demo it is in, and its frame, uploaded now. */
export async function sent(taken: Taken | null): Promise<SpotInput | undefined> {
  if (!taken) return;
  const still = await taken.upload?.();
  return { at: taken.at, ...(taken.demo !== undefined ? { demo: taken.demo } : {}), ...(still ? { still } : {}) };
}


interface Versions {
  cardId: string;
  shown?: number;
  show: (demo: number, at: number) => boolean;
}

let versions: Versions | null = null;

/** The card's demo view goes to another of its demos when a comment on a place in that one is clicked; returns the end of that. */
export function showsVersions(v: Versions): () => void {
  versions = v;
  return () => {
    if (versions === v) versions = null;
  };
}

/** Plays the card's video from a place a comment is about (in `demo`, which may be an earlier one), and brings it into view. */
export function seekTo(cardId: string, at: number, demo?: number) {
  if (demo !== undefined && versions?.cardId === cardId && versions.shown !== demo && versions.show(demo, at)) return;
  const v = videoOf(cardId);
  if (!v) return;
  v.currentTime = at;
  v.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  v.play().catch(() => {});
}
