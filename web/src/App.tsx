/**
 * App.tsx
 * 
 * 应用根组件：整体布局控制器
 * 
 * 功能说明：
 * - 使用 SplitPane 组件将界面分为上下两部分
 * - 上半部分：ChatPanel（聊天区域）
 * - 下半部分：DebugPanel（调试监控区域）
 * - 通过 useAguiSSE 和 useDebugWS 两个 Hook 获取数据
 * - 将数据分别传递给 ChatPanel 和 DebugPanel
 * 
 * 布局设计：
 * - 总高度 100vh（占满整个浏览器窗口）
 * - 上半部分默认高度 60%（聊天区域）
 * - 下半部分默认高度 40%（调试区域）
 * - 中间有拖拽条可以调整比例
 */

import ChatPanel from './components/ChatPanel'
import DebugPanel from './components/DebugPanel'
import SplitPane from './components/SplitPane'
import { useAguiSSE } from './hooks/useAguiSSE'
import { useDebugWS } from './hooks/useDebugWS'

function App() {
  // 初始化 AG-UI SSE 通信 Hook
  // messages: 聊天消息列表
  // sendMessage: 发送消息函数
  // isStreaming: 是否正在流式接收
  const { messages, sendMessage, isStreaming } = useAguiSSE()

  // 初始化 WebSocket 调试 Hook
  // clientRequests: 原始请求数据
  // aguiTransforms: 协议转换数据
  // agentInfos: Agent 内部事件数据
  // connected: 连接状态
  const {
    clientRequests,
    aguiTransforms,
    agentInfos,
    connected,
  } = useDebugWS()

  return (
    <div className="app-container">
      {/* 顶部标题栏 */}
      <header className="app-header">
        <h1>AG-UI 协议调试器</h1>
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          {connected ? '调试服务已连接' : '调试服务未连接'}
        </div>
      </header>

      {/* 上下分栏：ChatPanel 在上，DebugPanel 在下 */}
      <SplitPane
        direction="vertical"
        defaultRatio={0.6}
        minSize={200}
        className="app-main"
      >
        {/* 上半部分：聊天区域 */}
        <ChatPanel
          messages={messages}
          onSendMessage={sendMessage}
          isStreaming={isStreaming}
        />

        {/* 下半部分：调试监控区域 */}
        <DebugPanel
          clientRequests={clientRequests}
          aguiTransforms={aguiTransforms}
          agentInfos={agentInfos}
        />
      </SplitPane>
    </div>
  )
}

export default App
