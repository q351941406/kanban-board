'use server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser, signToken, setAuthCookie, clearAuthCookie } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { revalidatePath } from 'next/cache';
const VALID_STATUSES = ['todo', 'in_progress', 'testing', 'done'] as const;
const VALID_PRIORITIES = ['high', 'medium', 'low'] as const;
type ValidStatus = typeof VALID_STATUSES[number];
type ValidPriority = typeof VALID_PRIORITIES[number];
// Auth actions
export async function register(name: string, email: string, password: string) {
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return { error: '邮箱已被注册' };
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword },
    });
    const token = signToken(user.id);
    await setAuthCookie(token);
    return { success: true };
  } catch {
    return { error: '注册失败，请重试' };
  }
}
export async function login(email: string, password: string) {
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return { error: '邮箱或密码错误' };
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return { error: '邮箱或密码错误' };
    const token = signToken(user.id);
    await setAuthCookie(token);
    return { success: true };
  } catch {
    return { error: '登录失败，请重试' };
  }
}
export async function logout() {
  await clearAuthCookie();
}
// Card actions
export async function createCard(data: { title: string; description?: string; priority: string; status: string; projectId: string }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  
  if (!VALID_STATUSES.includes(data.status as ValidStatus)) {
    throw new Error('无效的状态值');
  }
  if (!VALID_PRIORITIES.includes(data.priority as ValidPriority)) {
    throw new Error('无效的优先级值');
  }
  
  // position 必须在同一项目内计算，否则会被其他项目的 position 干扰
  const maxPosition = await prisma.card.aggregate({
    where: { userId: user.id, projectId: data.projectId, status: data.status },
    _max: { position: true },
  });
  await prisma.card.create({
    data: {
      title: data.title,
      description: data.description || null,
      priority: data.priority,
      status: data.status,
      position: (maxPosition._max.position ?? -1) + 1,
      userId: user.id,
      projectId: data.projectId,
    },
  });
  revalidatePath('/');
}
export async function updateCard(id: string, data: { title?: string; description?: string; priority?: string; status?: string }) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  
  if (data.status && !VALID_STATUSES.includes(data.status as ValidStatus)) {
    throw new Error('无效的状态值');
  }
  if (data.priority && !VALID_PRIORITIES.includes(data.priority as ValidPriority)) {
    throw new Error('无效的优先级值');
  }
  
  await prisma.card.updateMany({
    where: { id, userId: user.id },
    data,
  });
  revalidatePath('/');
}
export async function deleteCard(id: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');

  const card = await prisma.card.findFirst({ where: { id, userId: user.id } });
  if (!card) return;

  await prisma.$transaction(async (tx) => {
    await tx.card.delete({ where: { id } });

    // 删除会在该列留下 position 空洞，一并压实保持 0..n-1
    const rest = await tx.card.findMany({
      where: { userId: user.id, projectId: card.projectId, status: card.status },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    for (let i = 0; i < rest.length; i++) {
      await tx.card.update({ where: { id: rest[i].id }, data: { position: i } });
    }
  });

  revalidatePath('/');
}
export async function moveCard(id: string, status: string, position: number) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');

  if (!VALID_STATUSES.includes(status as ValidStatus)) {
    throw new Error('无效的状态值');
  }

  const card = await prisma.card.findFirst({ where: { id, userId: user.id } });
  if (!card) throw new Error('卡片不存在');

  const sourceStatus = card.status;

  await prisma.$transaction(async (tx) => {
    // 目标列现有卡片（排除自己），按 position 排序后把当前卡片插入目标下标
    const siblings = await tx.card.findMany({
      where: { userId: user.id, projectId: card.projectId, status, id: { not: id } },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    const at = Math.max(0, Math.min(position, siblings.length));
    const ordered = [...siblings];
    ordered.splice(at, 0, { id });

    // 整列重排为 0..n-1：只更新单张会导致 position 重复，
    // 而 position 重复时 orderBy(position asc) 的排序是不确定的。
    for (let i = 0; i < ordered.length; i++) {
      await tx.card.update({
        where: { id: ordered[i].id },
        data: ordered[i].id === id ? { position: i, status } : { position: i },
      });
    }

    // 跨列移动时把源列的空洞也一并压实，避免 position 值无限增长
    if (sourceStatus !== status) {
      const rest = await tx.card.findMany({
        where: { userId: user.id, projectId: card.projectId, status: sourceStatus },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      for (let i = 0; i < rest.length; i++) {
        await tx.card.update({ where: { id: rest[i].id }, data: { position: i } });
      }
    }
  });

  revalidatePath('/');
}
// Subtask actions
export async function addSubtask(cardId: string, title: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  const card = await prisma.card.findFirst({ where: { id: cardId, userId: user.id } });
  if (!card) throw new Error('卡片不存在');
  await prisma.subtask.create({ data: { title, cardId } });
  revalidatePath('/');
}
export async function toggleSubtask(id: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  
  const subtask = await prisma.subtask.findUnique({
    where: { id },
    include: { card: true },
  });
  if (!subtask) throw new Error('子任务不存在');
  if (subtask.card.userId !== user.id) throw new Error('无权操作');
  
  await prisma.subtask.update({
    where: { id },
    data: { completed: !subtask.completed },
  });
  revalidatePath('/');
}
// Comment actions
export async function addComment(cardId: string, content: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  await prisma.comment.create({
    data: { content, cardId, userId: user.id },
  });
  revalidatePath('/');
}

export async function deleteSubtask(id: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  
  const subtask = await prisma.subtask.findUnique({
    where: { id },
    include: { card: true },
  });
  if (!subtask) throw new Error('子任务不存在');
  if (subtask.card.userId !== user.id) throw new Error('无权操作');
  
  await prisma.subtask.delete({ where: { id } });
  revalidatePath('/');
}

// Project actions
export async function createProject(name: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('项目名称不能为空');
  const project = await prisma.project.create({
    data: { name: trimmed, userId: user.id },
  });
  revalidatePath('/');
  return project;
}

export async function getProjects() {
  const user = await getCurrentUser();
  if (!user) return [];
  return prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
}

export async function renameProject(id: string, name: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('项目名称不能为空');
  const project = await prisma.project.findFirst({
    where: { id, userId: user.id },
  });
  if (!project) throw new Error('项目不存在');
  await prisma.project.update({ where: { id }, data: { name: trimmed } });
  revalidatePath('/');
}

export async function deleteProject(id: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  const project = await prisma.project.findFirst({
    where: { id, userId: user.id },
  });
  if (!project) throw new Error('项目不存在');

  // 显式清理关联数据，不单纯依赖数据库外键级联
  const cards = await prisma.card.findMany({
    where: { projectId: id, userId: user.id },
    select: { id: true },
  });
  const cardIds = cards.map(c => c.id);

  await prisma.$transaction([
    ...(cardIds.length
      ? [
          prisma.comment.deleteMany({ where: { cardId: { in: cardIds } } }),
          prisma.subtask.deleteMany({ where: { cardId: { in: cardIds } } }),
          prisma.card.deleteMany({ where: { id: { in: cardIds } } }),
        ]
      : []),
    prisma.project.delete({ where: { id } }),
  ]);

  revalidatePath('/');
}
