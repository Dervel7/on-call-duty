import { config } from 'dotenv'
import { resolve } from 'node:path'
import { z } from 'zod'

config({ path: resolve(import.meta.dirname, '../../.env') })

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGIN: z.string().default('http://localhost:5174'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    // Format is fixed to "<n>h" or "<n>d" because token.service derives the DB
    // expiry and cookie maxAge from it; anything else would silently fall back
    // to 1 hour.
    JWT_REFRESH_EXPIRES_IN: z.string().regex(/^\d{1,4}[hd]$/, 'JWT_REFRESH_EXPIRES_IN must be like 1h or 7d').default('1h'),
    COOKIE_SECURE: z
      .string()
      .optional()
      .transform((v) => (v === undefined ? process.env.NODE_ENV === 'production' : v === 'true')),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_DOMAIN: z.string().optional(),
  })
  .refine((env) => env.COOKIE_SAMESITE !== 'none' || env.COOKIE_SECURE, {
    message: 'COOKIE_SECURE must be true when COOKIE_SAMESITE is none',
  })

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data

export type Env = z.infer<typeof schema>
