import asyncio
import logging

from aiogram import BaseMiddleware, Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

import db
from config import BOT_TOKEN, OWNER_ID
from handlers import main_menu


class OwnerOnlyMiddleware(BaseMiddleware):
    """Пропускает только владельца, остальных молча игнорирует."""

    async def __call__(self, handler, event, data):
        user = data.get("event_from_user")
        if user is None or user.id != OWNER_ID:
            return
        return await handler(event, data)


async def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    db.init_db()

    bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.update.outer_middleware(OwnerOnlyMiddleware())
    dp.include_routers(main_menu.router)

    # Пропускаем сообщения, пришедшие пока бот был выключен
    await bot.delete_webhook(drop_pending_updates=True)
    logging.info("Бот запущен. Остановить: Ctrl+C")
    await dp.start_polling(bot)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Бот остановлен")
