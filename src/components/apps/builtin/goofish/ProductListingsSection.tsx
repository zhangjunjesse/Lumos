'use client';

import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { useGoofishAuth } from '@/components/goofish/use-goofish-auth';
import type { GoofishAccount } from '@/components/goofish/use-goofish-auth';
import { ProductAddListingDialog } from './ProductAddListingDialog';
import { ProductListingCard } from './ProductListingCard';
import { useProductListings } from './use-product-listings';
import { useProducts } from './use-products';

export function ProductListingsSection({
  productId,
  productTitle,
}: {
  productId: string;
  productTitle: string;
}): React.ReactElement {
  const { listings, loading, create, update, remove, refresh } = useProductListings(productId);
  const { status } = useGoofishAuth();
  const accounts: GoofishAccount[] = status?.accounts ?? [];
  const { products } = useProducts();
  const product = products.find((r) => r.id === productId) ?? null;
  const [adding, setAdding] = React.useState(false);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          关联商品 ({listings.length})
        </h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding(true)}
          disabled={accounts.length === 0}
        >
          <Plus className="size-3.5" /> 挂到新账号
        </Button>
      </div>

      {loading ? (
        <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
        </div>
      ) : listings.length === 0 ? (
        <div className="flex h-16 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
          还没有挂到任何闲鱼账号上
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {listings.map((listing) => (
            <ProductListingCard
              key={listing.id}
              listing={listing}
              product={product}
              onPatch={(p) => void update(listing.id, p)}
              onRemove={() => void remove(listing.id)}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <ProductAddListingDialog
          productId={productId}
          productTitle={productTitle}
          product={product}
          accounts={accounts}
          existingAccountIds={listings.map((l) => l.account_unb)}
          onClose={() => setAdding(false)}
          onSubmit={async (draft) => {
            const row = await create(draft);
            if (row) {
              setAdding(false);
              await refresh();
            }
          }}
          onAfterPublish={() => {
            setAdding(false);
            void refresh();
          }}
        />
      ) : null}
    </section>
  );
}
