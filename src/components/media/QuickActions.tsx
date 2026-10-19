import { Bookmark, BookmarkMinus, Check, ExternalLink, Heart, HeartOff, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ConfirmDialog, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger } from '@/components/ui/overlays'
import { canIncrement, useEntryActions } from '@/features/tracking/hooks'
import { useDeleteMedia } from '@/features/tracking/api'
import { CATEGORY_CONFIG, statusLabel } from '@/lib/categories'
import { STATUSES, type LibraryItem } from '@/types/db'
import { QuickEditDialog } from './QuickEditDialog'

/** Dropdown content shared by poster cards and list rows. */
export function QuickActionsMenu({ item, onEdit, onDelete }: { item: LibraryItem; onEdit: () => void; onDelete: () => void }) {
  const actions = useEntryActions()
  const navigate = useNavigate()
  const cfg = CATEGORY_CONFIG[item.category]
  return (
    <MenuContent>
      <MenuItem onSelect={() => navigate(`/media/${item.media_id}`)}><ExternalLink /> Open details</MenuItem>
      <MenuItem onSelect={onEdit}><Pencil /> Edit progress & rating…</MenuItem>
      {canIncrement(item) && (
        <MenuItem onSelect={() => actions.increment(item)}>
          <Plus /> +1 {cfg.progress === 'episodes' ? 'episode' : cfg.progress === 'chapters' ? 'chapter' : 'route'}
        </MenuItem>
      )}
      <MenuSub>
        <MenuSubTrigger><ListChecks /> Status</MenuSubTrigger>
        <MenuSubContent>
          {STATUSES.map((s) => (
            <MenuItem key={s} onSelect={() => actions.setStatus(item, s)}>
              <Check className={s === item.status ? 'text-accent' : 'invisible'} /> {statusLabel(s, item.category)}
            </MenuItem>
          ))}
        </MenuSubContent>
      </MenuSub>
      <MenuSeparator />
      <MenuItem onSelect={() => actions.toggleWishlist(item)}>
        {item.wishlisted_at ? <><BookmarkMinus /> Remove from Wishlist</> : <><Bookmark /> Add to Wishlist</>}
      </MenuItem>
      <MenuItem onSelect={() => actions.toggleFavorite(item)}>
        {item.is_favorite ? <><HeartOff /> Remove favorite</> : <><Heart /> Mark favorite</>}
      </MenuItem>
      <MenuSeparator />
      <MenuItem destructive onSelect={onDelete}><Trash2 /> Delete…</MenuItem>
    </MenuContent>
  )
}

/** Dialog state holder for the edit/delete flows triggered from QuickActionsMenu. */
export function useQuickActionDialogs(item: LibraryItem) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const del = useDeleteMedia()
  const dialogs = (
    <>
      {editOpen && <QuickEditDialog item={item} open={editOpen} onOpenChange={setEditOpen} />}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title={`Delete “${item.title}”?`}
        description="This removes the title, your rating, progress, history and notes. This cannot be undone (except from a backup)."
        confirmLabel="Delete"
        onConfirm={() => del.mutateAsync([item.media_id])}
      />
    </>
  )
  return { openEdit: () => setEditOpen(true), openDelete: () => setDeleteOpen(true), dialogs }
}
