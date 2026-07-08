/**
 * main.tsx
 * 
 * 项目入口文件：React 应用挂载点
 * 
 * 功能说明：
 * - 引入 React 严格模式（StrictMode），帮助检测潜在问题
 * - 引入 Ant Design 全局样式（重置浏览器默认样式）
 * - 将 React 应用挂载到 DOM 的 id="root" 元素上
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import App from './App'
import './App.css'

// 配置 Ant Design 中文主题
const antdConfig = {
  theme: {
    token: {
      colorPrimary: '#1677ff',
    },
  },
}

// 创建 React 根节点并渲染应用
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider {...antdConfig}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
