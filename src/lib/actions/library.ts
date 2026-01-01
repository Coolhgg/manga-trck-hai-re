
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function addToLibrary(seriesId: string, status: string = 'reading') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data, error } = await supabase
    .from('library_entries')
    .insert({
      user_id: user.id,
      series_id: seriesId,
      status,
      last_read_chapter: 0,
      notify_new_chapters: true,
      sync_priority: 'WARM',
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return { error: 'Series already in library' }
    }
    return { error: error.message }
  }

  // Log activity
  await supabase.from('activities').insert({
    user_id: user.id,
    type: 'series_added',
    series_id: seriesId,
    metadata: { status }
  })

  revalidatePath('/library')
  revalidatePath('/discover')
  revalidatePath('/feed')
  return { data }
}

export async function removeFromLibrary(entryId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { error } = await supabase
    .from('library_entries')
    .delete()
    .eq('id', entryId)
    .eq('user_id', user.id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/library')
  revalidatePath('/feed')
  return { success: true }
}

export async function updateProgress(entryId: string, chapter: number, seriesId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data, error } = await supabase
    .from('library_entries')
    .update({
      last_read_chapter: chapter,
      last_read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  // Update user's last_read_at
  await supabase
    .from('users')
    .update({
      last_read_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  // Award XP for reading
  await supabase.rpc('increment_xp', { user_id: user.id, amount: 10 })

  // Log activity
  await supabase.from('activities').insert({
    user_id: user.id,
    type: 'chapter_read',
    series_id: seriesId,
    metadata: { chapter_number: chapter }
  })

  revalidatePath('/library')
  revalidatePath('/feed')
  revalidatePath(`/series/${seriesId}`)
  return { data, xp_gained: 10 }
}

export async function updateStatus(entryId: string, status: string, seriesId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data, error } = await supabase
    .from('library_entries')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  // If completed, award bonus XP
  if (status === 'completed') {
    await supabase.rpc('increment_xp', { user_id: user.id, amount: 100 })
    
    // Log activity
    await supabase.from('activities').insert({
      user_id: user.id,
      type: 'series_completed',
      series_id: seriesId
    })
  }

  revalidatePath('/library')
  revalidatePath('/feed')
  revalidatePath(`/series/${seriesId}`)
  return { data }
}

export async function updateRating(entryId: string, rating: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data, error } = await supabase
    .from('library_entries')
    .update({
      user_rating: rating,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/library')
  return { data }
}
