// vite.config.ts
import { fileURLToPath, URL } from "node:url";
import react from "file:///D:/projects/React-Ts/watt-nexa/node_modules/.pnpm/@vitejs+plugin-react@4.7.0__1a87a688b7ae168f3dfe5f8db291d7b7/node_modules/@vitejs/plugin-react/dist/index.js";
import { defineConfig } from "file:///D:/projects/React-Ts/watt-nexa/node_modules/.pnpm/vite@6.4.6_@types+node@22.20.5_jiti@1.21.7_tsx@4.23.15/node_modules/vite/dist/node/index.js";
var __vite_injected_original_import_meta_url = "file:///D:/projects/React-Ts/watt-nexa/apps/web/vite.config.ts";
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", __vite_injected_original_import_meta_url)),
      "@wattnexa/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", __vite_injected_original_import_meta_url)),
      "@wattnexa/types": fileURLToPath(new URL("../../packages/types/src/index.ts", __vite_injected_original_import_meta_url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/socket.io": { target: "http://localhost:4000", ws: true }
    }
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxwcm9qZWN0c1xcXFxSZWFjdC1Uc1xcXFx3YXR0LW5leGFcXFxcYXBwc1xcXFx3ZWJcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXHByb2plY3RzXFxcXFJlYWN0LVRzXFxcXHdhdHQtbmV4YVxcXFxhcHBzXFxcXHdlYlxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDovcHJvamVjdHMvUmVhY3QtVHMvd2F0dC1uZXhhL2FwcHMvd2ViL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZmlsZVVSTFRvUGF0aCwgVVJMIH0gZnJvbSAnbm9kZTp1cmwnO1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgJ0AnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vc3JjJywgaW1wb3J0Lm1ldGEudXJsKSksXG4gICAgICAnQHdhdHRuZXhhL3NoYXJlZCc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi4vLi4vcGFja2FnZXMvc2hhcmVkL3NyYy9pbmRleC50cycsIGltcG9ydC5tZXRhLnVybCkpLFxuICAgICAgJ0B3YXR0bmV4YS90eXBlcyc6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi4vLi4vcGFja2FnZXMvdHlwZXMvc3JjL2luZGV4LnRzJywgaW1wb3J0Lm1ldGEudXJsKSksXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBwcm94eToge1xuICAgICAgJy9hcGknOiB7IHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6NDAwMCcsIGNoYW5nZU9yaWdpbjogdHJ1ZSB9LFxuICAgICAgJy9zb2NrZXQuaW8nOiB7IHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6NDAwMCcsIHdzOiB0cnVlIH0sXG4gICAgfSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICBvdXREaXI6ICdkaXN0JyxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogOTAwLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQW1ULFNBQVMsZUFBZSxXQUFXO0FBQ3RWLE9BQU8sV0FBVztBQUNsQixTQUFTLG9CQUFvQjtBQUZvSyxJQUFNLDJDQUEyQztBQUlsUCxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxjQUFjLElBQUksSUFBSSxTQUFTLHdDQUFlLENBQUM7QUFBQSxNQUNwRCxvQkFBb0IsY0FBYyxJQUFJLElBQUksc0NBQXNDLHdDQUFlLENBQUM7QUFBQSxNQUNoRyxtQkFBbUIsY0FBYyxJQUFJLElBQUkscUNBQXFDLHdDQUFlLENBQUM7QUFBQSxJQUNoRztBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFFBQVEsRUFBRSxRQUFRLHlCQUF5QixjQUFjLEtBQUs7QUFBQSxNQUM5RCxjQUFjLEVBQUUsUUFBUSx5QkFBeUIsSUFBSSxLQUFLO0FBQUEsSUFDNUQ7QUFBQSxFQUNGO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixXQUFXO0FBQUEsSUFDWCx1QkFBdUI7QUFBQSxFQUN6QjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
