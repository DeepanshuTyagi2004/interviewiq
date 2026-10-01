"use client";

import { useEffect } from "react";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const EASE = "cubic-bezier(.2,.7,.2,1)";

/**
 * Scroll-driven motion from the design, applied to server-rendered markup via data attributes:
 * - `data-reveal`   fades + un-blurs + rises into place the first time it enters the viewport
 *                   (only elements that start below the fold are hidden, so nothing visible blinks).
 * - `data-scramble` decodes its (uppercase) text through random letters.
 * - `data-count`    counts up from 0 to its value.
 * Renders nothing. Skipped entirely for `prefers-reduced-motion`.
 */
export function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timers = new Set<number>();
    const frames = new Set<number>();

    const scramble = (el: HTMLElement) => {
      const final = el.dataset.final ?? el.textContent ?? "";
      el.dataset.final = final;
      let f = 0;
      const id = window.setInterval(() => {
        el.textContent = final
          .split("")
          .map((c, i) => (i < f || c === " " ? c : LETTERS[(Math.random() * 26) | 0]))
          .join("");
        f += 0.6;
        if (f > final.length) {
          window.clearInterval(id);
          timers.delete(id);
          el.textContent = final;
        }
      }, 28);
      timers.add(id);
    };

    const count = (el: HTMLElement) => {
      const end = Number(el.dataset.count);
      if (!Number.isFinite(end)) return;
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / 1400);
        el.textContent = String(Math.round(end * (1 - Math.pow(1 - p, 3))));
        if (p < 1) frames.add(requestAnimationFrame(step));
      };
      frames.add(requestAnimationFrame(step));
    };

    const els = document.querySelectorAll<HTMLElement>("[data-reveal],[data-scramble],[data-count]");
    const vh = window.innerHeight;
    els.forEach((el) => {
      if (el.hasAttribute("data-reveal") && el.getBoundingClientRect().top > vh * 0.92) {
        Object.assign(el.style, {
          opacity: "0",
          transform: "translateY(26px)",
          filter: "blur(8px)",
          transition: `opacity .9s ${EASE}, transform .9s ${EASE}, filter .9s`,
        });
      }
    });

    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          if (el.hasAttribute("data-reveal")) {
            Object.assign(el.style, { opacity: "1", transform: "none", filter: "none" });
          }
          if (el.hasAttribute("data-scramble")) scramble(el);
          if (el.hasAttribute("data-count")) count(el);
          io.unobserve(el);
        }),
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));

    return () => {
      io.disconnect();
      timers.forEach((id) => window.clearInterval(id));
      frames.forEach((id) => cancelAnimationFrame(id));
      // Leave the page readable if this unmounts mid-animation.
      els.forEach((el) => {
        if (el.hasAttribute("data-reveal")) Object.assign(el.style, { opacity: "", transform: "", filter: "" });
        if (el.dataset.final) el.textContent = el.dataset.final;
        if (el.dataset.count) el.textContent = el.dataset.count;
      });
    };
  }, []);

  return null;
}
