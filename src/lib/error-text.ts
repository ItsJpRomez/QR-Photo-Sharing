/** Every problem a person can be told about, with its status and sentence. */
export const ERRORS = {
  not_found: [404, "We couldn't find that."],
  forbidden: [403, "You don't have permission to do that."],
  unauthenticated: [401, 'Please sign in.'],
  unverified: [403, 'Please verify your email address first.'],
  pin_required: [401, 'This event needs a PIN.'],
  pin_wrong: [403, "That PIN isn't right."],
  pin_paused: [429, 'Too many wrong PINs for this event. Please try again in 10 minutes.'],
  frozen: [409, 'The host closed uploads.'],
  gallery_full: [409, 'This gallery is full.'],
  guest_limit: [409, "You've reached the photo limit for this event."],
  event_limit: [409, "You've reached the limit of events for your account."],
  rate_limited: [429, 'Too many tries. Please wait a moment and try again.'],
  too_large: [413, 'That photo is larger than 40 MB.'],
  bad_type: [415, "That file isn't a photo we can read."],
  bad_input: [400, "Some of that information isn't valid."],
  feature_off: [403, 'The host turned this off.'],
  removed_by_host: [409, 'The host removed this photo.'],
  conflict: [409, 'That changed at the same time. Please try again.'],
  internal: [500, 'Something went wrong. Please try again.'],
} as const satisfies Record<string, readonly [number, string]>

export type ErrorCode = keyof typeof ERRORS

export function errorMessage(code: ErrorCode): string {
  return ERRORS[code][1]
}

export function isErrorCode(code: string | undefined): code is ErrorCode {
  return code !== undefined && code in ERRORS
}
