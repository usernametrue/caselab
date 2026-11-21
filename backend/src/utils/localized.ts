import { Schema } from 'mongoose';
import { z } from 'zod';

export type Locale = 'ru' | 'uz';
export const LOCALES: Locale[] = ['ru', 'uz'];

// Localized text { ru, uz } - every user-facing content field uses this shape
export type Localized = { ru: string; uz: string };

export const localizedSchema = new Schema<Localized>({
    ru: { type: String, default: '' },
    uz: { type: String, default: '' }
}, { _id: false });

export const localizedZod = z.object({
    ru: z.string().default(''),
    uz: z.string().default('')
});

// Text in the requested locale, falling back to the other one when empty
export const pick = (value: Partial<Localized> | undefined | null, locale: Locale): string => {
    if (!value) return '';
    return value[locale] || value[locale === 'ru' ? 'uz' : 'ru'] || '';
};
