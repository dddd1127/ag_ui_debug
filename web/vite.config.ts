import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Vite 构建配置文件
 * 
 * 核心功能：
 * 1. React 插件支持（JSX 转换、Fast Refresh）
 * 2. 开发服务器代理配置：将前端请求转发到后端服务
 *    - /ag-ui → http://localhost:8090（AG-UI 协议 SSE 端点）
 *    - /debug → ws://localhost:8090（WebSocket 调试端点）
 * 
 * 代理配置解决了前端开发时的跨域问题（CORS），
 * 因为前端运行在 http://localhost:5173，后端在 http://localhost:8090
 */

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // AG-UI 协议 SSE 端点代理
      // 前端发送 POST /ag-ui 请求时，Vite 将其转发到后端 FastAPI 服务
      '/ag-ui': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        // 修复 SSE 流式响应：确保代理不缓冲响应
        configure: (proxy, _options) => {
          proxy.on('proxyRes', (proxyRes, _req, _res) => {
            // 确保响应头正确设置，禁用缓冲
            proxyRes.headers['x-accel-buffering'] = 'no'
          })
        },
      },
      // WebSocket 调试端点代理
      // 前端 ws://localhost:5173/debug/ws 会被代理到 ws://localhost:8090/debug/ws
      '/debug': {
        target: 'ws://localhost:8090',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
