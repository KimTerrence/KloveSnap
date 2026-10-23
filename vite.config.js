import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  // basicSsl serves over https so phones on the network can use the camera
  plugins: [react(), tailwindcss(), basicSsl()],
  server: { host: true },
  preview: { host: true },
})
