/**
 * DebugPanel/index.tsx
 * 
 * 调试监控面板组装组件
 * 
 * 功能说明：
 * - 将三栏（ClientJsonView、AguiTransformView、AgentInfoView）并排展示
 * - 使用 CSS Grid 或 Flex 实现三栏等宽布局
 * - 支持栏之间拖拽调整宽度（可选）
 * 
 * 布局结构：
 * ```
 * ┌──────────┬──────────────┬──────────────┐
 * │ 客户端   │ 协议转换      │ Agent 内部   │
 * │ 请求 JSON│ 过程          │ 信息         │
 * ├──────────┼──────────────┼──────────────┤
 * │          │              │              │
 * │ 数据列表  │ 数据列表      │ 数据列表      │
 * │          │              │              │
 * └──────────┴──────────────┴──────────────┘
 * ```
 */

import ClientJsonView from './ClientJsonView'
import AguiTransformView from './AguiTransformView'
import AgentInfoView from './AgentInfoView'
import type {
  ClientRequestItem,
  AguiTransformItem,
  AgentEventItem,
} from '../../hooks/useDebugWS'
import './DebugPanel.css'

/**
 * 调试面板属性
 */
interface DebugPanelProps {
  /** 客户端请求数据 */
  clientRequests: ClientRequestItem[]
  /** 协议转换数据 */
  aguiTransforms: AguiTransformItem[]
  /** Agent 内部事件数据 */
  agentInfos: AgentEventItem[]
}

/**
 * 调试监控面板组件
 * 
 * 三栏并排展示：
 * - 左栏：客户端原始请求 JSON
 * - 中栏：AG-UI 协议转换过程
 * - 右栏：Agent 内部运行信息
 */
export default function DebugPanel({
  clientRequests,
  aguiTransforms,
  agentInfos,
}: DebugPanelProps) {
  return (
    <div className="debug-panel" style={{ overflow: 'hidden' }}>
      {/* 左栏：客户端请求 */}
      <div className="debug-column" style={{ overflow: 'auto' }}>
        <ClientJsonView data={clientRequests} />
      </div>

      {/* 中栏：协议转换 */}
      <div className="debug-column" style={{ overflow: 'auto' }}>
        <AguiTransformView data={aguiTransforms} />
      </div>

      {/* 右栏：Agent 内部信息 */}
      <div className="debug-column" style={{ overflow: 'auto' }}>
        <AgentInfoView data={agentInfos} />
      </div>
    </div>
  )
}
