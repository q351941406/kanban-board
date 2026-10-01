'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  closestCorners,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Card, COLUMNS } from '@/types';
import KanbanColumn from './kanban-column';
import KanbanCard from './kanban-card';
import CardModal from './card-modal';
import AddCardModal from './add-card-modal';
import { moveCard } from '@/app/actions';

const VALID_STATUSES = ['todo', 'in_progress', 'testing', 'done'] as const;

// 提到模块级是为了引用稳定：useSensor 内部是 useMemo(..., [sensor, options])，
// 内联字面量会让 options 每次渲染都是新引用，memo 永不命中，sensors 数组每次重建。
const MOUSE_ACTIVATION = { activationConstraint: { distance: 6 } };
// delay 必须是 number 而不是 { duration, tolerance }：
// @dnd-kit/core v6 的实现是 setTimeout(start, constraint.delay)，
// 传对象会被转成 NaN → 0ms，长按约束等于没加（类型上也会报错）。
const TOUCH_ACTIVATION = { activationConstraint: { delay: 200, tolerance: 5 } };

interface KanbanBoardProps {
  currentProjectId: string;
  initialCards: Card[];
}

export default function KanbanBoard({ initialCards, currentProjectId }: KanbanBoardProps) {
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [addCardStatus, setAddCardStatus] = useState<string | null>(null);
  const cardsRef = useRef(cards);
  // 记录拖拽开始时的真实状态：handleDragOver 会乐观改写 status，
  // 若拿改写后的 state 去判断"有没有移动"，拖到空列会被误判为没动。
  const dragOriginRef = useRef<{ status: string; position: number } | null>(null);
  // 触摸端长按拖拽后浏览器仍会补发一次 click，用这个标记区分「点了一下」
  // 和「刚拖完」，否则松手会误开详情弹窗。
  // 用布尔标记 + 定时复位，而不是存时间戳：Date.now() 是 impure 调用，
  // 放在组件函数体里会被 react-hooks/purity 判为渲染期调用。
  const justDraggedRef = useRef(false);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  const sensors = useSensors(
    // 必须显式区分 mouse / touch：PointerSensor 会用同一套约束接管两者，
    // 那样 distance 在触屏上会让「滑动看列」被误判成拖拽、劫持滚动。
    // MouseSensor 只绑 onMouseDown，桌面仍是位移 6px 即激活，手感不变。
    useSensor(MouseSensor, MOUSE_ACTIVATION),
    // 触摸：长按 200ms 才激活（5px 容差内移动不取消），
    // 于是短按=打开详情、滑动=滚动，只有长按才进入拖拽。
    // TouchSensor 内部注册了非 passive 的 touchmove，preventDefault 在 iOS Safari 才生效。
    useSensor(TouchSensor, TOUCH_ACTIVATION)
  );

  // 这里额外按 projectId 过滤是刻意的冗余：接口已经按项目过滤了，
  // 但看板的数据一旦被别的来源污染，渲染层是最后一道防线，
  // 绝不能把其他项目的卡片画到当前项目里。
  const getCardsByStatus = useCallback(
    (status: string) =>
      cards
        .filter((c) => c.projectId === currentProjectId && c.status === status)
        .sort((a, b) => a.position - b.position),
    [cards, currentProjectId]
  );

  const handleDragStart = (event: DragStartEvent) => {
    justDraggedRef.current = false;
    const card = cardsRef.current.find((c) => c.id === event.active.id);
    if (card) {
      setActiveCard(card);
      dragOriginRef.current = { status: card.status, position: card.position };
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    const activeCard = cards.find((c) => c.id === activeId);
    const overCard = cards.find((c) => c.id === overId);
    if (!activeCard) return;
    const overColumn = COLUMNS.find((col) => col.id === overId);
    if (overColumn && activeCard.status !== overColumn.id) {
      setCards((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, status: overColumn.id } : c))
      );
      return;
    }
    if (overCard && activeCard.status !== overCard.status) {
      setCards((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, status: overCard.status } : c))
      );
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);
    // 拖拽刚结束：吞掉紧随其后的那一次 click
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 300);
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    // 从最新快照同步计算，不要在 setState 回调里做赋值副作用：
    // React 会批处理/延迟执行 updater，那样读到的是初始值，moveCard 将永远不被调用。
    const current = cardsRef.current;
    const activeCard = current.find((c) => c.id === activeId);
    if (!activeCard) return;

    const overCard = current.find((c) => c.id === overId);
    const overColumn = COLUMNS.find((col) => col.id === overId);

    // 卡片由 useSortable 注册，本身也是 droppable：拖到空列时 over 常常就是
    // 卡片自己。此时要沿用它的 status（已被 handleDragOver 更新为目标列），
    // 绝不能因 over === active 就判定"没移动"提前返回——那正是拖拽不生效的原因。
    const targetStatus = overColumn?.id ?? overCard?.status ?? activeCard.status;
    const finalStatus = (VALID_STATUSES as readonly string[]).includes(targetStatus)
      ? targetStatus
      : activeCard.status;

    // 目标列内的插入下标（排除自身，按 position 排序）
    const siblings = current
      .filter((c) => c.status === finalStatus && c.id !== activeId)
      .sort((a, b) => a.position - b.position);

    let finalPosition = siblings.length;
    if (overCard && overCard.id !== activeId && overCard.status === finalStatus) {
      const idx = siblings.findIndex((c) => c.id === overCard.id);
      if (idx >= 0) finalPosition = idx;
    }

    // 与拖拽开始前的状态比对，真正没动才跳过
    const changed = !origin || origin.status !== finalStatus || origin.position !== finalPosition;
    if (!changed) return;

    // 乐观更新本地 UI：移动卡片并重排目标列 position
    setCards((prev) => {
      const others = prev.filter((c) => c.id !== activeId);
      const moved = { ...activeCard, status: finalStatus, position: finalPosition };
      const inTarget = others
        .filter((c) => c.status === finalStatus)
        .sort((a, b) => a.position - b.position);
      inTarget.splice(finalPosition, 0, moved);
      const reindexed = inTarget.map((c, i) => ({ ...c, position: i }));
      return [...others.filter((c) => c.status !== finalStatus), ...reindexed];
    });

    // 持久化；失败则从服务端拉回真实状态，避免 UI 与数据库不一致
    try {
      await moveCard(activeId, finalStatus, finalPosition);
    } catch (e) {
      console.error('移动卡片失败，正在回滚', e);
      await handleRefresh();
    }
  };

  const handleCardClick = (card: Card) => {
    if (justDraggedRef.current) return;
    setSelectedCard(card);
  };

  const handleRefresh = async () => {
    // 必须带 projectId：不带的话接口会返回该用户所有项目的卡片，
    // 新增/删除卡片后就会把别的项目的任务串到当前看板。
    const res = await fetch(`/api/cards?projectId=${encodeURIComponent(currentProjectId)}`);
    if (!res.ok) return;
    const data = await res.json();
    setCards(data);
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-5 overflow-x-auto snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 sm:snap-none p-4 sm:p-6 flex-1 min-h-0 pb-[calc(1rem_+_env(safe-area-inset-bottom,0px))] sm:pb-6">
          {COLUMNS.map((column, idx) => (
            <div
              key={column.id}
              className="animate-slide-in-right snap-start sm:snap-align-none"
              style={{ animationDelay: `${idx * 0.08}s` }}
            >
              <KanbanColumn
                id={column.id}
                title={column.title}
                color={column.color}
                borderColor={column.borderColor}
                cards={getCardsByStatus(column.id)}
                onCardClick={handleCardClick}
                onAddCard={() => setAddCardStatus(column.id)}
              />
            </div>
          ))}
        </div>
        <DragOverlay>
          {activeCard && (
            <div className="rotate-[3deg] scale-105 shadow-elevated">
              <KanbanCard card={activeCard} onClick={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {selectedCard && (
        <CardModal
          card={cards.find((c) => c.id === selectedCard.id) || selectedCard}
          onClose={() => setSelectedCard(null)}
          onUpdate={handleRefresh}
        />
      )}

      {addCardStatus && (
        <AddCardModal projectId={currentProjectId} 
          defaultStatus={addCardStatus}
          onClose={() => setAddCardStatus(null)}
          onUpdate={handleRefresh}
        />
      )}
    </>
  );
}
