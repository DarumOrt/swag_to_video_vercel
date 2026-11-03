# Эффекты и пост-обработка: отчёт (веха 4, волна 2)

## Публичный API (`@/effects`)

- `createEffect: EffectFactory`; неизвестный `type` → `null`. Типы `scene.effects` (`EFFECT_TYPES`): `accents`, `beat-camera`,
  `beat-flash`, `section-transitions`, **`drop-bursts`**, пост WebGL2: `bloom`, `chromatic-aberration`, `color-grade`,
  `vignette`, `scanlines`, `grain`.
- Акценты: `ACCENT_EFFECTS[id]` (15 шт., `ACCENT_EFFECT_ORDER`), общие `attack`/`release`/`breathe`. `ParamSpec`, `resolveParams`.
- Стили: `EFFECT_STYLES`, `EFFECT_STYLE_ORDER` = studio, neon, minimal, grunge, **edit**; `styleEffects(id)` → `scene.effects`.
- Секции (`sections.ts`): `sectionAt`, `moodAt`, **`shotMood(audio, shot, t)`**, `planTransitions`, **`planLineTransitions`**, `transitionAt(…, gain)`.

## Что готово (волна 2)

- **Наклон камеры**: `camera-orbit` пишет `camera.tiltX/tiltY` (с `director.camera3d` — перспектива движка, без неё —
  2D-сжатие). Гомография в шейдере осталась только фолбэком для хоста без наклона (признак — нет `f.shot`, оба пришли в
  одной версии движка). `beat-camera` получил `tilt` (°, по умолчанию 0): кивок в глубину на долях, направление по сиду.
- **`f.shot`**: настроение секции (beat-camera, beat-flash, все пост-проходы) берётся из шота — роль, `progress`,
  кроссфейд по `shot.enter` (у режиссёра), энергия × `shot.intensity`. Без режиссёра (нейтральный шот: variant/energy/chaos = 0)
  — свой кроссфейд 0.35 с, как раньше. Переходы и серии × `shotGain` (intensity, ≤1.5). Склейки стоят на `section.start`,
  а шоты режиссёра — это и есть секции, поэтому время совпадает.
- **Стиль `edit`** (для пресета «полноэкранный текст»): `section-transitions` с набором `edit` — `whip-zoom` (разгон наезда
  в склейку + 3D-разворот), `glitch`, `flash-cut` (белый/чёрный кадр ~2 кадра), `rgb` (RGB-сдвиг ступеньками); плюс
  склейки **на смене строк** (`lines` 0..1: короче ×0.6, слабее ×0.7, не ближе 0.6 с к секционной и 0.9 с к прошлой).
  Бит-камера с наклонами и креном, `drop-bursts` — серии строба / RGB-split в последних 1–2 долях такта (какие такты,
  длина, вид, 2 или 4 мигания на долю — по сиду; `sections: drop|peak`), хроматика, зерно, контраст, жёсткие акценты.
- Тесты: `edit.test.ts` (наклон и фолбэк, шот, стиль edit: детерминизм по сиду, разные сиды — разные склейки и серии) + старые, 96 зелёных.

## Включено главной сессией: `edit` у fullscreen

В `src/render/styles/presets.ts`: `EffectStyleRef = 'studio' | 'neon' | 'minimal' | 'grunge' | 'edit'` и у пресета
fullscreen `effectStyle: 'edit'` (вместо `'minimal'`). Больше ничего: `styleEffects('edit')` даёт полный список эффектов.
Склейки рисуют эффекты (в сцене есть `section-transitions`), режиссёр только меняет планы.

## Проблемы и ловушки

- Перспектива — проход движка по всему кадру: оверлеи (строб, flash-cut) наклоняются вместе с кадром.
- `drop-bursts` и `flash-cut` — частые вспышки; для чувствительных зрителей нужен будет переключатель «без строба» (фронт).
- Фейковый `FrameContext` без `shot` (старые тесты) идёт прежним путём. Режимы — в одном акцентном проходе.

## Что осталось

- Фронт: иконки новых id, `breathe`, UI диапазона, стиль `edit`. Визуальная оценка `edit` (пользователь), замер кадра (правило 11).
