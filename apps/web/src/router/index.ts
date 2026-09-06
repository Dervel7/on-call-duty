import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import type { Role } from '@oncall/shared'
import { useAuthStore } from '@/stores/auth'
import { resolveGuard } from './guard'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    roles?: Role[]
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../pages/LoginPage.vue'),
    meta: { public: true },
  },
  {
    path: '/locked',
    name: 'locked',
    component: () => import('../pages/LockedPage.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('../layouts/DefaultLayout.vue'),
    children: [
      { path: '', name: 'home', component: () => import('../pages/HomePage.vue') },
      {
        path: 'roster',
        name: 'roster',
        component: () => import('../pages/ScheduleRosterPage.vue'),
        meta: { roles: ['doctor'] },
      },
      { path: 'profile', name: 'profile', component: () => import('../pages/ProfilePage.vue') },
      {
        path: 'users',
        name: 'users',
        component: () => import('../pages/UsersPage.vue'),
        meta: { roles: ['administrator'] },
      },
      {
        path: 'doctors',
        name: 'doctors',
        component: () => import('../pages/DoctorsPage.vue'),
        meta: { roles: ['administrator'] },
      },
      {
        path: 'availability',
        name: 'availability',
        component: () => import('../pages/AvailabilityPage.vue'),
        meta: { roles: ['administrator'] },
      },
      {
        path: 'schedules/preview',
        name: 'schedule-preview',
        component: () => import('../pages/SchedulePreviewPage.vue'),
        meta: { roles: ['administrator'] },
      },
      {
        path: 'schedules',
        name: 'schedules',
        component: () => import('../pages/SchedulesPage.vue'),
        meta: { roles: ['administrator', 'doctor'] },
      },
      {
        path: 'schedules/:id',
        name: 'schedule-detail',
        component: () => import('../pages/ScheduleDetailPage.vue'),
        meta: { roles: ['administrator', 'doctor'] },
      },
      {
        path: 'holidays',
        name: 'holidays',
        component: () => import('../pages/HolidaysPage.vue'),
        meta: { roles: ['administrator'] },
      },
      {
        path: 'reports',
        name: 'reports',
        component: () => import('../pages/ReportsPage.vue'),
        meta: { roles: ['administrator'] },
      },
      {
        path: 'activity',
        name: 'activity',
        component: () => import('../pages/ActivityPage.vue'),
        meta: { roles: ['administrator'] },
      },
      {
        path: 'usage',
        name: 'usage',
        component: () => import('../pages/UsagePage.vue'),
        meta: { roles: ['superadmin'] },
      },
      {
        path: 'my-availability',
        name: 'my-availability',
        component: () => import('../pages/MyAvailabilityPage.vue'),
      },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => resolveGuard(to, useAuthStore()))
