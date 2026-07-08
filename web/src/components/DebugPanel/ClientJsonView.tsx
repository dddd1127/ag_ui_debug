/**
 * ClientJsonView.tsx
 * 
 * 客户端请求 JSON 展示组件（调试面板左栏）
 * 
 * 功能说明：
 * - 展示前端发送到后端的原始 AG-UI 请求 JSON
 * - 支持 JSON 折叠/展开查看
 * - 按时间倒序排列（最新请求在顶部）
 * - 高亮关键字段（threadId, runId, messages 等）
 * 
 * 数据格式：
 * 每个数据项包含：
 * - id: 唯一标识
 * - timestamp: 时间戳
 * - data: { request: RunAgentInput JSON }
 */

import { useState } from 'react'
import { Collapse, Tag } from 'antd'
import { formatJSON } from '../../utils/jsonFormatter'
import type { ClientRequestItem } from '../../hooks/useDebugWS'

const { Panel } = Collapse

/**
 * 格式化时间戳
 * 将毫秒时间戳转换为可读字符串
 * 
 * 参数：
 * - timestamp: 毫秒时间戳
 * 
 * 返回：
 * - 格式化字符串（如 "14:30:25.123"）
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')
  const ms = date.getMilliseconds().toString().padStart(3, '0')
  return `${hours}:${minutes}:${seconds}.${ms}`
}

/**
 * 提取关键字段摘要
 * 从请求 JSON 中提取最重要的几个字段用于展示
 * 
 * 参数：
 * - request: 请求对象
 * 
 * 返回：
 * - 摘要信息数组
 */
function extractSummary(request: Record<string, any>, item: { runId?: string; threadId?: string }): Array<{label: string, value: string}> {
  const summary = []
  
  // 优先显示 item 级别的关联标识
  if (item.runId) {
    summary.push({ label: '运行', value: item.runId })
  } else if (request.runId) {
    summary.push({ label: '运行', value: request.runId })
  }
  if (item.threadId) {
    summary.push({ label: '会话', value: item.threadId })
  } else if (request.threadId) {
    summary.push({ label: '会话', value: request.threadId })
  }
  if (request.messages && Array.isArray(request.messages)) {
    summary.push({ label: '消息数', value: `${request.messages.length} 条` })
  }
  if (request.tools && Array.isArray(request.tools)) {
    summary.push({ label: '工具数', value: `${request.tools.length} 个` })
  }
  
  return summary
}

/**
 * 客户端请求 JSON 展示组件
 * 
 * 属性：
 * - data: 客户端请求数据列表
 */
export default function ClientJsonView({ data }: { data: ClientRequestItem[] }) {
  // 当前展开的项
  const [activeKeys, setActiveKeys] = useState<string[]>([])

  return (
    <div className="client-json-view" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 标题栏 */}
      <div className="panel-header">
        <h3 className="panel-title">📤 客户端请求</h3>
        <span className="panel-count">{data.length} 条记录</span>
      </div>

      {/* 数据列表 */}
      <div className="panel-content">
        {data.length === 0 ? (
          <div className="empty-panel">
            <div className="empty-icon">📭</div>
            <div className="empty-text">等待发送请求...</div>
          </div>
        ) : (
          <Collapse
            activeKey={activeKeys}
            onChange={setActiveKeys}
            ghost
          >
            {data.map((item) => {
              const request = item.data?.request || {}
              const summary = extractSummary(request, item)
              
              return (
                <Panel
                  key={item.id}
                  header={
                    <div className="request-header">
                      <span className="request-time">{formatTime(item.timestamp)}</span>
                      <div className="request-summary">
                        {summary.map((s, i) => (
                          <Tag key={i} className="summary-tag">
                            {s.label}: {s.value}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  }
                >
                  <div className="request-detail">
                    <pre className="json-code">
                      {formatJSON(request, 2)}
                    </pre>
                  </div>
                </Panel>
              )
            })}
          </Collapse>
        )}
      </div>
    </div>
  )
}
