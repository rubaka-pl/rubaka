import { ASSET_BUCKET, supabase } from './supabase'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
const MAX_BYTES = 5 * 1024 * 1024

/** Largest stored size per kind; posters are shown at most ~180 px wide (360 on retina). */
const MAX_DIM = { poster: { w: 600, h: 900 }, backdrop: { w: 1600, h: 900 } } as const

/**
 * Downscale and re-encode to WebP in the browser so uploads stay small
 * (typically 60–150 KB instead of several MB) and the free 1 GB storage lasts.
 * Falls back to the original file if the browser cannot decode/encode it, or
 * if the result would not be smaller.
 */
export async function shrinkImage(file: File, kind: 'poster' | 'backdrop'): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const { w, h } = MAX_DIM[kind]
    const scale = Math.min(1, w / bmp.width, h / bmp.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85))
    return out && out.type === 'image/webp' && out.size < file.size ? out : file
  } catch {
    return file
  }
}

/** Validate, shrink and upload a custom cover/backdrop. Returns the storage path. */
export async function uploadImage(file: File, kind: 'poster' | 'backdrop'): Promise<string> {
  if (!ALLOWED.includes(file.type)) throw new Error('Use a JPEG, PNG, WebP or AVIF image.')
  const blob = await shrinkImage(file, kind)
  if (blob.size > MAX_BYTES) throw new Error('Images must be 5 MB or smaller.')
  const type = blob.type || file.type
  const ext = type.split('/')[1].replace('jpeg', 'jpg')
  const path = `${kind}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, blob, { contentType: type, cacheControl: '31536000', upsert: false })
  if (error) throw error
  return path
}

export async function removeImage(path: string | null | undefined) {
  if (!path) return
  const { error } = await supabase.storage.from(ASSET_BUCKET).remove([path])
  if (error) console.warn('[rubaka] remove image', error.message)
}

/** Guess the kind of an alternative title from its script. */
export function guessTitleKind(t: string): 'japanese' | 'russian' | 'native' | 'synonym' {
  if (/[぀-ヿㇰ-ㇿ]/.test(t)) return 'japanese'
  if (/[一-鿿]/.test(t)) return 'native'
  if (/[Ѐ-ӿ]/.test(t)) return 'russian'
  if (/[가-힯]/.test(t)) return 'native'
  return 'synonym'
}
