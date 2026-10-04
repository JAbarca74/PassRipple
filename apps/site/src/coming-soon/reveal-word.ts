/**
 * Splits the hero word into letters. They enter like a ripple from the middle, then a single
 * scan sweep crosses the word; hover, or a tap on touch screens, fills a letter with the brand
 * wave (coming-soon.css). Screen readers read the word once: the letters are hidden from them.
 * Delays go through style.setProperty, which the CSP allows, unlike style attributes.
 */
import { rippleOrder } from "./ripple-order.ts";

/** When the first letters start, between the icon (0.3 s) and the label (0.6 s). */
const ENTRANCE_START_MS = 450;
/** Length of letter-in in coming-soon.css. */
const ENTRANCE_MS = 600;
const SWEEP_PAUSE_MS = 150;
const SWEEP_STEP_MS = 55;

const word = document.querySelector<HTMLElement>("[data-reveal-word]");
const text = word?.textContent?.trim() ?? "";

if (word && text) {
  // Code points, not UTF-16 units, so an accented letter stays whole.
  const chars = Array.from(text);
  const delays = rippleOrder(chars.length);
  const sweepStart = ENTRANCE_START_MS + Math.max(...delays) + ENTRANCE_MS + SWEEP_PAUSE_MS;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const label = document.createElement("span");
  label.className = "visually-hidden";
  label.textContent = text;

  const row = document.createElement("span");
  row.className = "hero-letters";
  row.setAttribute("aria-hidden", "true");

  chars.forEach((char, index) => {
    const letter = document.createElement("span");
    letter.className = still ? "hero-letter is-in" : "hero-letter";
    letter.textContent = char;
    letter.dataset.char = char;
    letter.style.setProperty("--delay", `${ENTRANCE_START_MS + (delays[index] ?? 0)}ms`);
    letter.style.setProperty("--sweep-delay", `${sweepStart + index * SWEEP_STEP_MS}ms`);
    row.append(letter);
  });

  row.addEventListener("animationend", (event) => {
    if (event.animationName === "letter-in" && event.target instanceof HTMLElement) {
      event.target.classList.add("is-in");
    }
  });

  // Mouse fills on hover (CSS). On touch, a tap fills a letter and the next tap releases it.
  row.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse" || !(event.target instanceof Element)) return;
    const letter = event.target.closest(".hero-letter");
    if (!letter) return;
    const wasFilled = letter.classList.contains("is-filled");
    for (const filled of row.querySelectorAll(".is-filled")) filled.classList.remove("is-filled");
    if (!wasFilled) letter.classList.add("is-filled", "is-in");
  });

  word.replaceChildren(label, row);
  word.classList.add("is-split");
}
