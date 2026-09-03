import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type StudentNotification = {
  id: string
  title: string
  body: string
  kind: string
  read_at: string | null
  created_at: string
}

type UnreadListener = (count: number) => void

const unreadListeners = new Set<UnreadListener>()

/** Ids marked read locally so a refetch can't restore the badge for those rows. */
const locallyReadIds = new Set<string>()

function broadcastUnreadCount(count: number) {
  for (const listener of unreadListeners) {
    listener(count)
  }
}

function countUnread(rows: StudentNotification[]) {
  return rows.filter((row) => !row.read_at && !locallyReadIds.has(row.id)).length
}

async function persistMarkAllRead() {
  const { error: rpcError } = await supabase.rpc('mark_my_notifications_read')
  if (!rpcError) return null

  const readAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('notifications')
    .update({ read_at: readAt })
    .is('read_at', null)

  if (!updateError) return null

  return rpcError.message.includes('Could not find the function')
    ? updateError.message
    : rpcError.message
}

export function useStudentNotifications(enabled: boolean) {
  const [notifications, setNotifications] = useState<StudentNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const listener: UnreadListener = (count) => {
      setUnreadCount(count)
    }
    unreadListeners.add(listener)
    return () => {
      unreadListeners.delete(listener)
    }
  }, [])

  const setUnreadEverywhere = useCallback((count: number) => {
    setUnreadCount(count)
    broadcastUnreadCount(count)
  }, [])

  const reload = useCallback(async () => {
    if (!enabled) {
      setNotifications([])
      setUnreadEverywhere(0)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const { data, error: loadError } = await supabase
      .from('notifications')
      .select('id, title, body, kind, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(20)

    if (loadError) {
      if (
        loadError.message.includes('notifications') ||
        loadError.code === '42P01' ||
        loadError.code === 'PGRST205'
      ) {
        setNotifications([])
        setUnreadEverywhere(0)
        setLoading(false)
        return
      }
      setError(loadError.message)
      setLoading(false)
      return
    }

    const rows = (data ?? []) as StudentNotification[]
    for (const row of rows) {
      if (row.read_at) locallyReadIds.delete(row.id)
    }
    setNotifications(rows)
    setUnreadEverywhere(countUnread(rows))
    setLoading(false)
  }, [enabled, setUnreadEverywhere])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!enabled) return

    function onFocus() {
      void reload()
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, reload])

  const markAllRead = useCallback(async () => {
    const stamp = new Date().toISOString()
    setNotifications((current) => {
      for (const row of current) {
        if (!row.read_at) locallyReadIds.add(row.id)
      }
      return current.map((row) => ({
        ...row,
        read_at: row.read_at ?? stamp,
      }))
    })
    setUnreadEverywhere(0)

    const markError = await persistMarkAllRead()
    if (markError) {
      setError(markError)
      return
    }

    setUnreadEverywhere(0)
  }, [setUnreadEverywhere])

  const deleteNotification = useCallback(async (id: string) => {
    const { error: deleteError } = await supabase.rpc('delete_my_notification', {
      p_notification_id: id,
    })
    if (deleteError) {
      const { error: tableError } = await supabase.from('notifications').delete().eq('id', id)
      if (tableError) {
        setError(
          deleteError.message.includes('Could not find the function')
            ? 'Run supabase/22-notification-cap-delete.sql in the Supabase SQL Editor, then try again.'
            : deleteError.message,
        )
        return
      }
    }
    locallyReadIds.delete(id)
    setNotifications((current) => {
      const next = current.filter((row) => row.id !== id)
      setUnreadEverywhere(countUnread(next))
      return next
    })
  }, [setUnreadEverywhere])

  const deleteAllNotifications = useCallback(async () => {
    const { error: deleteError } = await supabase.rpc('delete_all_my_notifications')
    if (deleteError) {
      setError(
        deleteError.message.includes('Could not find the function')
          ? 'Run supabase/30-atomic-weekly-credit-notify-delete-all.sql in the Supabase SQL Editor, then try again.'
          : deleteError.message,
      )
      return
    }
    setNotifications([])
    setUnreadEverywhere(0)
  }, [setUnreadEverywhere])

  return {
    notifications,
    unreadCount,
    loading,
    error,
    reload,
    markAllRead,
    deleteNotification,
    deleteAllNotifications,
  }
}
