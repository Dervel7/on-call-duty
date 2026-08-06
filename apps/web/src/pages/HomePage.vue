<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import CardDescription from '@/components/ui/CardDescription.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col items-center py-12">
    <Card class="w-full">
      <CardHeader>
        <CardTitle>On-Call Duty Scheduling</CardTitle>
        <CardDescription>
          A simple, fair, and reliable way to plan doctor on-call rotations.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-6">
        <p class="text-sm text-muted-foreground">
          Coordinate monthly on-call schedules across your hospital with automated balancing,
          conflict detection, and transparent workload distribution.
        </p>
        <Button>Get started</Button>
      </CardContent>
    </Card>
  </div>
</template>
