# Экспорт видео — итог (`src/export/`)

## Публичный API (`@/export`)

- `exportVideo({ renderer, timeline, scene, output, audio, durationSec, file?, writable?, config?, preferHardware?, onProgress?, signal? }) → Promise<ExportResult>` — покадровый рендер в своём OffscreenCanvas → VideoEncoder/AudioEncoder → mediabunny. `ExportResult = { blob | null, mimeType, fileExtension (с точкой), config, stats: { frames, elapsedSec, framesPerSec, realtimeFactor, bytes, phasesMs } }`. Отмена → `DOMException('AbortError')`, остальное → `ExportError`.
- `exportVideoInWorker(options)` — те же опции без `renderer`/`writable`; в воркере всегда `SceneRenderer`. Определение кодеков и ресемплинг — в основном потоке, timeline/PCM копируются, воркер уничтожается после экспорта. `canExportInWorker()`.
- `checkExportSupport(output, audioSpec | null, { preferHardware }) → { ok, config } | { ok: false, reason }` (причина по-русски).
- `pickSaveTarget(baseName, container, { prefer: 'file' | 'opfs' | 'memory' }) → SaveTarget { kind, file, name, cleanup() }` — **первым await в обработчике клика**. Затем `file: target.file` в экспорт, `deliverExport(target, result.blob)` после успеха, `target.cleanup()` после ошибки. `clearOpfsExports()` — при старте приложения.

## Что готово

MP4 (H.264 High→Main→Baseline + AAC) и WebM (VP9→VP8 + Opus); пресеты 720p–4K, 24/30/60 fps, битрейт по разрешению; HW-ускорение для H.264 (VP9 — программный, он быстрее). Обратное давление, прогресс с ETA, отмена ≈0,2 с. Воркер. Запись потоком в файл/OPFS; при отмене файл не коммитится. Синхронизация: щелчки ±0,1 мс, кадры точно на месте. WebGL2-кадры захватываются точно (8 режимов, 90/90). Тесты: юнит (codecs, support, audio, guardWritable, saveTarget), e2e в `e2e/export/`.

## Скорость (видимый Chrome, H.264 HW, 1080×1920@30)

| Случай                             | кадр/с  | × реалтайм  |
| ---------------------------------- | ------- | ----------- |
| SceneRenderer, реальный трек, 20 с | 83      | 2,8         |
| то же в воркере                    | 79      | 2,6         |
| 4K@30 (HW) / 4K@60 (SW)            | 32 / 21 | 1,06 / 0,36 |
| WebM VP9 1080p@30 (SW)             | 52      | 1,7         |

Узкое место — аппаратный кодер (~10 мс/кадр); рендер + захват + звук ≈ 1,5 мс.

## Ловушки

- Скрытая/фоновая вкладка (в т.ч. панель браузера Claude) троттлится в 4–5 раз — мерить только в видимом Chrome (Playwright).
- `showSaveFilePicker` требует user gesture: никаких await до `pickSaveTarget`. Playwright этот диалог не автоматизирует — проверять вручную.
- `scene` для воркера — только plain object (structured clone).
- WebM/Opus: сдвиг +6,6 мс (pre-skip без CodecDelay) — на слух незаметно.
- Прозрачный VP9 (`alpha: 'keep'`) Chrome не поддерживает → понятный отказ. HW H.264 не берёт 4K@60.
- Не импортировать mediabunny дважды разными путями (ломает instanceof → зависание).

## Что осталось

- Полный прогон трека 2:38 (воркер + OPFS: время, пиковая память, длительность) — не запускался, ждёт согласия пользователя:
  `EXPORT_FULL=1 E2E_BASE_URL=http://localhost:5179 npx playwright test e2e/export/export-full.spec.ts`
  (перед этим `npm run dev -- --port 5179 --strictPort`; другой трек — `EXPORT_TRACK=/test-media/<файл>.mp3`).
- Ручная проверка сохранения через диалог «Сохранить как»; прозрачность через отдельный альфа-поток; Opus CodecDelay.
