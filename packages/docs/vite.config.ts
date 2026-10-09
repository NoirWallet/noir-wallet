import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import mdx from 'fumadocs-mdx/vite'

export default defineConfig({
  plugins: [mdx(), tailwindcss(), reactRouter(), tsconfigPaths()],
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  ssr: {
    noExternal: [
      /^fumadocs-ui(?:\/|$)/,
      /^@radix-ui\//,
      '@floating-ui/react-dom',
      'react-remove-scroll',
      'react-remove-scroll-bar',
      'react-style-singleton',
      'use-callback-ref',
      'use-sidecar'
    ],
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server']
  }
})
