import { ImageDetailView } from '@/components/apps/builtin/etsy-forge/ImageDetailView';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EtsyForgeImageDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <ImageDetailView imageId={id} />;
}
