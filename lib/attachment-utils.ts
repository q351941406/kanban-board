export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

export const ALLOWED_ATTACHMENT_MIME_PREFIXES = [
  'image/',
  'text/',
  'application/pdf',
  'application/json',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-',
];

export function isAllowedAttachment(file: { type: string; name: string }): boolean {
  const mime = (file.type || '').toLowerCase();
  if (!mime) return true;
  return ALLOWED_ATTACHMENT_MIME_PREFIXES.some((p) => mime.startsWith(p) || mime === p);
}

export function validateAttachmentFile(file: { size: number; type: string; name: string }): string | null {
  if (!file || !file.name) return '未选择文件';
  if (file.size <= 0) return '文件为空';
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return `文件过大（上限 ${Math.floor(MAX_ATTACHMENT_SIZE / 1024 / 1024)}MB）`;
  }
  if (!isAllowedAttachment(file)) {
    return '不支持的文件类型';
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function isImageMime(mime: string): boolean {
  return (mime || '').toLowerCase().startsWith('image/');
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'file';
  return base.replace(/[^\w.\-()（）\u4e00-\u9fa5]/g, '_').slice(0, 120) || 'file';
}
