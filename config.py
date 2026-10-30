import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent

# Читаем настройки из .env рядом с этим файлом
load_dotenv(BASE_DIR / ".env")

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
OWNER_ID_RAW = os.getenv("OWNER_ID", "").strip()
# Адрес Mini App (https://...). Пока пустой — бот подскажет, что его нужно заполнить
WEBAPP_URL = os.getenv("WEBAPP_URL", "").strip()

if not BOT_TOKEN or "ваш-токен" in BOT_TOKEN or not OWNER_ID_RAW.isdigit():
    raise SystemExit(
        "Не заполнен файл .env: нужны BOT_TOKEN и OWNER_ID (только цифры). "
        "Образец — в .env.example."
    )

OWNER_ID = int(OWNER_ID_RAW)
