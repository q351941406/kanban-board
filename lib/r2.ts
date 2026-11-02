/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const ENDPOINT = process.env.CLOUDFLARE_S3_ENDPOINT || process.env.R2_ENDPOINT || '';
const ACCESS_KEY_ID = process.env.CLOUDFLARE_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '';
const SECRET_ACCESS_KEY =
  process.env.CLOUDFLARE_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '';
export const R2_BUCKET = process.env.R2_BUCKET_NAME || 'kanban-board-attachments';

let _client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (_client) return _client;
  if (!ENDPOINT || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    throw new Error('Cloudflare R2 环境变量未配置');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

export function isR2Configured(): boolean {
  return Boolean(ENDPOINT && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const client = getR2Client();
  await (client as any).send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }),
  );
}

export async function downloadFromR2(key: string): Promise<{
  body: Buffer;
  contentType: string;
  contentLength: number;
}> {
  const client = getR2Client();
  const res = await (client as any).send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
  );
  const chunks: Buffer[] = [];
  if (res.Body) {
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
  }
  const body = Buffer.concat(chunks);
  return {
    body,
    contentType: res.ContentType || 'application/octet-stream',
    contentLength: res.ContentLength ?? body.length,
  };
}

export async function deleteFromR2(key: string): Promise<void> {
  const client = getR2Client();
  try {
    await (client as any).send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch {
    // 删除失败不应阻断主流程；对象可能已不存在
  }
}
