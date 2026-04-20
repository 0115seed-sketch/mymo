export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_IMAGE_SIDE = 1920

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export async function fileToOptimizedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 업로드할 수 있습니다.')
  }

  if (file.size > MAX_IMAGE_FILE_SIZE) {
    throw new Error('이미지는 5MB 이하만 업로드할 수 있습니다.')
  }

  const source = await readFileAsDataUrl(file)
  const img = await loadImage(source)

  const longSide = Math.max(img.naturalWidth, img.naturalHeight)
  const scale = longSide > MAX_IMAGE_SIDE ? MAX_IMAGE_SIDE / longSide : 1

  if (scale === 1) {
    return source
  }

  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('이미지 처리 중 오류가 발생했습니다.')
  }

  ctx.drawImage(img, 0, 0, width, height)

  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  return mime === 'image/png'
    ? canvas.toDataURL(mime)
    : canvas.toDataURL(mime, 0.85)
}
