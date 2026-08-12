import type { CatalogItem } from '../types';

function img(label: string, bg = 'EDE7DA', fg = '4A4438'): string {
  return `https://placehold.co/320x400/${bg}/${fg}?text=${encodeURIComponent(label)}`;
}

const APPAREL_SIZES = ['S', 'M', 'L', 'XL'];
const TROUSER_SIZES = ['28', '30', '32', '34'];
const FREE_SIZE = ['Free Size'];

/**
 * Kora's product catalog — undyed cotton, sage, clay, handloom textures.
 * `marginPercent` and `onSale` are read directly by pricingPolicy.ts; there
 * is no separate "cost price" field because gross margin is all the
 * discount engine needs to enforce a floor.
 *
 * findSimilarItems/findAlternativesByBudget (tools.ts) match on `category` +
 * price ceiling, so every category below has at least two items at
 * different price points. findAlternativesBySize and findAlternativesByColour
 * need the same category spread across `sizes`/`colour` — every category has
 * at least one item with an `outOfStockSizes` entry and at least two distinct
 * `colour` values, so both tools have real, non-empty results to return
 * against the seeded carts (see data/carts.ts CART-013..016).
 */
export const catalog: CatalogItem[] = [
  {
    itemId: 'K-KUR-01',
    name: 'Undyed Cotton Straight Kurta',
    category: 'Kurta',
    price: 1849,
    fabric: '100% handloom cotton, undyed natural tone',
    onSale: false,
    marginPercent: 52,
    inStock: true,
    imageUrl: img('Cotton Kurta'),
    colour: 'Undyed Natural',
    sizes: APPAREL_SIZES,
    // L sold out (still fine in S/M/XL) — backs CART-014's size-unavailable
    // scenario: the customer's own cart is size L.
    outOfStockSizes: ['L'],
  },
  {
    itemId: 'K-KUR-02',
    name: 'Sage Linen A-Line Kurta',
    category: 'Kurta',
    price: 2299,
    fabric: '100% pure linen',
    onSale: false,
    marginPercent: 50,
    inStock: true,
    imageUrl: img('Linen Kurta', 'DDE2D0', '3F4A36'),
    colour: 'Sage',
    sizes: APPAREL_SIZES,
    outOfStockSizes: [],
  },
  {
    itemId: 'K-KUR-03',
    name: 'Clay Block-Print Short Kurta',
    category: 'Kurta',
    price: 1299,
    fabric: 'Cotton, hand block-printed',
    onSale: false,
    marginPercent: 48,
    inStock: true,
    imageUrl: img('Block Print Kurta', 'D9B99B', '4A3423'),
    colour: 'Clay',
    sizes: APPAREL_SIZES,
    outOfStockSizes: [],
  },
  {
    itemId: 'K-SAR-01',
    name: 'Handloom Cotton Saree — Clay Border',
    category: 'Saree',
    price: 4499,
    fabric: 'Handloom cotton, natural dye border',
    onSale: false,
    marginPercent: 45,
    inStock: true,
    imageUrl: img('Handloom Saree', 'D9B99B', '4A3423'),
    colour: 'Clay Border',
    sizes: FREE_SIZE,
    outOfStockSizes: [],
  },
  {
    itemId: 'K-SAR-02',
    name: 'Sage Tussar Silk Saree',
    category: 'Saree',
    price: 6899,
    fabric: 'Tussar silk',
    onSale: false,
    marginPercent: 42,
    inStock: true,
    imageUrl: img('Tussar Saree', 'DDE2D0', '3F4A36'),
    colour: 'Sage',
    sizes: FREE_SIZE,
    outOfStockSizes: [],
  },
  {
    itemId: 'K-CO-01',
    name: 'Undyed Cotton Co-ord Set',
    category: 'Co-ord Set',
    price: 3299,
    fabric: '100% cotton, natural undyed',
    onSale: false,
    marginPercent: 47,
    inStock: true,
    imageUrl: img('Co-ord Set'),
    colour: 'Undyed Natural',
    sizes: ['S', 'M', 'L'],
    outOfStockSizes: [],
  },
  {
    itemId: 'K-CO-02',
    name: 'Sage Linen Co-ord Set',
    category: 'Co-ord Set',
    price: 3799,
    fabric: '100% pure linen',
    onSale: false,
    marginPercent: 46,
    inStock: false,
    imageUrl: img('Linen Co-ord', 'DDE2D0', '3F4A36'),
    colour: 'Sage',
    sizes: ['S', 'M', 'L'],
    // Discontinued outright — every size out, matching inStock:false above.
    outOfStockSizes: ['S', 'M', 'L'],
  },
  {
    itemId: 'K-DRS-01',
    name: 'Clay Hand Block-Print Midi Dress',
    category: 'Dress',
    price: 2799,
    fabric: 'Cotton, hand block-printed',
    onSale: true,
    marginPercent: 44,
    inStock: true,
    imageUrl: img('Midi Dress', 'D9B99B', '4A3423'),
    colour: 'Clay',
    sizes: APPAREL_SIZES,
    outOfStockSizes: [],
  },
  {
    itemId: 'K-DRS-02',
    name: 'Undyed Cotton Tiered Maxi Dress',
    category: 'Dress',
    price: 3499,
    fabric: '100% cotton',
    onSale: false,
    marginPercent: 48,
    inStock: true,
    imageUrl: img('Maxi Dress'),
    colour: 'Undyed Natural',
    sizes: APPAREL_SIZES,
    outOfStockSizes: [],
  },
  {
    itemId: 'K-TOP-01',
    name: 'Sage Cotton Wrap Top',
    category: 'Top',
    price: 1299,
    fabric: '100% cotton',
    onSale: false,
    marginPercent: 50,
    inStock: true,
    imageUrl: img('Wrap Top', 'DDE2D0', '3F4A36'),
    colour: 'Sage',
    sizes: ['S', 'M', 'L'],
    outOfStockSizes: [],
  },
  {
    itemId: 'K-TOP-02',
    name: 'Undyed Cotton Boxy Top',
    category: 'Top',
    price: 699,
    fabric: '100% cotton',
    onSale: false,
    marginPercent: 38,
    inStock: true,
    imageUrl: img('Boxy Top'),
    colour: 'Undyed Natural',
    sizes: APPAREL_SIZES,
    outOfStockSizes: [],
  },
  {
    itemId: 'K-TRS-01',
    name: 'Undyed Cotton Wide-Leg Trousers',
    category: 'Trousers',
    price: 1999,
    fabric: '100% cotton',
    onSale: false,
    marginPercent: 49,
    inStock: true,
    imageUrl: img('Wide Leg Trousers'),
    colour: 'Undyed Natural',
    sizes: TROUSER_SIZES,
    outOfStockSizes: [],
  },
  {
    itemId: 'K-TRS-02',
    name: 'Sage Linen Tapered Trousers',
    category: 'Trousers',
    price: 2499,
    fabric: '100% pure linen',
    onSale: false,
    marginPercent: 47,
    inStock: true,
    imageUrl: img('Linen Trousers', 'DDE2D0', '3F4A36'),
    colour: 'Sage',
    sizes: TROUSER_SIZES,
    outOfStockSizes: [],
  },
  {
    itemId: 'K-SET-01',
    name: 'Bridal Handloom Silk Set',
    category: 'Occasion',
    price: 12999,
    fabric: 'Pure silk, zari border, hand-finished',
    onSale: false,
    marginPercent: 55,
    inStock: true,
    imageUrl: img('Silk Occasion Set', 'D9B99B', '4A3423'),
    colour: 'Ivory',
    sizes: APPAREL_SIZES,
    outOfStockSizes: [],
  },
  {
    itemId: 'K-DRS-03',
    name: 'Limited Edition Hand-Embroidered Dress',
    category: 'Dress',
    price: 4999,
    fabric: 'Cotton silk blend, hand embroidery, imported thread work',
    onSale: false,
    // Deliberately thin — imported embellishment eats the margin most
    // Kora pieces carry. Used to demonstrate the margin floor blocking a
    // discount even though the tier cap alone would allow one (see
    // pricingPolicy.ts and the "price objection -> cheaper alternative"
    // scenario in data/scenarios.ts).
    marginPercent: 20,
    inStock: true,
    imageUrl: img('Embroidered Dress', 'D9B99B', '4A3423'),
    colour: 'Ivory',
    sizes: ['S', 'M', 'L'],
    outOfStockSizes: [],
  },
  {
    itemId: 'K-SHW-01',
    name: 'Clay Handwoven Cotton Shawl',
    category: 'Accessory',
    price: 999,
    fabric: 'Handwoven cotton',
    onSale: false,
    marginPercent: 40,
    inStock: true,
    imageUrl: img('Cotton Shawl', 'D9B99B', '4A3423'),
    colour: 'Clay',
    sizes: FREE_SIZE,
    outOfStockSizes: [],
  },
];

export function getCatalogItem(itemId: string): CatalogItem | undefined {
  return catalog.find((c) => c.itemId === itemId);
}
