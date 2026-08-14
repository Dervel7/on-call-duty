/**
 * Vendor-side license tooling (run from apps/api):
 *   pnpm --filter @oncall/api exec tsx scripts/license.ts keygen
 *   pnpm --filter @oncall/api exec tsx scripts/license.ts issue \
 *     --private-key ./license-private.pem --licensee "Clinic X" \
 *     --allowance 25 --window 90 --expires 2027-08-14 --out ./license.json
 *
 * keygen writes license-private.pem (KEEP SECRET) and license-public.pem
 * (bake into src/config/license-public-key.ts for production builds).
 *
 * Tokens are standard EdDSA (Ed25519) JWTs signed with node:crypto.
 * jsonwebtoken is not used because it does not support the EdDSA algorithm.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createPrivateKey, generateKeyPairSync, sign as signData } from 'node:crypto'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function signEdDSA(payload: Record<string, unknown>, privateKeyPem: string): string {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = signData(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    createPrivateKey(privateKeyPem),
  )
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`
}

function run(): void {
  const cmd = process.argv[2]
  if (cmd === 'keygen') {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    writeFileSync('license-private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }))
    writeFileSync('license-public.pem', publicKey.export({ type: 'spki', format: 'pem' }))
    console.log('Wrote license-private.pem (secret) and license-public.pem.')
    console.log('Replace src/config/license-public-key.ts with the public key for production builds.')
    return
  }
  if (cmd === 'issue') {
    const privateKeyPath = arg('private-key')
    const licensee = arg('licensee')
    const allowance = Number(arg('allowance') ?? 25)
    const window = Number(arg('window') ?? 90)
    const expires = arg('expires')
    const out = arg('out') ?? 'license.json'
    if (!privateKeyPath || !licensee || !expires) {
      console.error('issue requires --private-key, --licensee, --expires (YYYY-MM-DD)')
      process.exit(1)
    }
    const key = readFileSync(privateKeyPath, 'utf8')
    const token = signEdDSA(
      {
        licensee,
        doctor_allowance: allowance,
        rolling_window_days: window,
        exp: Math.floor(Date.parse(`${expires}T23:59:59Z`) / 1000),
      },
      key,
    )
    writeFileSync(out, token)
    console.log(`License written to ${out}`)
    return
  }
  console.error('Usage: license.ts keygen | issue --private-key ... --licensee ... --allowance N --window N --expires YYYY-MM-DD [--out file]')
  process.exit(1)
}

run()
