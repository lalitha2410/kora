# Product photography needed

`src/data/catalog.ts`'s `img()` helper points every catalog item's `imageUrl` at a local
file in this folder — `/products/{itemId}.jpg`, served by Vite directly from `public/`.

**None of these files exist yet.** Until they're added, every product image in the app
(chat bubbles, opening messages) is simply omitted — see `ChatBubble.tsx`'s
`ChatProductImage`, which hides the `<img>` on a load error instead of falling back to a
placeholder. The rest of the message (caption text, numbering) still renders normally
either way, so the demo works fine with zero files here too — this is purely a visual
upgrade once real (or realistic placeholder) photos are dropped in.

## Format

- **320×400px** (4:5 portrait) — matches every current catalog entry's expected aspect.
  Not a hard requirement (`ChatBubble.tsx` renders at a fixed compact height with
  `object-cover`, so other aspect ratios just get center-cropped), but this is what the
  layout was tuned against.
- **JPEG**, filename exactly `{itemId}.jpg` (case-sensitive, matches the itemId's own
  casing below).

## Files needed (16 — one per catalog item)

Every current Kora catalog item has exactly one fixed colourway (see `CatalogItem`'s own
doc in `src/types.ts` — no true SKU colour-variants are modeled; a different colour is
always a different catalog item, e.g. `K-KUR-01` vs `K-KUR-02`, never two photos of the
same entry). So only the base filename is needed for every item below — there is no
`{itemId}-{colour}.jpg` file to generate today.

| File | Product | Colour |
|---|---|---|
| `K-KUR-01.jpg` | Undyed Cotton Straight Kurta | Undyed Natural |
| `K-KUR-02.jpg` | Sage Linen A-Line Kurta | Sage |
| `K-KUR-03.jpg` | Clay Block-Print Short Kurta | Clay |
| `K-SAR-01.jpg` | Handloom Cotton Saree — Clay Border | Clay Border |
| `K-SAR-02.jpg` | Sage Tussar Silk Saree | Sage |
| `K-CO-01.jpg` | Undyed Cotton Co-ord Set | Undyed Natural |
| `K-CO-02.jpg` | Sage Linen Co-ord Set | Sage |
| `K-DRS-01.jpg` | Clay Hand Block-Print Midi Dress | Clay |
| `K-DRS-02.jpg` | Undyed Cotton Tiered Maxi Dress | Undyed Natural |
| `K-DRS-03.jpg` | Limited Edition Hand-Embroidered Dress | Ivory |
| `K-TOP-01.jpg` | Sage Cotton Wrap Top | Sage |
| `K-TOP-02.jpg` | Undyed Cotton Boxy Top | Undyed Natural |
| `K-TRS-01.jpg` | Undyed Cotton Wide-Leg Trousers | Undyed Natural |
| `K-TRS-02.jpg` | Sage Linen Tapered Trousers | Sage |
| `K-SET-01.jpg` | Bridal Handloom Silk Set | Ivory |
| `K-SHW-01.jpg` | Clay Handwoven Cotton Shawl | Clay |

## If colour variants are ever added

If a future catalog item genuinely needs more than one photo (a real multi-colour SKU,
not a separate item), `img(itemId, colour)` already supports it — drop the file in as
`/products/{itemId}-{colour-slugified}.jpg` (lowercase, spaces/punctuation → single
hyphens, e.g. colour `"Clay Border"` → `k-sar-01-clay-border.jpg`) and pass that colour
as `img()`'s second argument at the call site in `catalog.ts`. Nothing else needs to
change — `ChatBubble.tsx`'s missing-file handling and the rest of the image pipeline are
already colour-agnostic.
