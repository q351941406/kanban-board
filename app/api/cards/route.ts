import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    // 必须按 projectId 过滤。这个接口只被看板用来做局部刷新，
    // 一旦返回该用户所有项目的卡片，setCards 就会把别的项目一起塞进当前看板。
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: '缺少 projectId' }, { status: 400 });
    }

    // 确认项目归属，避免越权读取他人项目
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: user.id },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    const cards = await prisma.card.findMany({
      where: { userId: user.id, projectId },
      include: { subtasks: true, comments: { include: { user: true } } },
      orderBy: { position: 'asc' },
    });
    return NextResponse.json(cards);
  } catch {
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    const { id, status, position } = await request.json();
    await prisma.card.updateMany({
      where: { id, userId: user.id },
      data: { status, position },
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}
