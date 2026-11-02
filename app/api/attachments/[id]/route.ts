import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { downloadFromR2 } from '@/lib/r2';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const { id } = await params;

    const attachment = await prisma.attachment.findFirst({
      where: { id },
      include: { card: true },
    });

    if (!attachment || attachment.card.userId !== user.id) {
      return NextResponse.json({ error: '附件不存在' }, { status: 404 });
    }

    const file = await downloadFromR2(attachment.storageKey);

    const safeName = encodeURIComponent(attachment.fileName);
    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        'Content-Type': attachment.mimeType || file.contentType,
        'Content-Length': String(file.contentLength || file.body.length),
        'Content-Disposition': `inline; filename*=UTF-8''${safeName}`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}
