import { describe, expect, it } from 'vitest'
import nginxConf from '../../nginx.conf?raw'

function apiLocationBlock(): string {
  const match = nginxConf.match(/location \/api\/ \{([^}]*)\}/)
  if (!match?.[1]) throw new Error('location /api/ block not found')
  return match[1]
}

describe('nginx.conf', () => {
  it('strips the /api prefix when proxying to the API', () => {
    expect(apiLocationBlock()).toMatch(/proxy_pass http:\/\/api:3000\/;/)
  })

  it('rewrites the refresh cookie path from /auth to /api/auth', () => {
    expect(apiLocationBlock()).toMatch(/proxy_cookie_path \/auth \/api\/auth;/)
  })
})
