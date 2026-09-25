/**
 * The listing wizard's steps, in order.
 *
 * Kept in one place because each screen needs to know its own number and the
 * total, and a step added to the route tree but forgotten here would leave
 * every later screen counting wrong.
 */
export const WIZARD_STEPS = [
  // Name and space type first, because this is the step that creates the
  // listing. Nothing is written until a host has said what they are listing:
  // opening a blank row here and naming it later left an unnamed "New spot"
  // on the dashboard for everyone who looked at the wizard and backed out.
  "type",
  // The only place the address is asked for, and where the pin is placed.
  "address",
  "photos",
  // What the space offers and what fits: covered or open, amenities, which
  // vehicles, size limits (replaced the separate features and limits steps).
  "details",
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
  return next ? stepPath(next, id) : id ? `/host/spot?id=${id}` : "/host/spot";
}

/** Where the wizard opens. Derived, so reordering the steps moves it too. */
export function firstStepPath(id?: string): string {
  return stepPath(WIZARD_STEPS[0], id);
}

/**
 * Where Back goes from a given step, when there is no history to go back to.
 *
 * Every wizard screen is a real URL, so a host can land on one cold -- a
 * browser reload, a link, a `replace` that ended the previous flow. `back()`
 * does nothing in that case, which reads as a broken button. Before the first
 * step the wizard is the Host tab, which is where it was opened from.
 */
export function prevStepPath(step: WizardStep, id?: string): string {
  const previous = WIZARD_STEPS[WIZARD_STEPS.indexOf(step) - 1];
  return previous ? stepPath(previous, id) : "/host";
}

function stepPath(step: WizardStep, id?: string): string {
  const path = `/host/spot/${step}`;
  return id ? `${path}?id=${id}` : path;
}

/** The step names the API uses for readiness items and rejections, as wizard steps. */
export function isWizardStep(value: string | null | undefined): value is WizardStep {
  return (WIZARD_STEPS as readonly string[]).includes(value ?? "");
}

/**
 * The route of one step, for links from the review screen and the status
 * page. `from: "review"` makes that step's Continue return to the review.
 */
export function stepHref(step: WizardStep, id: string, from?: "review"): string {
  return `${stepPath(step, id)}${from ? `&from=${from}` : ""}`;
}

/** A listing that is live (or paused by support): edits there are day-to-day changes, not a draft. */
export function isLiveStatus(status: string): boolean {
  return status === "PUBLISHED" || status === "ONGOING" || status === "SUSPENDED";
}
