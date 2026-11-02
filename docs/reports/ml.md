# ML (Whisper) — отчёт сессии

## Публичный API (`@/ml`)

- `transcribe(mono16k: Float32Array, { language: 'ru'|'en'|'auto', quality?: 'light'|'max', vocalActivity?: TimeRange[], onProgress?, signal? }): Promise<RecognizedWord[]>` — тип `RecognizedWord` из `@/lyrics`; вызовы встают в очередь, буфер вызывающего не портится.
- `onProgress`: `{stage:'device', model, device, note}` → `{stage:'load', loaded, total}` (байты) → `{stage:'recognize', doneSec, totalSec}`.
- `estimateModelDownload(quality?) → { model, device, note, totalBytes, toDownloadBytes }`: если `toDownloadBytes === 0`, спрашивать «Загрузить N МБ?» не нужно.
- `listCachedModels()`, `deleteCachedModels()`, `deleteCachedModel(repo)`, `MAX_QUALITY_WARNING`, `toMono16k(blob)`, `probeDevice()`, `chooseConfig()`.

## Готово

- Своя обвязка Whisper `_timestamped` поверх `model.generate()`: окна по 30 с со своим seek, пословные таймкоды по DTW, уверенность слова = средняя вероятность токенов, своё определение языка ru/en.
- Против галлюцинаций: если окно упёрлось в лимит токенов, повтор декодирования с температурой 0.5; повторы n-грамм больше 4 подряд обрезаются; фильтр фраз «Субтитры сделал…» и т.п.
- Выбор режима: small, энкодер fp16 + декодер q4f16 на WebGPU; без WebGPU с fp16 или при памяти < 4 ГБ — q8 на WASM. При ошибке WebGPU — автоматический переход на WASM. Turbo (`quality:'max'`) — экспериментальный режим, грузится из `onnx-community`.
- Веса small берутся из `DarumOrt/whisper-small-timestamped-onnx` по `revision` из `models.json`. При скачивании потоково проверяются SHA-256 (`hash-wasm`) и размер.
- `scripts/models/publish_models.py` зеркалирует модели на HF и пишет `models.json`. Инструкция: `scripts/models/README.md`.
- Тестовая страница `dev/ml.html` (порт 5175, `window.mlBench`), юнит-тесты `src/ml/**/*.test.ts`.

## Ловушки

- **Память.** На встроенной графике WebGPU-буферы живут в общей RAM. Одна модель за раз, воркер уничтожается после прогона (`client.dispose()`); энкодер fp32 и turbo по умолчанию не использовать. Серия замеров разных моделей подряд однажды уронила Chrome и Claude Desktop.
- **Утечка KV-кэша.** `return_token_timestamps` включает `return_dict_in_generate`, и `generate` отдаёт `past_key_values`. Их надо вызывать `.dispose()`, иначе GPU-память течёт до «device lost».
- **transformers.js v4:**
  - автоопределения языка нет (по умолчанию молча `en`);
  - пайплайн не отдаёт вероятности токенов, отсюда `TokenProbRecorder`;
  - если передать `max_new_tokens`, внутренний seek отключается (это нам и нужно);
  - в `num_frames` передавать позиции энкодера (число сэмплов / 320), а не мел-кадры.
- ONNX Runtime WASM отдаётся с нашего сервера (`hub.ts`, импорт с суффиксом `?url`). Иначе transformers.js качает его с cdn.jsdelivr.net.
- Основной поток не должен импортировать transformers.js (тяжёлый бандл): `cache.ts`, `files.ts` и `resolve.ts` намеренно без него.
- Во встроенном браузере Claude (Electron) нет WebGPU — замеры делать только через Playwright.

## Осталось

- Замер WER (лёгкий WebGPU против WASM q8, по треку RU и EN). Запускать только когда машина свободна; нужен dev-сервер на 5175:
  `npm run dev -- --port 5175 --strictPort`, затем `E2E_BASE_URL=http://localhost:5175 npx playwright test e2e/ml`
  (по одному варианту на запуск Chrome; если свободно < 5 ГБ, тест пропускается; результаты — в `%TEMP%\swagtovideo-ml-bench.json`).
- Зеркало для turbo, если режим «Максимум» себя оправдает; проба CTC-выравнивателя (веха 3).
- Импорт моделей из файла; замена временного `toMono16k` на ресемплер модуля аудио.
