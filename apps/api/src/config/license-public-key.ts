/**
 * Public key used to verify the license file. This is a DEV keypair; the
 * private half is never committed. A developer who wants a locally-signed dev
 * license runs `pnpm --filter @oncall/api exec tsx scripts/license.ts keygen`
 * and pastes the generated public key into this file locally.
 * Production builds must replace the key and set LICENSE_PUBLIC_KEY_IS_DEV = false.
 */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWJqam1Uw6TkhEazltjWzPiI16kopZvn+1Q3eKCWxUl4=
-----END PUBLIC KEY-----`

/** Production builds must replace the key above and flip this to false. */
export const LICENSE_PUBLIC_KEY_IS_DEV = true
