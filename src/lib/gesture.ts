"use client";

import { useRef } from "react";
import { animate, type MotionValue } from "motion/react";
import { DUR, EASE_OUT, springSheet } from "@/lib/motion";

/**
 * Drag to dismiss, the way a phone's own sheets and drawers let go.
 *
 * The surface follows the finger 1:1 from where it was grabbed, resists
 * past its open position instead of stopping dead (rubber band), and on
 * release is thrown toward where the gesture was going (momentum
 * projection, the rule UIKit's scroll views use), then settles on the
 * house spring starting at the finger's own speed, so there is no seam
 * between dragging and animating. It can be grabbed again mid-flight: the
 * running animation stops and tracking resumes from where the surface is
 * on the screen. A quick pull closes it; a slow one past halfway closes
 * it; anything else, or a pull back the other way, puts it back.
 *
 * Touch and pen only: with a mouse the close button, the scrim and Escape
 * do the job, and a mouse drag would fight text selection.
 */

/** UIScrollView's normal deceleration rate, per millisecond. */
export const DECELERATION = 0.998;

/** Movement (px) before a touch counts as a drag rather than a tap. */
export const SLOP = 8;

/** A release moving back toward open faster than this (px/s) is a change of mind: the surface returns. */
export const REVERSAL = 80;

/** How far a release at `velocity` (px/s) would carry on before coming to rest (UIKit's projection). */
export function project(velocity: number, rate = DECELERATION): number {
  return ((velocity / 1000) * rate) / (1 - rate);
}

/** Past a boundary, the surface follows less the further it goes. Keeps the sign of `overshoot`. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0 || overshoot === 0) return 0;
  const d = Math.abs(overshoot);
  return (Math.sign(overshoot) * (d * dimension * constant)) / (dimension + constant * d);
}

export interface Sample {
  /** Event time, ms. */
  t: number;
  /** Offset toward dismissal, px. */
  v: number;
}

/** Release velocity (px/s) over the last `windowMs` of the gesture; zero when the finger had stopped. */
export function releaseVelocity(samples: Sample[], windowMs = 100): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? ((last.v - first.v) / dt) * 1000 : 0;
}

/**
 * Whether a release closes the surface: it must not be moving back toward
 * open, and where the gesture was heading (release point plus projection)
 * must lie past half of the surface.
 */
export function shouldDismiss(offset: number, velocity: number, size: number): boolean {
  if (size <= 0 || offset <= 0) return false;
  if (velocity < -REVERSAL) return false;
  return offset + project(velocity) > size / 2;
}

/** A value on screen, in px along the drag, whatever unit an entrance animation left it in. */
function toPx(v: number | string, size: number): number {
  if (typeof v === "number") return v;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return v.trim().endsWith("%") ? (n / 100) * size : n;
}

export type Toward = "down" | "left" | "right";

export interface DragToDismiss {
  /** The motion value behind the surface's translateY ("down") or translateX ("left", "right"), in px. */
  value: MotionValue<number>;
  /** The way the surface leaves: the way it came in. */
  toward: Toward;
  /** Off where the surface is not a sheet or a drawer (a laptop's centred dialog). */
  enabled: boolean;
  /** The surface's extent along the drag, read when the drag starts. */
  size: () => number;
  /** 0 open, 1 gone: what fades with the surface (the scrim) follows. */
  onProgress?: (progress: number) => void;
  /** Let go short of closing: the surface is on its way back. */
  onSettle?: () => void;
  /** Let go far or fast enough: close. The surface is already moving out at the finger's speed. */
  onDismiss: () => void;
  reduced?: boolean;
}

export interface DragHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  /** Swallows the click a browser may still send once a drag has ended on a link or a button. */
  onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Pointer handlers for a surface that can be pulled away. Spread them on the
 * part of the surface that takes the drag: a sheet's header (with
 * `touch-action: none`, the whole vertical gesture is ours), or a whole
 * drawer (with `touch-action: pan-y`, the browser keeps vertical scrolling
 * and a horizontal pull comes here).
 */
export function useDragToDismiss(options: DragToDismiss): DragHandlers {
  // The latest options, read by handlers that live across renders.
  const opts = useRef(options);
  opts.current = options;
  const state = useRef({
    pointerId: null as number | null,
    committed: false,
    x0: 0,
    y0: 0,
    start: 0,
    size: 0,
    shown: 0,
    samples: [] as Sample[],
    endedAt: -Infinity,
  });

  const axisDelta = (e: React.PointerEvent, toward: Toward) => {
    const s = state.current;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    // Along the drag, signed so that toward dismissal is positive; across it, unsigned.
    if (toward === "down") return { along: dy, across: Math.abs(dx) };
    return { along: toward === "left" ? -dx : dx, across: Math.abs(dy) };
  };
  const sign = (toward: Toward) => (toward === "left" ? -1 : 1);

  const release = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    const s = state.current;
    if (e.pointerId !== s.pointerId) return;
    s.pointerId = null;
    if (!s.committed) return;
    s.committed = false;
    s.endedAt = e.timeStamp;
    const { value, toward, reduced, onDismiss, onSettle } = opts.current;
    const velocity = cancelled ? 0 : releaseVelocity(s.samples);
    const dir = sign(toward);
    if (!cancelled && shouldDismiss(s.shown, velocity, s.size)) {
      // Out at the finger's speed; the exit animation that follows starts from this motion.
      if (!reduced) animate(value, dir * s.size, { ...springSheet, velocity: dir * velocity });
      onDismiss();
      return;
    }
    animate(value, 0, reduced ? { duration: 0.15, ease: EASE_OUT } : { ...springSheet, velocity: dir * velocity });
    onSettle?.();
  };

  return {
    onPointerDown: (e) => {
      const s = state.current;
      if (!opts.current.enabled || e.pointerType === "mouse" || s.pointerId !== null) return;
      s.pointerId = e.pointerId;
      s.committed = false;
      s.x0 = e.clientX;
      s.y0 = e.clientY;
    },
    onPointerMove: (e) => {
      const s = state.current;
      if (e.pointerId !== s.pointerId) return;
      const { value, toward, size, onProgress } = opts.current;
      const { along, across } = axisDelta(e, toward);
      if (!s.committed) {
        if (Math.abs(along) < SLOP && across < SLOP) return;
        // Across the drag first: the browser's (a scroll), or nothing to do.
        if (across >= Math.abs(along)) {
          s.pointerId = null;
          return;
        }
        s.committed = true;
        s.size = size();
        // Grabbed mid-flight: stop where it is on the screen and carry on from there.
        value.stop();
        s.start = sign(toward) * toPx(value.get(), s.size);
        s.samples = [];
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer the browser has already released: tracking carries on without capture.
        }
      }
      const offset = s.start + along;
      // Toward open, past it: resistance that grows, never a wall.
      const shown = offset < 0 ? rubberband(offset, s.size) : offset;
      s.shown = shown;
      value.set(sign(toward) * shown);
      onProgress?.(s.size > 0 ? Math.min(1, Math.max(0, shown / s.size)) : 0);
      s.samples.push({ t: e.timeStamp, v: shown });
      if (s.samples.length > 12) s.samples.shift();
    },
    onPointerUp: (e) => release(e, false),
    onPointerCancel: (e) => release(e, true),
    onClickCapture: (e) => {
      if (e.timeStamp - state.current.endedAt < 400) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };
}

/** The scrim's way back to full once a surface settles open again. */
export const SCRIM_SETTLE = { duration: DUR.micro, ease: EASE_OUT } as const;
