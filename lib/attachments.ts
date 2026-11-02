import { prisma } from '@/lib/prisma';
import { deleteFromR2, uploadToR2 } from '@/lib/r2';
import { validateAttachmentFile, sanitizeFileName } from '@/lib/attachment-utils';

export async function createAttachmentForCard(
  cardId: string,
  userId: string,
  projectId: string,
  file: File,
): Promise<{ id: string; storageKey: string }> {
  const err = validateAttachmentFile(file);
  if (err) throw new Error(err);

  const id = crypto.randomUUID();
  const safeName = sanitizeFileName(file.name);
  const storageKey = `${userId}/${projectId}/${cardId}/${id}/${safeName}`;

  await uploadToR2(storageKey, Buffer.from(await file.arrayBuffer()), file.type || 'application/octet-stream');

  try {
    await prisma.attachment.create({
      data: {
        id,
        cardId,
        userId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        storageKey,
      },
    });
  } catch (e) {
    await deleteFromR2(storageKey).catch(() => {});
    throw e;
  }

  return { id, storageKey };
}

export async function deleteAttachmentById(id: string, userId: string): Promise<void> {
  const attachment = await prisma.attachment.findFirst({
    where: { id },
    include: { card: true },
  });
  if (!attachment) throw new Error('附件不存在');
  if (attachment.card.userId !== userId) throw new Error('无权操作');

  await deleteFromR2(attachment.storageKey);
  await prisma.attachment.delete({ where: { id } });
}

export async function deleteAttachmentsForCards(cardIds: string[]): Promise<void> {
  if (!cardIds.length) return;
  const attachments = await prisma.attachment.findMany({
    where: { cardId: { in: cardIds } },
    select: { storageKey: true },
  });
  await Promise.allSettled(attachments.map((a) => deleteFromR2(a.storageKey)));
  await prisma.attachment.deleteMany({ where: { cardId: { in: cardIds } } });
}
