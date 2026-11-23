import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { devvit } from '@devvit/start/vite';

// Owner test tools (TEST panel) are compiled in only for playtest builds:
//   CRASHDAY_TEST=1 npx devvit upload   -> test build
//   npx devvit upload                   -> live build, no test tools at all
export default defineConfig({
  plugins: [react(), devvit()],
  define: {
    __TEST_TOOLS__: JSON.stringify(process.env.CRASHDAY_TEST === '1'),
  },
});
