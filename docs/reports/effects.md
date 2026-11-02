# Эффекты и пост-обработка: отчёт (веха 3)

## Публичный API (`@/effects`)

- `createEffect: EffectFactory`: фабрика для хоста эффектов рендера (`src/render/effectsHost.ts`). Неизвестный `type` → `null`.
- Типы `scene.effects` (`EFFECT_TYPES[type]` = { label, description, params, hooks }):
  `accents` (все `timeline.accents`; params `style`, `font`, `fontWeight`), `beat-camera`, `beat-flash`,
  пост WebGL2: `bloom` (+`quality`), `chromatic-aberration`, `color-grade`, `vignette`, `scanlines` (VHS), `grain`.
- Акценты: `ACCENT_EFFECTS[id]` = { label, description, defaults {preRollSec, durationSec, intensity}, params },
  `ACCENT_EFFECT_ORDER`. Общие параметры всех акцентов: `attack` / `release` (linear|ease|sharp|soft|elastic).
- Схемы параметров: `ParamSpec` = number {min,max,step,default,unit?} | boolean | enum {options} | color ('#rrggbb'),
  подписи `label`/`hint` {ru,en}. `resolveParams` зажимает значения в диапазон и подставляет дефолты.
- Стили: `EFFECT_STYLES` / `EFFECT_STYLE_ORDER` (studio, neon, minimal, grunge), `styleEffects(id)` → готовые `EffectSpec[]`.
- Чистая логика: `prepareAccents` / `evaluateAccents`, `accentWindow`, `envelopeAt`, `beatAt`, `beatPulse`, `dropAmountAt`,
  `drawOverlays`, `effectFontFamilies`.

## Что готово

- 9 акцентов: zoom-punch, shake, fullscreen-word, glitch, flash, particle-burst, palette-shift, invert, slow-motion.
- Ритм: камера и вспышки на долях, усиление в дропах; фолбэк без `beatStrength` (даунбит 1, остальные 0.6) и без `sections`.
- 6 пост-проходов WebGL2, 4 стиля, стенд `dev/effects.html` (порт 5180).
- Детерминизм проверен: кадр N совпадает после других кадров, в новом рендерере и в воркере.
- Стоимость кадра 1080×1920 на машине разработки: 7.6–12.7 мс в зависимости от стиля. Тесты: `src/effects/*.test.ts`.

## Известные проблемы и ловушки

- Акценты и ритм идут по `frame.baseTime`. Slow-motion меняет только время слоёв (`remapTime`) и к концу окна догоняет звук.
- Эффект `accents` кэширует последний вычисленный кадр: несколько хуков на кадр, состояние между кадрами не переносится.
- Шрифт «слова на весь экран» не грузится движком: первый кадр может уйти системным шрифтом.
- Типы хоста импортируются из `@/render/effectsHost` (только `import type`, TODO).
- Силу bloom в неоне приходится ограничивать, иначе текст пересвечивается на сильной доле.
- Оверлеи рисуются в экранных координатах, вне камеры. Частицы не знают, где на экране слово.
- На встроенной графике может понадобиться `bloom.quality: 'low'`; не измерено.

## Что осталось

- Рендер: реэкспорт типов хоста из `@/render`; перед первым кадром ждать шрифты из `effectFontFamilies(spec)`.
  Опционально — раскладка строки лирики, чтобы частицы вылетали от слова.
- Фронт: строить контролы из `ParamSpec` (number→range, boolean→toggle, enum→select, color→color); дефолты нового
  акцента брать из `ACCENT_EFFECTS[id].defaults`; стиль задаёт `scene.effects = styleEffects(id)`.
- Замер на встроенной графике (по правилу 11, с подтверждением пользователя).
