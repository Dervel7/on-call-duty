import { computed, type ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * Manager drill-down selection. The route query (`?clinic=<id>`) is the single
 * source of truth so links stay shareable and the back button works; other
 * query params are preserved on every change.
 */
export function useClinicSelection(): {
  selectedClinicId: ComputedRef<number | undefined>
  setClinic: (id: number | undefined) => void
} {
  const route = useRoute()
  const router = useRouter()

  const selectedClinicId = computed<number | undefined>(() => {
    const raw = route.query.clinic
    const value = Array.isArray(raw) ? raw[0] : raw
    if (typeof value !== 'string' || value === '') return undefined
    const n = Number(value)
    return Number.isInteger(n) && n > 0 ? n : undefined
  })

  function setClinic(id: number | undefined): void {
    const clinic = id === undefined ? undefined : String(id)
    router.replace({ query: { ...route.query, clinic } })
  }

  return { selectedClinicId, setClinic }
}
