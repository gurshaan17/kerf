import type { Dispatch, SetStateAction } from 'react';
import { STARTER_BRAND_KITS } from '@kerf/model';
import type { Asset, BrandKit } from '@kerf/model';
import { Button, Input, Select } from '@kerf/ui';
import type { RecipeLibrary } from './library';
export function BrandSettings({
  kit,
  setKit,
  library,
  media,
  logo,
  setLogo,
  brandName,
  setBrandName,
  onSave,
}: {
  kit: BrandKit;
  setKit: Dispatch<SetStateAction<BrandKit>>;
  library: RecipeLibrary;
  media: Asset[];
  logo: string;
  setLogo: (value: string) => void;
  brandName: string;
  setBrandName: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <details>
      <summary>Brand & opening / closing cards</summary>
      <div className="bp-brand-fields">
        <label>
          Brand preset
          <Select
            aria-label="Review brand kit"
            value={kit.name}
            options={[...STARTER_BRAND_KITS, ...library.kits].map((item) => ({
              value: item.name,
              label: item.name,
            }))}
            onChange={(event) =>
              setKit(
                [...STARTER_BRAND_KITS, ...library.kits].find(
                  (item) => item.name === event.target.value,
                )!,
              )
            }
          />
        </label>
        {(['foreground', 'background', 'accent'] as const).map((key) => (
          <label key={key}>
            {key === 'foreground'
              ? 'Text color'
              : key === 'background'
                ? 'Background'
                : 'Accent'}
            <Input
              type="color"
              aria-label={key}
              value={kit.style[key]}
              onChange={(event) =>
                setKit({
                  ...kit,
                  style: {
                    ...kit.style,
                    [key]: event.target.value,
                  },
                })
              }
            />
          </label>
        ))}
        <label>
          Font
          <Select
            aria-label="Brand font"
            value={kit.style.displayFontFamily}
            options={['Instrument Sans', 'Fraunces', 'JetBrains Mono'].map(
              (value) => ({ value, label: value }),
            )}
            onChange={(event) =>
              setKit({
                ...kit,
                style: {
                  ...kit.style,
                  displayFontFamily: event.target.value,
                },
              })
            }
          />
        </label>
        <label>
          Opening card
          <Input
            aria-label="Opening card"
            value={kit.intro}
            maxLength={200}
            placeholder="Optional"
            onChange={(event) => setKit({ ...kit, intro: event.target.value })}
          />
        </label>
        <label>
          Closing card
          <Input
            aria-label="Closing card"
            value={kit.outro}
            maxLength={200}
            placeholder="Optional"
            onChange={(event) => setKit({ ...kit, outro: event.target.value })}
          />
        </label>
        <label>
          Logo
          <Select
            aria-label="Logo"
            value={logo}
            options={[
              { value: '', label: 'No logo' },
              ...media
                .filter((asset) => asset.kind === 'image')
                .map((asset) => ({
                  value: asset.id,
                  label: asset.name,
                })),
            ]}
            onChange={(event) => setLogo(event.target.value)}
          />
        </label>
        <label>
          Save brand separately
          <Input
            aria-label="Brand preset name"
            value={brandName}
            maxLength={80}
            placeholder="e.g. Acme"
            onChange={(event) => setBrandName(event.target.value)}
          />
        </label>
        <Button onClick={onSave}>Save brand preset</Button>
      </div>
    </details>
  );
}
