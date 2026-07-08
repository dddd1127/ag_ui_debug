/**
 * SplitPane/index.tsx
 * 
 * 可调整大小的分栏组件
 * 
 * 功能说明：
 * - 支持上下分栏（vertical）和左右分栏（horizontal）
 * - 中间有拖拽条，可以调整两侧区域的大小比例
 * - 支持设置最小尺寸（minSize）
 * - 支持设置默认比例（defaultRatio）
 * 
 * 使用方式：
 * ```tsx
 * <SplitPane direction="vertical" defaultRatio={0.6} minSize={200}>
 *   <div>上半部分</div>
 *   <div>下半部分</div>
 * </SplitPane>
 * ```
 * 
 * 实现原理：
 * 1. 使用 React 的 ref 获取容器和子元素的 DOM 引用
 * 2. 监听 mousedown 事件开始拖拽
 * 3. 监听 mousemove 事件实时计算新的大小
 * 4. 监听 mouseup 事件结束拖拽
 * 5. 使用 CSS 控制子元素的 flex-basis 实现大小调整
 */

import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react'
import './SplitPane.css'

/**
 * 分栏方向类型
 * - vertical: 上下分栏（垂直方向）
 * - horizontal: 左右分栏（水平方向）
 */
type Direction = 'vertical' | 'horizontal'

/**
 * SplitPane 组件属性
 */
interface SplitPaneProps {
  /** 分栏方向 */
  direction: Direction
  /** 默认比例（0-1），默认 0.5 */
  defaultRatio?: number
  /** 最小尺寸（像素） */
  minSize?: number
  /** 子元素（必须是两个） */
  children: [ReactNode, ReactNode]
  /** 自定义类名 */
  className?: string
}

/**
 * 可调整大小的分栏组件
 * 
 * 属性：
 * - direction: 分栏方向（"vertical" 或 "horizontal"）
 * - defaultRatio: 默认比例（0-1）
 * - minSize: 最小尺寸（像素）
 * - children: 两个子元素
 */
export default function SplitPane({
  direction,
  defaultRatio = 0.5,
  minSize = 100,
  children,
  className = '',
}: SplitPaneProps) {
  // 容器引用
  const containerRef = useRef<HTMLDivElement>(null)
  // 当前比例（0-1）
  const [ratio, setRatio] = useState(defaultRatio)
  // 是否正在拖拽
  const [isDragging, setIsDragging] = useState(false)

  /**
   * 开始拖拽
   * 
   * 当用户在拖拽条上按下鼠标时触发
   * 
   * 参数：
   * - e: 鼠标事件
   */
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  /**
   * 处理拖拽中的鼠标移动
   * 
   * 当鼠标移动时，根据鼠标位置计算新的比例
   * 
   * 参数：
   * - e: 鼠标事件
   */
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return

      const container = containerRef.current
      const rect = container.getBoundingClientRect()

      let newRatio: number

      if (direction === 'vertical') {
        // 垂直方向：根据 Y 坐标计算
        const totalHeight = rect.height
        const mouseY = e.clientY - rect.top
        newRatio = mouseY / totalHeight
      } else {
        // 水平方向：根据 X 坐标计算
        const totalWidth = rect.width
        const mouseX = e.clientX - rect.left
        newRatio = mouseX / totalWidth
      }

      // 限制最小尺寸
      const minRatio = minSize / (direction === 'vertical' ? rect.height : rect.width)
      const maxRatio = 1 - minRatio
      newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio))

      setRatio(newRatio)
    },
    [isDragging, direction, minSize],
  )

  /**
   * 结束拖拽
   * 
   * 当用户释放鼠标时触发
   */
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  /**
   * 监听全局鼠标事件
   * 
   * 在拖拽过程中，需要监听全局的 mousemove 和 mouseup 事件
   * 因为鼠标可能移出了拖拽条区域
   */
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    } else {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  /**
   * 拖拽时的样式
   * 当正在拖拽时，禁止选择文本
   */
  const containerStyle: React.CSSProperties = {
    cursor: isDragging
      ? direction === 'vertical'
        ? 'row-resize'
        : 'col-resize'
      : 'default',
    userSelect: isDragging ? 'none' : 'auto',
  }

  return (
    <div
      ref={containerRef}
      className={`split-pane ${direction} ${className}`}
      style={containerStyle}
    >
      {/* 第一个子元素 */}
      <div
        className="split-pane-pane"
        style={
          direction === 'vertical'
            ? { height: `${ratio * 100}%`, flexShrink: 0 }
            : { width: `${ratio * 100}%`, flexShrink: 0 }
        }
      >
        {children[0]}
      </div>

      {/* 拖拽条 */}
      <div
        className={`split-pane-resizer ${direction}`}
        onMouseDown={handleMouseDown}
      />

      {/* 第二个子元素 */}
      <div
        className="split-pane-pane"
        style={
          direction === 'vertical'
            ? { height: `${(1 - ratio) * 100}%`, flexShrink: 0 }
            : { width: `${(1 - ratio) * 100}%`, flexShrink: 0 }
        }
      >
        {children[1]}
      </div>
    </div>
  )
}
