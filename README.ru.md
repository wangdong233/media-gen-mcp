<div align="center">

# media-gen-mcp

[![Price](https://img.shields.io/badge/Price-Free-success?style=flat-square)](#-получить-бесплатный-key)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](#license)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-6f42c1?style=flat-square)](https://modelcontextprotocol.io/)

**Бесплатный MCP-сервер генерации изображений и видео для Claude Code**

Текст в изображение / изображение в изображение / текст в видео / изображение в видео / анимация по ключевым кадрам — **всё бесплатно** (через Agnes AI и бесплатные модели Zhipu)

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | **Русский** | [Português](README.pt.md)

</div>

## ① Получить бесплатный Key

Зарегистрируйтесь на одной (или обеих) платформах ниже, чтобы получить бесплатный API key:

| Provider | Бесплатно | Как получить |
|---|---|---|
| **Agnes AI** (по умолчанию) | Все изображения и видео бесплатно | https://platform.agnes-ai.com/ → регистрация → API Keys |
| **Zhipu BigModel** (опционально, 4K / китайский) | cogview-3-flash для изображений + cogvideox-flash для видео — бесплатно навсегда | https://bigmodel.cn/usercenter/proj-mgmt/apikeys → верификация → создать key |

> Подробные инструкции: [руководство по Agnes](doc/Agnes%20开通指引.md) · [руководство по Zhipu](doc/Zhipu%20开通指引.md)

## ② Настройка (один раз)

Создайте `~/.media-gen-mcp/config.json` с вашим key:

```json
{
  "providers": {
    "agnes": { "apiKey": "sk-your-agnes-key" },
    "zhipu": { "apiKey": "your-zhipu-key" }
  }
}
```

Достаточно только agnes (удалите строку zhipu). Если не указать `models`, будут использованы встроенные значения по умолчанию.

## ③ Подключение к Claude Code

```bash
claude mcp add media-gen-mcp npx media-gen-mcp
```

Команда установки **не содержит key** (он уже указан в config выше). Выполните `/mcp` — `media-gen-mcp ✓ Connected` означает успешное подключение.

## ④ Использование

Просто скажите это в Claude Code (автоматический выбор подходящего provider/model):

| Сценарий | Что сказать | Результат |
|---|---|---|
| **По умолчанию** | «Сгенерируй фотореалистичное изображение кота» / «Сгенерируй 5-секундное видео с пляжем» | Использует defaultImageProvider / defaultVideoProvider |
| **Конкретный provider** | «Нарисуй через **Zhipu**» / «Сделай видео через **agnes**» | Временно переключает provider, не меняя config |
| **Конкретная модель** | «Нарисуй через **cogview-4**» / «Используй **agnes-video-v2.0**» | Выбирает конкретную модель (выше качество и т. п.) |
| **Provider + модель** | «Сделай 4K-видео через **Zhipu cogvideox-3**» | Точная спецификация (4K / первый-последний кадр) |
| **Изображение в изображение** | «Преврати это изображение в акварель» | Изображение-референс → новое изображение |
| **Изображение в видео** | «Преврати это изображение в видео» | Одно изображение → видео |
| **Ключевые кадры** | «Сделай плавный переход между этими двумя изображениями» | Несколько изображений → плавный переход |

> Если не указать спецификацию → используются значения по умолчанию; указание provider/model влияет только на текущий вызов и **не меняет ваш config**.

## Providers

| | По умолчанию | Изображения (бесплатно) | Видео (бесплатно) | Преимущества |
|---|:---:|---|---|---|
| **agnes** | ✅ | agnes-image-2.1-flash | agnes-video-v2.0 | Всё бесплатно, фотореализм, нативный звук |
| **zhipu** (опционально) | | cogview-3-flash | cogvideox-flash | 4K/60fps, нативный китайский, соответствует требованиям КНР |

Переключение: `defaultProvider: "zhipu"`, либо по типу контента через `defaultImageProvider`/`defaultVideoProvider`, либо передайте `provider` в конкретном вызове. Не знаете, что выбрать? См. [сравнение](doc/Agnes_vs_Zhipu_横评.md).

## 📌 Config (расширенно, обычно не требуется)

**Трёхуровневый fallback provider** (аргумент вызова > по типу контента > глобальный):

| Поле | По умолчанию | Описание |
|---|---|---|
| `defaultProvider` | `agnes` | Глобальное значение по умолчанию (финальный fallback, если ни один тип контента не задан) |
| `defaultImageProvider` | как `defaultProvider` | Значение для изображений (используется в `generate_image`) |
| `defaultVideoProvider` | как `defaultProvider` | Значение для видео (используется в `create_video` / `get_video`) |

Например, `defaultProvider: "agnes"` + `defaultVideoProvider: "zhipu"` → изображения через agnes, видео через Zhipu. Если опустить последние два поля, для всего будет применяться `defaultProvider`.

Настройки подключения конкретного provider:

| Поле | По умолчанию | Описание |
|---|---|---|
| `providers.<name>.apiKey` | — | **обязательно**, по одному на каждый provider |
| `providers.<name>.models.image.default` | встроенное у provider | модель изображений по умолчанию |
| `providers.<name>.models.video.default` | встроенное у provider | модель видео по умолчанию |
| `outDir` | session-dir/output | каталог вывода (можно переопределить в вызове) |

> Самообучение rate-limit (rateLimits / rateLimitTtlMs) и другие расширенные поля — см. [doc/](doc/).

## FAQ

**Видео генерируется медленно?** Длительность 3–18 с, занимает ~1–3 мин. Если опустить `wait`, процесс станет асинхронным с уведомлением о завершении.
**Количество кадров?** Передайте `durationSeconds` для автоматического выбора (5/10/18 с). Agnes допускает только 81/121/161/241/441.
**Получили 429?** Встроен 62-секундный сериализатор; автоматически определяет реальный rate limit.
**Config не читается?** Должен находиться по пути `~/.media-gen-mcp/config.json` (npx устанавливает в кэш; config внутри проекта недоступен).

## Архитектура и документация

Подключаемые provider (agnes + zhipu; добавление нового provider не требует изменений на уровне инструментов). Подробнее в [doc/](doc/):

- [руководство по Agnes](doc/Agnes%20开通指引.md) · [руководство по Zhipu](doc/Zhipu%20开通指引.md) · [сравнение Agnes vs Zhipu](doc/Agnes_vs_Zhipu_横评.md)

## 💝 Поддержать автора

Если media-gen-mcp оказался вам полезен, угостите автора кофе ☕

<div align="center">

WeChat | Alipay
:-: | :-:
<img src="doc/support-wechat.jpg" height="220" alt="WeChat"> | <img src="doc/support-alipay.jpg" height="220" alt="Alipay">

</div>

Также можно поставить ⭐ Star, открыть Issue / PR — любая поддержка приветствуется.

## License

[MIT](LICENSE)
