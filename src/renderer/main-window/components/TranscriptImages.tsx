import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TranscriptImage } from '@shared/types/transcript'
import { cn } from '../../shared/lib/utils'
import type { Size } from '../../shared/lib/zoom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../shared/components/ui/dialog'
import { ZoomableView } from '../../shared/components/ZoomableView'

/**
 * エージェントの返信・ツールコールの結果に含まれていた画像を並べる。`data` の無い画像は
 * `[image <mimeType>]` のプレースホルダにする。画像をクリックすると、拡大・縮小できるダイアログで開く。
 */
export function TranscriptImages({ images, className }: { images: TranscriptImage[]; className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  const [opened, setOpened] = useState<TranscriptImage | null>(null)
  return (
    <div className={cn('flex flex-wrap items-start gap-2', className)}>
      {images.map((image, i) =>
        image.data ? (
          <button
            key={i}
            className="overflow-hidden rounded border border-border hover:border-primary"
            title={t('transcript.image.open')}
            onClick={() => setOpened(image)}
          >
            <img src={imageUrl(image)} alt={image.mimeType} className="block max-h-64 max-w-full" draggable={false} />
          </button>
        ) : (
          <span key={i} className="text-transcript-sm italic text-muted-foreground">
            [image {image.mimeType}]
          </span>
        )
      )}
      {opened && <ImageDialog image={opened} onClose={() => setOpened(null)} />}
    </div>
  )
}

function ImageDialog({ image, onClose }: { image: TranscriptImage; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [natural, setNatural] = useState<Size | null>(null)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[85vh] max-w-[90vw] flex-col sm:max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>{t('transcript.image.title')}</DialogTitle>
        </DialogHeader>
        <ZoomableView natural={natural} initialMode="fitAll" className="flex-1">
          <img
            src={imageUrl(image)}
            alt={image.mimeType}
            className="block h-full w-full object-contain"
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth: width, naturalHeight: height } = e.currentTarget
              if (width > 0 && height > 0) setNatural({ width, height })
            }}
          />
        </ZoomableView>
      </DialogContent>
    </Dialog>
  )
}

function imageUrl(image: TranscriptImage): string {
  return `data:${image.mimeType};base64,${image.data ?? ''}`
}
