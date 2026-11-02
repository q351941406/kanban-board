'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Card, COLUMNS, PRIORITIES } from '@/types';
import { updateCard, moveCard, addSubtask, toggleSubtask, deleteSubtask, addComment, deleteCard, uploadAttachment, deleteAttachment } from '@/app/actions';
import { X, Save, Trash2, Plus, ListChecks, MessageSquare, Send, CheckSquare, Paperclip, Upload, Download, Image as ImageIcon } from 'lucide-react';
import Sheet from '@/components/ui/sheet';
import { formatFileSize, isImageMime } from '@/lib/attachment-utils';

interface CardModalProps {
  card: Card;
  onClose: () => void;
  onUpdate: () => void;
}

export default function CardModal({ card, onClose, onUpdate }: CardModalProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [priority, setPriority] = useState(card.priority);
  const [status, setStatus] = useState(card.status);
  const [newSubtask, setNewSubtask] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    for (const file of list) {
      const formData = new FormData();
      formData.append('file', file);
      const res = await uploadAttachment(card.id, formData);
      if (res?.error) {
        alert(res.error);
      }
    }
    setUploading(false);
    onUpdate();
  }, [card.id, onUpdate]);

  const handleDeleteAttachment = useCallback(async (id: string) => {
    if (!confirm('确定删除此附件？')) return;
    const res = await deleteAttachment(id);
    if (res?.error) alert(res.error);
    onUpdate();
  }, [onUpdate]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        handleUploadFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleUploadFiles]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewImage(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const handleSave = async () => {
    setLoading(true);
    // 状态变更不能只 update 字段：需要和拖拽一样走 moveCard，
    // 否则源列会留 position 空洞、目标列可能产生重复 position。
    if (status !== card.status) {
      await moveCard(card.id, status, Number.MAX_SAFE_INTEGER);
    }
    await updateCard(card.id, { title, description, priority });
    onUpdate();
    setLoading(false);
    onClose();
  };

  const handleAddSubtask = async () => {
    if (!newSubtask.trim()) return;
    await addSubtask(card.id, newSubtask);
    setNewSubtask('');
    onUpdate();
  };

  const handleToggleSubtask = async (subtaskId: string) => {
    await toggleSubtask(subtaskId);
    onUpdate();
  };

  const handleAddComment = async () => {
    if (!comment.trim()) return;
    await addComment(card.id, comment);
    setComment('');
    onUpdate();
  };

  const handleDelete = async () => {
    if (confirm('确定删除此卡片？')) {
      await deleteCard(card.id);
      onUpdate();
      onClose();
    }
  };

  const completedSubtasks = card.subtasks.filter((s) => s.completed).length;
  const totalSubtasks = card.subtasks.length;

  return (
    <Sheet onClose={onClose} label="卡片详情">
      {/* 底部 padding 叠加安全区，Home Indicator 不再压住最后一个输入框 */}
      <div className="p-5 sm:p-6 pb-[calc(1.25rem_+_env(safe-area-inset-bottom,0px))] sm:pb-6">
          {/* 头部 */}
          <div className="flex items-start justify-between mb-5">
            <div className="flex-1 mr-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-lg font-semibold text-text-primary bg-transparent
                  border-b border-transparent hover:border-border-light focus:border-brand-400
                  outline-none transition-all duration-200 pb-1
                  focus:ring-0"
                placeholder="卡片标题"
              />
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded-xl flex items-center justify-center
                text-text-tertiary hover:text-text-primary hover:bg-surface-hover
                transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                active:scale-90"
            >
              <X className="w-4 h-4" />
            </button>
          </div>


          {/* 状态 */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-text-tertiary mb-2 uppercase tracking-wider">
              状态
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {COLUMNS.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => setStatus(col.id)}
                  className={`
                    px-3 py-1.5 pointer-coarse:px-4 pointer-coarse:py-3.5 rounded-lg text-xs font-medium
                    transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                    active:scale-95
                    ${status === col.id
                      ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm'
                      : 'bg-surface-hover text-text-secondary hover:bg-surface-hover/80'
                    }
                  `}
                >
                  {col.title}
                </button>
              ))}
            </div>
          </div>


          {/* 优先级 */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-text-tertiary mb-2 uppercase tracking-wider">
              优先级
            </label>
            <div className="flex gap-2">
              {Object.entries(PRIORITIES).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setPriority(key)}
                  className={`
                    px-3 py-1.5 pointer-coarse:px-4 pointer-coarse:py-3.5 rounded-lg text-xs font-medium
                    transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                    active:scale-95
                    ${priority === key
                      ? `${val.color} ring-2 ring-offset-1 ring-current dark:ring-offset-surface-elevated`
                      : 'text-text-tertiary bg-surface-hover hover:bg-surface-hover/80'
                    }
                  `}
                >
                  {val.label}
                </button>
              ))}
            </div>
          </div>

          {/* 描述 */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-text-tertiary mb-2 uppercase tracking-wider">
              描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-border-light rounded-xl p-3 text-base sm:text-sm
                bg-surface dark:bg-surface-muted text-text-primary
                placeholder:text-text-tertiary
                resize-none h-24
                transition-all duration-200
                focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15
                outline-none"
              placeholder="添加描述..."
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={handleSave}
              disabled={loading}
              className="
                flex items-center gap-1.5 px-4 py-2 pointer-coarse:py-3 rounded-xl
                bg-gradient-to-br from-brand-500 to-brand-600 text-white text-sm font-medium
                hover:from-brand-600 hover:to-brand-700
                shadow-lg shadow-brand-500/15
                transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                active:scale-95
                disabled:opacity-50
                focus:outline-none focus:ring-2 focus:ring-brand-500/40
              "
            >
              <Save className="w-3.5 h-3.5" />
              {loading ? '保存中...' : '保存'}
            </button>
            <button
              onClick={handleDelete}
              className="
                flex items-center gap-1.5 px-3 py-2 pointer-coarse:px-4 pointer-coarse:py-3 rounded-xl
                text-text-tertiary hover:text-error hover:bg-error-bg
                text-sm transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                active:scale-95
              "
            >
              <Trash2 className="w-3.5 h-3.5" />
              删除
            </button>
          </div>

          {/* 子任务 */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <ListChecks className="w-4 h-4 text-text-tertiary" />
              <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                子任务
              </span>
              {totalSubtasks > 0 && (
                <span className="text-[10px] text-text-tertiary ml-auto">
                  {completedSubtasks}/{totalSubtasks}
                </span>
              )}
            </div>
            <div className="space-y-1.5 mb-2.5">
              {card.subtasks.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl
                    hover:bg-surface-hover group transition-all duration-200"
                >
                  <button
                    onClick={() => handleToggleSubtask(sub.id)}
                    className="flex items-center gap-2.5 flex-1 text-left"
                  >
                    <div className={`
                      w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0
                      transition-all duration-200
                      ${sub.completed
                        ? 'bg-brand-500 border-brand-500'
                        : 'border-border-default group-hover:border-brand-400'
                      }
                    `}>
                      {sub.completed && <CheckSquare className="w-3 h-3 text-white" />}
                    </div>
                    <span className={`text-sm transition-all duration-200 ${
                      sub.completed
                        ? 'line-through text-text-tertiary'
                        : 'text-text-primary'
                    }`}>
                      {sub.title}
                    </span>
                  </button>
                  <button
                    onClick={async () => {
                      await deleteSubtask(sub.id);
                      onUpdate();
                    }}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100
                      w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded-lg flex items-center justify-center shrink-0
                      text-text-tertiary hover:text-error hover:bg-error/10
                      transition-all duration-200"
                    title="删除子任务"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {card.subtasks.length === 0 && (
                <p className="text-xs text-text-tertiary px-1">暂无子任务</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSubtask()}
                placeholder="添加子任务..."
                className="flex-1 border border-border-light rounded-xl px-3 py-2 text-base sm:text-sm
                  bg-surface dark:bg-surface-muted text-text-primary placeholder:text-text-tertiary
                  outline-none transition-all duration-200
                  focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
              />
              <button
                onClick={handleAddSubtask}
                className="w-9 h-9 pointer-coarse:w-11 pointer-coarse:h-11 rounded-xl flex items-center justify-center shrink-0
                  bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400
                  hover:bg-brand-200 dark:hover:bg-brand-900/50
                  transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                  active:scale-90"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 附件 */}

          <div className="mb-5">

            <div className="flex items-center gap-2 mb-3">

              <Paperclip className="w-4 h-4 text-text-tertiary" />

              <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">

                附件

              </span>

              {card.attachments && card.attachments.length > 0 && (

                <span className="text-[10px] text-text-tertiary ml-auto">

                  {card.attachments.length}

                </span>

              )}

            </div>



            {/* 上传拖拽区 */}

            <div

              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}

              onDragLeave={() => setDragOver(false)}

              onDrop={(e) => {

                e.preventDefault();

                setDragOver(false);

                handleUploadFiles(e.dataTransfer.files);

              }}

              onClick={() => fileInputRef.current?.click()}

              className={`

                border-2 border-dashed rounded-xl p-3 mb-3 text-center cursor-pointer

                transition-all duration-200

                ${dragOver

                  ? 'border-brand-400 bg-brand-50/40 dark:bg-brand-500/5'

                  : 'border-border-light hover:border-brand-300 bg-surface-hover/40'

                }

              `}

            >

              <input

                ref={fileInputRef}

                type="file"

                multiple

                className="hidden"

                onChange={(e) => handleUploadFiles(e.target.files)}

              />

              <div className="flex items-center justify-center gap-2 text-xs text-text-tertiary">

                {uploading ? (

                  <>

                    <Upload className="w-3.5 h-3.5 animate-bounce" />

                    <span>上传中...</span>

                  </>

                ) : (

                  <>

                    <Upload className="w-3.5 h-3.5" />

                    <span>点击选择、拖拽文件到此处，或 Ctrl/Cmd+V 粘贴截图</span>

                  </>

                )}

              </div>

            </div>



            {/* 附件列表 */}

            <div className="space-y-2">

              {(card.attachments || []).length === 0 && (

                <p className="text-xs text-text-tertiary px-1">暂无附件</p>

              )}

              {(card.attachments || []).map((att) => {

                const isImg = isImageMime(att.mimeType);

                return (

                  <div

                    key={att.id}

                    className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface-hover dark:bg-surface-muted group transition-all duration-200"

                  >

                    {isImg ? (

                      <button type="button" onClick={() => setPreviewImage({ url: `/api/attachments/${att.id}`, name: att.fileName })} className="shrink-0 focus:outline-none" title="点击放大">

                        <img

                          src={`/api/attachments/${att.id}`}

                          alt={att.fileName}

                          className="w-12 h-12 rounded-lg object-cover border border-border-light"

                        />

                      </button>

                    ) : (

                      <div className="w-12 h-12 rounded-lg bg-surface flex items-center justify-center shrink-0 border border-border-light">

                        <ImageIcon className="w-5 h-5 text-text-tertiary" />

                      </div>

                    )}

                    <div className="flex-1 min-w-0">

                      <a

                        href={`/api/attachments/${att.id}`}

                        target="_blank"

                        rel="noreferrer"

                        className="text-sm text-text-primary font-medium truncate hover:text-brand-500 transition-colors block"

                        title={att.fileName}

                      >

                        {att.fileName}

                      </a>

                      <p className="text-[10px] text-text-tertiary mt-0.5">

                        {formatFileSize(att.size)}

                      </p>

                    </div>

                    <a

                      href={`/api/attachments/${att.id}`}

                      download={att.fileName}

                      className="w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface transition-all duration-200"

                      title="下载"

                    >

                      <Download className="w-4 h-4" />

                    </a>

                    <button

                      onClick={() => handleDeleteAttachment(att.id)}

                      className="w-8 h-8 pointer-coarse:w-11 pointer-coarse:h-11 rounded-lg flex items-center justify-center text-text-tertiary hover:text-error hover:bg-error/10 transition-all duration-200"

                      title="删除"

                    >

                      <Trash2 className="w-4 h-4" />

                    </button>

                  </div>

                );

              })}

            </div>

          </div>



          {/* 评论 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-text-tertiary" />
              <span className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
                评论
              </span>
            </div>
            <div className="space-y-2 mb-3 max-h-32 overflow-y-auto">
              {card.comments.map((c) => (
                <div key={c.id} className="bg-surface-hover dark:bg-surface-muted rounded-xl p-3 animate-slide-up">
                  <p className="text-[11px] font-medium text-text-secondary mb-1">
                    {c.user?.name || '用户'}
                  </p>
                  <p className="text-sm text-text-primary">{c.content}</p>
                </div>
              ))}
              {card.comments.length === 0 && (
                <p className="text-xs text-text-tertiary px-1">暂无评论</p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                placeholder="添加评论..."
                className="flex-1 border border-border-light rounded-xl px-3 py-2 text-base sm:text-sm
                  bg-surface dark:bg-surface-muted text-text-primary placeholder:text-text-tertiary
                  outline-none transition-all duration-200
                  focus:border-brand-400 focus:ring-2 focus:ring-brand-500/15"
              />
              <button
                onClick={handleAddComment}
                className="w-9 h-9 pointer-coarse:w-11 pointer-coarse:h-11 rounded-xl flex items-center justify-center shrink-0
                  bg-gradient-to-br from-brand-500 to-brand-600 text-white
                  hover:from-brand-600 hover:to-brand-700
                  shadow-lg shadow-brand-500/15
                  transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                  active:scale-90"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
      </div>



      {previewImage && (

        <div

          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"

          onClick={() => setPreviewImage(null)}

        >

          <button

            type="button"

            onClick={() => setPreviewImage(null)}

            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-all"

            aria-label="关闭"

          >

            <X className="w-5 h-5" />

          </button>

          <img

            src={previewImage.url}

            alt={previewImage.name}

            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl cursor-zoom-out"

            onClick={(e) => e.stopPropagation()}

          />

        </div>

      )}

    </Sheet>
  );
}