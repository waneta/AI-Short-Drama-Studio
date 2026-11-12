import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { tokenPlanWebProxy } from './scripts/token-plan-proxy'

/** Packaged builds must not inline this machine's .env keys or endpoints. */
const packEnvDir = path.join(__dirname, 'scripts/pack-env')

function stripMachineEnvOnPack(): Plugin {
  return {
    name: 'strip-machine-env-on-pack',
    configResolved(config) {
      if (config.command !== 'build') return
      for (const key of Object.keys(config.env)) {
        if (key.startsWith('VITE_')) config.env[key] = ''
      }
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig(async ({ command, mode }) => {
  const web = mode === 'web'
  // Explicit local deployment only; never bake machine profiles into packaged builds.
  const startupVideoProfileFile = command === 'serve' && web ? process.env.JULIU_VIDEO_PROFILE_FILE : ''
  const startupVideoProfile = startupVideoProfileFile
    ? JSON.stringify(JSON.parse(readFileSync(path.resolve(startupVideoProfileFile), 'utf8')))
    : ''
  const startupImageProfileFile = command === 'serve' && web ? process.env.JULIU_IMAGE_PROFILE_FILE : ''
  const startupImageProfile = startupImageProfileFile
    ? JSON.stringify(JSON.parse(readFileSync(path.resolve(startupImageProfileFile), 'utf8')))
    : ''
  // Fixed server-side targets: browsers cannot supply arbitrary proxy destinations.
  const comfyTarget = new URL(process.env.COMFYUI_URL || 'http://127.0.0.1:8188')
  const comfyImageTarget = process.env.COMFYUI_IMAGE_URL ? new URL(process.env.COMFYUI_IMAGE_URL) : undefined
  const comfyRemoteImageTarget = process.env.COMFYUI_REMOTE_IMAGE_URL ? new URL(process.env.COMFYUI_REMOTE_IMAGE_URL) : undefined
  for (const [name, target] of [['COMFYUI_URL', comfyTarget], ['COMFYUI_IMAGE_URL', comfyImageTarget], ['COMFYUI_REMOTE_IMAGE_URL', comfyRemoteImageTarget]] as const) {
    if (target && (!['http:', 'https:'].includes(target.protocol) || target.username ||
        target.password || target.pathname !== '/' || target.search || target.hash)) {
      throw new Error(`${name} 必须是无账号、无路径的 HTTP(S) 地址，例如 http://127.0.0.1:8188`)
    }
  }
  const comfyProxy = (target: string, prefix: string): import('vite').ProxyOptions => ({
    target,
    changeOrigin: true,
    rewrite: (url: string) => url.slice(prefix.length),
    // Same-origin browser proxy; ComfyUI must not see the page Origin.
    configure: (server) => {
      server.on('proxyReq', (request) => request.removeHeader('origin'))
    }
  })
  const proxy = web ? {
    '^/comfy-local(?:/|\\?|$)': comfyProxy(comfyTarget.origin, '/comfy-local'),
    ...(comfyImageTarget ? {
      '^/comfy-image(?:/|\\?|$)': comfyProxy(comfyImageTarget.origin, '/comfy-image')
    } : {}),
    ...(comfyRemoteImageTarget ? {
      '^/comfy-remote-image(?:/|\\?|$)': comfyProxy(comfyRemoteImageTarget.origin, '/comfy-remote-image')
    } : {})
  } : undefined
  return {
    define: {
      'import.meta.env.VITE_COMFY_PROXY_TARGET': JSON.stringify(web ? comfyTarget.origin : ''),
      'import.meta.env.VITE_COMFY_REMOTE_IMAGE_PROXY_TARGET': JSON.stringify(web ? comfyRemoteImageTarget?.origin || '' : ''),
      'import.meta.env.VITE_COMFY_IMAGE_PROXY_TARGET': JSON.stringify(web ? comfyImageTarget?.origin || '' : ''),
      'import.meta.env.VITE_TOKEN_PLAN_WEB_PROXY': JSON.stringify(web ? 'true' : ''),
      'import.meta.env.VITE_STARTUP_VIDEO_PROFILE': JSON.stringify(startupVideoProfile),
      'import.meta.env.VITE_STARTUP_IMAGE_PROFILE': JSON.stringify(startupImageProfile)
    },
    base: './',
    envDir: command === 'build' ? packEnvDir : __dirname,
    build: {
      sourcemap: false
    },
    plugins: [
      stripMachineEnvOnPack(),
      vue(),
      ...(web ? [tokenPlanWebProxy()] : []),
      ...(web ? [] : [(await import('vite-plugin-electron/simple')).default({
        main: {
          entry: 'electron/main.ts',
          vite: {
            build: {
              rollupOptions: {
                external: ['node:sqlite']
              }
            }
          }
        },
        preload: {
          input: path.join(__dirname, 'electron/preload.ts'),
          vite: {
            build: {
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: 'preload.cjs',
                  inlineDynamicImports: true
                }
              }
            }
          }
        }
      })])
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      port: 5173,
      host: web ? '127.0.0.1' : '0.0.0.0',
      strictPort: web,
      proxy,
      // FFmpeg.wasm 需要 cross-origin isolation 启用 SharedArrayBuffer
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      },
      fs: {
        // 允许 serve public/ 目录
        strict: false
      }
    },
    preview: {
      port: 4173,
      host: web ? '127.0.0.1' : '0.0.0.0',
      strictPort: web,
      proxy,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      }
    },
    // FFmpeg core 的 wasm 不应该被 Vite 拦截处理
    assetsInclude: ['**/*.wasm'],
    optimizeDeps: {
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core']
    }
    // ⚠️ 不要设置 worker.format='es'：ffmpeg-core UMD 用 importScripts 加载，
    //    module worker 不支持，会导致 core 永远加载不出来。
  }
})
