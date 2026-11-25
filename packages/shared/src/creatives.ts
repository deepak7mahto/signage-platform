import { z } from 'zod';

export type CreativeFieldType = 'text' | 'url' | 'textarea' | 'select' | 'number';

export interface CreativeFieldDef {
  key: string;
  label: string;
  fieldType: CreativeFieldType;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
}

export type CreativeCategory = 'media' | 'app';

export interface CreativeTypeDefinition {
  type: string;
  label: string;
  description: string;
  category: CreativeCategory;
  defaultDurationMs: number;
  requiresNetwork: boolean;
  fields: CreativeFieldDef[];
}

export const CreativeConfigSchema = z.record(z.string(), z.unknown());
export type CreativeConfig = z.infer<typeof CreativeConfigSchema>;

export const MediaTypeSchema = z.string().min(1).max(40);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const CREATIVE_TYPE_REGISTRY: readonly CreativeTypeDefinition[] = [
  {
    type: 'video',
    label: 'Video',
    description: '4K / HD MP4 or WebM video asset stored in S3.',
    category: 'media',
    defaultDurationMs: 15_000,
    requiresNetwork: false,
    fields: [],
  },
  {
    type: 'image',
    label: 'Image',
    description: 'High-resolution PNG, JPG, or WebP still graphic.',
    category: 'media',
    defaultDurationMs: 10_000,
    requiresNetwork: false,
    fields: [],
  },
  {
    type: 'webpage',
    label: 'Web Page',
    description: 'Embed a live dashboard, menu board, or HTTPS web URL.',
    category: 'app',
    defaultDurationMs: 25_000,
    requiresNetwork: true,
    fields: [
      {
        key: 'url',
        label: 'Web Page URL',
        fieldType: 'url',
        required: true,
        placeholder: 'https://example.com/menu',
      },
      {
        key: 'fallbackMessage',
        label: 'Loading / Offline Fallback Message',
        fieldType: 'text',
        placeholder: 'Live dashboard temporarily offline',
      },
    ],
  },
  {
    type: 'youtube',
    label: 'YouTube Video',
    description: 'Embed a YouTube video or livestream via URL or video ID.',
    category: 'app',
    defaultDurationMs: 30_000,
    requiresNetwork: true,
    fields: [
      {
        key: 'url',
        label: 'YouTube URL',
        fieldType: 'url',
        placeholder: 'https://www.youtube.com/watch?v=...',
      },
      {
        key: 'videoId',
        label: 'YouTube Video ID',
        fieldType: 'text',
        placeholder: 'dQw4w9WgXcQ (optional if URL set)',
      },
      {
        key: 'fallbackMessage',
        label: 'Loading / Offline Fallback Message',
        fieldType: 'text',
        placeholder: 'Stream connecting...',
      },
    ],
  },
  {
    type: 'weather',
    label: 'Weather Widget',
    description: 'Live local forecast widget powered by Open-Meteo with offline cache.',
    category: 'app',
    defaultDurationMs: 20_000,
    requiresNetwork: true,
    fields: [
      {
        key: 'city',
        label: 'City',
        fieldType: 'text',
        required: true,
        defaultValue: 'Mumbai',
        placeholder: 'e.g. Mumbai, Delhi, Bengaluru',
      },
      {
        key: 'unit',
        label: 'Temperature Unit',
        fieldType: 'select',
        defaultValue: 'C',
        options: [
          { value: 'C', label: 'Celsius (°C)' },
          { value: 'F', label: 'Fahrenheit (°F)' },
        ],
      },
      {
        key: 'fallbackMessage',
        label: 'Offline Fallback Message',
        fieldType: 'text',
        placeholder: 'Weather forecast updating...',
      },
    ],
  },
  {
    type: 'html',
    label: 'Announcement / HTML Card',
    description: 'Offline-ready announcement card with headline, message, and CTA.',
    category: 'app',
    defaultDurationMs: 15_000,
    requiresNetwork: false,
    fields: [
      {
        key: 'headline',
        label: 'Headline',
        fieldType: 'text',
        required: true,
        placeholder: 'Welcome to SignageOS',
      },
      {
        key: 'body',
        label: 'Message Body',
        fieldType: 'textarea',
        placeholder: 'Supporting message or offer details...',
      },
      {
        key: 'ctaText',
        label: 'Call to Action',
        fieldType: 'text',
        placeholder: 'Scan QR or visit reception',
      },
      {
        key: 'accentColor',
        label: 'Accent Theme',
        fieldType: 'select',
        defaultValue: 'amber',
        options: [
          { value: 'amber', label: 'Amber' },
          { value: 'emerald', label: 'Emerald' },
          { value: 'sky', label: 'Sky Blue' },
          { value: 'rose', label: 'Rose' },
        ],
      },
    ],
  },
];

export const APP_CREATIVE_TYPES: readonly CreativeTypeDefinition[] =
  CREATIVE_TYPE_REGISTRY.filter((def) => def.category === 'app');

export function getCreativeTypeDef(type: string): CreativeTypeDefinition | undefined {
  return CREATIVE_TYPE_REGISTRY.find((def) => def.type === type);
}

export function isBinaryMediaType(type: string): boolean {
  return type === 'video' || type === 'image';
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.replace(/^\//, '').split('/')[0] || null;
    }
    const v = parsed.searchParams.get('v');
    if (v) return v;
    const match = parsed.pathname.match(/\/(?:embed|shorts)\/([a-zA-Z0-9_-]{6,})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function validateCreativeConfig(
  type: string,
  config: CreativeConfig,
): { ok: true; normalized: CreativeConfig } | { ok: false; error: string } {
  const def = getCreativeTypeDef(type);
  if (!def || def.category !== 'app') {
    return { ok: false, error: `Unsupported app creative type: ${type}` };
  }

  const normalized: CreativeConfig = { ...config };

  for (const field of def.fields) {
    const rawVal = normalized[field.key];
    const strVal = typeof rawVal === 'string' ? rawVal.trim() : '';

    if (!strVal && field.defaultValue !== undefined) {
      normalized[field.key] = field.defaultValue;
    } else if (typeof rawVal === 'string') {
      normalized[field.key] = strVal;
    }

    const finalStr = typeof normalized[field.key] === 'string' ? (normalized[field.key] as string) : '';

    if (field.required && !finalStr) {
      return { ok: false, error: `${field.label} is required` };
    }

    if (field.fieldType === 'url' && finalStr) {
      if (!/^https?:\/\/.+/i.test(finalStr)) {
        return { ok: false, error: `${field.label} must start with http:// or https://` };
      }
    }
  }

  if (type === 'youtube') {
    const rawUrl = typeof normalized.url === 'string' ? normalized.url : '';
    const existingId = typeof normalized.videoId === 'string' ? normalized.videoId : '';
    const extracted = rawUrl ? extractYouTubeVideoId(rawUrl) : null;
    const finalId = existingId || extracted || '';
    if (!finalId) {
      return { ok: false, error: 'Provide a valid YouTube URL or video ID' };
    }
    normalized.videoId = finalId;
  }

  return { ok: true, normalized };
}
