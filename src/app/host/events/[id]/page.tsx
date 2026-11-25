import { HostPhotos } from '@/features/host/host-photos'

export default async function EventPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  return <HostPhotos id={(await params).id} />
}
