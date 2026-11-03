/**
 * Editable scalar fields of every layer type (keys are the layer spec field names), for a
 * "layer properties" panel. Arrays and rects (colors[], rect, colormap) are not listed: presets
 * expose them through their own simpler knobs.
 */

import type { LayerType } from '../scene'
import {
  bool,
  choice,
  color,
  FONT_OPTIONS,
  num,
  text,
  type LocalizedText,
  type ParamSpec,
} from './params'

export interface LayerSchema {
  label: LocalizedText
  params: ParamSpec[]
}

export const LAYER_SCHEMAS: Record<LayerType, LayerSchema> = {
  background: {
    label: { ru: 'Фон', en: 'Background' },
    params: [
      color('pulseColor', 'Цвет вспышки', 'Pulse color', '#7c3aed'),
      num('vignette', 'Виньетка', 'Vignette', 0, 1, 0.05, 0.45),
    ],
  },
  noise: {
    label: { ru: 'Зерно и царапины', en: 'Grain and scratches' },
    params: [
      num('amount', 'Сила', 'Amount', 0, 1, 0.01, 0.18),
      num('grain', 'Размер зерна', 'Grain size', 0.001, 0.01, 0.0005, 0.0025),
      num('refreshHz', 'Смена, раз/с', 'Refresh, per s', 0, 30, 1, 12),
      num('scratches', 'Царапины', 'Scratches', 0, 12, 1, 0),
      bool('monochrome', 'Монохром', 'Monochrome', true),
    ],
  },
  'spectrum-bars': {
    label: { ru: 'Спектр: полосы', en: 'Spectrum: bars' },
    params: [
      num('barCount', 'Число полос', 'Bar count', 8, 128, 1, 48),
      num('gap', 'Зазор', 'Gap', 0, 0.9, 0.05, 0.3),
      num('radius', 'Скругление', 'Rounding', 0, 0.5, 0.05, 0.5),
      choice(
        'anchor',
        'Рост',
        'Grow from',
        [
          ['bottom', 'Снизу', 'Bottom'],
          ['center', 'От центра', 'Center'],
        ],
        'bottom',
      ),
      num('gamma', 'Контраст', 'Contrast', 0.5, 3, 0.1, 1.2),
      num('releaseSec', 'Спад, с', 'Release, s', 0, 1, 0.01, 0.18),
      num('reflection', 'Отражение', 'Reflection', 0, 1, 0.05, 0.25),
    ],
  },
  'spectrum-curve': {
    label: { ru: 'Спектр: линия / горы', en: 'Spectrum: line / mountains' },
    params: [
      choice(
        'style',
        'Стиль',
        'Style',
        [
          ['line', 'Линия', 'Line'],
          ['mountain', 'Горы', 'Mountains'],
        ],
        'mountain',
      ),
      color('lineColor', 'Цвет линии', 'Line color', '#e0f2fe'),
      num('lineWidth', 'Толщина линии', 'Line width', 0.001, 0.02, 0.0005, 0.004),
      num('fillOpacity', 'Заливка', 'Fill opacity', 0, 1, 0.05, 0.55),
      bool('mirror', 'Зеркально', 'Mirrored', false),
      bool('grid', 'Сетка', 'Grid', false),
      bool('labels', 'Подписи частот', 'Frequency labels', false),
      num('releaseSec', 'Спад, с', 'Release, s', 0, 1, 0.01, 0.2),
    ],
  },
  spectrogram: {
    label: { ru: 'Спектрограмма', en: 'Spectrogram' },
    params: [
      num('historySec', 'История, с', 'History, s', 1, 15, 0.5, 6),
      choice(
        'direction',
        'Направление',
        'Direction',
        [
          ['left', 'Влево', 'Left'],
          ['up', 'Вверх', 'Up'],
        ],
        'left',
      ),
      num('gamma', 'Контраст', 'Contrast', 0.5, 3, 0.1, 1.4),
      bool('grid', 'Сетка', 'Grid', false),
    ],
  },
  oscilloscope: {
    label: { ru: 'Осциллограф', en: 'Oscilloscope' },
    params: [
      choice(
        'channel',
        'Каналы',
        'Channels',
        [
          ['mid', 'Моно (M)', 'Mid'],
          ['stereo', 'L и R', 'L and R'],
        ],
        'mid',
      ),
      color('color', 'Цвет', 'Color', '#a7f3d0'),
      color('color2', 'Цвет R', 'Right color', '#f9a8d4'),
      num('lineWidth', 'Толщина', 'Line width', 0.001, 0.02, 0.0005, 0.004),
      num('gain', 'Усиление', 'Gain', 0.5, 5, 0.1, 1.6),
      bool('grid', 'Сетка', 'Grid', false),
    ],
  },
  goniometer: {
    label: { ru: 'Гониометр', en: 'Goniometer' },
    params: [
      choice(
        'style',
        'Стиль',
        'Style',
        [
          ['dots', 'Точки', 'Dots'],
          ['lines', 'Линии', 'Lines'],
        ],
        'dots',
      ),
      color('color', 'Цвет', 'Color', '#bef264'),
      num('gain', 'Усиление', 'Gain', 0.5, 5, 0.1, 1.4),
      num('trail', 'След, кадров', 'Trail, frames', 0, 12, 1, 3),
      bool('grid', 'Сетка', 'Grid', true),
      bool('labels', 'Подписи', 'Labels', true),
    ],
  },
  'level-meters': {
    label: { ru: 'Пик / RMS / LUFS', en: 'Peak / RMS / LUFS' },
    params: [
      choice(
        'orientation',
        'Ориентация',
        'Orientation',
        [
          ['vertical', 'Вертикально', 'Vertical'],
          ['horizontal', 'Горизонтально', 'Horizontal'],
        ],
        'vertical',
      ),
      num('minDb', 'Низ шкалы, дБ', 'Scale floor, dB', -96, -24, 6, -60),
      num('holdSec', 'Удержание пика, с', 'Peak hold, s', 0, 5, 0.1, 1.5),
      bool('labels', 'Подписи', 'Labels', true),
    ],
  },
  correlation: {
    label: { ru: 'Корреляция', en: 'Correlation' },
    params: [
      num('smoothingSec', 'Сглаживание, с', 'Smoothing, s', 0, 2, 0.05, 0.3),
      color('positiveColor', 'Цвет «+»', 'Positive color', '#22c55e'),
      color('negativeColor', 'Цвет «−»', 'Negative color', '#ef4444'),
      bool('labels', 'Подписи', 'Labels', true),
    ],
  },
  waveform: {
    label: { ru: 'Волна трека', en: 'Track waveform' },
    params: [
      num('spanSec', 'Окно, с (0 = весь трек)', 'Window, s (0 = whole track)', 0, 30, 1, 0),
      num('barWidth', 'Ширина столбца', 'Column width', 0.002, 0.03, 0.001, 0.006),
      color('playedColor', 'Проиграно', 'Played', '#f8fafc'),
      color('playheadColor', 'Плейхед', 'Playhead', '#f43f5e'),
    ],
  },
  text: {
    label: { ru: 'Заголовок', en: 'Title' },
    params: [
      text('text', 'Текст', 'Text', ''),
      num('fontSize', 'Размер', 'Size', 0.02, 0.2, 0.005, 0.075),
      num('fontWeight', 'Насыщенность', 'Weight', 100, 900, 100, 800),
      color('color', 'Цвет', 'Color', '#ffffff'),
      bool('uppercase', 'Заглавными', 'Uppercase', true),
    ],
  },
  lyrics: {
    label: { ru: 'Текст песни (караоке)', en: 'Lyrics (karaoke)' },
    params: [
      num('fontSize', 'Размер', 'Size', 0.03, 0.15, 0.005, 0.075),
      num('fontWeight', 'Насыщенность', 'Weight', 100, 900, 100, 800),
      color('fillColor', 'Спето', 'Sung', '#ffffff'),
      bool('showNext', 'Показывать следующую строку', 'Show next line', true),
      bool('uppercase', 'Заглавными', 'Uppercase', false),
      num('transitionSec', 'Смена строки, с', 'Line transition, s', 0.05, 1, 0.05, 0.3),
    ],
  },
  kinetic: {
    label: { ru: 'Кинетическая типографика', en: 'Kinetic typography' },
    params: [
      choice(
        'mode',
        'Раскладка',
        'Layout',
        [
          ['flow', 'Строкой', 'Flow'],
          ['stack', 'Столбиком', 'Stack'],
          ['focus', 'Одно слово', 'Focus word'],
        ],
        'flow',
      ),
      num('fontSize', 'Размер', 'Size', 0.04, 0.3, 0.01, 0.12),
      num('weightMin', 'Вес тихих слов', 'Quiet weight', 100, 900, 100, 300),
      num('weightMax', 'Вес громких слов', 'Loud weight', 100, 900, 100, 900),
      num('sizeReact', 'Размер от громкости', 'Size by loudness', 0, 1, 0.05, 0.25),
      num('appearScale', 'Масштаб появления', 'Pop-in scale', 1, 3, 0.05, 1.35),
      num('futureOpacity', 'Будущие слова', 'Upcoming words', 0, 1, 0.05, 0),
      num('beatPunch', 'Удар на бит', 'Beat punch', 0, 0.3, 0.01, 0.04),
      num('jitter', 'Дрожание', 'Jitter', 0, 0.05, 0.001, 0),
      num('tear', 'Разрыв букв', 'Tear', 0, 1, 0.05, 0),
    ],
  },
  fulltext: {
    label: { ru: 'Текст на весь экран', en: 'Full-screen text' },
    params: [
      choice(
        'mode',
        'Раскладка',
        'Layout',
        [
          ['word', 'Слово', 'Word'],
          ['phrase', 'Фраза', 'Phrase'],
          ['stack', 'Столбик слов', 'Word stack'],
        ],
        'word',
      ),
      choice(
        'orientation',
        'Ориентация',
        'Orientation',
        [
          ['horizontal', 'Горизонтально', 'Horizontal'],
          ['vertical', 'Вертикально', 'Vertical'],
          ['alternate', 'Чередовать', 'Alternate'],
          ['random', 'Случайно (сид)', 'Random (seed)'],
        ],
        'alternate',
      ),
      num('verticalChance', 'Доля вертикальных', 'Vertical share', 0, 1, 0.05, 0.4),
      choice(
        'flipBy',
        'Поворот по',
        'Turn by',
        [
          ['line', 'Строкам', 'Lines'],
          ['word', 'Словам', 'Words'],
        ],
        'line',
      ),
      choice(
        'fillStyle',
        'Буквы',
        'Letters',
        [
          ['solid', 'Заливка', 'Solid'],
          ['outline', 'Контур', 'Outline'],
          ['video', 'Видео внутри букв', 'Picture inside'],
        ],
        'solid',
      ),
      bool('uppercase', 'Заглавные', 'Uppercase', true),
      num('fill', 'Заполнение', 'Fill', 0.5, 1.4, 0.02, 0.92),
      num('maxHeight', 'Макс. высота', 'Max height', 0.1, 1, 0.05, 0.5),
      color('color', 'Цвет', 'Color', '#ffffff'),
      color('activeColor', 'Цвет текущего слова', 'Active word color', '#ffffff'),
      color('strokeColor', 'Цвет контура', 'Outline color', '#ffffff'),
      num('strokeWidth', 'Контур', 'Outline', 0, 0.02, 0.001, 0),
      num('outsideDim', 'Затемнение вокруг', 'Dim outside', 0, 1, 0.05, 0.7),
      num('echoes', 'Эхо-контуры', 'Echo outlines', 0, 6, 1, 0),
      num('echoSpread', 'Шаг эха', 'Echo step', 0.02, 0.3, 0.01, 0.08),
      choice(
        'entrance',
        'Появление',
        'Entrance',
        [
          ['slam', 'Удар', 'Slam'],
          ['mask', 'Из-под маски', 'Mask reveal'],
          ['mixed', 'Вперемешку (сид)', 'Mixed (seed)'],
        ],
        'mixed',
      ),
      num('appearScale', 'Масштаб удара', 'Slam scale', 1, 3, 0.05, 1.4),
      num('beatPunch', 'Удар на бит', 'Beat punch', 0, 0.3, 0.01, 0.06),
      num('shake', 'Тряска', 'Shake', 0, 0.04, 0.001, 0.006),
    ],
  },
}

export { FONT_OPTIONS }
