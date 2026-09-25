/**
 * A failure whose message is written for the person using the app, not a
 * developer -- shown as-is by useAsyncAction, where any other non-API error
 * becomes "Something went wrong".
 */
export class UserError extends Error {}
