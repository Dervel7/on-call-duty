// Guards async loads against out-of-order responses: only the latest start() stays current.
export function useLatestRequest() {
  let seq = 0
  return {
    start() {
      const mine = ++seq
      return () => mine === seq
    },
  }
}
