import { createSignal, onMount, onCleanup } from 'solid-js'
import type { Component } from 'solid-js'
import { darkMode } from '../stores/settings'

interface CropModalProps {
  src: string
  onConfirm: (croppedDataUrl: string) => void
  onClose: () => void
}

type Handle = 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se'

const CropModal: Component<CropModalProps> = (props) => {
  let imgRef!: HTMLImageElement
  let containerRef!: HTMLDivElement

  const [crop, setCrop] = createSignal({ x: 0, y: 0, w: 0, h: 0 })
  const [imgLoaded, setImgLoaded] = createSignal(false)
  const [processing, setProcessing] = createSignal(false)

  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  const onImgLoad = () => {
    const r = imgRef.getBoundingClientRect()
    const cr = containerRef.getBoundingClientRect()
    setCrop({ x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height })
    setImgLoaded(true)
  }

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

  const startDrag = (e: MouseEvent, handle: Handle) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const cr = containerRef.getBoundingClientRect()
    const ir = imgRef.getBoundingClientRect()
    const imgLeft = ir.left - cr.left
    const imgTop = ir.top - cr.top
    const imgRight = imgLeft + ir.width
    const imgBottom = imgTop + ir.height

    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const startCrop = { ...crop() }

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startMouseX
      const dy = ev.clientY - startMouseY
      let { x, y, w, h } = startCrop

      if (handle === 'n' || handle === 'nw' || handle === 'ne') {
        const newY = clamp(y + dy, imgTop, y + h - 8)
        h -= newY - y; y = newY
      }
      if (handle === 's' || handle === 'sw' || handle === 'se') {
        h = clamp(h + dy, 8, imgBottom - y)
      }
      if (handle === 'w' || handle === 'nw' || handle === 'sw') {
        const newX = clamp(x + dx, imgLeft, x + w - 8)
        w -= newX - x; x = newX
      }
      if (handle === 'e' || handle === 'ne' || handle === 'se') {
        w = clamp(w + dx, 8, imgRight - x)
      }
      setCrop({ x, y, w, h })
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    const cursors: Record<Handle, string> = {
      n:'n-resize', s:'s-resize', w:'w-resize', e:'e-resize',
      nw:'nw-resize', ne:'ne-resize', sw:'sw-resize', se:'se-resize',
    }
    document.body.style.cursor = cursors[handle]
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const blobToDataUrl = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  const onConfirm = async () => {
    if (processing()) return

    const c = crop()
    if (c.w < 4 || c.h < 4) return

    const cr = containerRef.getBoundingClientRect()
    const ir = imgRef.getBoundingClientRect()
    const scaleX = imgRef.naturalWidth / ir.width
    const scaleY = imgRef.naturalHeight / ir.height

    const sx = clamp(Math.round((c.x - (ir.left - cr.left)) * scaleX), 0, imgRef.naturalWidth)
    const sy = clamp(Math.round((c.y - (ir.top - cr.top)) * scaleY), 0, imgRef.naturalHeight)
    const sw = clamp(Math.round(c.w * scaleX), 1, imgRef.naturalWidth - sx)
    const sh = clamp(Math.round(c.h * scaleY), 1, imgRef.naturalHeight - sy)

    const off = document.createElement('canvas')
    off.width = sw; off.height = sh
    off.getContext('2d')!.drawImage(imgRef, sx, sy, sw, sh, 0, 0, sw, sh)

    setProcessing(true)
    try {
      const blob = await new Promise<Blob | null>((resolve) => off.toBlob(resolve, 'image/png'))
      if (!blob) {
        alert('이미지 자르기 처리 중 오류가 발생했습니다.')
        return
      }
      const dataUrl = await blobToDataUrl(blob)
      props.onConfirm(dataUrl)
    } finally {
      setProcessing(false)
    }
  }

  const c = () => crop()

  const handles: Array<{ id: Handle; style: string }> = [
    { id: 'n',  style: 'top:-5px;left:50%;transform:translateX(-50%);cursor:n-resize' },
    { id: 's',  style: 'bottom:-5px;left:50%;transform:translateX(-50%);cursor:s-resize' },
    { id: 'w',  style: 'left:-5px;top:50%;transform:translateY(-50%);cursor:w-resize' },
    { id: 'e',  style: 'right:-5px;top:50%;transform:translateY(-50%);cursor:e-resize' },
    { id: 'nw', style: 'top:-5px;left:-5px;cursor:nw-resize' },
    { id: 'ne', style: 'top:-5px;right:-5px;cursor:ne-resize' },
    { id: 'sw', style: 'bottom:-5px;left:-5px;cursor:sw-resize' },
    { id: 'se', style: 'bottom:-5px;right:-5px;cursor:se-resize' },
  ]

  return (
    <div
      class="fixed inset-0 z-[200] flex flex-col items-center justify-center"
      style="background: rgba(0,0,0,0.75)"
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose() }}
    >
      <div
        class={`flex flex-col rounded-lg shadow-xl overflow-hidden ${darkMode() ? 'bg-[#1a1b2e]' : 'bg-white'}`}
        style="width: min(92vw, 960px); max-height: 92vh"
      >
        <div class={`flex items-center justify-between px-4 py-3 border-b flex-shrink-0 ${darkMode() ? 'border-gray-700 text-gray-100' : 'border-gray-200 text-gray-800'}`}>
          <span class="font-semibold">이미지 자르기</span>
          <span class={`text-xs ${darkMode() ? 'text-gray-400' : 'text-gray-500'}`}>핸들을 드래그해 남길 영역을 조정하세요</span>
          <button class="btn" onClick={props.onClose}>✕</button>
        </div>

        <div
          ref={containerRef}
          class={`relative flex-1 overflow-hidden flex items-center justify-center select-none ${darkMode() ? 'bg-[#111122]' : 'bg-gray-300'}`}
          style="min-height: 320px; max-height: calc(92vh - 108px)"
        >
          <img
            ref={imgRef}
            src={props.src}
            draggable={false}
            onLoad={onImgLoad}
            style="max-width:100%; max-height:calc(92vh - 108px); display:block; pointer-events:none; user-select:none"
          />

          {imgLoaded() && (
            <>
              <div class="absolute pointer-events-none" style={`left:0;top:0;right:0;height:${c().y}px;background:rgba(0,0,0,0.5)`} />
              <div class="absolute pointer-events-none" style={`left:0;top:${c().y + c().h}px;right:0;bottom:0;background:rgba(0,0,0,0.5)`} />
              <div class="absolute pointer-events-none" style={`left:0;top:${c().y}px;width:${c().x}px;height:${c().h}px;background:rgba(0,0,0,0.5)`} />
              <div class="absolute pointer-events-none" style={`left:${c().x + c().w}px;top:${c().y}px;right:0;height:${c().h}px;background:rgba(0,0,0,0.5)`} />

              <div
                class="absolute"
                style={`left:${c().x}px;top:${c().y}px;width:${c().w}px;height:${c().h}px;border:2px solid #3b82f6;box-sizing:border-box;pointer-events:none`}
              >
                <div style="position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr 1fr;pointer-events:none">
                  {Array.from({ length: 9 }).map(() => (
                    <div style="border:0.5px solid rgba(255,255,255,0.25);box-sizing:border-box" />
                  ))}
                </div>
                {handles.map(({ id, style }) => (
                  <div
                    style={`position:absolute;width:10px;height:10px;background:#3b82f6;border:2px solid #fff;border-radius:2px;pointer-events:all;${style}`}
                    onMouseDown={(e) => startDrag(e, id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div class={`flex justify-end gap-2 px-4 py-3 border-t flex-shrink-0 ${darkMode() ? 'border-gray-700' : 'border-gray-200'}`}>
          <button class="btn" onClick={props.onClose}>취소</button>
          <button class="btn" style="background:#3b82f6;color:#fff" disabled={processing()} onClick={onConfirm}>
            {processing() ? '처리중...' : '자르기'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CropModal