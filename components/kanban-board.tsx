'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  closestCorners,
  PointerSensor,
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

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const getCardsByStatus = useCallback(
    (status: string) =>
      cards.filter((c) => c.status === status).sort((a, b) => a.position - b.position),
    [cards]
  );

  const handleDragStart = (event: DragStartEvent) => {
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

  const handleRefresh = async () => {
    const res = await fetch('/api/cards');
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
        <div className="flex gap-5 overflow-x-auto p-4 sm:p-6 h-[calc(100vh-100px)]">
          {COLUMNS.map((column, idx) => (
            <div
              key={column.id}
              className="animate-slide-in-right"
              style={{ animationDelay: `${idx * 0.08}s` }}
            >
              <KanbanColumn
                id={column.id}
                title={column.title}
                color={column.color}
                borderColor={column.borderColor}
                cards={getCardsByStatus(column.id)}
                onCardClick={(card) => setSelectedCard(card)}
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
