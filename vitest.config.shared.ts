import { defineConfig } from 'vitest/config'

export const sharedVitest = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
    },
  },
})

export default sharedVitest
