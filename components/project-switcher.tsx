'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Project } from '@/types';
import { createProject, renameProject, deleteProject } from '@/app/actions';
import { FolderKanban, Plus, ChevronDown, Check, Pencil, Trash2, X } from 'lucide-react';

interface ProjectSwitcherProps {
  projects: Project[];
  currentProjectId: string | null;
}

export default function ProjectSwitcher({ projects, currentProjectId }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const currentProject = projects.find(p => p.id === currentProjectId);

  const closeMenu = () => {
    setOpen(false);
    setCreating(false);
    setRenamingId(null);
    setDeletingId(null);
    setNewName('');
    setRenameValue('');
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (renamingId) setTimeout(() => renameRef.current?.focus(), 50);
  }, [renamingId]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || loading) return;
    setLoading(true);
    try {
      const project = await createProject(name);
      closeMenu();
      router.push(`/?project=${project.id}`);
      router.refresh();
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleSwitch = (id: string) => {
    closeMenu();
    router.push(`/?project=${id}`);
    router.refresh();
  };

  const startRename = (project: Project) => {
    setDeletingId(null);
    setRenamingId(project.id);
    setRenameValue(project.name);
  };

  const handleRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name || loading) return;
    setLoading(true);
    try {
      await renameProject(id, name);
      setRenamingId(null);
      setRenameValue('');
      router.refresh();
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (loading) return;
    setLoading(true);
    try {
      await deleteProject(id);
      const remaining = projects.filter(p => p.id !== id);
      setDeletingId(null);
      if (id === currentProjectId) {
        closeMenu();
        router.push(remaining.length ? `/?project=${remaining[0].id}` : '/');
      }
      router.refresh();
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => (open ? closeMenu() : setOpen(true))}
        className="
          flex items-center gap-2 px-3 py-2 rounded-xl
          bg-surface-hover/60 hover:bg-surface-hover
          border border-border-light/50
          text-sm font-medium text-text-primary
          transition-all duration-200
          active:scale-[0.98]
        "
      >
        <FolderKanban className="w-4 h-4 text-brand-500" />
        <span className="max-w-[120px] truncate">
          {currentProject?.name || '选择项目'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-text-tertiary transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="
          absolute top-full left-0 mt-2 w-72
          bg-surface border border-border-light
          rounded-2xl shadow-elevated
          py-2 z-50
          animate-scale-in origin-top-left
        ">
          <div className="px-3 py-1.5 text-xs font-medium text-text-tertiary uppercase tracking-wider">
            项目
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {projects.length === 0 && !creating && (
              <div className="px-4 py-3 text-sm text-text-tertiary text-center">
                还没有项目，创建一个吧
              </div>
            )}

            {projects.map(project => {
              const isCurrent = project.id === currentProjectId;

              // ── 删除确认态 ──
              if (deletingId === project.id) {
                return (
                  <div key={project.id} className="mx-1 px-3 py-2.5 rounded-xl bg-red-50/60 dark:bg-red-500/5">
                    <p className="text-sm text-text-primary mb-0.5">
                      删除「<span className="font-medium">{project.name}</span>」？
                    </p>
                    <p className="text-xs text-text-tertiary mb-2.5">
                      该项目下的所有卡片会一并删除，此操作不可恢复
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDelete(project.id)}
                        disabled={loading}
                        className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium
                          bg-red-500 text-white hover:bg-red-600
                          disabled:opacity-50 transition-colors duration-200"
                      >
                        确认删除
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        disabled={loading}
                        className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium
                          bg-surface-hover text-text-secondary hover:text-text-primary
                          transition-colors duration-200"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                );
              }

              // ── 重命名态 ──
              if (renamingId === project.id) {
                return (
                  <div key={project.id} className="flex items-center gap-1.5 mx-1 px-2 py-1.5">
                    <input
                      ref={renameRef}
                      type="text"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRename(project.id);
                        if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                      }}
                      className="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-sm
                        bg-surface-hover border border-border-light
                        text-text-primary
                        outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20
                        transition-all duration-200"
                    />
                    <button
                      onClick={() => handleRename(project.id)}
                      disabled={loading || !renameValue.trim()}
                      title="保存"
                      className="p-1.5 rounded-lg text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10
                        disabled:opacity-40 transition-colors duration-200"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setRenamingId(null); setRenameValue(''); }}
                      title="取消"
                      className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary
                        hover:bg-surface-hover transition-colors duration-200"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              }

              // ── 常规行 ──
              return (
                <div
                  key={project.id}
                  className={`
                    group flex items-center rounded-xl mx-1
                    transition-colors duration-150
                    hover:bg-surface-hover
                    ${isCurrent ? 'bg-brand-50/50 dark:bg-brand-500/5' : ''}
                  `}
                >
                  <button
                    onClick={() => handleSwitch(project.id)}
                    className={`
                      flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-sm text-left
                      ${isCurrent ? 'text-brand-600' : 'text-text-primary'}
                    `}
                  >
                    <div className="w-6 h-6 rounded-lg bg-brand-500/10 flex items-center justify-center flex-shrink-0">
                      <FolderKanban className="w-3.5 h-3.5 text-brand-500" />
                    </div>
                    <span className="flex-1 truncate">{project.name}</span>
                    {isCurrent && (
                      <Check className="w-4 h-4 text-brand-500 flex-shrink-0 group-hover:hidden" />
                    )}
                  </button>

                  <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                    <button
                      onClick={() => startRename(project)}
                      title="重命名项目"
                      className="p-1.5 rounded-lg text-text-tertiary
                        hover:text-brand-600 hover:bg-surface
                        transition-colors duration-200"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { setRenamingId(null); setDeletingId(project.id); }}
                      title="删除项目"
                      className="p-1.5 rounded-lg text-text-tertiary
                        hover:text-red-500 hover:bg-surface
                        transition-colors duration-200"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-border-light/50 mt-1 pt-1 px-2">
            {creating ? (
              <div className="flex items-center gap-2 px-2 py-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                  }}
                  placeholder="项目名称"
                  className="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-sm
                    bg-surface-hover border border-border-light
                    text-text-primary placeholder:text-text-tertiary
                    outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/20
                    transition-all duration-200"
                  autoFocus
                />
                <button
                  onClick={handleCreate}
                  disabled={loading || !newName.trim()}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium
                    bg-brand-600 text-white hover:bg-brand-700
                    disabled:opacity-50 transition-all duration-200"
                >
                  创建
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setRenamingId(null);
                  setDeletingId(null);
                  setCreating(true);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                className="
                  w-full flex items-center gap-3 px-4 py-2.5 text-sm
                  text-text-tertiary hover:text-text-primary
                  hover:bg-surface-hover rounded-xl
                  transition-all duration-200
                "
              >
                <Plus className="w-4 h-4" />
                <span>新建项目</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
