# Рендер-движок и визуализация — отчёт (вехи 1–3)

Код: `src/render/`, `src/visualizers/`. Стенд `dev/render.html` (порт 5177), бенчмарки `e2e/render/frame-cost.spec.ts`.

## Публичный API (`@/render`)

- `new SceneRenderer({ willReadFrequently?, alpha?, createEffect? })` реализует `FrameRenderer`: `init({canvas, width, height, fps, timeline, scene})` → Promise (ждёт шрифты, прогревает кадр), `renderFrame(N)`, `resize(w, h)`, `dispose()`. Работает с HTMLCanvas и OffscreenCanvas (воркер), при импорте не трогает window/document.
- `Scene` = `{ version: 1, seed, safeArea: 'social'|'none', layers: LayerSpec[], effects: EffectSpec[] }`; вход `SceneInput` с необязательными полями, `normalizeScene()` подставляет дефолты, `null` → `createDefaultScene()`, `layerDefaults(type)`.
- Слой: `{ id, type, enabled?, opacity?, blend?, camera? }` + поля типа. Типы: background, noise, spectrum-bars, spectrum-curve (line/mountain), spectrogram, oscilloscope, goniometer, level-meters, correlation, waveform, text, lyrics (караоке), kinetic.
- Разметка: `RectSpec {x,y,w,h, space:'safe'|'frame'}` в долях; размеры в долях короткой стороны (`unit`). Сцена без правок идёт в 9:16/16:9/1:1/4:5.
- Пресеты: `STYLE_PRESETS` (studio, neon, minimal, grunge), `getStylePreset(id)`, `buildPresetScene(id, values)`, `presetDefaults(p)`. Пресет = `{ id, name, description (ru/en), effectStyle, params: ParamSpec[], build(values) → SceneInput }`.
- Схемы: `ParamSpec` (number/boolean/enum/color как в `@/effects`, плюс `text`), `LAYER_SCHEMAS[type]`, `resolveParams`, `defaultParams`, `FONT_OPTIONS`.
- Шрифты: `FONT_FAMILY` (STV Inter / Unbounded / Oswald / JetBrains Mono, OFL, woff2 в `src/render/fonts/`), `fontStack`, `loadEmbeddedFonts`.
- Точки расширения (`effectsHost.ts`, всё реэкспортировано): `Effect { remapTime?, camera?, overlay?, post?: PostPass }`, `EffectFactory` (`createEffect` из `@/effects`), `PostKit` (program/target/bind/texture/draw/copy), `CameraTransform`. Порядок кадра: время → камера → слои → overlay → post. `FrameContext`: time/baseTime, beat, section, camera, `rng(salt)`, sample/band/spectrumAt/rect.
- Тестовые данные: `createFakeTimeline({durationSec, bpm, seed, scopePoints, ...})` — спектр, ритм, `beatStrength`, `sections`, `scope`, лирика RU/EN, акценты.

## Что готово

Движок слоёв с эффектами и WebGL2-цепочкой, 8 визуализаторов в духе MiniMeters, караоке-лирика, кинетическая типографика (flow/stack/focus, вес и размер от громкости, рваные буквы), зерно, 4 пресета, схемы параметров. Превью 1080×1920: 76–114 кадр/с с синхронизацией GPU на каждом кадре; `renderFrame` < 1 мс на CPU.

## Ловушки

- Детерминизм: кадр зависит только от (timeline, scene, size, fps, N); случайность только через сид; кэши хранят лишь чистые функции (раскладка текста, строки спектрограммы).
- Chrome рисует первую композицию нового источника (GL-канвас, OffscreenCanvas, паттерн) с другим округлением (±1–4 уровня). Лечится прогревочным кадром в `init`; промежуточные канвасы — `willReadFrequently`.
- GPU и CPU растеризуют по-разному, `getImageData` переводит канвас на CPU. Хэши сравнивать на одном бэкенде (`willReadFrequently: true`) или через `VideoFrame.copyTo`.
- GL → 2D: результат пост-проходов рисуется обратно в выходной 2D-канвас (`copy`); в CPU-режиме через `readPixels`/`putImageData`, иначе следующий кадр растеризуется иначе.
- Шрифты: без встроенных экспорт отличается между машинами; `init` ждёт только шрифты из полей `fontFamily` слоёв.
- Экспорт медленнее реального времени из-за `VideoFrame`/энкодера (~25 мс на кадр даже на пустой сцене), не из-за рендера.

## Что осталось

1. Ждать шрифты эффектов: в `init` вызывать `effectFontFamilies(spec)` из `@/effects` (сейчас «слово на весь экран» может уйти системным шрифтом в первом кадре).
2. Дать эффектам позицию слова в кадре (раскладку строки лирики), чтобы частицы и акценты били из слова, а не по экрану.
3. Свести два пути эффектов: хост движка (`createEffect`) и `EffectsCompositor`, оставить один.
4. Фронту заменить `style.stub.ts` на `STYLE_PRESETS` и маппинг `ParamSpec.type` → `kind`.
5. Опционально: слой Butterchurn, акценты на уровне слов в караоке-слое, настройка качества спектрограммы.
