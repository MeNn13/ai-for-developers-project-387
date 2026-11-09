import { defineConfig } from 'orval'

export default defineConfig({
  bookingCalendar: {
    input: './openapi/openapi.yaml',
    output: {
      target: '../frontend/src/api/generated/booking.ts',
      client: 'fetch',
      mode: 'single',
      clean: true,
      prettier: true,
    },
  },
})
