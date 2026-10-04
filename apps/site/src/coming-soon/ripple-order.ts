/**
 * Entrance delays for the letters of a word that appears like a ripple in water: the middle
 * letter first (the middle two when the length is even), then outward one ring at a time.
 * Pure, so it can be tested without a page.
 */
export function rippleOrder(length: number, stepMs = 70): number[] {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError("length must be a whole number");
  }
  if (!Number.isFinite(stepMs) || stepMs < 0) {
    throw new RangeError("stepMs must be a finite number of at least 0");
  }
  const center = (length - 1) / 2;
  // With an even length the two middle letters sit half a step from the center: both ring 0.
  return Array.from({ length }, (_, index) => Math.floor(Math.abs(index - center)) * stepMs);
}
