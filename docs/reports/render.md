# Рендер-движок и визуализация — отчёт (вехи 1–3, правки после просмотра)

Код: `src/render/`, `src/visualizers/`. Стенд `dev/render.html` (порт 5177; URL: `?preset=neon&format=1080x1920&fps=30&fx=style|demo|none&frame=N&safe=1`, «эффекты стиля» = `styleEffects` пресета), бенчмарки `e2e/render/frame-cost.spec.ts`.

## Публичный API (`@/render`)

- `new SceneRenderer({ willReadFrequently?, alpha?, createEffect?, effectFontFamilies? })` реализует `FrameRenderer`: `init({canvas, width, height, fps, timeline, scene})` → Promise (ждёт шрифты слоёв и эффектов через `effectFontFamilies` из `@/effects`, прогревает кадр), `renderFrame(N)`, `resize(w, h)`, `dispose()`. Работает с HTMLCanvas и OffscreenCanvas (воркер), при импорте не трогает window/document.
- `Scene` = `{ version: 1, seed, safeArea: 'social'|'none', layers: LayerSpec[], effects: EffectSpec[] }`; вход `SceneInput` с необязательными полями, `normalizeScene()` подставляет дефолты, `null` → `createDefaultScene()`, `layerDefaults(type)`.
- Слой: `{ id, type, enabled?, opacity?, blend?, camera? }` + поля типа. Типы: background, noise, spectrum-bars, spectrum-curve (line/mountain), spectrogram, oscilloscope, goniometer, level-meters, correlation, waveform, text, lyrics (караоке), kinetic.
- Разметка: `RectSpec {x,y,w,h, space}` в долях; `space`: `safe` (как есть; в 9:16 асимметрична — справа колонка кнопок), `center` (safe, симметричная по горизонтали — всё центровое), `bleed` (вся ширина × высота safe — волны от края до края), `frame`. Размеры — в долях короткой стороны (`unit`). Дефолты центровых слоёв — `center`, полос/волн — `bleed`.
- Движение слоя (`motion.ts`, поле `motion` любого слоя): `sections` (прозрачность по quiet/build/drop/normal с плавным переходом), `beatScale`/`beatAlpha` (удар на бите с затуханием, `beatSections` — сила по секциям), `origin`, `depth` (параллакс: доля движения эффект-камеры). Масштаб вшивается в камеру слоя, поэтому `WordBox` точны.
- Пресеты: `STYLE_PRESETS` (studio, neon, minimal, grunge), `getStylePreset(id)`, `buildPresetScene(id, values)`, `presetDefaults(p)`. Пресет = `{ id, name, description (ru/en), effectStyle, params: ParamSpec[], build(values) → SceneInput }`.
- Схемы: `ParamSpec` (number/boolean/enum/color как в `@/effects`, плюс `text`), `LAYER_SCHEMAS[type]`, `resolveParams`, `defaultParams`, `FONT_OPTIONS`.
- Шрифты: `FONT_FAMILY` (STV Inter / Unbounded / Oswald / JetBrains Mono, OFL, woff2 в `src/render/fonts/`), `fontStack`, `loadEmbeddedFonts`.
- Точки расширения (`effectsHost.ts`, всё реэкспортировано): `Effect { remapTime?, camera?, overlay?, post?: PostPass }`, `EffectFactory` (`createEffect` из `@/effects`), `PostKit` (program/target/bind/texture/draw/copy), `CameraTransform`. Порядок кадра: время → камера → слои → overlay → post. `FrameContext`: time/baseTime, beat, section, camera, `rng(salt)`, sample/band/spectrumAt/rect, `words`.
- Слова в кадре (`words.ts`): `f.words: FrameWords` — `get(wordId)`, `active(time)`, `all()` → `WordBox {wordId, layerId, x, y (центр), width, height, start, end}` в экранных px после камеры слоя. Заполняют слои `lyrics` и `kinetic` (`place()`); видно в `overlay`/`post`, в `remapTime`/`camera` пусто (они до слоёв). `emptyFrameWords()` для тестов.
- Тестовые данные: `createFakeTimeline({durationSec, bpm, seed, scopePoints, ...})` — спектр, ритм, `beatStrength`, `sections`, `scope`, лирика RU/EN, акценты.

## Что готово

Движок слоёв с эффектами и WebGL2-цепочкой, 8 визуализаторов в духе MiniMeters, караоке-лирика, кинетическая типографика (flow/stack/focus, вес и размер от громкости, рваные буквы), зерно, 4 пресета, схемы параметров. Центровка во всех форматах (автотест `symmetry.test.ts`: rect центровых слоёв и bbox нарисованного симметричны ±1 px, 4 пресета × 4 формата). Неон переделан: пол-спектрограмма, волна дропа, вектороскоп за текстом, «трубки» (широкий тусклый ореол + тонкая яркая жила), всё от края до края; новые параметры `tertiary`, `core`, `floor`, `motion`. Превью 1080×1920: 76–114 кадр/с с синхронизацией GPU на каждом кадре; `renderFrame` < 1 мс на CPU.

## Ловушки

- Детерминизм: кадр зависит только от (timeline, scene, size, fps, N); случайность только через сид; кэши хранят лишь чистые функции (раскладка текста, строки спектрограммы).
- Chrome рисует первую композицию нового источника (GL-канвас, OffscreenCanvas, паттерн) с другим округлением (±1–4 уровня). Лечится прогревочным кадром в `init`; промежуточные канвасы — `willReadFrequently`.
- GPU и CPU растеризуют по-разному, `getImageData` переводит канвас на CPU. Хэши сравнивать на одном бэкенде (`willReadFrequently: true`) или через `VideoFrame.copyTo`.
- GL → 2D: результат пост-проходов рисуется обратно в выходной 2D-канвас (`copy`); в CPU-режиме через `readPixels`/`putImageData`, иначе следующий кадр растеризуется иначе.
- Шрифты: без встроенных экспорт отличается между машинами; `init` ждёт `fontFamily` всех слоёв и `effectFontFamilies` всех эффектов сцены.
- Экспорт медленнее реального времени из-за `VideoFrame`/энкодера (~25 мс на кадр даже на пустой сцене), не из-за рендера.

## Что осталось

0. ~~Неоновая вспышка на бите~~ — главная сессия снизила `beat-flash.amount` неона до 0.1.

1. ~~Частицы из слова~~ — сделано главной сессией: `ParticleOverlay.wordId`, `atWord()` в `src/effects/host.ts` (фолбэк — параметры origin).
2. Камера по слову (zoom в слово) невозможна сейчас: хук `camera` идёт до слоёв. Если понадобится — отдельный проход раскладки без отрисовки до камеры (слои с методом `placeWords(f)`), решение главной сессии.
3. Свести пути эффектов — оценка: `EffectsCompositor` в коде уже нет, путь один (`createEffect`). Остались хвосты: (а) `SceneRenderer` и `dev/common.ts` берут `createEffect`/`effectFontFamilies` через `effectsModule as {...}` — заменить прямым импортом из `@/effects` (цикла нет: эффекты импортируют из `@/render` только типы); (б) `dev/sampleEffects.ts` — примеры API для стенда, удалить или оставить флажком стенда; (в) эффектам перевести `import type` с `@/render/effectsHost` на `@/render`. ~30 минут, Haiku/Sonnet.
4. Опционально: слой Butterchurn, акценты на уровне слов в караоке-слое, настройка качества спектрограммы.
