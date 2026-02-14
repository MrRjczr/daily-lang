
export interface TranscriptItem {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface Language {
  code: string;
  name: string;
  flag: string;
  short: string;
}

export type Theme = 'midnight' | 'dark' | 'light';
export type AccentColor = 'indigo' | 'emerald' | 'rose';

export const LANGUAGES: Language[] = [
  { code: 'ru-RU', name: 'Russian', flag: '🇷🇺', short: 'RU' },
  { code: 'en-US', name: 'English', flag: '🇺🇸', short: 'EN' },
  { code: 'de-DE', name: 'German', flag: '🇩🇪', short: 'DE' },
  { code: 'fr-FR', name: 'French', flag: '🇫🇷', short: 'FR' },
  { code: 'es-ES', name: 'Spanish', flag: '🇪🇸', short: 'ES' },
  { code: 'zh-CN', name: 'Chinese', flag: '🇨🇳', short: 'ZH' },
];

export enum AppMode {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  ERROR = 'ERROR'
}
