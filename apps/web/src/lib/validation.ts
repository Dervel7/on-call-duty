import type { ZodIssue } from 'zod'

type Translate = (key: string, named?: Record<string, unknown>) => string

/** Translates a Zod issue; the shared schemas only carry English default messages. */
export function issueText(issue: ZodIssue | undefined, t: Translate): string {
  if (!issue) return t('common.invalidInput')
  if (issue.code === 'too_small') {
    return t(issue.type === 'string' ? 'validation.minLength' : 'validation.min', {
      min: Number(issue.minimum),
    })
  }
  if (issue.code === 'too_big') {
    return t(issue.type === 'string' ? 'validation.maxLength' : 'validation.max', {
      max: Number(issue.maximum),
    })
  }
  if (issue.code === 'invalid_string' && issue.validation === 'email') return t('validation.email')
  if (issue.code === 'invalid_string' && issue.validation === 'regex' && issue.path.at(-1) === 'username') {
    return t('validation.username')
  }
  return t('common.invalidInput')
}
