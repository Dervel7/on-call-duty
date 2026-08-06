export function required(name: string, value: string | undefined): string {
  if (value === undefined) {
    throw new Error(`${name} is required`)
  }
  return value
}
