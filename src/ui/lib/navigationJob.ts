export type NavigationOutcome = "arrived" | "cancelled" | "unavailable" | "timed-out";

/** A bounded retry job. Capture listeners cannot catch a bubbling initiating key. */
export function runNavigationJob(
  step: () => boolean | "unavailable",
  onFinish: (outcome: NavigationOutcome) => void = () => {},
  timeoutMs = 3000,
) {
  let finished = false;
  let raf = 0;
  const deadline = performance.now() + timeoutMs;
  const finish = (outcome: NavigationOutcome) => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    for (const event of events) window.removeEventListener(event, cancel, true);
    onFinish(outcome);
  };
  const cancel = () => finish("cancelled");
  const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  for (const event of events) {
    window.addEventListener(event, cancel, { capture: true, passive: true });
  }
  // A background tab may stop producing frames altogether.
  const timer = setTimeout(() => finish("timed-out"), timeoutMs);
  const tick = () => {
    if (finished) return;
    if (performance.now() >= deadline) return finish("timed-out");
    const result = step();
    if (result === "unavailable") finish("unavailable");
    else if (result) finish("arrived");
    else if (!finished) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return cancel;
}
