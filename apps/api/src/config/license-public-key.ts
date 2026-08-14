/**
 * Public key used to verify the license file. This is a DEV keypair committed
 * for local development and tests. For production, generate a new keypair with
 * `pnpm --filter @oncall/api exec tsx scripts/license.ts keygen` and replace
 * this constant with the generated public key before building.
 */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEATmwuNpNtIR49lG3kGanXcrWCsHrDFc/ly1vHL/+k+E0=
-----END PUBLIC KEY-----`
