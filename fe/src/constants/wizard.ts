/**
 * The listing wizard's steps, in order.
 *
 * Kept in one place because each screen needs to know its own number and the
 * total, and a step added to the route tree but forgotten here would leave
 * every later screen counting wrong.
 */
export const WIZARD_STEPS = [
  // Address first, and it is the only place the address is asked for. It used
  // to be collected again by host onboarding before the wizard opened, which
  // meant a host typed it twice and the two copies were free to disagree.
  "address",
  "type",
  "photos",
  "availability",
  "pricing",
  "access",
  "documents",
  "payout",
  "review",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export const TOTAL_STEPS = WIZARD_STEPS.length;

export const stepNumber = (step: WizardStep) =>
  WIZARD_STEPS.indexOf(step) + 1;

/**
 * Where Continue goes from a given step.
 *
 * `id` is the listing the wizard is working on, carried forward as a query
 * param so every screen along the way -- and a browser back button, since
 * that just replays history -- keeps pointing at the same spot. A host can
 * have more than one, so a step that dropped it would have the next screen
 * fall back to guessing which one was meant.
 */
export function nextStepPath(step: WizardStep, id?: string): string {
  const next = WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1];
  const path = next ? `/host/spot/${next}` : "/host/spot";
  return id ? `${path}?id=${id}` : path;
}

/** Where the wizard opens. Derived, so reordering the steps moves it too. */
export function firstStepPath(id?: string): string {
  const path = `/host/spot/${WIZARD_STEPS[0]}`;
  return id ? `${path}?id=${id}` : path;
}
